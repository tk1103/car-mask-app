/**
 * Carkus プラン仕様（2026）
 *
 * Free:
 *   - AI自動検出: 1日 FREE_DAILY_DETECT_LIMIT 回（デフォルト 3、サーバー強制）
 *   - 上限後も手動編集・保存は可（Gemini を叩かない）
 *   - 独自ロゴ不可 / 保存に透かし
 *
 * Pro:
 *   - AI自動検出: 日次上限なし（PRO_DAILY_DETECT_LIMIT=0）または高上限
 *   - 独自ロゴ可 / 透かしなし
 *   - 分あたりレート制限を緩和
 *
 * 課金連携:
 *   - BILLING_ENABLED=true のときのみ Pro 判定・有効化 API が有効
 *   - β公開時は BILLING_ENABLED 未設定（= false）で全員 Free
 *   - 現状: PLAN_ACTIVATION_CODES + KV で Pro 付与（決済後にコード配布）
 *   - 将来: Stripe Webhook から grantPro() を呼ぶ
 */
import { kv } from '@vercel/kv';

export type Plan = 'free' | 'pro';
export type PlanSource = 'force' | 'kv' | 'allowlist' | 'default' | 'billing_disabled';

export type PlanFeatures = {
  customLogo: boolean;
  watermarkOnExport: boolean;
  /** 0 = 実質無制限 */
  dailyDetectLimit: number;
  rateLimitPerMinute: number;
};

export type PlanContext = {
  plan: Plan;
  source: PlanSource;
  features: PlanFeatures;
};

const FREE_DAILY_DETECT_LIMIT = Math.max(
  0,
  Number.parseInt(process.env.FREE_DAILY_DETECT_LIMIT ?? '3', 10) || 3
);
const PRO_DAILY_DETECT_LIMIT = Number.parseInt(process.env.PRO_DAILY_DETECT_LIMIT ?? '0', 10);
const FREE_RATE_LIMIT_PER_MINUTE = Math.max(
  1,
  Number.parseInt(process.env.FREE_RATE_LIMIT_PER_MINUTE ?? '5', 10) || 5
);
const PRO_RATE_LIMIT_PER_MINUTE = Math.max(
  1,
  Number.parseInt(process.env.PRO_RATE_LIMIT_PER_MINUTE ?? '15', 10) || 15
);

const PRO_KV_PREFIX = 'carkus:pro:';
const DETECT_KV_PREFIX = 'carkus:detect:';
const KV_TTL_SECONDS = 60 * 60 * 24 * 400; // ~13 months

const memoryProDevices = new Set<string>();
const memoryProExpiry = new Map<string, number>();
const memoryDetectCounts = new Map<string, number>();

function isKvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/** 課金機能の有効化。未設定または false なら β 同様に Free のみ。 */
export function isBillingEnabled(): boolean {
  return process.env.BILLING_ENABLED === 'true';
}

function normalizePlan(value?: string | null): Plan {
  return value?.toLowerCase() === 'pro' ? 'pro' : 'free';
}

export function isValidDeviceId(deviceId: string): boolean {
  const id = deviceId.trim();
  return /^[0-9a-f-]{36}$/i.test(id) || /^d-\d+-[a-z0-9]+$/i.test(id);
}

