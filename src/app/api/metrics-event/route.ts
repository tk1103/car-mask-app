import { NextRequest, NextResponse } from 'next/server';
import { trackUsageEvent } from '../../../lib/usage-metrics';

export const runtime = 'nodejs';

type ClientEvent = 'page_view' | 'upgrade_click' | 'feature_blocked_by_plan';

function getClientId(request: NextRequest): string {
  const deviceId = request.headers.get('x-device-id')?.trim();
  if (deviceId && (/^[0-9a-f-]{36}$/i.test(deviceId) || /^d-\d+-[a-z0-9]+$/i.test(deviceId))) {
    return `device:${deviceId}`;
  }
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim() ?? '';
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'anonymous';
}

function getCountryCode(request: NextRequest): string {
  const country = request.headers.get('x-vercel-ip-country')?.trim();
  if (country) return country.toUpperCase();
  const cloudflareCountry = request.headers.get('cf-ipcountry')?.trim();
  if (cloudflareCountry) return cloudflareCountry.toUpperCase();
  return 'UNKNOWN';
}

function getDeviceType(request: NextRequest): 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown' {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  if (!ua) return 'unknown';
  if (/bot|crawler|spider|slurp/.test(ua)) return 'bot';
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobi|iphone|android/.test(ua)) return 'mobile';
  return 'desktop';
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { event?: string };
    const event = body.event;
    if (event !== 'page_view' && event !== 'upgrade_click' && event !== 'feature_blocked_by_plan') {
      return NextResponse.json({ ok: false, error: 'invalid_event' }, { status: 400 });
    }
    const clientId = getClientId(request);
    const meta =
      event === 'page_view'
        ? { country: getCountryCode(request), deviceType: getDeviceType(request) }
        : undefined;
    await trackUsageEvent(clientId, event as ClientEvent, undefined, meta);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[metrics-event] failed to track:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
