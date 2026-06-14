'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type MetricsSingleResponse = {
  mode: 'single';
  date: string;
  pageViews?: number;
  pageViewUniqueUsers?: number;
  uniqueUsers: number;
  detectAttempts?: number;
  detectSuccess?: number;
  detectFailure?: number;
  countryCounts?: Record<string, number>;
  deviceTypeCounts?: Record<string, number>;
  pageViewCountryCounts?: Record<string, number>;
  pageViewDeviceTypeCounts?: Record<string, number>;
  detectFailureTypeCounts?: Record<string, number>;
  storage: 'kv' | 'memory';
  upgradeClick?: number;
  featureBlockedByPlan?: number;
};
type MetricsRangeResponse = {
  mode: 'range';
  from: string;
  to: string;
  days: number;
  storage: 'kv' | 'memory';
  totals: {
    pageViews: number;
    pageViewUniqueUsers: number;
    uniqueUsers: number;
    detectAttempts: number;
    detectSuccess: number;
    detectFailure: number;
    upgradeClick: number;
    featureBlockedByPlan: number;
    detectFailureTypeCounts?: Record<string, number>;
  };
  series: Array<{
    date: string;
    pageViews: number;
    pageViewUniqueUsers: number;
    uniqueUsers: number;
    detectAttempts: number;
    detectSuccess: number;
    detectFailure: number;
    upgradeClick: number;
    featureBlockedByPlan: number;
    detectFailureTypeCounts?: Record<string, number>;
  }>;
};
type MetricsResponse = MetricsSingleResponse | MetricsRangeResponse;

const TOKEN_STORAGE_KEY = 'carkus_metrics_admin_token';
const DEVICE_ID_KEY = 'carkus_device_id';

