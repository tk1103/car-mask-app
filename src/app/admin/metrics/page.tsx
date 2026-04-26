'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type MetricsResponse = {
  date: string;
  uniqueUsers: number;
  detectAttempts: number;
  detectSuccess: number;
  detectFailure: number;
  storage: 'kv' | 'memory';
  kvConfigured?: boolean;
  missingEnvVars?: string[];
  kvError?: string;
  countryCounts?: Record<string, number>;
  deviceTypeCounts?: Record<string, number>;
};

type PreflightResponse = {
  ok: boolean;
  mode: 'beta';
  checks: Array<{
    id: 'admin_token' | 'kv_env' | 'metrics_read';
    ok: boolean;
    message: string;
  }>;
};

const TOKEN_STORAGE_KEY = 'carkus_metrics_admin_token';
const MAX_RANGE_DAYS = 31;

function formatJstDateInput(offsetDays = 0): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function enumerateDates(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate) return [];
  const dates: string[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const cursor = new Date(start);
  while (cursor <= end && dates.length <= MAX_RANGE_DAYS) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export default function AdminMetricsPage() {
  const [token, setToken] = useState('');
  const [date, setDate] = useState('');
  const [rangeStartDate, setRangeStartDate] = useState('');
  const [rangeEndDate, setRangeEndDate] = useState('');
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [rangeSeries, setRangeSeries] = useState<MetricsResponse[]>([]);
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
    if (saved) setToken(saved);
    const today = formatJstDateInput(0);
    setDate(today);
    setRangeEndDate(today);
    setRangeStartDate(formatJstDateInput(-6));
  }, []);

  const successRate = useMemo(() => {
    if (!data || data.detectAttempts === 0) return 0;
    return Math.round((data.detectSuccess / data.detectAttempts) * 100);
  }, [data]);

  const topCountries = useMemo(
    () =>
      Object.entries(data?.countryCounts ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [data?.countryCounts]
  );

  const deviceEntries = useMemo(
    () =>
      Object.entries(data?.deviceTypeCounts ?? {}).sort((a, b) => b[1] - a[1]),
    [data?.deviceTypeCounts]
  );

  const rangeMaxAttempts = useMemo(
    () => Math.max(1, ...rangeSeries.map((item) => item.detectAttempts)),
    [rangeSeries]
  );

  const rangeTotals = useMemo(
    () =>
      rangeSeries.reduce(
        (acc, item) => {
          acc.detectAttempts += item.detectAttempts;
          acc.detectSuccess += item.detectSuccess;
          acc.detectFailure += item.detectFailure;
          return acc;
        },
        { detectAttempts: 0, detectSuccess: 0, detectFailure: 0 }
      ),
    [rangeSeries]
  );

  const successRateSeries = useMemo(
    () =>
      rangeSeries.map((item) => ({
        date: item.date,
        rate: item.detectAttempts > 0 ? Math.round((item.detectSuccess / item.detectAttempts) * 100) : 0,
      })),
    [rangeSeries]
  );

  const successRatePolylinePoints = useMemo(() => {
    if (successRateSeries.length === 0) return '';
    if (successRateSeries.length === 1) return '0,100';
    return successRateSeries
      .map((item, index) => {
        const x = (index / (successRateSeries.length - 1)) * 100;
        const y = 100 - item.rate;
        return `${x},${y}`;
      })
      .join(' ');
  }, [successRateSeries]);

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
      const fetchOne = async (targetDate?: string): Promise<MetricsResponse> => {
        const params = new URLSearchParams();
        if (targetDate) params.set('date', targetDate);
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

      const primary = await fetchOne(date || undefined);
      setData(primary);

      const rangeDates = enumerateDates(rangeStartDate, rangeEndDate);
      if (rangeDates.length === 0) {
        setRangeSeries([]);
      } else if (rangeDates.length > MAX_RANGE_DAYS) {
        throw new Error(`期間は最大 ${MAX_RANGE_DAYS} 日までにしてください。`);
      } else {
        const series = await Promise.all(rangeDates.map((d) => fetchOne(d)));
        setRangeSeries(series);
      }
    } catch (e) {
      setData(null);
      setRangeSeries([]);
      setError(`通信エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [date, rangeEndDate, rangeStartDate, token]);

  const runPreflight = useCallback(async () => {
    if (!token.trim()) {
      setError('まず METRICS_ADMIN_TOKEN を入力してください。');
      return;
    }
    setPreflightLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/metrics?preflight=1', {
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
        throw new Error(typeof json?.error === 'string' ? json.error : `公開前チェックに失敗しました (${res.status})`);
      }
      if (!json || typeof json !== 'object' || !Array.isArray(json.checks)) {
        throw new Error('公開前チェックの応答形式が不正です。');
      }
      setPreflight(json as PreflightResponse);
    } catch (e) {
      setPreflight(null);
      setError(`通信エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPreflightLoading(false);
    }
  }, [token]);

  return (
    <main className="min-h-screen bg-black text-white p-6 md:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-light tracking-wide">Carkus Metrics</h1>
          <p className="text-white/70 text-sm">
            ブラウザだけで本日の利用状況を確認できます。トークンを入力して「更新」を押してください。
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
            <label className="text-xs text-white/70">日付（任意 / JST）</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full md:w-64 rounded-lg bg-black/60 border border-white/20 px-3 py-2 text-sm outline-none focus:border-white/40"
              />
              <button
                type="button"
                onClick={() => setDate(formatJstDateInput(0))}
                className="px-3 py-2 rounded-full text-xs bg-white/10 border border-white/20 hover:bg-white/20"
              >
                今日
              </button>
              <button
                type="button"
                onClick={() => setDate(formatJstDateInput(-1))}
                className="px-3 py-2 rounded-full text-xs bg-white/10 border border-white/20 hover:bg-white/20"
              >
                昨日
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-white/70">期間（日次グラフ / JST, 最大31日）</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={rangeStartDate}
                onChange={(e) => setRangeStartDate(e.target.value)}
                className="w-full md:w-56 rounded-lg bg-black/60 border border-white/20 px-3 py-2 text-sm outline-none focus:border-white/40"
              />
              <span className="text-white/60 text-xs">〜</span>
              <input
                type="date"
                value={rangeEndDate}
                onChange={(e) => setRangeEndDate(e.target.value)}
                className="w-full md:w-56 rounded-lg bg-black/60 border border-white/20 px-3 py-2 text-sm outline-none focus:border-white/40"
              />
              <button
                type="button"
                onClick={() => {
                  setRangeEndDate(formatJstDateInput(0));
                  setRangeStartDate(formatJstDateInput(-6));
                }}
                className="px-3 py-2 rounded-full text-xs bg-white/10 border border-white/20 hover:bg-white/20"
              >
                直近7日
              </button>
              <button
                type="button"
                onClick={() => {
                  setRangeEndDate(formatJstDateInput(0));
                  setRangeStartDate(formatJstDateInput(-29));
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
          <button
            onClick={runPreflight}
            disabled={preflightLoading}
            className="ml-2 px-5 py-2.5 rounded-full bg-sky-500/15 border border-sky-300/30 text-sm hover:bg-sky-500/25 transition-colors disabled:opacity-60"
          >
            {preflightLoading ? 'チェック中...' : '公開前チェック（ベータ）'}
          </button>

          {error && (
            <p className="text-red-200 text-sm">{error}</p>
          )}
        </section>

        {preflight && (
          <section className="rounded-2xl border border-white/20 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-white/90">公開前チェック（ベータ運用向け）</p>
              <span className={`text-xs px-2 py-1 rounded-full border ${preflight.ok ? 'bg-emerald-500/20 border-emerald-300/30 text-emerald-100' : 'bg-amber-500/20 border-amber-300/30 text-amber-100'}`}>
                {preflight.ok ? '公開OK（ベータ）' : '要確認'}
              </span>
            </div>
            <div className="space-y-2">
              {preflight.checks.map((check) => (
                <div key={check.id} className="rounded-lg border border-white/15 bg-black/20 px-3 py-2">
                  <p className={`text-xs ${check.ok ? 'text-emerald-200' : 'text-amber-200'}`}>
                    {check.ok ? 'OK' : 'NG'} / {check.id}
                  </p>
                  <p className="text-xs text-white/80 mt-1">{check.message}</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-white/15 bg-black/20 px-3 py-2 space-y-1">
              <p className="text-xs text-white/80">実機スモーク（最終確認）</p>
              <p className="text-xs text-white/60">- iPhone/Android で 撮影 → 解析 → 手動調整 → 保存 を各1回</p>
              <p className="text-xs text-white/60">- 20秒以上待機時に案内文が表示されること</p>
            </div>
          </section>
        )}

        {data && (
          <>
            {!data.kvConfigured && (
              <section className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-4 space-y-2">
                <p className="text-amber-100 text-sm font-light">
                  いまは一時保存（Memory）です。Vercelに以下の環境変数を追加すると、数字が永続化されます。
                </p>
                <p className="text-amber-100/90 text-xs">不足: {(data.missingEnvVars ?? []).join(', ') || 'なし'}</p>
                {data.kvError && (
                  <p className="text-amber-100/90 text-xs break-all">
                    KV接続エラー: {data.kvError}
                  </p>
                )}
                <p className="text-amber-100/90 text-xs">
                  設定後は再デプロイしてからこの画面を更新してください。
                </p>
              </section>
            )}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MetricCard label="日付" value={data.date} />
              <MetricCard label="保存方式" value={data.storage === 'kv' ? 'KV（永続）' : 'Memory（一時）'} />
              <MetricCard label="ユニーク利用端末" value={`${data.uniqueUsers}`} />
              <MetricCard label="検出リクエスト" value={`${data.detectAttempts}`} />
              <MetricCard label="成功数" value={`${data.detectSuccess}`} />
              <MetricCard label="失敗数" value={`${data.detectFailure}`} />
              <MetricCard label="成功率" value={`${successRate}%`} />
            </section>
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-white/20 bg-white/5 p-4">
                <p className="text-xs text-white/70 mb-2">地域（上位5 / 検出試行数）</p>
                {topCountries.length === 0 ? (
                  <p className="text-sm text-white/60">データなし</p>
                ) : (
                  <div className="space-y-1">
                    {topCountries.map(([country, count]) => (
                      <p key={country} className="text-sm text-white/90">{country}: {count}</p>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/5 p-4">
                <p className="text-xs text-white/70 mb-2">端末種別（検出試行数）</p>
                {deviceEntries.length === 0 ? (
                  <p className="text-sm text-white/60">データなし</p>
                ) : (
                  <div className="space-y-1">
                    {deviceEntries.map(([deviceType, count]) => (
                      <p key={deviceType} className="text-sm text-white/90">{deviceType}: {count}</p>
                    ))}
                  </div>
                )}
              </div>
            </section>
            <section className="rounded-2xl border border-white/20 bg-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-white/70">期間グラフ（日次）</p>
                <p className="text-xs text-white/60">
                  合計: 試行 {rangeTotals.detectAttempts} / 成功 {rangeTotals.detectSuccess} / 失敗 {rangeTotals.detectFailure}
                </p>
              </div>
              {rangeSeries.length === 0 ? (
                <p className="text-sm text-white/60">期間を指定して「更新」を押すとグラフ表示します。</p>
              ) : (
                <div className="space-y-2">
                  {rangeSeries.map((item) => (
                    <div key={item.date} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-white/70">
                        <span>{item.date}</span>
                        <span>試行 {item.detectAttempts} / 成功 {item.detectSuccess} / 失敗 {item.detectFailure}</span>
                      </div>
                      <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full bg-sky-400/80"
                          style={{ width: `${Math.max(4, (item.detectAttempts / rangeMaxAttempts) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="rounded-2xl border border-white/20 bg-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-white/70">成功率の折れ線グラフ（日次）</p>
                <p className="text-xs text-white/60">縦軸: 成功率(%) / 横軸: 日付</p>
              </div>
              {successRateSeries.length === 0 ? (
                <p className="text-sm text-white/60">期間を指定して「更新」を押すと折れ線グラフ表示します。</p>
              ) : (
                <>
                  <div className="rounded-xl border border-white/15 bg-black/30 p-3">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-48">
                      <line x1="0" y1="100" x2="100" y2="100" stroke="rgba(255,255,255,0.25)" strokeWidth="0.6" />
                      <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.18)" strokeWidth="0.4" />
                      <line x1="0" y1="0" x2="100" y2="0" stroke="rgba(255,255,255,0.12)" strokeWidth="0.3" />
                      <polyline
                        fill="none"
                        stroke="rgba(56,189,248,0.95)"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={successRatePolylinePoints}
                      />
                      {successRateSeries.map((item, index) => {
                        const x = successRateSeries.length === 1 ? 0 : (index / (successRateSeries.length - 1)) * 100;
                        const y = 100 - item.rate;
                        return <circle key={`${item.date}-dot`} cx={x} cy={y} r="1.6" fill="rgba(125,211,252,1)" />;
                      })}
                    </svg>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {successRateSeries.map((item) => (
                      <div key={`${item.date}-label`} className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5">
                        <p className="text-[11px] text-white/60">{item.date}</p>
                        <p className="text-sm text-white/90">{item.rate}%</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </>
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
