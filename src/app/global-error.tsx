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
      <body style={{ background: '#07071a', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Terjadi kesalahan</h1>
            <p style={{ color: '#8a8aa3', fontSize: 14, marginBottom: 20 }}>
              Halaman gagal dimuat. Coba lagi — jika berlanjut, hubungi tim Kipramp.
            </p>
            <button
              onClick={() => reset()}
              style={{
                padding: '10px 24px', background: '#4f46e5', color: '#fff',
                border: 'none', borderRadius: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Coba lagi
            </button>
            {error.digest && (
              <p style={{ color: '#4a4a6a', fontSize: 11, marginTop: 16, fontFamily: 'monospace' }}>
                Ref: {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
