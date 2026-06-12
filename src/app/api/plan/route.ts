import { NextRequest, NextResponse } from 'next/server';
import {
  getDetectRemainingToday,
  getPlanLimitsForDocs,
  isBillingEnabled,
  isValidDeviceId,
  resolvePlanContext,
} from '../../../lib/plan';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const deviceId =
    request.headers.get('x-device-id')?.trim() ||
    request.nextUrl.searchParams.get('deviceId')?.trim() ||
    '';

  const ctx = await resolvePlanContext(deviceId);
  const remainingDetectionsToday = await getDetectRemainingToday(deviceId, ctx);

  return NextResponse.json({
    plan: ctx.plan,
    planSource: ctx.source,
    features: ctx.features,
    remainingDetectionsToday,
    limits: getPlanLimitsForDocs(),
    hasValidDeviceId: Boolean(deviceId && isValidDeviceId(deviceId)),
    billingEnabled: isBillingEnabled(),
  });
}
