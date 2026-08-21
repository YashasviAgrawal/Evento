import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #4c0519 0%, #9f1239 45%, #e11d48 100%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 120,
            height: 120,
            borderRadius: 28,
            background: 'rgba(255,255,255,0.15)',
            color: '#fff',
            fontSize: 64,
            fontWeight: 800,
            marginBottom: 36,
          }}
        >
          T
        </div>
        <div style={{ display: 'flex', color: '#fff', fontSize: 76, fontWeight: 800, letterSpacing: -1.5 }}>
          Tixit
        </div>
        <div style={{ display: 'flex', color: 'rgba(255,255,255,0.85)', fontSize: 30, marginTop: 16 }}>
          Find Your Moment
        </div>
      </div>
    ),
    { ...size },
  );
}
