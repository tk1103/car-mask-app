'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type MetricsSingleResponse = {
  mode: 'single';
  date: string;
  uniqueUsers: number;
  detectAttempts?: number;
  detectSuccess?: number;
  detectFailure?: number;
  countryCounts?: Record<string, number>;
  deviceTypeCounts?: Record<string, number>;
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
    uniqueUsers: number;
    detectAttempts: number;
    detectSuccess: number;
    detectFailure: number;
    upgradeClick: number;
    featureBlockedByPlan: number;
  };
  series: Array<{
    date: string;
    uniqueUsers: number;
    detectAttempts: number;
    detectSuccess: number;
    detectFailure: number;
    upgradeClick: number;
    featureBlockedByPlan: number;
  }>;
};
type MetricsResponse = MetricsSingleResponse | MetricsRangeResponse;

const TOKEN_STORAGE_KEY = 'carkus_metrics_admin_token';

function formatJstDateInput(offsetDays = 0): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function AdminMetricsPage() {
  const [token, setToken] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
    if (saved) setToken(saved);
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
        uniqueUsers: data.uniqueUsers,
        detectAttempts: data.detectAttempts ?? 0,
        detectSuccess: data.detectSuccess ?? 0,
        detectFailure: data.detectFailure ?? 0,
        upgradeClick: data.upgradeClick ?? 0,
        featureBlockedByPlan: data.featureBlockedByPlan ?? 0,
      },
    ];
  }, [data]);

  return (
    <main className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-light tracking-wide">Carkus Metrics</h1>
          <p className="text-white/70 text-sm">
            期間を選んで総数と推移を確認できます（単日表示にも対応）。
          </p>
        </header>

        <section className="rounded-2xl border border-white/20 bg-white/5 p-4 md:p-5 space-y-4">
          <div className="space-y-2">
            <label className="text-xs text-white/70">METRICS_ADMIN_TOKEN</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Vercel で設定した METRICS_ADMIN_TOKEN"
              className="w-full rounded-lg bg-black/60 border border-white/20 px-3 py-2 text-sm outline-none focus:border-white/40"
            />
          </div>

          <div className="space-y-2">
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
              label="利用人数（合計）"
              value={`${data.mode === 'range' ? data.totals.uniqueUsers : data.uniqueUsers}`}
            />
            <MetricCard
              label="検出リクエスト（合計）"
              value={`${data.mode === 'range' ? data.totals.detectAttempts : data.detectAttempts ?? 0}`}
            />
            <MetricCard label="保存方式" value={data.storage === 'kv' ? 'KV（永続）' : 'Memory（一時）'} />
          </section>
        )}

        {data && (
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard
              label="検出成功（合計）"
              value={`${data.mode === 'range' ? data.totals.detectSuccess : data.detectSuccess ?? 0}`}
            />
            <MetricCard
              label="検出失敗（合計）"
              value={`${data.mode === 'range' ? data.totals.detectFailure : data.detectFailure ?? 0}`}
            />
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
          <section className="rounded-2xl border border-white/20 bg-white/5 p-4">
            <p className="text-xs text-white/70 mb-3">折れ線グラフ（日次）</p>
            <LineChart series={resolvedSeries} />
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
            <MetricCard label="データ点数" value={`${resolvedSeries.length}`} />
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
  series: Array<{ date: string; uniqueUsers: number; detectAttempts: number }>;
}) {
  if (series.length === 0) {
    return <p className="text-sm text-white/50">データなし</p>;
  }
  const w = 900;
  const h = 260;
  const pad = 26;
  const maxY = Math.max(
    1,
    ...series.map((s) => s.uniqueUsers),
    ...series.map((s) => s.detectAttempts)
  );
  const x = (i: number) => (series.length <= 1 ? w / 2 : pad + (i * (w - pad * 2)) / (series.length - 1));
  const y = (v: number) => h - pad - (v / maxY) * (h - pad * 2);
  const usersPoints = series.map((s, i) => `${x(i)},${y(s.uniqueUsers)}`).join(' ');
  const attemptsPoints = series.map((s, i) => `${x(i)},${y(s.detectAttempts)}`).join(' ');
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
        <polyline fill="none" stroke="rgb(56 189 248)" strokeWidth="3" points={usersPoints} />
        <polyline fill="none" stroke="rgb(251 191 36)" strokeWidth="3" points={attemptsPoints} />
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-white/75">
        <span>■ ユニーク端末（日次）</span>
        <span className="text-amber-200">■ 検出リクエスト（日次）</span>
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
