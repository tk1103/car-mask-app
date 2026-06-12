import { NextRequest, NextResponse } from 'next/server';
import { grantPro, isActivationCodeValid, isBillingEnabled, isValidDeviceId } from '../../../../lib/plan';

export const runtime = 'nodejs';

/**
 * 決済後に配布するコードで Pro を付与（デバイス単位）。
 * Body: { "code": "..." }
 * Header: X-Device-Id
 */
export async function POST(request: NextRequest) {
  if (!isBillingEnabled()) {
    return NextResponse.json(
      { error: 'Billing is not enabled', errorType: 'billing_disabled' },
      { status: 403 }
    );
  }

  const deviceId = request.headers.get('x-device-id')?.trim() || '';
  if (!isValidDeviceId(deviceId)) {
    return NextResponse.json(
      { error: 'Valid X-Device-Id header is required', errorType: 'bad_request' },
      { status: 400 }
    );
  }

  let body: { code?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', errorType: 'bad_request' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return NextResponse.json({ error: 'Activation code is required', errorType: 'bad_request' }, { status: 400 });
  }

  if (!isActivationCodeValid(code)) {
    return NextResponse.json({ error: 'Invalid activation code', errorType: 'forbidden' }, { status: 403 });
  }

  const lifetime = process.env.PLAN_ACTIVATION_LIFETIME === 'true';
  const days = Number.parseInt(process.env.PLAN_ACTIVATION_DAYS ?? '365', 10) || 365;

  try {
    await grantPro(deviceId, lifetime ? { lifetime: true } : { days });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Activation failed',
        errorType: 'unknown',
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    plan: 'pro',
    lifetime,
    days: lifetime ? null : days,
  });
}
