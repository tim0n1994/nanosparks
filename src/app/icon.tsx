import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#09090b',
          borderRadius: '6px',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect x="1" y="8" width="3" height="6" rx="1.5" fill="#6366f1" opacity="0.68" />
          <rect x="5.25" y="5" width="3" height="12" rx="1.5" fill="#6366f1" opacity="0.84" />
          <rect x="9.5" y="2" width="3" height="18" rx="1.5" fill="#6366f1" />
          <rect x="13.75" y="5" width="3" height="12" rx="1.5" fill="#6366f1" opacity="0.84" />
          <rect x="18" y="8" width="3" height="6" rx="1.5" fill="#6366f1" opacity="0.68" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
