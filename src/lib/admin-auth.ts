import { NextRequest } from 'next/server';

/** コピペ時の改行・全角スペース等を除去 */
export function normalizeAdminToken(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
}

export function isMetricsAdminAuthorized(
  request: NextRequest,
  extraToken?: string | null
): boolean {
  const expected = normalizeAdminToken(process.env.METRICS_ADMIN_TOKEN);
  if (!expected) return false;
  const headerToken = normalizeAdminToken(request.headers.get('x-admin-token'));
  const queryToken = normalizeAdminToken(request.nextUrl.searchParams.get('token'));
  const bodyToken = normalizeAdminToken(extraToken);
  const provided = headerToken || queryToken || bodyToken;
  return Boolean(provided && provided === expected);
}
