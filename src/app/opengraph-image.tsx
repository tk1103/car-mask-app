import { ImageResponse } from 'next/og';
import { site } from '../lib/site';

export const alt = `${site.name} - ${site.taglineJa}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '72px',
          background: 'linear-gradient(160deg, #0a0a0a 0%, #1a1a1a 45%, #000 100%)',
          color: '#fff',
        }}
      >
        <div style={{ fontSize: 88, fontWeight: 300, letterSpacing: '-0.02em' }}>{site.name}</div>
        <div style={{ marginTop: 28, fontSize: 40, fontWeight: 400, color: 'rgba(255,255,255,0.88)' }}>
          {site.taglineJa}
        </div>
        <div style={{ marginTop: 24, fontSize: 26, lineHeight: 1.5, color: 'rgba(255,255,255,0.55)', maxWidth: 900 }}>
          {site.descriptionJa}
        </div>
        <div
          style={{
            marginTop: 'auto',
            fontSize: 22,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.12em',
          }}
        >
          BETA · Web App
        </div>
      </div>
    ),
    { ...size }
  );
}
