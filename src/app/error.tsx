'use client';

/**
 * Segment error boundary — fallback UI per segmen route.
 * Sama seperti global-error: tampilkan pemulihan, jangan bocorkan detail.
 */
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[segment-error]', error.digest ?? '', error.message);
  }, [error]);

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-xl font-bold text-white mb-2">Terjadi kesalahan</h1>
        <p className="text-gray-400 text-sm mb-5">
          Bagian ini gagal dimuat. Coba lagi. Jika berlanjut, hubungi tim KORAMP.
        </p>
        <button
          onClick={() => reset()}
          className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Coba lagi
        </button>
        {error.digest && (
          <p className="text-gray-600 text-xs mt-4 font-mono">Ref: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
