import { NextRequest, NextResponse } from 'next/server';
import { getUsageSummary } from '../../../../lib/usage-metrics';

export const runtime = 'nodejs';

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.METRICS_ADMIN_TOKEN;
  if (!expected) return false;
  const headerToken = request.headers.get('x-admin-token')?.trim();
  const queryToken = request.nextUrl.searchParams.get('token')?.trim();
  const provided = headerToken || queryToken;
  return Boolean(provided && provided === expected);
}

export async function GET(request: NextRequest) {
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
}
