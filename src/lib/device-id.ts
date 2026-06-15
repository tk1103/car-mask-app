export const DEVICE_ID_KEY = 'carkus_device_id';
export const PLAN_REFRESH_EVENT = 'carkus:plan-refresh';

let memoryDeviceId: string | null = null;

function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
}

function readStorage(getter: () => string | null): string | null {
  try {
    const value = getter();
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function writeStorage(setter: (value: string) => void): void {
  if (!memoryDeviceId) return;
  try {
    setter(memoryDeviceId);
  } catch {
    // localStorage / sessionStorage が使えない環境では memory のみ
  }
}

/** 端末IDをセッション中ずっと同じ値に保つ（localStorage 失敗時も再生成しない） */
export function getStableDeviceId(): string {
  if (typeof window === 'undefined') return '';

  if (memoryDeviceId) return memoryDeviceId;

  const fromLocal = readStorage(() => window.localStorage.getItem(DEVICE_ID_KEY));
  if (fromLocal) {
    memoryDeviceId = fromLocal;
    writeStorage((v) => window.sessionStorage.setItem(DEVICE_ID_KEY, v));
    return fromLocal;
  }

  const fromSession = readStorage(() => window.sessionStorage.getItem(DEVICE_ID_KEY));
  if (fromSession) {
    memoryDeviceId = fromSession;
    writeStorage((v) => window.localStorage.setItem(DEVICE_ID_KEY, v));
    return fromSession;
  }

  const id = generateDeviceId();
  memoryDeviceId = id;
  writeStorage((v) => window.localStorage.setItem(DEVICE_ID_KEY, v));
  writeStorage((v) => window.sessionStorage.setItem(DEVICE_ID_KEY, v));
  return id;
}

export const OPERATOR_PRO_SESSION_KEY = 'carkus_operator_pro_pending';

export function requestPlanRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PLAN_REFRESH_EVENT));
}

/** 運営者登録直後: カメラ画面で Pro を即反映しつつサーバー再取得する */
export function markOperatorProPending(): void {
  if (typeof window === 'undefined') return;
  const id = getStableDeviceId();
  if (!id) return;
  try {
    window.sessionStorage.setItem(OPERATOR_PRO_SESSION_KEY, id);
  } catch {
    // sessionStorage 不可でも memory の device id は安定している
  }
}

export function hasOperatorProPending(): boolean {
  if (typeof window === 'undefined') return false;
  const id = getStableDeviceId();
  if (!id) return false;
  try {
    return window.sessionStorage.getItem(OPERATOR_PRO_SESSION_KEY) === id;
  } catch {
    return false;
  }
}

export function clearOperatorProPending(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(OPERATOR_PRO_SESSION_KEY);
  } catch {
    // ignore
  }
}
