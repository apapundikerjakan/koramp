'use client';

/**
 * Root error boundary — production safety net.
 * Menangkap error render di route mana pun agar user melihat halaman
 * pemulihan, bukan crash/stack trace. Error detail hanya masuk console
 * server (tidak pernah dirender ke browser).
 */
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global-error]', error.digest ?? '', error.message);
  }, [error]);

  return (
    <html lang="id">
      <body style={{ background: '#0E120F', color: '#F5F1E8', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Terjadi kesalahan</h1>
            <p style={{ color: '#9FAB9F', fontSize: 14, marginBottom: 20 }}>
              Halaman gagal dimuat. Coba lagi. Jika berlanjut, hubungi tim KORAMP.
            </p>
            <button
              onClick={() => reset()}
              style={{
                padding: '10px 24px', background: '#C7A048', color: '#131916',
                border: 'none', borderRadius: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Coba lagi
            </button>
            {error.digest && (
              <p style={{ color: '#5E6B60', fontSize: 11, marginTop: 16, fontFamily: 'monospace' }}>
                Ref: {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