function ensureDeviceId(): string {
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

function formatJstDateInput(offsetDays = 0): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeTokenInput(value: string): string {
  return value.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
}

export default function AdminMetricsPage() {
  const [token, setToken] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [granularity, setGranularity] = useState<'daily' | 'weekly'>('daily');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [deviceIdCopied, setDeviceIdCopied] = useState(false);
  const [operatorStatus, setOperatorStatus] = useState<string | null>(null);
  const [operatorLoading, setOperatorLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDeviceId(ensureDeviceId());
    const params = new URLSearchParams(window.location.search);
    const urlToken = normalizeTokenInput(params.get('token') ?? '');
    const saved = normalizeTokenInput(window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '');
    if (urlToken) {
      setToken(urlToken);
      try {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, urlToken);
      } catch (_) {}
    } else if (saved) {
      setToken(saved);
    }
    const today = formatJstDateInput(0);
    setToDate(today);
    setFromDate(formatJstDateInput(-6));
  }, []);

  const loadMetrics = useCallback(async () => {
    if (!token.trim()) {
      setError('まず METRICS_ADMIN_TOKEN を入力してください。');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
      }
      const fetchOne = async (): Promise<MetricsResponse> => {
        const params = new URLSearchParams();
        if (fromDate && toDate) {
          params.set('from', fromDate);
          params.set('to', toDate);
        }
        const url = `/api/admin/metrics${params.toString() ? `?${params.toString()}` : ''}`;
        const res = await fetch(url, {
          headers: { 'x-admin-token': token.trim() },
        });
        const rawText = await res.text();
        let json: any = null;
        if (rawText) {
          try {
            json = JSON.parse(rawText);
          } catch (_) {
            json = null;
          }
        }
        if (!res.ok) {
          const detail = rawText ? ` / ${rawText.slice(0, 120)}` : '';
          throw new Error(typeof json?.error === 'string' ? json.error : `取得に失敗しました (${res.status})${detail}`);
        }
        if (!json || typeof json !== 'object') {
          throw new Error('サーバーからの応答形式が不正です。再読み込み後にもう一度お試しください。');
        }
        return json as MetricsResponse;
      };

      const primary = await fetchOne();
      setData(primary);
    } catch (e) {
      setData(null);
      setError(`通信エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, token]);

  const resolvedSeries = useMemo(() => {
    if (!data) return [];
    if (data.mode === 'range') return data.series;
    return [
      {
        date: data.date,
        pageViews: data.pageViews ?? 0,
        pageViewUniqueUsers: data.pageViewUniqueUsers ?? 0,
        uniqueUsers: data.uniqueUsers,
        detectAttempts: data.detectAttempts ?? 0,
        detectSuccess: data.detectSuccess ?? 0,
        detectFailure: data.detectFailure ?? 0,
        upgradeClick: data.upgradeClick ?? 0,
        featureBlockedByPlan: data.featureBlockedByPlan ?? 0,
      },
    ];
  }, [data]);

  const chartSeries = useMemo(() => {
    if (granularity === 'daily') return resolvedSeries;
    const buckets = new Map<
      string,
      {
        date: string;
        pageViews: number;
        pageViewUniqueUsers: number;
        uniqueUsers: number;
        detectAttempts: number;
        detectSuccess: number;
        detectFailure: number;
        upgradeClick: number;
        featureBlockedByPlan: number;
      }
    >();
    for (const row of resolvedSeries) {
      const d = new Date(`${row.date}T00:00:00Z`);
      const day = d.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + diff);
      const weekStart = d.toISOString().slice(0, 10);
      const current = buckets.get(weekStart) ?? {
        date: weekStart,
        pageViews: 0,
        pageViewUniqueUsers: 0,
        uniqueUsers: 0,
        detectAttempts: 0,
        detectSuccess: 0,
        detectFailure: 0,
        upgradeClick: 0,
        featureBlockedByPlan: 0,
      };
      current.pageViews += row.pageViews;
      current.pageViewUniqueUsers += row.pageViewUniqueUsers;
      current.uniqueUsers += row.uniqueUsers;
      current.detectAttempts += row.detectAttempts;
      current.detectSuccess += row.detectSuccess;
      current.detectFailure += row.detectFailure;
      current.upgradeClick += row.upgradeClick;
      current.featureBlockedByPlan += row.featureBlockedByPlan;
      buckets.set(weekStart, current);
    }
    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [resolvedSeries, granularity]);

  const failureTypeEntries = useMemo(() => {
    if (!data) return [] as Array<[string, number]>;
    const counts =
      data.mode === 'range'
        ? data.totals.detectFailureTypeCounts ?? {}
        : data.detectFailureTypeCounts ?? {};
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const handleExportCsv = useCallback(() => {
    if (!chartSeries.length) return;
    const header = [
      'date_or_week_start',
      'page_views',
      'page_view_unique_users',
      'unique_users',
      'detect_attempts',
      'detect_success',
      'detect_failure',
      'upgrade_click',
      'feature_blocked_by_plan',
    ];
    const lines = chartSeries.map((row) =>
      [
        row.date,
        row.pageViews,
        row.pageViewUniqueUsers,
        row.uniqueUsers,
        row.detectAttempts,
        row.detectSuccess,
        row.detectFailure,
        row.upgradeClick,
        row.featureBlockedByPlan,
      ].join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carkus-metrics-${granularity}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [chartSeries, granularity]);

  const registerOperatorDevice = useCallback(async () => {
    const trimmedToken = normalizeTokenInput(token);
    if (!trimmedToken) {
      setOperatorStatus('先に METRICS_ADMIN_TOKEN を入力してください。');
      return;
    }
    const id = ensureDeviceId();
    setDeviceId(id);
    if (!id) {
      setOperatorStatus('端末 ID を取得できませんでした。');
      return;
    }
    setOperatorLoading(true);
    setOperatorStatus(null);
    try {
      const res = await fetch('/api/admin/register-operator', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': trimmedToken,
        },
        body: JSON.stringify({ deviceId: id, adminToken: trimmedToken }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof json.error === 'string' ? json.error : `登録失敗 (${res.status})`);
      }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, trimmedToken);
      }
      setOperatorStatus(
        typeof json.message === 'string'
          ? json.message
          : '登録しました。Carkus トップを再読み込みしてください。'
      );
    } catch (e) {
      setOperatorStatus(e instanceof Error ? e.message : '登録に失敗しました');
    } finally {
      setOperatorLoading(false);
    }
  }, [token]);

  const verifyAdminToken = useCallback(async () => {
    const trimmedToken = normalizeTokenInput(token);
    if (!trimmedToken) {
      setOperatorStatus('先に METRICS_ADMIN_TOKEN を入力してください。');
      return;
    }
    setOperatorLoading(true);
    setOperatorStatus(null);
    try {
      const res = await fetch('/api/admin/metrics?preflight=1', {
        headers: { 'x-admin-token': trimmedToken },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof json.error === 'string'
            ? json.error
            : 'トークンが違います。Vercel → Settings → Environment Variables の METRICS_ADMIN_TOKEN をコピーし直してください。'
        );
      }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, trimmedToken);
      }
      setOperatorStatus('トークン OK。この端末を Pro にする、を押してください。');
    } catch (e) {
      setOperatorStatus(e instanceof Error ? e.message : 'トークン確認に失敗しました');
    } finally {
      setOperatorLoading(false);
    }
  }, [token]);

  return (
    <main className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-light tracking-wide">Carkus Metrics</h1>
          <p className="text-white/70 text-sm">
            日次のアクセス数（PV/UV）と AI 検出の利用状況を確認できます（JST 基準）。
          </p>
        </header>

        <section className="rounded-2xl border border-white/20 bg-white/5 p-4 md:p-5 space-y-4">
          <div className="space-y-2">
            <label className="text-xs text-white/70">METRICS_ADMIN_TOKEN</label>
            <input
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onPaste={() => {
                setTimeout(() => setOperatorStatus(null), 0);
              }}
              placeholder="Vercel の METRICS_ADMIN_TOKEN を貼り付け"
              className="w-full rounded-lg bg-black/60 border border-white/20 px-3 py-3 text-sm outline-none focus:border-emerald-400/60 font-mono"
            />
            {!token.trim() && (
              <p className="text-xs text-amber-200/95 leading-relaxed">
                ↑ ここにトークンを貼り付けると、下のボタンが使えます（Vercel → Settings → Environment Variables →
                METRICS_ADMIN_TOKEN）。
              </p>
            )}
          </div>

          <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/25 p-4 space-y-3">
            <p className="text-sm text-emerald-100 font-medium">運営者モード（AI 検出 無制限）</p>
            <p className="text-xs text-white/60 leading-relaxed">
              下のボタンを押すだけで、このブラウザだけ Pro になります。Vercel の設定は不要です。
            </p>
            <code className="block text-[11px] break-all text-white/75 bg-black/40 rounded px-2 py-1.5">
              {deviceId || '…'}
            </code>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={verifyAdminToken}
                disabled={operatorLoading}
                className="px-4 py-2.5 rounded-full text-sm bg-white/10 border border-white/25 text-white hover:bg-white/15 disabled:opacity-40"
              >
                トークンを確認
              </button>
              <button
                type="button"
                onClick={registerOperatorDevice}
                disabled={operatorLoading}
                className="px-4 py-2.5 rounded-full text-sm bg-emerald-500/25 border border-emerald-400/50 text-emerald-50 hover:bg-emerald-500/35 disabled:opacity-40"
              >
                {operatorLoading ? '処理中…' : 'この端末を Pro にする'}
              </button>
              <button
                type="button"
                disabled={!deviceId}
                onClick={async () => {
                  if (!deviceId) return;
                  try {
                    await navigator.clipboard.writeText(deviceId);
                    setDeviceIdCopied(true);
                    setTimeout(() => setDeviceIdCopied(false), 2000);
                  } catch (_) {}
                }}
                className="px-4 py-2.5 rounded-full text-sm bg-white/10 border border-white/20 text-white/85 hover:bg-white/15 disabled:opacity-40"
              >
                {deviceIdCopied ? 'コピーしました' : 'ID をコピー'}
              </button>
            </div>
            {operatorStatus && (
              <p className={`text-xs leading-relaxed ${operatorStatus.includes('失敗') || operatorStatus.includes('Invalid') || operatorStatus.includes('無効') ? 'text-red-300' : 'text-emerald-200'}`}>
                {operatorStatus}
              </p>
            )}
          </div>

          <div className="space-y-2 pt-1 border-t border-white/10">
            <label className="text-xs text-white/70">期間（JST）</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full md:w-52 rounded-lg bg-black/60 border border-white/20 px-3 py-2 text-sm outline-none focus:border-white/40"
              />
              <span className="text-white/60 text-xs">〜</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full md:w-52 rounded-lg bg-black/60 border border-white/20 px-3 py-2 text-sm outline-none focus:border-white/40"
              />
              <button
                type="button"
                onClick={() => {
                  setToDate(formatJstDateInput(0));
                  setFromDate(formatJstDateInput(-6));
                }}
                className="px-3 py-2 rounded-full text-xs bg-white/10 border border-white/20 hover:bg-white/20"
              >
                直近7日
              </button>
              <button
                type="button"
                onClick={() => {
                  setToDate(formatJstDateInput(0));
                  setFromDate(formatJstDateInput(-29));
                }}
                className="px-3 py-2 rounded-full text-xs bg-white/10 border border-white/20 hover:bg-white/20"
              >
                直近30日
              </button>
            </div>
          </div>

          <button
            onClick={loadMetrics}
            disabled={loading}
            className="px-5 py-2.5 rounded-full bg-white/10 border border-white/20 text-sm hover:bg-white/20 transition-colors disabled:opacity-60"
          >
            {loading ? '取得中...' : '更新'}
          </button>

          {data && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-white/60">集計単位</span>
              <button
                type="button"
                onClick={() => setGranularity('daily')}
                className={`px-3 py-1.5 rounded-full text-xs border ${granularity === 'daily' ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'}`}
              >
                日次
              </button>
              <button
                type="button"
                onClick={() => setGranularity('weekly')}
                className={`px-3 py-1.5 rounded-full text-xs border ${granularity === 'weekly' ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'}`}
              >
                週次
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3 py-1.5 rounded-full text-xs bg-emerald-500/20 border border-emerald-300/40 text-emerald-100 hover:bg-emerald-500/30"
              >
                CSVエクスポート
              </button>
            </div>
          )}

          {error && (
            <p className="text-red-200 text-sm">{error}</p>
          )}
        </section>

        {data && (
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard
              label={data.mode === 'range' ? '期間' : '日付'}
              value={data.mode === 'range' ? `${data.from} 〜 ${data.to}` : data.date}
            />
            <MetricCard
              label="PV（ページビュー）"
              value={`${data.mode === 'range' ? data.totals.pageViews : data.pageViews ?? 0}`}
            />
            <MetricCard
              label="UV（訪問者数）"
              value={`${data.mode === 'range' ? data.totals.pageViewUniqueUsers : data.pageViewUniqueUsers ?? 0}`}
            />
            <MetricCard label="保存方式" value={data.storage === 'kv' ? 'KV（永続）' : 'Memory（一時）'} />
          </section>
        )}

        {data && (
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard
              label="検出リクエスト（合計）"
              value={`${data.mode === 'range' ? data.totals.detectAttempts : data.detectAttempts ?? 0}`}
            />
            <MetricCard
              label="検出成功（合計）"
              value={`${data.mode === 'range' ? data.totals.detectSuccess : data.detectSuccess ?? 0}`}
            />
            <MetricCard
              label="検出失敗（合計）"
              value={`${data.mode === 'range' ? data.totals.detectFailure : data.detectFailure ?? 0}`}
            />
            <MetricCard
              label="アクティブ端末（全イベント）"
              value={`${data.mode === 'range' ? data.totals.uniqueUsers : data.uniqueUsers}`}
            />
          </section>
        )}

        {data && (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard
              label="feature_blocked_by_plan"
              value={`${data.mode === 'range' ? data.totals.featureBlockedByPlan : data.featureBlockedByPlan ?? 0}`}
            />
            <MetricCard
              label="upgrade_click"
              value={`${data.mode === 'range' ? data.totals.upgradeClick : data.upgradeClick ?? 0}`}
            />
          </section>
        )}

        {data && data.mode === 'single' && (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricListCard
              label="国別（page_view）"
              entries={Object.entries(data.pageViewCountryCounts ?? {}).sort((a, b) => b[1] - a[1])}
              emptyLabel="データなし"
            />
            <MetricListCard
              label="端末別（page_view）"
              entries={Object.entries(data.pageViewDeviceTypeCounts ?? {}).sort((a, b) => b[1] - a[1])}
              emptyLabel="データなし"
            />
            <MetricListCard
              label="国別（detect_attempt）"
              entries={Object.entries(data.countryCounts ?? {}).sort((a, b) => b[1] - a[1])}
              emptyLabel="データなし"
            />
            <MetricListCard
              label="端末別（detect_attempt）"
              entries={Object.entries(data.deviceTypeCounts ?? {}).sort((a, b) => b[1] - a[1])}
              emptyLabel="データなし"
            />
          </section>
        )}

        {data && (
          <section className="grid grid-cols-1 gap-4">
            <MetricListCard
              label="失敗要因（errorType）"
              entries={failureTypeEntries}
              emptyLabel="失敗要因データなし"
            />
          </section>
        )}

        {data && (
          <section className="rounded-2xl border border-white/20 bg-white/5 p-4">
            <p className="text-xs text-white/70 mb-3">
              折れ線グラフ（{granularity === 'daily' ? '日次' : '週次'}）
            </p>
            <LineChart series={chartSeries} />
          </section>
        )}

        {data && (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              label="成功率"
              value={`${
                (data.mode === 'range' ? data.totals.detectAttempts : data.detectAttempts ?? 0) > 0
                  ? Math.round(
                      ((data.mode === 'range' ? data.totals.detectSuccess : data.detectSuccess ?? 0) /
                        (data.mode === 'range' ? data.totals.detectAttempts : data.detectAttempts ?? 0)) *
                        100
                    )
                  : 0
              }%`}
            />
            <MetricCard
              label="失敗率"
              value={`${
                (data.mode === 'range' ? data.totals.detectAttempts : data.detectAttempts ?? 0) > 0
                  ? Math.round(
                      ((data.mode === 'range' ? data.totals.detectFailure : data.detectFailure ?? 0) /
                        (data.mode === 'range' ? data.totals.detectAttempts : data.detectAttempts ?? 0)) *
                        100
                    )
                  : 0
              }%`}
            />
            <MetricCard label="データ点数" value={`${chartSeries.length}`} />
          </section>
        )}
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/5 p-4">
      <p className="text-xs text-white/70 mb-1">{label}</p>
      <p className="text-xl font-light">{value}</p>
    </div>
  );
}

