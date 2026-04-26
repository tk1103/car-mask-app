import { kv } from '@vercel/kv';

type UsageEvent = 'detect_attempt' | 'detect_success' | 'detect_failure';

type UsageSummary = {
  date: string;
  uniqueUsers: number;
  detectAttempts: number;
  detectSuccess: number;
  detectFailure: number;
  storage: 'kv' | 'memory';
  kvConfigured: boolean;
  missingEnvVars: string[];
  kvError?: string;
};

const MEMORY_STORE = {
  usersByDate: new Map<string, Set<string>>(),
  countersByDate: new Map<string, { detectAttempts: number; detectSuccess: number; detectFailure: number }>(),
};

function getTodayDateStringJst(): string {
  const now = new Date();
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jstDate = new Date(jstMs);
  const y = jstDate.getUTCFullYear();
  const m = String(jstDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isKvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function getMissingKvEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.KV_REST_API_URL) missing.push('KV_REST_API_URL');
  if (!process.env.KV_REST_API_TOKEN) missing.push('KV_REST_API_TOKEN');
  return missing;
}

function getSetKey(date: string): string {
  return `metrics:${date}:active_users`;
}

function getCounterKey(date: string): string {
  return `metrics:${date}:counters`;
}

function normalizeUserId(userId: string): string {
  if (userId.startsWith('device:')) return userId;
  if (!userId) return 'anonymous';
  return `ip:${userId}`;
}

export async function trackUsageEvent(userId: string, event: UsageEvent, date = getTodayDateStringJst()): Promise<void> {
  const normalizedUserId = normalizeUserId(userId);
  if (isKvConfigured()) {
    try {
      const setKey = getSetKey(date);
      const counterKey = getCounterKey(date);
      const ttlSeconds = 60 * 60 * 24 * 8;
      const counterField = event === 'detect_attempt' ? 'detectAttempts' : event === 'detect_success' ? 'detectSuccess' : 'detectFailure';
      await Promise.all([
        kv.sadd(setKey, normalizedUserId),
        kv.expire(setKey, ttlSeconds),
        kv.hincrby(counterKey, counterField, 1),
        kv.expire(counterKey, ttlSeconds),
      ]);
      return;
    } catch (error) {
      console.error('[usage-metrics] KV write failed. Falling back to memory.', error);
    }
  }

  const users = MEMORY_STORE.usersByDate.get(date) ?? new Set<string>();
  users.add(normalizedUserId);
  MEMORY_STORE.usersByDate.set(date, users);
  const counters = MEMORY_STORE.countersByDate.get(date) ?? { detectAttempts: 0, detectSuccess: 0, detectFailure: 0 };
  if (event === 'detect_attempt') counters.detectAttempts += 1;
  if (event === 'detect_success') counters.detectSuccess += 1;
  if (event === 'detect_failure') counters.detectFailure += 1;
  MEMORY_STORE.countersByDate.set(date, counters);
}

export async function getUsageSummary(date = getTodayDateStringJst()): Promise<UsageSummary> {
  if (isKvConfigured()) {
    try {
      const [uniqueUsersRaw, countersRaw] = await Promise.all([
        kv.scard(getSetKey(date)),
        kv.hgetall<Record<string, string | number>>(getCounterKey(date)),
      ]);
      const uniqueUsers = Number(uniqueUsersRaw || 0);
      const detectAttempts = Number(countersRaw?.detectAttempts || 0);
      const detectSuccess = Number(countersRaw?.detectSuccess || 0);
      const detectFailure = Number(countersRaw?.detectFailure || 0);
      return {
        date,
        uniqueUsers,
        detectAttempts,
        detectSuccess,
        detectFailure,
        storage: 'kv',
        kvConfigured: true,
        missingEnvVars: [],
      };
    } catch (error) {
      return {
        date,
        uniqueUsers: 0,
        detectAttempts: 0,
        detectSuccess: 0,
        detectFailure: 0,
        storage: 'memory',
        kvConfigured: false,
        missingEnvVars: [],
        kvError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const users = MEMORY_STORE.usersByDate.get(date) ?? new Set<string>();
  const counters = MEMORY_STORE.countersByDate.get(date) ?? { detectAttempts: 0, detectSuccess: 0, detectFailure: 0 };
  return {
    date,
    uniqueUsers: users.size,
    detectAttempts: counters.detectAttempts,
    detectSuccess: counters.detectSuccess,
    detectFailure: counters.detectFailure,
    storage: 'memory',
    kvConfigured: false,
    missingEnvVars: getMissingKvEnvVars(),
  };
}
