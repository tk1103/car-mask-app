import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const SIZES = [192, 512] as const;
type Size = (typeof SIZES)[number];

function isValidSize(n: number): n is Size {
  return SIZES.includes(n as Size);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const size = Math.min(512, Math.max(192, parseInt(searchParams.get('size') || '192', 10) || 192));
  const w = isValidSize(size) ? size : 192;
  const fontSize = Math.round((w / 192) * 32);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000000',
          borderRadius: w >= 512 ? 64 : 24,
        }}
      >
        <span
          style={{
            color: '#ffffff',
            fontSize,
            fontWeight: 300,
            letterSpacing: '0.2em',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          Carkus
        </span>
      </div>
    ),
    { width: w, height: w }
  );
}
