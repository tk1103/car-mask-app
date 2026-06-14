import { NextRequest, NextResponse } from 'next/server';
import { isMetricsAdminAuthorized } from '../../../../lib/admin-auth';
import { grantOperatorPro, isValidDeviceId, resolvePlanContext } from '../../../../lib/plan';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!process.env.METRICS_ADMIN_TOKEN) {
    return NextResponse.json({ error: 'METRICS_ADMIN_TOKEN is not configured' }, { status: 503 });
  }
  if (!isMetricsAdminAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { deviceId?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const deviceId = body.deviceId?.trim() ?? '';
  if (!isValidDeviceId(deviceId)) {
    return NextResponse.json(
      { error: 'deviceId が無効です。Carkus トップを同じブラウザで開いてから再度お試しください。' },
      { status: 400 }
    );
  }

  try {
    await grantOperatorPro(deviceId);
    const ctx = await resolvePlanContext(deviceId);
    return NextResponse.json({
      ok: true,
      deviceId,
      plan: ctx.plan,
      planSource: ctx.source,
      message: 'この端末を運営 Pro に登録しました。Carkus トップを再読み込みしてください。',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Registration failed' },
      { status: 500 }
    );
  }
}
