import { kv } from '@vercel/kv';

type UsageEvent =
  | 'detect_attempt'
  | 'detect_success'
  | 'detect_failure'
  | 'upgrade_click'
  | 'feature_blocked_by_plan';

type UsageSummary = {
  date: string;
  uniqueUsers: number;
  detectAttempts: number;
  detectSuccess: number;
  detectFailure: number;
  upgradeClick: number;
  featureBlockedByPlan: number;
  storage: 'kv' | 'memory';
  kvConfigured: boolean;
  missingEnvVars: string[];
  kvError?: string;
  countryCounts?: Record<string, number>;
  deviceTypeCounts?: Record<string, number>;
};

const MEMORY_STORE = {
  usersByDate: new Map<string, Set<string>>(),
  countersByDate: new Map<
    string,
    {
      detectAttempts: number;
      detectSuccess: number;
      detectFailure: number;
      upgradeClick: number;
      featureBlockedByPlan: number;
    }
  >(),
  countryCountsByDate: new Map<string, Record<string, number>>(),
  deviceCountsByDate: new Map<string, Record<string, number>>(),
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

function getCountryCounterKey(date: string): string {
  return `metrics:${date}:country_counts`;
}

function getDeviceCounterKey(date: string): string {
  return `metrics:${date}:device_counts`;
}

function normalizeUserId(userId: string): string {
  if (userId.startsWith('device:')) return userId;
  if (!userId) return 'anonymous';
  return `ip:${userId}`;
}

function normalizeCountry(country?: string): string {
  const value = (country || 'unknown').trim().toUpperCase();
  return value || 'UNKNOWN';
}

function normalizeDeviceType(deviceType?: string): string {
  const value = (deviceType || 'unknown').trim().toLowerCase();
  if (value === 'mobile' || value === 'desktop' || value === 'tablet' || value === 'bot') return value;
  return 'unknown';
}

type TrackUsageMeta = {
  country?: string;
  deviceType?: string;
};

export async function trackUsageEvent(
  userId: string,
  event: UsageEvent,
  date = getTodayDateStringJst(),
  meta?: TrackUsageMeta
): Promise<void> {
  const normalizedUserId = normalizeUserId(userId);
  const country = normalizeCountry(meta?.country);
  const deviceType = normalizeDeviceType(meta?.deviceType);
  if (isKvConfigured()) {
    try {
      const setKey = getSetKey(date);
      const counterKey = getCounterKey(date);
      const countryCounterKey = getCountryCounterKey(date);
      const deviceCounterKey = getDeviceCounterKey(date);
      const ttlSeconds = 60 * 60 * 24 * 8;
      const counterField =
        event === 'detect_attempt'
          ? 'detectAttempts'
          : event === 'detect_success'
            ? 'detectSuccess'
            : event === 'detect_failure'
              ? 'detectFailure'
              : event === 'upgrade_click'
                ? 'upgradeClick'
                : 'featureBlockedByPlan';
      await Promise.all([
        kv.sadd(setKey, normalizedUserId),
        kv.expire(setKey, ttlSeconds),
        kv.hincrby(counterKey, counterField, 1),
        kv.expire(counterKey, ttlSeconds),
        event === 'detect_attempt' ? kv.hincrby(countryCounterKey, country, 1) : Promise.resolve(0),
        event === 'detect_attempt' ? kv.expire(countryCounterKey, ttlSeconds) : Promise.resolve(0),
        event === 'detect_attempt' ? kv.hincrby(deviceCounterKey, deviceType, 1) : Promise.resolve(0),
        event === 'detect_attempt' ? kv.expire(deviceCounterKey, ttlSeconds) : Promise.resolve(0),
      ]);
      return;
    } catch (error) {
      console.error('[usage-metrics] KV write failed. Falling back to memory.', error);
    }
  }

  const users = MEMORY_STORE.usersByDate.get(date) ?? new Set<string>();
  users.add(normalizedUserId);
  MEMORY_STORE.usersByDate.set(date, users);
  const counters = MEMORY_STORE.countersByDate.get(date) ?? {
    detectAttempts: 0,
    detectSuccess: 0,
    detectFailure: 0,
    upgradeClick: 0,
    featureBlockedByPlan: 0,
  };
  if (event === 'detect_attempt') counters.detectAttempts += 1;
  if (event === 'detect_success') counters.detectSuccess += 1;
  if (event === 'detect_failure') counters.detectFailure += 1;
  if (event === 'upgrade_click') counters.upgradeClick += 1;
  if (event === 'feature_blocked_by_plan') counters.featureBlockedByPlan += 1;
  MEMORY_STORE.countersByDate.set(date, counters);
  if (event === 'detect_attempt') {
    const countryMap = MEMORY_STORE.countryCountsByDate.get(date) ?? {};
    countryMap[country] = (countryMap[country] ?? 0) + 1;
    MEMORY_STORE.countryCountsByDate.set(date, countryMap);

    const deviceMap = MEMORY_STORE.deviceCountsByDate.get(date) ?? {};
    deviceMap[deviceType] = (deviceMap[deviceType] ?? 0) + 1;
    MEMORY_STORE.deviceCountsByDate.set(date, deviceMap);
  }
}

export async function getUsageSummary(date = getTodayDateStringJst()): Promise<UsageSummary> {
  if (isKvConfigured()) {
    try {
      const [uniqueUsersRaw, countersRaw, countryCountsRaw, deviceTypeCountsRaw] = await Promise.all([
        kv.scard(getSetKey(date)),
        kv.hgetall<Record<string, string | number>>(getCounterKey(date)),
        kv.hgetall<Record<string, string | number>>(getCountryCounterKey(date)),
        kv.hgetall<Record<string, string | number>>(getDeviceCounterKey(date)),
      ]);
      const uniqueUsers = Number(uniqueUsersRaw || 0);
      const detectAttempts = Number(countersRaw?.detectAttempts || 0);
      const detectSuccess = Number(countersRaw?.detectSuccess || 0);
      const detectFailure = Number(countersRaw?.detectFailure || 0);
      const upgradeClick = Number(countersRaw?.upgradeClick || 0);
      const featureBlockedByPlan = Number(countersRaw?.featureBlockedByPlan || 0);
      const countryCounts = Object.fromEntries(
        Object.entries(countryCountsRaw ?? {}).map(([k, v]) => [k, Number(v || 0)])
      );
      const deviceTypeCounts = Object.fromEntries(
        Object.entries(deviceTypeCountsRaw ?? {}).map(([k, v]) => [k, Number(v || 0)])
      );
      return {
        date,
        uniqueUsers,
        detectAttempts,
        detectSuccess,
        detectFailure,
        upgradeClick,
        featureBlockedByPlan,
        storage: 'kv',
        kvConfigured: true,
        missingEnvVars: [],
        countryCounts,
        deviceTypeCounts,
      };
    } catch (error) {
      return {
        date,
        uniqueUsers: 0,
        detectAttempts: 0,
        detectSuccess: 0,
        detectFailure: 0,
        upgradeClick: 0,
        featureBlockedByPlan: 0,
        storage: 'memory',
        kvConfigured: false,
        missingEnvVars: [],
        kvError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const users = MEMORY_STORE.usersByDate.get(date) ?? new Set<string>();
  const counters = MEMORY_STORE.countersByDate.get(date) ?? {
    detectAttempts: 0,
    detectSuccess: 0,
    detectFailure: 0,
    upgradeClick: 0,
    featureBlockedByPlan: 0,
  };
  const countryCounts = MEMORY_STORE.countryCountsByDate.get(date) ?? {};
  const deviceTypeCounts = MEMORY_STORE.deviceCountsByDate.get(date) ?? {};
  return {
    date,
    uniqueUsers: users.size,
    detectAttempts: counters.detectAttempts,
    detectSuccess: counters.detectSuccess,
    detectFailure: counters.detectFailure,
    upgradeClick: counters.upgradeClick,
    featureBlockedByPlan: counters.featureBlockedByPlan,
    storage: 'memory',
    kvConfigured: false,
    missingEnvVars: getMissingKvEnvVars(),
    countryCounts,
    deviceTypeCounts,
  };
}
