import { NextRequest, NextResponse } from 'next/server';
import {
  getDetectRemainingToday,
  incrementDetectSuccess,
  isValidDeviceId,
  resolvePlanContext,
} from '../../../lib/plan';
import { trackUsageEvent } from '../../../lib/usage-metrics';

export const runtime = 'nodejs';
export const maxDuration = 60; // Vercel 等のサーバー実行時間を最大60秒に延長

// gemini-2.0-flash は 2026-06-01 提供終了。
// 座標検出は gemini-2.5-flash（画像+structured output 実績あり）。上書き: GEMINI_DETECT_MODEL
// コスト重視: gemini-3.1-flash-lite / 高精度: gemini-3.5-flash
const DEFAULT_DETECT_MODEL = 'gemini-2.5-flash';

function getDetectModels(): string[] {
  const primary = process.env.GEMINI_DETECT_MODEL?.trim() || DEFAULT_DETECT_MODEL;
  const fallback = process.env.GEMINI_DETECT_MODEL_FALLBACK?.trim() || '';
  if (fallback && fallback !== primary) return [primary, fallback];
  return [primary];
}

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateLimitStore = new Map<string, number[]>();

type DetectErrorType =
  | 'rate_limited'
  | 'daily_limit'
  | 'bad_request'
  | 'config'
  | 'quota'
  | 'upstream'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'unknown';

function createRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch (_) {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function logStructured(level: 'info' | 'warn' | 'error', event: string, payload: Record<string, unknown>) {
  const body = JSON.stringify({ event, ...payload });
  if (level === 'error') {
    console.error(body);
    return;
  }
  if (level === 'warn') {
    console.warn(body);
    return;
  }
  console.log(body);
}

/** gemini-2.5-flash 有料単価（USD / 1M tokens）。試算用。 */
const GEMINI_25_FLASH_INPUT_USD_PER_M = 0.30;
const GEMINI_25_FLASH_OUTPUT_USD_PER_M = 2.50;

type GeminiUsageLog = {
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  thoughtsTokenCount: number | null;
  totalTokenCount: number | null;
  imageTokenCount: number | null;
  textPromptTokenCount: number | null;
  estimatedCostUsd: number | null;
};

function parseGeminiUsage(usageMetadata: unknown): GeminiUsageLog | null {
  if (!usageMetadata || typeof usageMetadata !== 'object') return null;
  const u = usageMetadata as Record<string, unknown>;
  const promptTokenCount = typeof u.promptTokenCount === 'number' ? u.promptTokenCount : null;
  const candidatesTokenCount = typeof u.candidatesTokenCount === 'number' ? u.candidatesTokenCount : null;
  const thoughtsTokenCount = typeof u.thoughtsTokenCount === 'number' ? u.thoughtsTokenCount : null;
  const totalTokenCount = typeof u.totalTokenCount === 'number' ? u.totalTokenCount : null;

  let imageTokenCount: number | null = null;
  let textPromptTokenCount: number | null = null;
  if (Array.isArray(u.promptTokensDetails)) {
    for (const detail of u.promptTokensDetails) {
      if (!detail || typeof detail !== 'object') continue;
      const row = detail as { modality?: unknown; tokenCount?: unknown };
      const count = typeof row.tokenCount === 'number' ? row.tokenCount : 0;
      const modality = String(row.modality ?? '').toUpperCase();
      if (modality === 'IMAGE') imageTokenCount = (imageTokenCount ?? 0) + count;
      else if (modality === 'TEXT') textPromptTokenCount = (textPromptTokenCount ?? 0) + count;
    }
  }

  const inputTokens = promptTokenCount ?? 0;
  const outputTokens = (candidatesTokenCount ?? 0) + (thoughtsTokenCount ?? 0);
  const estimatedCostUsd =
    promptTokenCount != null || candidatesTokenCount != null || thoughtsTokenCount != null
      ? (inputTokens * GEMINI_25_FLASH_INPUT_USD_PER_M + outputTokens * GEMINI_25_FLASH_OUTPUT_USD_PER_M) /
        1_000_000
      : null;

  return {
    promptTokenCount,
    candidatesTokenCount,
    thoughtsTokenCount,
    totalTokenCount,
    imageTokenCount,
    textPromptTokenCount,
    estimatedCostUsd: estimatedCostUsd != null ? Math.round(estimatedCostUsd * 1e8) / 1e8 : null,
  };
}

function logGeminiUsage(
  requestId: string,
  modelName: string,
  usageMetadata: unknown,
  extra: Record<string, unknown> = {}
) {
  const usage = parseGeminiUsage(usageMetadata);
  if (!usage) {
    logStructured('warn', 'detect.gemini_usage_missing', { requestId, modelName, ...extra });
    return null;
  }
  logStructured('info', 'detect.gemini_usage', {
    requestId,
    modelName,
    pricingModel: 'gemini-2.5-flash',
    ...usage,
    ...extra,
  });
  return usage;
}

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

function getCountryCode(request: NextRequest): string {
  const country = request.headers.get('x-vercel-ip-country')?.trim();
  if (country) return country.toUpperCase();
  const cloudflareCountry = request.headers.get('cf-ipcountry')?.trim();
  if (cloudflareCountry) return cloudflareCountry.toUpperCase();
  return 'UNKNOWN';
}

function getDeviceType(request: NextRequest): 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown' {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  if (!ua) return 'unknown';
  if (/bot|crawler|spider|slurp/.test(ua)) return 'bot';
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobi|iphone|android/.test(ua)) return 'mobile';
  return 'desktop';
}

