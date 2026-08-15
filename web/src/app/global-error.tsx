'use client';

/**
 * Last-resort boundary for failures in the root layout itself.
 *
 * At this level the app shell — including Tailwind's stylesheet and the
 * providers — may not have mounted, so this page deliberately carries its own
 * <html>/<body> and inline styles rather than depending on anything else.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              margin: '0 auto',
              borderRadius: '16px',
              background: '#ffe4e6',
              display: 'grid',
              placeItems: 'center',
              fontSize: '26px',
            }}
            aria-hidden
          >
            ⚠️
          </div>

          <h1 style={{ margin: '20px 0 0', fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
            Tixit couldn&apos;t load
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: '14px', lineHeight: 1.6, color: '#64748b' }}>
            Something went wrong while starting the page. Reloading usually fixes it.
          </p>

          <div style={{ marginTop: '28px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              onClick={reset}
              style={{
                height: '40px',
                padding: '0 20px',
                borderRadius: '8px',
                border: 'none',
                background: '#e11d48',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                height: '40px',
                padding: '0 20px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#1e293b',
                fontSize: '14px',
                fontWeight: 500,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Go home
            </a>
          </div>

          {error?.digest && (
            <p style={{ marginTop: '24px', fontSize: '12px', color: '#94a3b8' }}>
              Reference code <span style={{ fontFamily: 'ui-monospace, monospace' }}>{error.digest}</span>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
