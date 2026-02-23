import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60; // Vercel 等のサーバー実行時間を最大60秒に延長

// 安定版・高速。1.5-flash が 404 の場合は 2.0-flash を利用
const MODEL_NAMES = ['gemini-1.5-flash', 'gemini-2.0-flash'] as const;

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

/** Gemini の返答テキストから JSON 文字列を抽出し、パースしやすく正規化する */
function extractAndNormalizeJson(raw: string): string {
  let s = raw.trim();
  // マークダウンコードブロックを除去
  if (s.includes('```json')) {
    const m = s.match(/```json\s*([\s\S]*?)```/);
    if (m?.[1]) s = m[1].trim();
  } else if (s.includes('```')) {
    const m = s.match(/```\s*([\s\S]*?)```/);
    if (m?.[1]) s = m[1].trim();
  }
  // 先頭・末尾の説明文を除去（最初の { から最後の } までを抽出）
  const firstBrace = s.indexOf('{');
  if (firstBrace !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = firstBrace; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end !== -1) s = s.slice(firstBrace, end + 1);
  }
  // トレイリングカンマを除去（, ] や , } は JSON では無効だが Gemini が出力することがある）
  s = s.replace(/,(\s*[}\]])/g, '$1');
  // 複数箇所のトレイリングカンマを再適用（ネストした配列内など）
  while (s.match(/,(\s*[}\]])/)) {
    s = s.replace(/,(\s*[}\]])/g, '$1');
  }
  // キー名のシングルクォートをダブルに（"key": の形に）— 簡易: " の直後でない ' の連続を " に
  s = s.replace(/'([^']*)'(\s*):/g, '"$1"$2:');
  // 行・ブロックコメントを除去（Gemini がたまに混入）
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/\/\/[^\n]*/g, '');
  return s;
}

/** 正規化済みの座標オブジェクトかどうか簡易チェック */
function isValidCorner(c: unknown): c is { x: number; y: number } {
  return (
    c !== null &&
    typeof c === 'object' &&
    typeof (c as { x?: unknown }).x === 'number' &&
    typeof (c as { y?: unknown }).y === 'number'
  );
}

/** パース結果をスキーマに合わせて正規化（plates が無くても corners があれば復元） */
function normalizeParsedResponse(parsed: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    found: Boolean(parsed.found),
    plates: Array.isArray(parsed.plates) ? parsed.plates : [],
  };
  const plates = result.plates as unknown[];
  if (plates.length === 0 && parsed.corners && Array.isArray(parsed.corners)) {
    const corners = (parsed.corners as unknown[]).filter(isValidCorner);
    if (corners.length === 4) {
      result.plates = [{ found: true, corners }];
      result.found = true;
    }
  }
  const validPlates = (result.plates as unknown[]).filter(
    (p: unknown) =>
      p !== null &&
      typeof p === 'object' &&
      Array.isArray((p as { corners?: unknown }).corners) &&
      ((p as { corners: unknown[] }).corners).filter(isValidCorner).length === 4
  );
  result.plates = validPlates.map((p: unknown) => ({
    found: true,
    corners: (p as { corners: unknown[] }).corners.filter(isValidCorner).slice(0, 4),
  }));
  if (validPlates.length === 0) result.found = false;
  return result;
}

/** 残り回数だけ取得（消費しない）。撮影前にクライアントが確認する用 */
export async function GET(request: NextRequest) {
  const clientId = getClientId(request);
  return NextResponse.json({ remainingToday: getDailyRemaining(clientId) });
}