function getDeviceIdFromRequest(request: NextRequest): string {
  const deviceId = request.headers.get('x-device-id')?.trim() || '';
  return deviceId && isValidDeviceId(deviceId) ? deviceId : '';
}

function isRateLimited(clientId: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  let timestamps = rateLimitStore.get(clientId) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);
  if (timestamps.length >= maxPerMinute) return true;
  timestamps.push(now);
  rateLimitStore.set(clientId, timestamps);
  return false;
}

const MAX_DETECT_PLATES = Math.min(
  3,
  Math.max(1, Number.parseInt(process.env.GEMINI_DETECT_MAX_PLATES ?? '3', 10) || 3)
);

const CORNER_POINT_SCHEMA = {
  type: 'object',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
  },
  required: ['x', 'y'],
} as const;

const NAMED_CORNERS_SCHEMA = {
  type: 'object',
  properties: {
    tl: CORNER_POINT_SCHEMA,
    tr: CORNER_POINT_SCHEMA,
    br: CORNER_POINT_SCHEMA,
    bl: CORNER_POINT_SCHEMA,
  },
  required: ['tl', 'tr', 'br', 'bl'],
} as const;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    plates: {
      type: 'array',
      description: 'visible license plates, most prominent first; empty if none',
      minItems: 0,
      maxItems: MAX_DETECT_PLATES,
      items: {
        type: 'object',
        properties: {
          corners: NAMED_CORNERS_SCHEMA,
        },
        required: ['corners'],
      },
    },
  },
  required: ['plates'],
} as const;

function buildDetectPrompt(imageWidth: number, imageHeight: number): string {
  return `# Role
You are a precise computer vision and image coordinate extraction assistant. Your sole task is to detect the license plate of a car in the provided image and return its exact four corners in order to apply a perspective warp (Homography).

# Goal
Output the exact pixel coordinates for the four corners of each visible license plate.
Even if the plate is skewed, tilted, or viewed from an angle (perspective distortion / trapezoid), you must trace the actual visible boundary lines of the plate. Do NOT return an axis-aligned bounding box.

# Image
The attached image is exactly ${imageWidth}×${imageHeight} pixels.

# JSON Output Format
Return ONLY a valid JSON object. No markdown, backticks, or extra text.

{
  "plates": [
    {
      "corners": {
        "tl": {"x": 0, "y": 0},
        "tr": {"x": 0, "y": 0},
        "br": {"x": 0, "y": 0},
        "bl": {"x": 0, "y": 0}
      }
    }
  ]
}

# Rules & Constraints
1. Coordinate System: Use absolute pixel coordinates of the provided ${imageWidth}×${imageHeight} image. (0,0) is top-left.
2. Strict Corner Ordering:
   - "tl": Top-Left corner of the license plate.
   - "tr": Top-Right corner of the license plate.
   - "br": Bottom-Right corner of the license plate.
   - "bl": Bottom-Left corner of the license plate.
   If the plate is heavily rotated, determine orientation from the text direction on the plate.
3. Follow the Slope: If the plate is slanted, the line connecting "tl" and "tr" must follow the slanted top edge of the plate.
4. Multiple plates: return up to ${MAX_DETECT_PLATES} entries in "plates", most prominent first.
5. No plate found: return {"plates": []}.
6. No explanations or reasoning keys.`;
}

