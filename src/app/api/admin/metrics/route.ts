import { NextRequest, NextResponse } from 'next/server';
import { getUsageSummary } from '../../../../lib/usage-metrics';

export const runtime = 'nodejs';

type PreflightCheck = {
  id: 'admin_token' | 'kv_env' | 'metrics_read';
  ok: boolean;
  message: string;
};

type DailyPoint = {
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
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function toIsoDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function listDatesInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = toUtcDate(from);
  const end = toUtcDate(to);
  while (cur.getTime() <= end.getTime()) {
    out.push(toIsoDateUTC(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.METRICS_ADMIN_TOKEN;
  if (!expected) return false;
  const headerToken = request.headers.get('x-admin-token')?.trim();
  const queryToken = request.nextUrl.searchParams.get('token')?.trim();
  const provided = headerToken || queryToken;
  return Boolean(provided && provided === expected);
}

function buildKvEnvCheck(): PreflightCheck {
  const url = process.env.KV_REST_API_URL?.trim() ?? '';
  const token = process.env.KV_REST_API_TOKEN?.trim() ?? '';
  if (!url || !token) {
    return {
      id: 'kv_env',
      ok: false,
      message: 'KV_REST_API_URL または KV_REST_API_TOKEN が未設定です',
    };
  }
  const looksLikeToken = url.startsWith('gQ') || !url.includes('://');
  const looksLikeUrl = /^https?:\/\//.test(url);
  if (!looksLikeUrl || looksLikeToken) {
    return {
      id: 'kv_env',
      ok: false,
      message: 'KV_REST_API_URL がURL形式ではありません（URLとTOKENの入れ違いの可能性）',
    };
  }
  if (token.includes('://')) {
    return {
      id: 'kv_env',
      ok: false,
      message: 'KV_REST_API_TOKEN にURLが入っています（URLとTOKENの入れ違いの可能性）',
    };
  }
  return {
    id: 'kv_env',
    ok: true,
    message: 'KV環境変数の形式は正常です',
  };
}

export async function GET(request: NextRequest) {
  try {
    const preflight = request.nextUrl.searchParams.get('preflight') === '1';
    if (preflight) {
      if (!process.env.METRICS_ADMIN_TOKEN) {
        return NextResponse.json(
          { error: 'METRICS_ADMIN_TOKEN is not configured' },
          { status: 503 }
        );
      }
      if (!isAuthorized(request)) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      const checks: PreflightCheck[] = [];
      const hasAdminToken = Boolean(process.env.METRICS_ADMIN_TOKEN);
      checks.push({
        id: 'admin_token',
        ok: hasAdminToken,
        message: hasAdminToken
          ? 'METRICS_ADMIN_TOKEN は設定済みです'
          : 'METRICS_ADMIN_TOKEN が未設定です',
      });
      checks.push(buildKvEnvCheck());
      try {
        const summary = await getUsageSummary();
        checks.push({
          id: 'metrics_read',
          ok: true,
          message:
            summary.storage === 'kv'
              ? 'メトリクス取得OK（KV永続）'
              : 'メトリクス取得OK（Memoryフォールバック）',
        });
      } catch (error) {
        checks.push({
          id: 'metrics_read',
          ok: false,
          message: `メトリクス読み取り失敗: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return NextResponse.json({
        ok: checks.every((item) => item.ok),
        mode: 'beta',
        checks,
      });
    }

    if (!process.env.METRICS_ADMIN_TOKEN) {
      return NextResponse.json(
        { error: 'METRICS_ADMIN_TOKEN is not configured' },
        { status: 503 }
      );
    }
    if (!isAuthorized(request)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const from = request.nextUrl.searchParams.get('from')?.trim() ?? '';
    const to = request.nextUrl.searchParams.get('to')?.trim() ?? '';
    if (from || to) {
      if (!from || !to || !isIsoDate(from) || !isIsoDate(to) || from > to) {
        return NextResponse.json(
          { error: 'Invalid from/to. Use YYYY-MM-DD and from <= to.' },
          { status: 400 }
        );
      }
      const dates = listDatesInclusive(from, to);
      if (dates.length > 120) {
        return NextResponse.json(
          { error: 'Date range is too large. Please use 120 days or fewer.' },
          { status: 400 }
        );
      }
      const summaries = await Promise.all(dates.map((d) => getUsageSummary(d)));
      const series: DailyPoint[] = summaries.map((s) => ({
        date: s.date,
        pageViews: s.pageViews,
        pageViewUniqueUsers: s.pageViewUniqueUsers,
        uniqueUsers: s.uniqueUsers,
        detectAttempts: s.detectAttempts,
        detectSuccess: s.detectSuccess,
        detectFailure: s.detectFailure,
        upgradeClick: s.upgradeClick,
        featureBlockedByPlan: s.featureBlockedByPlan,
        detectFailureTypeCounts: s.detectFailureTypeCounts ?? {},
      }));
      const totals = series.reduce(
        (acc, row) => {
          acc.pageViews += row.pageViews;
          acc.pageViewUniqueUsers += row.pageViewUniqueUsers;
          acc.uniqueUsers += row.uniqueUsers;
          acc.detectAttempts += row.detectAttempts;
          acc.detectSuccess += row.detectSuccess;
          acc.detectFailure += row.detectFailure;
          acc.upgradeClick += row.upgradeClick;
          acc.featureBlockedByPlan += row.featureBlockedByPlan;
          for (const [errorType, count] of Object.entries(row.detectFailureTypeCounts ?? {})) {
            acc.detectFailureTypeCounts[errorType] = (acc.detectFailureTypeCounts[errorType] ?? 0) + count;
          }
          return acc;
        },
        {
          pageViews: 0,
          pageViewUniqueUsers: 0,
          uniqueUsers: 0,
          detectAttempts: 0,
          detectSuccess: 0,
          detectFailure: 0,
          upgradeClick: 0,
          featureBlockedByPlan: 0,
          detectFailureTypeCounts: {} as Record<string, number>,
        }
      );
      return NextResponse.json({
        mode: 'range',
        from,
        to,
        days: dates.length,
        storage: summaries.some((s) => s.storage === 'memory') ? 'memory' : 'kv',
        totals,
        series,
      });
    }

    const date = request.nextUrl.searchParams.get('date') || undefined;
    const summary = await getUsageSummary(date);
    return NextResponse.json({ mode: 'single', ...summary });
  } catch (error) {
    console.error('[admin/metrics] failed to load summary:', error);
    return NextResponse.json(
      { error: 'Failed to load metrics' },
      { status: 500 }
    );
  }
}
