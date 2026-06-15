'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activateOperatorPro,
  ensureDeviceId,
  isStandaloneApp,
  isTokenConfusedWithDeviceId,
  isUuidLike,
  normalizeOperatorToken,
  OPERATOR_TOKEN_STORAGE_KEY,
} from '../../lib/operator-client';
import { requestPlanRefresh } from '../../lib/device-id';

function stripSensitiveQueryFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('token');
  url.searchParams.delete('auto');
  const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '');
  window.history.replaceState({}, '', next);
}

export default function OperatorPage() {
  const [password, setPassword] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [standalone, setStandalone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [successDetail, setSuccessDetail] = useState<{
    deviceId: string;
    planSource?: string;
  } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const autoTriggered = useRef(false);

  const runActivate = useCallback(async (rawPassword: string) => {
    const trimmed = normalizeOperatorToken(rawPassword);
    setLoading(true);
    setStatus('idle');
    setMessage(null);
    try {
      const result = await activateOperatorPro(trimmed);
      setSuccessDetail({
        deviceId: result.deviceId ?? ensureDeviceId(),
        planSource: result.verifiedPlanSource ?? result.planSource,
      });
      setStatus('success');
      setMessage(result.message);
      stripSensitiveQueryFromUrl();
    } catch (e) {
      setSuccessDetail(null);
      setStatus('error');
      setMessage(e instanceof Error ? e.message : '登録に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDeviceId(ensureDeviceId());
    setStandalone(isStandaloneApp());

    const params = new URLSearchParams(window.location.search);
    const urlToken = normalizeOperatorToken(params.get('token') ?? '');
    const saved = normalizeOperatorToken(window.localStorage.getItem(OPERATOR_TOKEN_STORAGE_KEY) ?? '');
    const initial = urlToken || saved;
    if (initial) setPassword(initial);

    if (params.get('auto') === 'pro' && initial && !autoTriggered.current) {
      const id = ensureDeviceId();
      if (!isTokenConfusedWithDeviceId(initial, id)) {
        autoTriggered.current = true;
        void runActivate(initial);
      }
    }
  }, [runActivate]);

  const confused = Boolean(password.trim() && isTokenConfusedWithDeviceId(password, deviceId));
  const uuidWarning = Boolean(password.trim() && isUuidLike(password) && !confused);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <header className="text-center space-y-2">
          <p className="text-white/50 text-xs tracking-wide">Carkus</p>
          <h1 className="text-2xl font-light tracking-wide">運営者モード</h1>
          <p className="text-white/65 text-sm leading-relaxed">
            この端末だけ AI 自動検出を無制限にします。
          </p>
          {standalone ? (
            <p className="text-emerald-300/90 text-xs">✓ ホーム画面アプリから開いています（撮影と同じ環境）</p>
          ) : (
            <p className="text-amber-200/90 text-xs leading-relaxed">
              通常ブラウザから開いています。ホーム画面の Carkus から撮影する場合は、その Carkus 内の「運営者: 無制限にする」から開いてください。
            </p>
          )}
        </header>

        {status === 'success' ? (
          <div className="rounded-2xl border border-emerald-400/40 bg-emerald-950/30 p-6 text-center space-y-4">
            <p className="text-3xl">✓</p>
            <p className="text-emerald-100 text-sm leading-relaxed">{message}</p>
            <p className="text-emerald-200/80 text-xs leading-relaxed">
              右上が緑の「Pro」になっているか確認してください。
            </p>
            {successDetail && (
              <p className="text-[11px] text-white/45 font-mono break-all leading-relaxed">
                端末ID: {successDetail.deviceId}
                {successDetail.planSource ? ` / ${successDetail.planSource}` : ''}
              </p>
            )}
            <Link
              href="/"
              onClick={() => requestPlanRefresh()}
              className="inline-flex w-full items-center justify-center rounded-full bg-emerald-500/25 border border-emerald-400/50 px-5 py-3.5 text-sm text-emerald-50 hover:bg-emerald-500/35"
            >
              カメラに戻る
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/15 bg-white/5 p-5 space-y-4">
            <div className="space-y-2">
              <label htmlFor="operator-password" className="text-sm text-white/85">
                運営者パスワード
              </label>
              <p className="text-[11px] text-white/45 leading-relaxed">
                PC のターミナルで <code className="text-white/60">npm run operator:pro-link</code>{' '}
                を実行して出る URL の <code className="text-white/60">token=</code>{' '}
                以降、または Vercel の METRICS_ADMIN_TOKEN を貼り付け。
              </p>
              <input
                id="operator-password"
                type="password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setStatus('idle');
                  setMessage(null);
                }}
                placeholder="長い英数字を貼り付け（端末IDではない）"
                className="w-full rounded-xl bg-black/60 border border-white/20 px-4 py-3.5 text-sm outline-none focus:border-emerald-400/60 font-mono"
              />
              {confused && (
                <p className="text-xs text-red-300 leading-relaxed">
                  これは端末IDです。下に表示されている短い ID と同じものを入れないでください。
                </p>
              )}
              {uuidWarning && (
                <p className="text-xs text-amber-200/90 leading-relaxed">
                  UUID 形式です。運営者パスワードは通常もっと長い英数字です。
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={loading || !password.trim() || confused}
              onClick={() => void runActivate(password)}
              className="w-full rounded-full bg-emerald-500/30 border border-emerald-400/55 px-5 py-4 text-sm font-medium text-emerald-50 hover:bg-emerald-500/40 disabled:opacity-40"
            >
              {loading ? '有効化中…' : 'この端末で Pro を有効にする'}
            </button>

            {status === 'error' && message && (
              <p className="text-xs text-red-300 leading-relaxed">{message}</p>
            )}
          </div>
        )}

        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="text-white/40 text-xs underline underline-offset-2 hover:text-white/65"
          >
            {showHelp ? 'ヘルプを閉じる' : 'パスワードの入手方法'}
          </button>
          {showHelp && (
            <div className="mt-3 text-left text-[11px] text-white/50 leading-relaxed space-y-2 rounded-xl border border-white/10 bg-white/5 p-4">
              <p>
                <strong className="text-white/70">Mac / PC:</strong> プロジェクトフォルダで{' '}
                <code className="text-white/65">npm run operator:pro-link</code>{' '}
                を実行。表示された URL を、この撮影に使うアプリ（Safari / Chrome / ホーム画面の Carkus）で開く。
              </p>
              <p>
                <strong className="text-white/70">手入力:</strong> Vercel → Settings → Environment Variables →{' '}
                METRICS_ADMIN_TOKEN の値（64文字前後）を上の欄に貼る。
              </p>
              <p className="text-white/40">端末ID（この端末）: {deviceId || '…'}</p>
            </div>
          )}
        </div>

        <p className="text-center">
          <Link href="/" className="text-white/45 text-xs underline underline-offset-2 hover:text-white/70">
            ← カメラに戻る
          </Link>
        </p>
      </div>
    </main>
  );
}
