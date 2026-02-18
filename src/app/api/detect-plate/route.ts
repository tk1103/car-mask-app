import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60; // Vercel 等のサーバー実行時間を最大60秒に延長

// 2026年3月廃止対応: Gemini 3 系（v1beta で responseSchema 対応）
const MODEL_NAME = 'gemini-3-flash-preview';

// 簡易レート制限: headers から IP を取得し、同一IPは1分間に5回まで
const RATE_LIMIT_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// 簡易IP制限: 1日あたり20回（サーバー再起動でリセット。ベータ用）
const DAILY_LIMIT_PER_IP = 20;

const rateLimitStore = new Map<string, number[]>();
const dailyLimitStore = new Map<string, { count: number; date: string }>();

function getClientId(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim() ?? '';
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'anonymous';
}

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function isOverDailyLimit(clientId: string): boolean {
  const today = getTodayDateString();
  let entry = dailyLimitStore.get(clientId);
  if (!entry || entry.date !== today) {
    entry = { count: 0, date: today };
    dailyLimitStore.set(clientId, entry);
  }
  return entry.count >= DAILY_LIMIT_PER_IP;
}

function incrementDailyCount(clientId: string): void {
  const today = getTodayDateString();
  let entry = dailyLimitStore.get(clientId);
  if (!entry || entry.date !== today) {
    entry = { count: 0, date: today };
    dailyLimitStore.set(clientId, entry);
  }
  entry.count += 1;
}

function getDailyRemaining(clientId: string): number {
  const today = getTodayDateString();
  const entry = dailyLimitStore.get(clientId);
  if (!entry || entry.date !== today) return DAILY_LIMIT_PER_IP;
  return Math.max(0, DAILY_LIMIT_PER_IP - entry.count);
}

function isRateLimited(clientId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  let timestamps = rateLimitStore.get(clientId) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);
  if (timestamps.length >= RATE_LIMIT_PER_MINUTE) return true;
  timestamps.push(now);
  rateLimitStore.set(clientId, timestamps);
  return false;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'found' },
    plates: {
      type: 'array',
      description: 'plates',
      items: {
        type: 'object',
        properties: {
          found: { type: 'boolean', description: 'found' },
          corners: {
            type: 'array',
            description: 'corners',
            minItems: 4,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', minimum: 0, maximum: 1000, description: 'x' },
                y: { type: 'number', minimum: 0, maximum: 1000, description: 'y' },
              },
              required: ['x', 'y'],
            },
          },
        },
        required: ['found', 'corners'],
      },
    },
  },
  required: ['found', 'plates'],
} as const;

