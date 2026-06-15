import { NextRequest, NextResponse } from 'next/server';
import { isMetricsAdminAuthorized } from '../../../../lib/admin-auth';
import { grantOperatorPro, isValidDeviceId, resolvePlanContext } from '../../../../lib/plan';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!process.env.METRICS_ADMIN_TOKEN) {
    return NextResponse.json({ error: 'METRICS_ADMIN_TOKEN is not configured' }, { status: 503 });
  }

  let body: { deviceId?: string; adminToken?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isMetricsAdminAuthorized(request, body.adminToken)) {
    return NextResponse.json(
      {
        error:
          'Unauthorized（トークン不一致）。Vercel の METRICS_ADMIN_TOKEN と同じ値か、「トークンを確認」を押して確認してください。',
      },
      { status: 401 }
    );
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
    if (ctx.plan !== 'pro') {
      const forcePlan = process.env.FORCE_PLAN?.trim();
      return NextResponse.json(
        {
          error:
            `Pro 登録は KV に保存しましたが、プラン解決が ${ctx.plan} (${ctx.source}) のままです。` +
            (forcePlan
              ? ` Vercel の FORCE_PLAN=${forcePlan} を削除するか、デプロイを最新にしてください。`
              : ' デプロイを最新にして再試行してください。'),
          deviceId,
          plan: ctx.plan,
          planSource: ctx.source,
        },
        { status: 500 }
      );
    }
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