export function getJstDateString(): string {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jstDate = new Date(jstMs);
  const y = jstDate.getUTCFullYear();
  const m = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getFeatures(plan: Plan): PlanFeatures {
  if (plan === 'pro') {
    return {
      customLogo: true,
      watermarkOnExport: false,
      dailyDetectLimit: PRO_DAILY_DETECT_LIMIT,
      rateLimitPerMinute: PRO_RATE_LIMIT_PER_MINUTE,
    };
  }
  return {
    customLogo: false,
    watermarkOnExport: true,
    dailyDetectLimit: FREE_DAILY_DETECT_LIMIT,
    rateLimitPerMinute: FREE_RATE_LIMIT_PER_MINUTE,
  };
}

function getEnvAllowlistPro(deviceId: string): boolean {
  const raw = process.env.PRO_DEVICE_IDS?.trim() || '';
  if (!raw || !deviceId) return false;
  const ids = new Set(raw.split(',').map((id) => id.trim()).filter(Boolean));
  return ids.has(deviceId);
}

async function isKvPro(deviceId: string): Promise<boolean> {
  const key = `${PRO_KV_PREFIX}${deviceId}`;
  if (isKvConfigured()) {
    try {
      const raw = await kv.get<string>(key);
      if (!raw) return false;
      if (raw === 'lifetime') return true;
      const expiresAt = Date.parse(raw);
      if (!Number.isFinite(expiresAt)) return true;
      if (expiresAt > Date.now()) return true;
      await kv.del(key);
      return false;
    } catch {
      return memoryProDevices.has(deviceId);
    }
  }
  if (!memoryProDevices.has(deviceId)) return false;
  const exp = memoryProExpiry.get(deviceId);
  if (exp && exp <= Date.now()) {
    memoryProDevices.delete(deviceId);
    memoryProExpiry.delete(deviceId);
    return false;
  }
  return true;
}

export async function resolvePlanContext(deviceId: string): Promise<PlanContext> {
  if (process.env.FORCE_PLAN?.trim()) {
    const plan = normalizePlan(process.env.FORCE_PLAN);
    return { plan, source: 'force', features: getFeatures(plan) };
  }

  if (!isBillingEnabled()) {
    return { plan: 'free', source: 'billing_disabled', features: getFeatures('free') };
  }

  if (deviceId && isValidDeviceId(deviceId)) {
    if (await isKvPro(deviceId)) {
      return { plan: 'pro', source: 'kv', features: getFeatures('pro') };
    }
    if (getEnvAllowlistPro(deviceId)) {
      return { plan: 'pro', source: 'allowlist', features: getFeatures('pro') };
    }
  }

  const plan = normalizePlan(process.env.DEFAULT_PLAN);
  return { plan, source: 'default', features: getFeatures(plan) };
}

function detectCountKey(deviceId: string, date: string): string {
  return `${DETECT_KV_PREFIX}${deviceId}:${date}`;
}

async function getDetectCount(deviceId: string, date: string): Promise<number> {
  const key = detectCountKey(deviceId, date);
  if (isKvConfigured()) {
    try {
      const n = await kv.get<number>(key);
      return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;
    } catch {
      return memoryDetectCounts.get(key) ?? 0;
    }
  }
  return memoryDetectCounts.get(key) ?? 0;
}

export async function getDetectRemainingToday(deviceId: string, ctx: PlanContext): Promise<number | null> {
  if (!deviceId || !isValidDeviceId(deviceId)) return null;
  const limit = ctx.features.dailyDetectLimit;
  if (limit <= 0) return null; // unlimited
  const used = await getDetectCount(deviceId, getJstDateString());
  return Math.max(0, limit - used);
}

export async function incrementDetectSuccess(deviceId: string, ctx: PlanContext): Promise<void> {
  if (!deviceId || !isValidDeviceId(deviceId)) return;
  const limit = ctx.features.dailyDetectLimit;
  if (limit <= 0) return;
  const date = getJstDateString();
  const key = detectCountKey(deviceId, date);
  if (isKvConfigured()) {
    try {
      const next = await kv.incr(key);
      if (next === 1) await kv.expire(key, 60 * 60 * 24 * 8);
      return;
    } catch {
      // fall through to memory
    }
  }
  memoryDetectCounts.set(key, (memoryDetectCounts.get(key) ?? 0) + 1);
}

export async function grantPro(
  deviceId: string,
  options?: { lifetime?: boolean; days?: number }
): Promise<void> {
  if (!isBillingEnabled()) {
    throw new Error('Billing is disabled');
  }
  if (!isValidDeviceId(deviceId)) {
    throw new Error('Invalid device id');
  }
  const key = `${PRO_KV_PREFIX}${deviceId}`;
  let value = 'lifetime';
  if (!options?.lifetime) {
    const days = Math.max(1, options?.days ?? 30);
    value = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }
  if (isKvConfigured()) {
    await kv.set(key, value, { ex: KV_TTL_SECONDS });
    return;
  }
  memoryProDevices.add(deviceId);
  if (value !== 'lifetime') {
    memoryProExpiry.set(deviceId, Date.parse(value));
  } else {
    memoryProExpiry.delete(deviceId);
  }
}

export function isActivationCodeValid(code: string): boolean {
  const normalized = code.trim();
  if (!normalized) return false;
  const secret = process.env.PLAN_ACTIVATION_SECRET?.trim();
  if (secret && normalized === secret) return true;
  const raw = process.env.PLAN_ACTIVATION_CODES?.trim() || '';
  if (!raw) return false;
  const codes = new Set(raw.split(',').map((c) => c.trim()).filter(Boolean));
  return codes.has(normalized);
}

export function getPlanLimitsForDocs() {
  return {
    freeDailyDetectLimit: FREE_DAILY_DETECT_LIMIT,
    proDailyDetectLimit: PRO_DAILY_DETECT_LIMIT,
    freeRateLimitPerMinute: FREE_RATE_LIMIT_PER_MINUTE,
    proRateLimitPerMinute: PRO_RATE_LIMIT_PER_MINUTE,
  };
}
