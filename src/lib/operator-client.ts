import {
  DEVICE_ID_KEY,
  getStableDeviceId,
  markOperatorProPending,
  requestPlanRefresh,
} from './device-id';

export { DEVICE_ID_KEY };
export const OPERATOR_TOKEN_STORAGE_KEY = 'carkus_metrics_admin_token';

export type PlanApiSnapshot = {
  plan?: string;
  planSource?: string;
  hasValidDeviceId?: boolean;
};

/** @deprecated use getStableDeviceId */
export function ensureDeviceId(): string {
  return getStableDeviceId();
}

export function normalizeOperatorToken(value: string): string {
  return value.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isTokenConfusedWithDeviceId(token: string, deviceId: string): boolean {
  const t = normalizeOperatorToken(token);
  const d = normalizeOperatorToken(deviceId);
  if (!t || !d) return false;
  return t === d;
}

export function buildOperatorProUrl(origin: string, token: string): string {
  const url = new URL('/operator', origin);
  url.searchParams.set('token', normalizeOperatorToken(token));
  url.searchParams.set('auto', 'pro');
  return url.toString();
}

export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

export async function fetchPlanSnapshot(deviceId?: string): Promise<PlanApiSnapshot> {
  const id = deviceId ?? getStableDeviceId();
  const res = await fetch('/api/plan', {
    cache: 'no-store',
    headers: id ? { 'X-Device-Id': id } : undefined,
  });
  if (!res.ok) {
    throw new Error(`プラン確認に失敗しました (${res.status})`);
  }
  return (await res.json()) as PlanApiSnapshot;
}

export type ActivateOperatorProResult = {
  message: string;
  plan?: string;
  planSource?: string;
  deviceId?: string;
  verifiedPlan?: string;
  verifiedPlanSource?: string;
};

export async function activateOperatorPro(token: string): Promise<ActivateOperatorProResult> {
  const trimmedToken = normalizeOperatorToken(token);
  const deviceId = getStableDeviceId();
  if (!trimmedToken) {
    throw new Error('運営者パスワードを入力してください。');
  }
  if (isTokenConfusedWithDeviceId(trimmedToken, deviceId)) {
    throw new Error(
      '入力されているのは端末IDです。下に表示されている短いIDではなく、PCでコピーした長いパスワードを貼ってください。'
    );
  }
  if (!deviceId) {
    throw new Error('端末IDを取得できませんでした。');
  }

  const res = await fetch('/api/admin/register-operator', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': trimmedToken,
    },
    body: JSON.stringify({ deviceId, adminToken: trimmedToken }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof json.error === 'string' ? json.error : `登録に失敗しました (${res.status})`);
  }

  try {
    window.localStorage.setItem(OPERATOR_TOKEN_STORAGE_KEY, trimmedToken);
  } catch (_) {}

  const snapshot = await fetchPlanSnapshot(deviceId);
  if (snapshot.plan !== 'pro') {
    const source = snapshot.planSource ? ` / ${snapshot.planSource}` : '';
    throw new Error(
      `登録APIは成功しましたが、サーバーはまだ「${snapshot.plan ?? 'free'}」${source} と返しています。` +
        ` 端末ID: ${deviceId}` +
        (snapshot.hasValidDeviceId === false ? '（端末IDがサーバーで無効と判定されています）' : '') +
        (snapshot.planSource === 'force'
          ? ' — Vercel に FORCE_PLAN が設定されています。削除するかデプロイを更新してください。'
          : '')
    );
  }

  markOperatorProPending();
  requestPlanRefresh();

  return {
    message: typeof json.message === 'string' ? json.message : 'この端末で Pro を有効にしました。',
    plan: typeof json.plan === 'string' ? json.plan : undefined,
    planSource: typeof json.planSource === 'string' ? json.planSource : undefined,
    deviceId: typeof json.deviceId === 'string' ? json.deviceId : deviceId,
    verifiedPlan: snapshot.plan,
    verifiedPlanSource: snapshot.planSource,
  };
}
