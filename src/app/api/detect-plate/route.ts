import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60; // Vercel 等のサーバー実行時間を最大60秒に延長

const MODEL_NAMES = ['gemini-3-flash-preview', 'gemini-2.0-flash'] as const;

// 簡易レート制限: headers から IP を取得し、同一IPは1分間に5回まで
const RATE_LIMIT_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// 1日あたり20回（フロント表示用の目安）。バックエンドでのハード制限は一旦オフにする。
const DAILY_LIMIT_PER_CLIENT = 20;

const rateLimitStore = new Map<string, number[]>();
const dailyLimitStore = new Map<string, { count: number; date: string }>();

/** デバイスID（UUID または d- プレフィックスならデバイス単位で制限）。無効な場合はIPで識別（レート制限用） */
function getClientId(request: NextRequest): string {
  const deviceId = request.headers.get('x-device-id')?.trim();
  if (deviceId && ( /^[0-9a-f-]{36}$/i.test(deviceId) || /^d-\d+-[a-z0-9]+$/i.test(deviceId) )) return `device:${deviceId}`;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim() ?? '';
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'anonymous';
}

/** 日次利用回数の制限は「デバイスID がある場合のみ」適用（IP 共有による誤検知を避ける）。
 *  現状は UI 用の残数表示のみに利用し、サーバー側でブロックはしない。 */
function getQuotaId(request: NextRequest): string | null {
  const deviceId = request.headers.get('x-device-id')?.trim();
  if (deviceId && ( /^[0-9a-f-]{36}$/i.test(deviceId) || /^d-\d+-[a-z0-9]+$/i.test(deviceId) )) {
    return `device:${deviceId}`;
  }
  return null;
}

/** 1日の境界を JST（UTC+9）で計算。日本時間の 0:00 でリセットされる */
function getTodayDateString(): string {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jstDate = new Date(jstMs);
  const y = jstDate.getUTCFullYear();
  const m = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isOverDailyLimit(clientId: string): boolean {
  const today = getTodayDateString();
  let entry = dailyLimitStore.get(clientId);
  if (!entry || entry.date !== today) {
    entry = { count: 0, date: today };
    dailyLimitStore.set(clientId, entry);
  }
  return entry.count >= DAILY_LIMIT_PER_CLIENT;
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
  if (!entry || entry.date !== today) return DAILY_LIMIT_PER_CLIENT;
  return Math.max(0, DAILY_LIMIT_PER_CLIENT - entry.count);
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
      const ch = s[i];
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0 && ch === '}') {
          end = i;
          break;
        }
      }
    }
    if (end !== -1) s = s.slice(firstBrace, end + 1);
  }
  // トレイリングカンマを除去（, ] や , } は JSON では無効だが Gemini が出力することがある）
  s = s.replace(/,(\s*[}\]])/g, '$1');
  while (s.match(/,(\s*[}\]])/)) {
    s = s.replace(/,(\s*[}\]])/g, '$1');
  }
  // キー名のシングルクォートをダブルに
  s = s.replace(/'([^']*)'(\s*):/g, '"$1"$2:');
  // 行・ブロックコメントを除去
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/\/\/[^\n]*/g, '');
  // 制御文字・BOM を除去
  s = s.replace(/^\uFEFF/, '').replace(/[\x00-\x1F\x7F]/g, ' ');
  return s;
}

/** テキストから複数の JSON オブジェクト候補を抽出してパースを試行 */
function extractAllJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf('{', i);
    if (idx === -1) break;
    let depth = 0;
    let end = -1;
    for (let j = idx; j < text.length; j++) {
      const ch = text[j];
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0 && ch === '}') {
          end = j;
          break;
        }
      }
    }
    if (end !== -1) {
      const slice = text.slice(idx, end + 1);
      const normalized = extractAndNormalizeJson(slice);
      if (normalized && normalized.startsWith('{')) candidates.push(normalized);
      i = end + 1;
    } else {
      i = idx + 1;
    }
  }
  return candidates;
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

