'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const DEVICE_ID_KEY = 'carkus_device_id';

function getDeviceId(): string {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `d-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`;
    try {
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    } catch (_) {}
  }
  return id ?? '';
}

export function PageViewTracker() {
  const pathname = usePathname();
  const sentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return;
    if (sentRef.current === pathname) return;
    sentRef.current = pathname;

    const deviceId = getDeviceId();
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
