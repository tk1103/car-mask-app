import { NextRequest } from 'next/server';

export function isMetricsAdminAuthorized(request: NextRequest): boolean {
  const expected = process.env.METRICS_ADMIN_TOKEN?.trim();
  if (!expected) return false;
  const headerToken = request.headers.get('x-admin-token')?.trim();
  const queryToken = request.nextUrl.searchParams.get('token')?.trim();
  const provided = headerToken || queryToken;
  return Boolean(provided && provided === expected);
}