/** parts と text から座標データを抽出。成功時は正規化済みオブジェクト、失敗時は null */
function tryParsePlateResponse(parts: unknown[], text: string): Record<string, unknown> | null {
  for (const p of parts) {
    if (p != null && typeof p === 'object') {
      const po = p as Record<string, unknown>;
      const struct = po.struct as Record<string, unknown> | undefined;
      const obj: Record<string, unknown> | null = ('found' in po && 'plates' in po) ? po : (struct && typeof struct === 'object' && 'found' in struct ? struct : null);
      if (obj) {
        try {
          return normalizeParsedResponse(obj as Record<string, unknown>);
        } catch (_) {}
      }
    }
  }
  const jsonCandidates = [
    extractAndNormalizeJson(text),
    text.trim(),
    ...extractAllJsonCandidates(text),
  ];
  const seen = new Set<string>();
  const uniqueCandidates = jsonCandidates.filter((s) => s && s.length > 10 && !seen.has(s) && (seen.add(s), true));
  for (const jsonText of uniqueCandidates) {
    try {
      const value = JSON.parse(jsonText);
      if (value && typeof value === 'object' && ('found' in value || 'plates' in value)) {
        return normalizeParsedResponse(value as Record<string, unknown>);
      }
    } catch (_) {}
  }
  return null;
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

export async function GET(request: NextRequest) {
  const quotaId = getQuotaId(request);
  if (!quotaId) {
    // デバイスIDが無い場合は「残り回数不明」として扱い、フロント側で 20回 を表示させる
    return NextResponse.json({ remainingToday: null });
  }
  // 日次カウンタは UI 表示用のみ。実際のブロックは行わない。
  return NextResponse.json({ remainingToday: getDailyRemaining(quotaId) });
}

export async function POST(request: NextRequest) {
  try {
    const clientId = getClientId(request);
    const quotaId = getQuotaId(request);

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

    // NOTE: quotaId に対する日次カウントは現在 UI 用にのみ利用し、ここではインクリメントしない。

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
      'You are a precise license plate detector. Detect the 4 corners of the license plate.',
      'Coordinates: [0,0] is top-left, [1000,1000] is bottom-right.',
      'Return ONLY JSON in this format: {"found": true, "plates": [{"found": true, "corners": [{"x": 123, "y": 456}, ...]}]}.',
      'Order: Top-Left, Top-Right, Bottom-Right, Bottom-Left.',
    ].join(' ');

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
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
      safetySettings: [
        // BLOCK_NONE でナンバープレート画像が個人情報としてブロックされないようにする
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    });

    const startTime = Date.now();
    let lastErrorBody = '';
    let lastStatus = 0;
    let lastErrorMessage = '';
    let lastRawText = '';

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

        if (!res.ok) {
          lastErrorBody = await res.text().catch(() => '');
          const errJson: any = (() => { try { return JSON.parse(lastErrorBody); } catch { return null; } })();
          lastErrorMessage = errJson?.error?.message ?? errJson?.error ?? lastErrorBody;
          if (res.status === 404 || res.status === 400) {
            console.warn(`[detect-plate] Model ${modelName} returned ${res.status}, trying next.`, lastErrorMessage?.substring(0, 200));
            continue;
          }
          const isQuota = res.status === 429 || /quota|rate limit|exceeded/i.test(String(lastErrorMessage));
          const userMessage = isQuota
            ? 'サーバー側の利用制限に達しました。しばらく時間をおいて再度お試しください。位置を手動で調整することもできます。'
            : res.status === 403 || res.status === 404
              ? 'APIキーまたはモデル設定を確認してください。位置を手動で調整できます。'
              : '解析中にエラーが発生しました。位置を手動で調整してください。';
          return NextResponse.json(
            { found: false, error: userMessage, userMessage, remainingToday: getDailyRemaining(clientId) },
            { status: res.status === 429 ? 429 : 500 }
          );
        }

        let geminiJson: any;
        try {
          geminiJson = await res.json();
        } catch {
          console.warn(`[detect-plate] Model ${modelName}: response body parse failed, trying next`);
          continue;
        }

        const candidate = geminiJson.candidates?.[0];
        if (!candidate?.content) {
          console.warn(`[detect-plate] Model ${modelName}: no candidate content, trying next`);
          continue;
        }

        const content = candidate.content;
        const parts = content?.parts ?? [];
        const text = parts
          .map((p: any) => {
            if (p != null && typeof p === 'object') {
              if (typeof p.text === 'string') return p.text;
              if ('found' in p && 'plates' in p) return JSON.stringify(p);
              if (p.struct && typeof p.struct === 'object' && 'found' in p.struct) return JSON.stringify(p.struct);
            }
            return '';
          })
          .join('') ?? '';

        const parsed = tryParsePlateResponse(parts, text);
        if (parsed) {
          (parsed as { remainingToday?: number }).remainingToday = getDailyRemaining(clientId);
          console.log(`[detect-plate] Success (${modelName}): found=${parsed.found}, plates=${(parsed.plates as unknown[])?.length || 0}, elapsed=${Date.now() - startTime}ms`);
          return NextResponse.json(parsed);
        }

        lastRawText = text;
        console.warn(`[detect-plate] Model ${modelName}: coordinate parse failed, trying next. Raw (500 chars):`, text.substring(0, 500));
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

    if (!lastRawText && (lastStatus === 404 || lastStatus === 400)) {
      return NextResponse.json({
        found: false,
        error: 'APIキーまたはモデル設定を確認してください',
        userMessage: 'APIキーまたはモデル設定を確認してください。位置を手動で調整できます。',
        remainingToday: getDailyRemaining(clientId),
      }, { status: 500 });
    }
    console.error(`[detect-plate] All models failed. Last raw text:`, (lastRawText || '').substring(0, 1000));
    return NextResponse.json({
      found: false,
      error: '座標の解析に失敗しました',
      userMessage: '座標の解析に失敗しました。位置を手動で調整してください。',
      remainingToday: getDailyRemaining(clientId),
      rawResponse: (lastRawText || '').substring(0, 500),
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
