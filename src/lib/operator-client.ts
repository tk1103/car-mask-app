export const DEVICE_ID_KEY = 'carkus_device_id';
export const OPERATOR_TOKEN_STORAGE_KEY = 'carkus_metrics_admin_token';

export function ensureDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `d-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
    try {
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    } catch (_) {}
  }
  return id ?? '';
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

export async function activateOperatorPro(token: string): Promise<{ message: string; plan?: string }> {
  const trimmedToken = normalizeOperatorToken(token);
  const deviceId = ensureDeviceId();
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

  return {
    message: typeof json.message === 'string' ? json.message : 'この端末で Pro を有効にしました。',
    plan: typeof json.plan === 'string' ? json.plan : undefined,
  };
}
