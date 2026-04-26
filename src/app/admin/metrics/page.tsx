'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type MetricsResponse = {
  date: string;
  uniqueUsers: number;
  detectAttempts: number;
  detectSuccess: number;
  detectFailure: number;
  storage: 'kv' | 'memory';
};

const TOKEN_STORAGE_KEY = 'carkus_metrics_admin_token';

export default function AdminMetricsPage() {
  const [token, setToken] = useState('');
  const [date, setDate] = useState('');
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
    if (saved) setToken(saved);
  }, []);

  const successRate = useMemo(() => {
    if (!data || data.detectAttempts === 0) return 0;
    return Math.round((data.detectSuccess / data.detectAttempts) * 100);
  }, [data]);

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
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      const url = `/api/admin/metrics${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await fetch(url, {
        headers: { 'x-admin-token': token.trim() },
      });
      const json = await res.json();
      if (!res.ok) {
        setData(null);
        setError(typeof json?.error === 'string' ? json.error : `取得に失敗しました (${res.status})`);
        return;
      }
      setData(json as MetricsResponse);
    } catch (e) {
      setData(null);
      setError(`通信エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [date, token]);

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
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full md:w-64 rounded-lg bg-black/60 border border-white/20 px-3 py-2 text-sm outline-none focus:border-white/40"
            />
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
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard label="日付" value={data.date} />
            <MetricCard label="保存方式" value={data.storage === 'kv' ? 'KV（永続）' : 'Memory（一時）'} />
            <MetricCard label="ユニーク利用端末" value={`${data.uniqueUsers}`} />
            <MetricCard label="検出リクエスト" value={`${data.detectAttempts}`} />
            <MetricCard label="成功数" value={`${data.detectSuccess}`} />
            <MetricCard label="失敗数" value={`${data.detectFailure}`} />
            <MetricCard label="成功率" value={`${successRate}%`} />
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