function LineChart({
  series,
}: {
  series: Array<{
    date: string;
    pageViews: number;
    pageViewUniqueUsers: number;
    uniqueUsers: number;
    detectAttempts: number;
    detectSuccess: number;
    detectFailure: number;
  }>;
}) {
  if (series.length === 0) {
    return <p className="text-sm text-white/50">データなし</p>;
  }
  const w = 900;
  const h = 260;
  const pad = 26;
  const maxY = Math.max(
    1,
    ...series.map((s) => s.pageViews),
    ...series.map((s) => s.pageViewUniqueUsers),
    ...series.map((s) => s.uniqueUsers),
    ...series.map((s) => s.detectAttempts),
    ...series.map((s) => s.detectSuccess),
    ...series.map((s) => s.detectFailure)
  );
  const x = (i: number) => (series.length <= 1 ? w / 2 : pad + (i * (w - pad * 2)) / (series.length - 1));
  const y = (v: number) => h - pad - (v / maxY) * (h - pad * 2);
  const pageViewPoints = series.map((s, i) => `${x(i)},${y(s.pageViews)}`).join(' ');
  const pageViewUvPoints = series.map((s, i) => `${x(i)},${y(s.pageViewUniqueUsers)}`).join(' ');
  const usersPoints = series.map((s, i) => `${x(i)},${y(s.uniqueUsers)}`).join(' ');
  const attemptsPoints = series.map((s, i) => `${x(i)},${y(s.detectAttempts)}`).join(' ');
  const successPoints = series.map((s, i) => `${x(i)},${y(s.detectSuccess)}`).join(' ');
  const failurePoints = series.map((s, i) => `${x(i)},${y(s.detectFailure)}`).join(' ');
  const ticks = [0, Math.round(maxY / 2), maxY];

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-52 md:h-64">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad} y1={y(t)} x2={w - pad} y2={y(t)} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
            <text x={4} y={y(t) + 4} fill="rgba(255,255,255,0.55)" fontSize="12">
              {t}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="rgb(147 197 253)" strokeWidth="3" points={pageViewPoints} />
        <polyline fill="none" stroke="rgb(56 189 248)" strokeWidth="3" points={pageViewUvPoints} />
        <polyline fill="none" stroke="rgb(167 139 250)" strokeWidth="2" points={usersPoints} />
        <polyline fill="none" stroke="rgb(251 191 36)" strokeWidth="2" points={attemptsPoints} />
        <polyline fill="none" stroke="rgb(74 222 128)" strokeWidth="2" points={successPoints} />
        <polyline fill="none" stroke="rgb(248 113 113)" strokeWidth="2" points={failurePoints} />
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-white/75">
        <span className="text-sky-200">■ PV</span>
        <span className="text-sky-400">■ UV（訪問）</span>
        <span className="text-violet-300">■ アクティブ端末</span>
        <span className="text-amber-200">■ 検出リクエスト</span>
        <span className="text-emerald-300">■ 成功</span>
        <span className="text-red-300">■ 失敗</span>
      </div>
      <div className="flex justify-between text-[11px] text-white/50">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function MetricListCard({
  label,
  entries,
  emptyLabel,
}: {
  label: string;
  entries: Array<[string, number]>;
  emptyLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/5 p-4">
      <p className="text-xs text-white/70 mb-2">{label}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-white/50">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1">
          {entries.map(([name, count]) => (
            <li key={name} className="flex items-center justify-between text-sm">
              <span className="text-white/80">{name}</span>
              <span className="text-white">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
