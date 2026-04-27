import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Plan = 'free' | 'pro';

function normalizePlan(value?: string | null): Plan {
  return value?.toLowerCase() === 'pro' ? 'pro' : 'free';
}

function resolvePlan(deviceId: string): Plan {
  const forcedPlan = normalizePlan(process.env.FORCE_PLAN);
  if (process.env.FORCE_PLAN) return forcedPlan;

  const defaultPlan = normalizePlan(process.env.DEFAULT_PLAN);
  const rawProDeviceIds = process.env.PRO_DEVICE_IDS || '';
  const proDeviceIds = new Set(
    rawProDeviceIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
  if (deviceId && proDeviceIds.has(deviceId)) return 'pro';
  return defaultPlan;
}

export async function GET(request: NextRequest) {
  const deviceId =
    request.headers.get('x-device-id')?.trim() ||
    request.nextUrl.searchParams.get('deviceId')?.trim() ||
    '';
  const plan = resolvePlan(deviceId);
  return NextResponse.json({
    plan,
    planSource: process.env.FORCE_PLAN ? 'force' : deviceId ? 'device' : 'default',
  });
}
