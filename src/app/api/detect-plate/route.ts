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

// ナンバープレート検知専用レスポンススキーマ: found + plates[]（各要素は found と corners: {x,y}[]）
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    found: {
      type: 'boolean',
      description: '画像内に1つ以上ナンバープレートが検出された場合true',
    },
    plates: {
      type: 'array',
      description: '検出したナンバープレートの配列。各要素は found と corners を持つ',
      items: {
        type: 'object',
        properties: {
          found: {
            type: 'boolean',
            description: '当該プレートが有効に検出された場合true',
          },
          corners: {
            type: 'array',
            description: '四隅の座標。時計回りに 左上・右上・右下・左下。0-1000で正規化',
            minItems: 4,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', minimum: 0, maximum: 1000, description: '横方向 0=左端 1000=右端' },
                y: { type: 'number', minimum: 0, maximum: 1000, description: '縦方向 0=上端 1000=下端' },
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

    // ナンバープレート四隅検知専用（0-1000）。プロンプトを最小化してレスポンス速度を優先
    const prompt = `ナンバープレート四隅0-1000。${imageWidth}x${imageHeight}。`;

    // v1 では responseMimeType/responseSchema が未対応のため v1beta を使用
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 14_000); // 14秒でタイムアウト（クライアント15sより短く）
    let geminiResponse: Response;
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
            topP: 0.8, // 0.95 → 0.8 に下げて処理速度を優先
            topK: 20, // 40 → 20 に下げて処理速度を優先
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      });
    } catch (fetchErr: unknown) {
      clearTimeout(timeoutId);
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        return NextResponse.json(
          {
            found: false,
            error: '解析がタイムアウトしました',
            userMessage: '解析に時間がかかりすぎました。もう一度お試しください。',
            status: 504,
            remainingToday: getDailyRemaining(clientId),
          },
          { status: 504 }
        );
      }
      throw fetchErr;
    }
    clearTimeout(timeoutId);

    if (!geminiResponse.ok) {
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
        errorBody = `エラーレスポンスの読み取りに失敗: ${e instanceof Error ? e.message : String(e)}`;
      }
      console.error('Gemini HTTP error:', geminiResponse.status, errorBody);

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
          ? '解析サービスが混雑しています。しばらく待ってから再度お試しください。'
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

    let geminiJson: any;
    try {
      geminiJson = await geminiResponse.json();
    } catch (jsonError) {
      console.error('Failed to parse Gemini response as JSON:', jsonError);
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
      console.error('Empty response from Gemini API:', geminiJson);
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
        console.log(`Detect-plate: found=${parsed.found}, plates=${parsed.plates.length}`);
      } else if (parsed.found && !Array.isArray(parsed.plates)) {
        parsed.found = false;
        parsed.plates = [];
      }

      (parsed as { remainingToday?: number }).remainingToday = getDailyRemaining(clientId);
      return NextResponse.json(parsed);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json({
        found: false,
        error: '座標の解析に失敗しました',
        userMessage: '座標の解析に失敗しました。もう一度撮影してお試しください。',
        rawResponse: jsonText.substring(0, 500),
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Gemini API error:', error);
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
