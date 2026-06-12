import { NextRequest, NextResponse } from 'next/server';
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

// 簡易レート制限: headers から IP を取得し、同一IPは1分間に5回まで
const RATE_LIMIT_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// 1日あたりの利用回数の「目安値」。バックエンドではこの値でハード制限は行わず、UI 向けの参考情報としてのみ利用する。
const DAILY_LIMIT_PER_CLIENT = 20;

const rateLimitStore = new Map<string, number[]>();
const dailyLimitStore = new Map<string, { count: number; date: string }>();

type DetectErrorType =
  | 'rate_limited'
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
    points: {
      type: 'array',
      description: 'single license plate corners',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'x' },
          y: { type: 'number', description: 'y' },
        },
        required: ['x', 'y'],
      },
    },
    reasoning: { type: 'string', description: 'why these points were inferred' },
  },
  required: ['points'],
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

function clampToApiScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return Math.max(0, Math.min(1000, rounded));
}

/** parts と text から座標データを抽出。成功時は正規化済みオブジェクト、失敗時は null */
function tryParsePlateResponse(parts: unknown[], text: string): Record<string, unknown> | null {
  for (const p of parts) {
    if (p != null && typeof p === 'object') {
      const po = p as Record<string, unknown>;
      const struct = po.struct as Record<string, unknown> | undefined;
      const obj: Record<string, unknown> | null =
        ('points' in po || ('found' in po && 'plates' in po))
          ? po
          : (struct && typeof struct === 'object' && ('points' in struct || 'found' in struct) ? struct : null);
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
      if (value && typeof value === 'object' && ('points' in value || 'found' in value || 'plates' in value)) {
        return normalizeParsedResponse(value as Record<string, unknown>);
      }
    } catch (_) {}
  }
  return null;
}

/** パース結果をスキーマに合わせて正規化（plates が無くても corners があれば復元） */
function normalizeParsedResponse(parsed: Record<string, unknown>): Record<string, unknown> {
  const points = Array.isArray(parsed.points) ? (parsed.points as unknown[]).filter(isValidCorner).slice(0, 4) : [];
  const result: Record<string, unknown> = {
    found: points.length === 4 ? true : Boolean(parsed.found),
    plates: Array.isArray(parsed.plates) ? parsed.plates : [],
  };
  if (points.length === 4) {
    result.plates = [{ found: true, corners: points }];
  }
  if (typeof parsed.reasoning === 'string') {
    result.reasoning = parsed.reasoning.trim().slice(0, 1200);
  }
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
    corners: (p as { corners: unknown[] }).corners.filter(isValidCorner).slice(0, 4).map((c) => ({
      x: clampToApiScale(c.x),
      y: clampToApiScale(c.y),
    })),
  }));
  if (validPlates.length === 0) result.found = false;
  // AI 推論結果をクライアントで明示できるようにフラグ化
  result.inferred = Boolean(result.found);
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
    const requestId = createRequestId();
    const clientId = getClientId(request);
    const quotaId = getQuotaId(request);
    const usageMeta = {
      country: getCountryCode(request),
      deviceType: getDeviceType(request),
    };
    await trackUsageEvent(clientId, 'detect_attempt', undefined, usageMeta);

    if (isRateLimited(clientId)) {
      await trackUsageEvent(clientId, 'detect_failure', undefined, { ...usageMeta, errorType: 'rate_limited' });
      return NextResponse.json(
        {
          found: false,
          error: 'リクエストが多すぎます',
          userMessage: 'しばらく待ってからもう一度お試しください。（1分間に5回まで）',
          errorType: 'rate_limited' as DetectErrorType,
          retryAfterSeconds: 60,
          requestId,
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

    logStructured('info', 'detect.request_received', {
      requestId,
      sizeBytes: imageFile?.size || 0,
      imageWidth,
      imageHeight,
      hasQuotaId: Boolean(quotaId),
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

    const prompt = [
      'You are an expert in image analysis for vehicle license plates.',
      'Task: detect the four corners of each visible license plate.',
      'If corners are partially occluded (grass, shadow, poles, dirt) or outside image bounds, logically infer and complete the true geometric rectangle that the plate should have.',
      'Output coordinates on an integer [0..1000] scale where (0,0)=top-left and (1000,1000)=bottom-right.',
      'Corner order must be Top-Left, Top-Right, Bottom-Right, Bottom-Left.',
      'Return ONLY valid JSON in this exact shape:',
      '{"points":[{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0},{"x":0,"y":0}],"reasoning":"short reason"}',
      'No markdown, no extra keys, no explanations outside JSON.',
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
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        // 4点座標だけ欲しいので thinking を切り、JSON 出力枠を確保
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
              remainingToday: getDailyRemaining(clientId),
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
            remainingToday: getDailyRemaining(clientId),
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
            remainingToday: getDailyRemaining(clientId),
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

        const parsed = tryParsePlateResponse(parts, text);
        if (parsed) {
          (parsed as { remainingToday?: number }).remainingToday = getDailyRemaining(clientId);
          (parsed as { requestId?: string }).requestId = requestId;
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
          remainingToday: getDailyRemaining(clientId),
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
              remainingToday: getDailyRemaining(clientId),
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
            remainingToday: getDailyRemaining(clientId),
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
        remainingToday: getDailyRemaining(clientId),
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
      remainingToday: getDailyRemaining(clientId),
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