export async function POST(request: NextRequest) {
  try {
    const clientId = getClientId(request);

    if (isOverDailyLimit(clientId)) {
      return NextResponse.json(
        {
          found: false,
          error: '1日の利用制限に達しました',
          userMessage: 'Carkusuベータ版の1日あたりの利用制限（20回）に達しました。また明日お試しください',
          status: 429,
          remainingToday: 0,
        },
        { status: 429 }
      );
    }

    if (isRateLimited(clientId)) {
      return NextResponse.json(
        {
          found: false,
          error: 'リクエストが多すぎます',
          userMessage: 'しばらく待ってからもう一度お試しください。（1分間に5回まで）',
          status: 429,
          remainingToday: getDailyRemaining(clientId),
        },
        { status: 429 }
      );
    }

    incrementDailyCount(clientId);

    const formData = await request.formData();
    const imageFile = formData.get('image') as File;
    const imageWidth = parseInt(formData.get('width') as string) || 0;
    const imageHeight = parseInt(formData.get('height') as string) || 0;

    if (!imageFile) {
      return NextResponse.json({ error: '画像が送信されませんでした' }, { status: 400 });
    }
    if (!imageWidth || !imageHeight) {
      return NextResponse.json({ error: '画像サイズが送信されませんでした' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません' }, { status: 500 });
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imageFile.type || 'image/jpeg';

    const prompt = "Detect license plates. Return JSON only. Order corners [0:top-left, 1:top-right, 2:bottom-right, 3:bottom-left] by text orientation.";

    // v1 では responseMimeType/responseSchema が未対応のため v1beta を使用
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000); // 15秒（Gemini応答待ち。クライアント17sより短く）
    let geminiResponse: Response;
    const startTime = Date.now();
    try {
      geminiResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inlineData: { data: base64Image, mimeType } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            topP: 0.1,
            topK: 1,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      });
    } catch (fetchErr: unknown) {
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        console.error(`[detect-plate] Gemini API timeout after ${elapsed}ms`);
        return NextResponse.json(
          {
            found: false,
            error: '解析がタイムアウトしました',
            userMessage: '解析サーバが混雑しています。しばらく待ってから再度お試しください。',
            status: 504,
            remainingToday: getDailyRemaining(clientId),
          },
          { status: 504 }
        );
      }
      console.error(`[detect-plate] Gemini API fetch error after ${elapsed}ms:`, fetchErr);
      throw fetchErr;
    }
    clearTimeout(timeoutId);
    const fetchElapsed = Date.now() - startTime;

    if (!geminiResponse.ok) {
      const elapsed = Date.now() - startTime;
      console.error(`[detect-plate] Gemini API error ${geminiResponse.status} after ${elapsed}ms`);
      let errorBody: string;
      let errorJson: any = null;
      try {
        errorBody = await geminiResponse.text();
        try {
          errorJson = JSON.parse(errorBody);
        } catch {
          // ignore
        }
      } catch (e) {
        errorBody = '';
      }

      let errorMessage = 'Gemini API HTTPエラー';
      if (errorJson?.error?.message) errorMessage = errorJson.error.message;
      else if (errorJson?.error) errorMessage = String(errorJson.error);

      const isQuota =
        geminiResponse.status === 429 ||
        /quota|rate limit|exceeded/i.test(String(errorMessage));
      const isHighDemand =
        geminiResponse.status === 503 ||
        /high demand|experiencing.*demand|try again later|overloaded|resource exhausted/i.test(String(errorMessage));
      const userMessage = isQuota
        ? '本日の検出回数の上限に達しました。明日またお試しください。'
        : isHighDemand
          ? '解析サーバが混雑しています。しばらく待ってから再度お試しください。'
          : '解析中にエラーが発生しました。しばらく経ってから再度お試しください。';

      return NextResponse.json(
        {
          found: false,
          error: userMessage,
          userMessage,
          status: geminiResponse.status,
          rawResponse: errorBody?.substring?.(0, 1000),
        },
        { status: geminiResponse.status === 429 ? 429 : 500 }
      );
    }

    const parseStart = Date.now();
    let geminiJson: any;
    try {
      geminiJson = await geminiResponse.json();
    } catch {
      const elapsed = Date.now() - startTime;
      console.error(`[detect-plate] Failed to parse JSON after ${elapsed}ms`);
      const text = await geminiResponse.text();
      return NextResponse.json({
        found: false,
        error: 'Gemini APIの応答を解析できませんでした',
        userMessage: '解析の応答を読み取れませんでした。しばらく経ってから再度お試しください。',
        rawResponse: text.substring(0, 500),
      }, { status: 500 });
    }

    const text =
      geminiJson.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text ?? '')
        .join('') ?? '';

    if (!text?.trim()) {
      const elapsed = Date.now() - startTime;
      console.error(`[detect-plate] Empty response after ${elapsed}ms`);
      return NextResponse.json({
        found: false,
        error: 'Gemini APIから空の応答が返されました',
        userMessage: '解析結果が空でした。もう一度撮影してお試しください。',
        rawResponse: JSON.stringify(geminiJson).substring(0, 500),
      }, { status: 500 });
    }

    let jsonText = text.trim();
    if (jsonText.includes('```json')) {
      jsonText = jsonText.split('```json')[1]?.split('```')[0]?.trim() ?? jsonText;
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.split('```')[1]?.split('```')[0]?.trim() ?? jsonText;
    }

    try {
      const parsed = JSON.parse(jsonText);

      if (parsed.found && Array.isArray(parsed.plates)) {
        const validPlates = parsed.plates.filter(
          (p: any) => p?.found && Array.isArray(p?.corners) && p.corners.length === 4
        );
        if (validPlates.length === 0) {
          parsed.found = false;
          parsed.plates = [];
        } else {
          parsed.plates = validPlates;
        }
      } else if (parsed.found && !Array.isArray(parsed.plates)) {
        parsed.found = false;
        parsed.plates = [];
      }

      (parsed as { remainingToday?: number }).remainingToday = getDailyRemaining(clientId);
      const totalElapsed = Date.now() - startTime;
      console.log(`[detect-plate] Success: found=${parsed.found}, plates=${parsed.plates?.length || 0}, elapsed=${totalElapsed}ms`);
      return NextResponse.json(parsed);
    } catch {
      const elapsed = Date.now() - startTime;
      console.error(`[detect-plate] JSON parse error after ${elapsed}ms`);
      return NextResponse.json({
        found: false,
        error: '座標の解析に失敗しました',
        userMessage: '座標の解析に失敗しました。もう一度撮影してお試しください。',
        rawResponse: jsonText.substring(0, 500),
      }, { status: 500 });
    }
  } catch (error) {
    console.error('[detect-plate] Unexpected error:', error);
    return NextResponse.json(
      {
        error: 'ナンバープレートの検出に失敗しました',
        userMessage: 'ナンバープレートの検出に失敗しました。しばらく経ってから再度お試しください。',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
