'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { getStableDeviceId } from '../lib/device-id';

export function PageViewTracker() {
  const pathname = usePathname();
  const sentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return;
    if (sentRef.current === pathname) return;
    sentRef.current = pathname;

    const deviceId = getStableDeviceId();
    fetch('/api/metrics-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(deviceId ? { 'X-Device-Id': deviceId } : {}),
      },
      body: JSON.stringify({ event: 'page_view', path: pathname }),
    }).catch(() => {});
  }, [pathname]);

  return null;
}