export async function POST(request: NextRequest) {
  try {
    const clientId = getClientId(request);

    if (isOverDailyLimit(clientId)) {
      return NextResponse.json(
        {
          found: false,
          error: '1日の利用制限に達しました',
          userMessage: 'Carkusベータ版の1日あたりの利用制限（20回）に達しました。また明日お試しください',
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

    const requestStart = Date.now();
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;
    const imageWidth = parseInt(formData.get('width') as string) || 0;
    const imageHeight = parseInt(formData.get('height') as string) || 0;

    console.log(`[detect-plate] Request received: size=${imageFile?.size || 0} bytes, dimensions=${imageWidth}x${imageHeight}`);

    if (!imageFile) {
      console.error(`[detect-plate] No image file received`);
      return NextResponse.json({ error: '画像が送信されませんでした' }, { status: 400 });
    }
    if (!imageWidth || !imageHeight) {
      console.error(`[detect-plate] Invalid dimensions: ${imageWidth}x${imageHeight}`);
      return NextResponse.json({ error: '画像サイズが送信されませんでした' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error(`[detect-plate] GEMINI_API_KEY not set`);
      return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません' }, { status: 500 });
    }

    const arrayBufferStart = Date.now();
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Start = Date.now();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imageFile.type || 'image/jpeg';
    console.log(`[detect-plate] Image processed: arrayBuffer=${base64Start - arrayBufferStart}ms, base64=${Date.now() - base64Start}ms, total=${Date.now() - requestStart}ms`);

    const prompt = [
      'Detect the license plate 4 corners in this image. Coordinates 0-1000 for both axes.',
      'Return only JSON: {"found":true,"plates":[{"found":true,"corners":[{"x":n,"y":n},{"x":n,"y":n},{"x":n,"y":n},{"x":n,"y":n}]}]} or {"found":false,"plates":[]}. No other text.',
    ].join(' ');

    // v1beta で responseMimeType/responseSchema を使用
    const urlTemplate = (model: string) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = JSON.stringify({
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
        maxOutputTokens: 400,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    });

    const startTime = Date.now();
    let geminiResponse: Response | null = null;
    let lastErrorBody = '';
    let lastStatus = 0;
    let lastErrorMessage = '';

    for (const modelName of MODEL_NAMES) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45_000);
      try {
        const res = await fetch(urlTemplate(modelName), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body,
        });
        clearTimeout(timeoutId);
        lastStatus = res.status;
        if (res.ok) {
          geminiResponse = res;
          break;
        }
        lastErrorBody = await res.text().catch(() => '');
        const errJson: any = (() => { try { return JSON.parse(lastErrorBody); } catch { return null; } })();
        lastErrorMessage = errJson?.error?.message ?? errJson?.error ?? lastErrorBody;
        // 404/400 はモデル名違いの可能性があるので次のモデルを試す
        if (res.status === 404 || res.status === 400) {
          console.warn(`[detect-plate] Model ${modelName} returned ${res.status}, trying next.`, lastErrorMessage?.substring(0, 200));
          continue;
        }
        break;
      } catch (fetchErr: unknown) {
        clearTimeout(timeoutId);
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
          console.error(`[detect-plate] Gemini API timeout (model ${modelName}) after ${Date.now() - startTime}ms`);
          return NextResponse.json(
            {
              found: false,
              error: '解析がタイムアウトしました',
              userMessage: '解析に時間がかかりすぎました。位置を手動で調整してください。',
              status: 504,
              remainingToday: getDailyRemaining(clientId),
            },
            { status: 504 }
          );
        }
        console.error(`[detect-plate] Gemini API fetch error (model ${modelName}):`, fetchErr);
        return NextResponse.json(
          {
            found: false,
            error: '通信エラー',
            userMessage: '通信エラーです。位置を手動で調整してください。',
            remainingToday: getDailyRemaining(clientId),
          },
          { status: 500 }
        );
      }
    }

    if (!geminiResponse || !geminiResponse.ok) {
      const isQuota =
        lastStatus === 429 ||
        /quota|rate limit|exceeded/i.test(String(lastErrorMessage));
      const userMessage = isQuota
        ? '本日の検出回数の上限に達しました。明日またお試しください。'
        : lastStatus === 403 || lastStatus === 404
          ? 'APIキーまたはモデル設定を確認してください。位置を手動で調整できます。'
          : '解析中にエラーが発生しました。位置を手動で調整してください。';
      console.error(`[detect-plate] Gemini API error ${lastStatus}:`, lastErrorMessage?.substring(0, 300));
      return NextResponse.json(
        {
          found: false,
          error: userMessage,
          userMessage,
          status: lastStatus === 429 ? 429 : 500,
          remainingToday: getDailyRemaining(clientId),
          rawResponse: lastErrorBody?.substring?.(0, 500),
        },
        { status: lastStatus === 429 ? 429 : 500 }
      );
    }

    const geminiResponseFinal = geminiResponse;

    const parseStart = Date.now();
    let geminiJson: any;
    try {
      geminiJson = await geminiResponseFinal.json();
    } catch {
      const elapsed = Date.now() - startTime;
      console.error(`[detect-plate] Failed to parse JSON after ${elapsed}ms`);
      let rawText = '';
      try {
        rawText = await geminiResponseFinal.text();
      } catch {
        // body already consumed
      }
      return NextResponse.json({
        found: false,
        error: 'Gemini APIの応答を解析できませんでした',
        userMessage: '解析の応答を読み取れませんでした。しばらく経ってから再度お試しください。',
        rawResponse: rawText.substring(0, 500),
      }, { status: 500 });
    }

    const candidate = geminiJson.candidates?.[0];
    if (!candidate?.content) {
      const elapsed = Date.now() - startTime;
      const blockReason = geminiJson.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'no candidate content';
      console.error(`[detect-plate] No candidate content after ${elapsed}ms`, {
        blockReason,
        finishReason: candidate?.finishReason,
        rawSnippet: JSON.stringify(geminiJson).substring(0, 600),
      });
      return NextResponse.json({
        found: false,
        error: '解析結果がありません',
        userMessage: blockReason === 'SAFETY' || blockReason === 'RECITATION'
          ? '画像の内容により解析をスキップしました。別の写真でお試しください。'
          : '解析結果が空でした。もう一度撮影してお試しください。',
        rawResponse: JSON.stringify(geminiJson).substring(0, 500),
      }, { status: 500 });
    }
    const content = candidate.content;
    const parts = content?.parts ?? [];
    // テキスト: parts[].text の結合。構造化出力で part がオブジェクトの場合は JSON 文字列に
    let text =
      parts
        .map((p: any) => {
          if (p != null && typeof p === 'object') {
            if (typeof p.text === 'string') return p.text;
            // responseSchema でオブジェクトがそのまま返る場合
            if ('found' in p && 'plates' in p) return JSON.stringify(p);
          }
          return '';
        })
        .join('') ?? '';

    if (!text?.trim()) {
      const elapsed = Date.now() - startTime;
      const finishReason = candidate?.finishReason ?? geminiJson.promptFeedback?.blockReason ?? 'unknown';
      console.error(`[detect-plate] Empty response after ${elapsed}ms`, {
        finishReason,
        partsCount: parts.length,
        hasContent: !!content,
        rawSnippet: JSON.stringify(geminiJson).substring(0, 800),
      });
      const isSafety = finishReason === 'SAFETY' || finishReason === 'RECITATION' || geminiJson.promptFeedback?.blockReason;
      return NextResponse.json({
        found: false,
        error: 'Gemini APIから空の応答が返されました',
        userMessage: isSafety
          ? '画像の内容により解析をスキップしました。別の写真でお試しください。'
          : '解析結果が空でした。もう一度撮影してお試しください。',
        rawResponse: JSON.stringify(geminiJson).substring(0, 500),
      }, { status: 500 });
    }

    const jsonCandidates = [
      extractAndNormalizeJson(text),
      text.trim(),
    ];
    let parseErr: unknown = null;
    let parsed: Record<string, unknown> | null = null;

    for (const jsonText of jsonCandidates) {
      if (!jsonText) continue;
      try {
        const value = JSON.parse(jsonText);
        if (value && typeof value === 'object') {
          parsed = normalizeParsedResponse(value as Record<string, unknown>);
          break;
        }
      } catch (e) {
        parseErr = e;
      }
    }

    if (parsed) {
      (parsed as { remainingToday?: number }).remainingToday = getDailyRemaining(clientId);
      const totalElapsed = Date.now() - startTime;
      console.log(`[detect-plate] Success: found=${parsed.found}, plates=${(parsed.plates as unknown[])?.length || 0}, elapsed=${totalElapsed}ms`);
      return NextResponse.json(parsed);
    }

    const elapsed = Date.now() - startTime;
    const errorMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error(`[detect-plate] JSON parse error after ${elapsed}ms: ${errorMsg}`);
    console.error(`[detect-plate] Raw text (first 1000 chars):`, text.substring(0, 1000));
    return NextResponse.json({
      found: false,
      error: '座標の解析に失敗しました',
      userMessage: '座標の解析に失敗しました。画像サイズや明るさを確認して、もう一度撮影してお試しください。',
      rawResponse: text.substring(0, 500),
    }, { status: 500 });
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
