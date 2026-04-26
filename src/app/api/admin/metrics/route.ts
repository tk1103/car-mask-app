import { NextRequest, NextResponse } from 'next/server';
import { getUsageSummary } from '../../../../lib/usage-metrics';

export const runtime = 'nodejs';

type PreflightCheck = {
  id: 'admin_token' | 'kv_env' | 'metrics_read';
  ok: boolean;
  message: string;
};

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

    const date = request.nextUrl.searchParams.get('date') || undefined;
    const summary = await getUsageSummary(date);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[admin/metrics] failed to load summary:', error);
    return NextResponse.json(
      { error: 'Failed to load metrics' },
      { status: 500 }
    );
  }
}