/** 0–1000 正規化座標（クライアント互換） */
function clampToApiScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return Math.max(0, Math.min(1000, rounded));
}

/** モデル出力ピクセル座標 → 0–1000 正規化 */
function pixelToApiScale(
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number } {
  const xNorm = imageWidth > 0 ? (x / imageWidth) * 1000 : x;
  const yNorm = imageHeight > 0 ? (y / imageHeight) * 1000 : y;
  return { x: clampToApiScale(xNorm), y: clampToApiScale(yNorm) };
}

/** 旧形式（0–1000 グリッド）かピクセル座標かを推定 */
function coordsLookLikeNormalizedGrid(
  corners: { x: number; y: number }[],
  imageWidth: number,
  imageHeight: number
): boolean {
  const maxDim = Math.max(imageWidth, imageHeight);
  if (maxDim <= 1000) return false;
  return corners.every((c) => c.x >= 0 && c.y >= 0 && c.x <= 1000 && c.y <= 1000);
}

function scaleCornersToApi(
  corners: { x: number; y: number }[],
  imageWidth: number,
  imageHeight: number
): { x: number; y: number }[] {
  const useGrid = coordsLookLikeNormalizedGrid(corners, imageWidth, imageHeight);
  return corners.map((c) =>
    useGrid
      ? { x: clampToApiScale(c.x), y: clampToApiScale(c.y) }
      : pixelToApiScale(c.x, c.y, imageWidth, imageHeight)
  );
}

function isNullCorner(value: unknown): boolean {
  return value == null;
}

/** { tl, tr, br, bl } → [tl, tr, br, bl]（ピクセル→0–1000） */
function namedCornersToArray(
  cornersObj: unknown,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number }[] | null {
  if (!cornersObj || typeof cornersObj !== 'object') return null;
  const c = cornersObj as Record<string, unknown>;
  if (isNullCorner(c.tl) && isNullCorner(c.tr) && isNullCorner(c.br) && isNullCorner(c.bl)) {
    return null;
  }
  const ordered = [c.tl, c.tr, c.br, c.bl];
  if (!ordered.every(isValidCorner)) return null;
  return scaleCornersToApi(ordered as { x: number; y: number }[], imageWidth, imageHeight);
}

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

function plateEntryToCorners(
  entry: unknown,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number }[] | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as { points?: unknown; corners?: unknown };
  if (row.corners && typeof row.corners === 'object' && !Array.isArray(row.corners)) {
    return namedCornersToArray(row.corners, imageWidth, imageHeight);
  }
  const raw = row.points ?? row.corners;
  if (!Array.isArray(raw)) return null;
  const corners = raw.filter(isValidCorner).slice(0, 4);
  if (corners.length !== 4) return null;
  return scaleCornersToApi(corners, imageWidth, imageHeight);
}

