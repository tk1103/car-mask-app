import { kv } from '@vercel/kv';

type UsageEvent =
  | 'page_view'
  | 'detect_attempt'
  | 'detect_success'
  | 'detect_failure'
  | 'upgrade_click'
  | 'feature_blocked_by_plan';

type UsageSummary = {
  date: string;
  pageViews: number;
  pageViewUniqueUsers: number;
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
  pageViewCountryCounts?: Record<string, number>;
  pageViewDeviceTypeCounts?: Record<string, number>;
  detectFailureTypeCounts?: Record<string, number>;
};

const MEMORY_STORE = {
  usersByDate: new Map<string, Set<string>>(),
  countersByDate: new Map<
    string,
    {
      pageViews: number;
      detectAttempts: number;
      detectSuccess: number;
      detectFailure: number;
      upgradeClick: number;
      featureBlockedByPlan: number;
    }
  >(),
  pageViewUsersByDate: new Map<string, Set<string>>(),
  countryCountsByDate: new Map<string, Record<string, number>>(),
  deviceCountsByDate: new Map<string, Record<string, number>>(),
  pageViewCountryCountsByDate: new Map<string, Record<string, number>>(),
  pageViewDeviceCountsByDate: new Map<string, Record<string, number>>(),
  failureTypeCountsByDate: new Map<string, Record<string, number>>(),
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

function getPageViewUsersKey(date: string): string {
  return `metrics:${date}:page_view_users`;
}

function getCountryCounterKey(date: string): string {
  return `metrics:${date}:country_counts`;
}

function getDeviceCounterKey(date: string): string {
  return `metrics:${date}:device_counts`;
}

function getPageViewCountryCounterKey(date: string): string {
  return `metrics:${date}:page_view_country_counts`;
}

function getPageViewDeviceCounterKey(date: string): string {
  return `metrics:${date}:page_view_device_counts`;
}

function getFailureTypeCounterKey(date: string): string {
  return `metrics:${date}:detect_failure_types`;
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
  errorType?: string;
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
  const failureType = (meta?.errorType || 'unknown').trim().toLowerCase() || 'unknown';
  if (isKvConfigured()) {
    try {
      const setKey = getSetKey(date);
      const counterKey = getCounterKey(date);
      const countryCounterKey = getCountryCounterKey(date);
      const deviceCounterKey = getDeviceCounterKey(date);
      const pageViewUsersKey = getPageViewUsersKey(date);
      const pageViewCountryCounterKey = getPageViewCountryCounterKey(date);
      const pageViewDeviceCounterKey = getPageViewDeviceCounterKey(date);
      const failureTypeCounterKey = getFailureTypeCounterKey(date);
      const ttlSeconds = 60 * 60 * 24 * 8;
      const counterField =
        event === 'page_view'
          ? 'pageViews'
          : event === 'detect_attempt'
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
        event === 'page_view' ? kv.sadd(pageViewUsersKey, normalizedUserId) : Promise.resolve(0),
        event === 'page_view' ? kv.expire(pageViewUsersKey, ttlSeconds) : Promise.resolve(0),
        event === 'detect_attempt' ? kv.hincrby(countryCounterKey, country, 1) : Promise.resolve(0),
        event === 'detect_attempt' ? kv.expire(countryCounterKey, ttlSeconds) : Promise.resolve(0),
        event === 'detect_attempt' ? kv.hincrby(deviceCounterKey, deviceType, 1) : Promise.resolve(0),
        event === 'detect_attempt' ? kv.expire(deviceCounterKey, ttlSeconds) : Promise.resolve(0),
        event === 'page_view' ? kv.hincrby(pageViewCountryCounterKey, country, 1) : Promise.resolve(0),
        event === 'page_view' ? kv.expire(pageViewCountryCounterKey, ttlSeconds) : Promise.resolve(0),
        event === 'page_view' ? kv.hincrby(pageViewDeviceCounterKey, deviceType, 1) : Promise.resolve(0),
        event === 'page_view' ? kv.expire(pageViewDeviceCounterKey, ttlSeconds) : Promise.resolve(0),
        event === 'detect_failure' ? kv.hincrby(failureTypeCounterKey, failureType, 1) : Promise.resolve(0),
        event === 'detect_failure' ? kv.expire(failureTypeCounterKey, ttlSeconds) : Promise.resolve(0),
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
    pageViews: 0,
    detectAttempts: 0,
    detectSuccess: 0,
    detectFailure: 0,
    upgradeClick: 0,
    featureBlockedByPlan: 0,
  };
  if (event === 'page_view') counters.pageViews += 1;
  if (event === 'detect_attempt') counters.detectAttempts += 1;
  if (event === 'detect_success') counters.detectSuccess += 1;
  if (event === 'detect_failure') counters.detectFailure += 1;
  if (event === 'upgrade_click') counters.upgradeClick += 1;
  if (event === 'feature_blocked_by_plan') counters.featureBlockedByPlan += 1;
  MEMORY_STORE.countersByDate.set(date, counters);
  if (event === 'page_view') {
    const pageViewUsers = MEMORY_STORE.pageViewUsersByDate.get(date) ?? new Set<string>();
    pageViewUsers.add(normalizedUserId);
    MEMORY_STORE.pageViewUsersByDate.set(date, pageViewUsers);

    const countryMap = MEMORY_STORE.pageViewCountryCountsByDate.get(date) ?? {};
    countryMap[country] = (countryMap[country] ?? 0) + 1;
    MEMORY_STORE.pageViewCountryCountsByDate.set(date, countryMap);

    const deviceMap = MEMORY_STORE.pageViewDeviceCountsByDate.get(date) ?? {};
    deviceMap[deviceType] = (deviceMap[deviceType] ?? 0) + 1;
    MEMORY_STORE.pageViewDeviceCountsByDate.set(date, deviceMap);
  }
  if (event === 'detect_attempt') {
    const countryMap = MEMORY_STORE.countryCountsByDate.get(date) ?? {};
    countryMap[country] = (countryMap[country] ?? 0) + 1;
    MEMORY_STORE.countryCountsByDate.set(date, countryMap);

    const deviceMap = MEMORY_STORE.deviceCountsByDate.get(date) ?? {};
    deviceMap[deviceType] = (deviceMap[deviceType] ?? 0) + 1;
    MEMORY_STORE.deviceCountsByDate.set(date, deviceMap);
  }
  if (event === 'detect_failure') {
    const failureTypeMap = MEMORY_STORE.failureTypeCountsByDate.get(date) ?? {};
    failureTypeMap[failureType] = (failureTypeMap[failureType] ?? 0) + 1;
    MEMORY_STORE.failureTypeCountsByDate.set(date, failureTypeMap);
  }
}

export async function getUsageSummary(date = getTodayDateStringJst()): Promise<UsageSummary> {
  if (isKvConfigured()) {
    try {
      const [
        uniqueUsersRaw,
        pageViewUniqueUsersRaw,
        countersRaw,
        countryCountsRaw,
        deviceTypeCountsRaw,
        pageViewCountryCountsRaw,
        pageViewDeviceTypeCountsRaw,
        detectFailureTypeCountsRaw,
      ] = await Promise.all([
        kv.scard(getSetKey(date)),
        kv.scard(getPageViewUsersKey(date)),
        kv.hgetall<Record<string, string | number>>(getCounterKey(date)),
        kv.hgetall<Record<string, string | number>>(getCountryCounterKey(date)),
        kv.hgetall<Record<string, string | number>>(getDeviceCounterKey(date)),
        kv.hgetall<Record<string, string | number>>(getPageViewCountryCounterKey(date)),
        kv.hgetall<Record<string, string | number>>(getPageViewDeviceCounterKey(date)),
        kv.hgetall<Record<string, string | number>>(getFailureTypeCounterKey(date)),
      ]);
      const uniqueUsers = Number(uniqueUsersRaw || 0);
      const pageViewUniqueUsers = Number(pageViewUniqueUsersRaw || 0);
      const pageViews = Number(countersRaw?.pageViews || 0);
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
      const pageViewCountryCounts = Object.fromEntries(
        Object.entries(pageViewCountryCountsRaw ?? {}).map(([k, v]) => [k, Number(v || 0)])
      );
      const pageViewDeviceTypeCounts = Object.fromEntries(
        Object.entries(pageViewDeviceTypeCountsRaw ?? {}).map(([k, v]) => [k, Number(v || 0)])
      );
      const detectFailureTypeCounts = Object.fromEntries(
        Object.entries(detectFailureTypeCountsRaw ?? {}).map(([k, v]) => [k, Number(v || 0)])
      );
      return {
        date,
        pageViews,
        pageViewUniqueUsers,
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
        pageViewCountryCounts,
        pageViewDeviceTypeCounts,
        detectFailureTypeCounts,
      };
    } catch (error) {
      return {
        date,
        pageViews: 0,
        pageViewUniqueUsers: 0,
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
  const pageViewUsers = MEMORY_STORE.pageViewUsersByDate.get(date) ?? new Set<string>();
  const counters = MEMORY_STORE.countersByDate.get(date) ?? {
    pageViews: 0,
    detectAttempts: 0,
    detectSuccess: 0,
    detectFailure: 0,
    upgradeClick: 0,
    featureBlockedByPlan: 0,
  };
  const countryCounts = MEMORY_STORE.countryCountsByDate.get(date) ?? {};
  const deviceTypeCounts = MEMORY_STORE.deviceCountsByDate.get(date) ?? {};
  const pageViewCountryCounts = MEMORY_STORE.pageViewCountryCountsByDate.get(date) ?? {};
  const pageViewDeviceTypeCounts = MEMORY_STORE.pageViewDeviceCountsByDate.get(date) ?? {};
  const detectFailureTypeCounts = MEMORY_STORE.failureTypeCountsByDate.get(date) ?? {};
  return {
    date,
    pageViews: counters.pageViews,
    pageViewUniqueUsers: pageViewUsers.size,
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
    pageViewCountryCounts,
    pageViewDeviceTypeCounts,
    detectFailureTypeCounts,
  };
}