/** parts と text から座標データを抽出。成功時は正規化済みオブジェクト、失敗時は null */
function tryParsePlateResponse(
  parts: unknown[],
  text: string,
  imageWidth: number,
  imageHeight: number
): Record<string, unknown> | null {
  for (const p of parts) {
    if (p != null && typeof p === 'object') {
      const po = p as Record<string, unknown>;
      const struct = po.struct as Record<string, unknown> | undefined;
      const obj: Record<string, unknown> | null =
        'plates' in po || 'points' in po || 'corners' in po
          ? po
          : struct &&
              typeof struct === 'object' &&
              ('plates' in struct || 'points' in struct || 'corners' in struct)
            ? struct
            : null;
      if (obj) {
        try {
          return normalizeParsedResponse(obj as Record<string, unknown>, imageWidth, imageHeight);
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
      if (
        value &&
        typeof value === 'object' &&
        ('points' in value || 'found' in value || 'plates' in value || 'corners' in value)
      ) {
        return normalizeParsedResponse(value as Record<string, unknown>, imageWidth, imageHeight);
      }
    } catch (_) {}
  }
  return null;
}

/** パース結果を正規化。plates[].corners / points → corners に統一し、最大 MAX_DETECT_PLATES 件まで */
function normalizeParsedResponse(
  parsed: Record<string, unknown>,
  imageWidth: number,
  imageHeight: number
): Record<string, unknown> {
  const normalizedPlates: { found: true; corners: { x: number; y: number }[] }[] = [];

  const pushCorners = (corners: { x: number; y: number }[]) => {
    if (normalizedPlates.length >= MAX_DETECT_PLATES) return;
    normalizedPlates.push({ found: true, corners });
  };

  if (Array.isArray(parsed.plates)) {
    for (const entry of parsed.plates) {
      const corners = plateEntryToCorners(entry, imageWidth, imageHeight);
      if (corners) pushCorners(corners);
    }
  }

  if (normalizedPlates.length === 0 && parsed.corners && typeof parsed.corners === 'object') {
    const corners = namedCornersToArray(parsed.corners, imageWidth, imageHeight);
    if (corners) pushCorners(corners);
  }

  if (normalizedPlates.length === 0 && Array.isArray(parsed.points)) {
    const corners = (parsed.points as unknown[]).filter(isValidCorner).slice(0, 4);
    if (corners.length === 4) {
      pushCorners(scaleCornersToApi(corners, imageWidth, imageHeight));
    }
  }

  if (normalizedPlates.length === 0 && Array.isArray(parsed.corners)) {
    const corners = (parsed.corners as unknown[]).filter(isValidCorner).slice(0, 4);
    if (corners.length === 4) {
      pushCorners(scaleCornersToApi(corners, imageWidth, imageHeight));
    }
  }

  const found = normalizedPlates.length > 0;
  return {
    found,
    plates: normalizedPlates,
    inferred: found,
  };
}

export async function GET(request: NextRequest) {
  const deviceId = getDeviceIdFromRequest(request);
  if (!deviceId) {
    return NextResponse.json({ remainingToday: null });
  }
  const planCtx = await resolvePlanContext(deviceId);
  const remainingToday = await getDetectRemainingToday(deviceId, planCtx);
  return NextResponse.json({
    remainingToday,
    plan: planCtx.plan,
    dailyDetectLimit: planCtx.features.dailyDetectLimit,
  });
}

export async function POST(request: NextRequest) {
  try {
    const requestId = createRequestId();
    const clientId = getClientId(request);
    const deviceId = getDeviceIdFromRequest(request);
    const planCtx = await resolvePlanContext(deviceId);
    let remainingToday = await getDetectRemainingToday(deviceId, planCtx);
    const rateLimitPerMinute = planCtx.features.rateLimitPerMinute;
    const usageMeta = {
      country: getCountryCode(request),
      deviceType: getDeviceType(request),
      plan: planCtx.plan,
    };
    await trackUsageEvent(clientId, 'detect_attempt', undefined, usageMeta);

    if (deviceId && planCtx.plan === 'free' && remainingToday !== null && remainingToday <= 0) {
      await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'daily_limit' });
      return NextResponse.json(
        {
          found: false,
          error: '本日の無料自動検出枠を使い切りました',
          userMessage: '本日の無料自動検出枠を使い切りました。手動で枠を調整してください。',
          errorType: 'daily_limit' as DetectErrorType,
          requestId,
          status: 429,
          remainingToday: 0,
          plan: planCtx.plan,
        },
        { status: 429 }
      );
    }

    if (isRateLimited(clientId, rateLimitPerMinute)) {
      await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'rate_limited' });
      return NextResponse.json(
        {
          found: false,
          error: 'リクエストが多すぎます',
          userMessage: `しばらく待ってからもう一度お試しください。（1分間に${rateLimitPerMinute}回まで）`,
          errorType: 'rate_limited' as DetectErrorType,
          retryAfterSeconds: 60,
          requestId,
          status: 429,
          remainingToday,
          plan: planCtx.plan,
        },
        { status: 429 }
      );
    }

    const requestStart = Date.now();
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;
    const imageWidth = parseInt(formData.get('width') as string) || 0;
    const imageHeight = parseInt(formData.get('height') as string) || 0;

    logStructured('info', 'detect.request_received', {
      requestId,
      sizeBytes: imageFile?.size || 0,
      imageWidth,
      imageHeight,
      hasDeviceId: Boolean(deviceId),
      plan: planCtx.plan,
    });

    if (!imageFile) {
      logStructured('error', 'detect.bad_request.no_image', { requestId });
      await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'bad_request' });
      return NextResponse.json({ error: '画像が送信されませんでした', errorType: 'bad_request', requestId }, { status: 400 });
    }
    if (!imageWidth || !imageHeight) {
      logStructured('error', 'detect.bad_request.invalid_dimensions', { requestId, imageWidth, imageHeight });
      await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'bad_request' });
      return NextResponse.json({ error: '画像サイズが送信されませんでした', errorType: 'bad_request', requestId }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logStructured('error', 'detect.config.missing_api_key', { requestId });
      await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'config' });
      return NextResponse.json({ error: 'GEMINI_API_KEYが設定されていません', errorType: 'config', requestId }, { status: 500 });
    }

    const arrayBufferStart = Date.now();
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Start = Date.now();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imageFile.type || 'image/jpeg';
    logStructured('info', 'detect.image_processed', {
      requestId,
      arrayBufferMs: base64Start - arrayBufferStart,
      base64Ms: Date.now() - base64Start,
      requestElapsedMs: Date.now() - requestStart,
      mimeType,
    });

    const prompt = buildDetectPrompt(imageWidth, imageHeight);

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
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
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

    const modelNames = getDetectModels();
    for (let modelIndex = 0; modelIndex < modelNames.length; modelIndex++) {
      const modelName = modelNames[modelIndex];
      const isLastModel = modelIndex === modelNames.length - 1;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);
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
          if ((res.status === 404 || res.status === 400) && !isLastModel) {
            logStructured('warn', 'detect.model_try_next', {
              requestId,
              modelName,
              status: res.status,
              reason: String(lastErrorMessage || '').substring(0, 200),
            });
            continue;
          }
          const isQuota = res.status === 429 || /quota|rate limit|exceeded/i.test(String(lastErrorMessage));
          const userMessage = isQuota
            ? 'サーバー側の利用制限に達しました。しばらく時間をおいて再度お試しください。位置を手動で調整することもできます。'
            : res.status === 403 || res.status === 404
              ? 'APIキーまたはモデル設定を確認してください。位置を手動で調整できます。'
              : '解析中にエラーが発生しました。位置を手動で調整してください。';
          const retryAfterHeader = res.headers.get('retry-after');
          const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined;
          const errorType: DetectErrorType = isQuota ? 'quota' : res.status === 403 || res.status === 404 ? 'config' : 'upstream';
          logStructured('error', 'detect.upstream_error', {
            requestId,
            modelName,
            status: res.status,
            errorType,
            retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
            message: String(lastErrorMessage || '').substring(0, 300),
          });
          await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType });
          return NextResponse.json(
            {
              found: false,
              error: userMessage,
              userMessage,
              errorType,
              retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
              requestId,
              remainingToday,
          plan: planCtx.plan,
            },
            { status: res.status === 429 ? 429 : 500 }
          );
        }

        let geminiJson: any;
        try {
          geminiJson = await res.json();
        } catch {
          logStructured('warn', 'detect.model_invalid_json', { requestId, modelName });
          await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'invalid_response' });
          return NextResponse.json({
            found: false,
            error: '座標の解析に失敗しました',
            userMessage: '座標の解析に失敗しました。位置を手動で調整してください。',
            errorType: 'invalid_response',
            requestId,
            remainingToday,
          plan: planCtx.plan,
          }, { status: 500 });
        }

        const candidate = geminiJson.candidates?.[0];
        const finishReason = candidate?.finishReason ?? null;
        logGeminiUsage(requestId, modelName, geminiJson.usageMetadata, {
          imageWidth,
          imageHeight,
          finishReason,
        });

        if (!candidate?.content) {
          logStructured('warn', 'detect.model_empty_content', { requestId, modelName });
          await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'invalid_response' });
          return NextResponse.json({
            found: false,
            error: '座標の解析に失敗しました',
            userMessage: '座標の解析に失敗しました。位置を手動で調整してください。',
            errorType: 'invalid_response',
            requestId,
            remainingToday,
          plan: planCtx.plan,
          }, { status: 500 });
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

        const parsed = tryParsePlateResponse(parts, text, imageWidth, imageHeight);
        if (parsed) {
          await incrementDetectSuccess(deviceId, planCtx);
          remainingToday = await getDetectRemainingToday(deviceId, planCtx);
          (parsed as { remainingToday?: number | null }).remainingToday = remainingToday;
          (parsed as { requestId?: string }).requestId = requestId;
          (parsed as { plan?: string }).plan = planCtx.plan;
          await trackUsageEvent(clientId, 'detect_success', undefined, usageMeta);
          logStructured('info', 'detect.success', {
            requestId,
            modelName,
            found: Boolean(parsed.found),
            platesCount: (parsed.plates as unknown[])?.length || 0,
            elapsedMs: Date.now() - startTime,
            ...(parseGeminiUsage(geminiJson.usageMetadata) ?? {}),
          });
          return NextResponse.json(parsed);
        }

        lastRawText = text;
        logStructured('warn', 'detect.model_parse_failed', {
          requestId,
          modelName,
          rawSnippet: text.substring(0, 500),
        });
        await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'invalid_response' });
        return NextResponse.json({
          found: false,
          error: '座標の解析に失敗しました',
          userMessage: '座標の解析に失敗しました。位置を手動で調整してください。',
          errorType: 'invalid_response',
          requestId,
          remainingToday,
          plan: planCtx.plan,
          rawResponse: text.substring(0, 500),
        }, { status: 500 });
      } catch (fetchErr: unknown) {
        clearTimeout(timeoutId);
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
          logStructured('error', 'detect.timeout', {
            requestId,
            modelName,
            elapsedMs: Date.now() - startTime,
          });
          await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'timeout' });
          return NextResponse.json(
            {
              found: false,
              error: '解析がタイムアウトしました',
              userMessage: '解析に時間がかかりすぎました。位置を手動で調整してください。',
              errorType: 'timeout',
              requestId,
              status: 504,
              remainingToday,
          plan: planCtx.plan,
            },
            { status: 504 }
          );
        }
        logStructured('error', 'detect.network_error', {
          requestId,
          modelName,
          message: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
        });
        await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'network' });
        return NextResponse.json(
          {
            found: false,
            error: '通信エラー',
            userMessage: '通信エラーです。位置を手動で調整してください。',
            errorType: 'network',
            requestId,
            remainingToday,
          plan: planCtx.plan,
          },
          { status: 500 }
        );
      }
    }

    if (!lastRawText && (lastStatus === 404 || lastStatus === 400)) {
      logStructured('error', 'detect.config_invalid_model_or_key', { requestId, lastStatus });
      await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'config' });
      return NextResponse.json({
        found: false,
        error: 'APIキーまたはモデル設定を確認してください',
        userMessage: 'APIキーまたはモデル設定を確認してください。位置を手動で調整できます。',
        errorType: 'config',
        requestId,
        remainingToday,
          plan: planCtx.plan,
      }, { status: 500 });
    }
    logStructured('error', 'detect.invalid_response_all_models_failed', {
      requestId,
      lastStatus,
      rawSnippet: (lastRawText || '').substring(0, 1000),
    });
    await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'invalid_response' });
    return NextResponse.json({
      found: false,
      error: '座標の解析に失敗しました',
      userMessage: '座標の解析に失敗しました。位置を手動で調整してください。',
      errorType: 'invalid_response',
      requestId,
      remainingToday,
          plan: planCtx.plan,
      rawResponse: (lastRawText || '').substring(0, 500),
    }, { status: 500 });
  } catch (error) {
    const requestId = createRequestId();
    const clientId = getClientId(request);
    await trackUsageEvent(clientId, 'detect_failure', undefined, {
      country: getCountryCode(request),
      deviceType: getDeviceType(request),
      errorType: 'unknown',
    });
    logStructured('error', 'detect.unexpected_error', {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: 'ナンバープレートの検出に失敗しました',
        userMessage: 'ナンバープレートの検出に失敗しました。しばらく経ってから再度お試しください。',
        errorType: 'unknown',
        requestId,
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
