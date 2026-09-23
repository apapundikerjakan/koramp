'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

function tickFormat(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function RestrictedCountdown({ remaining, retryAfter, restrictionId, onExpire }: {
  remaining?: string;
  retryAfter: number;
  restrictionId?: string;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(retryAfter);
  useEffect(() => {
    if (left <= 0) {
      onExpire();
      return;
    }
    const id = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(id);
  }, [left, onExpire]);

  return (
    <div className="w-full max-w-md text-center bg-surface-2 border border-line rounded-xl p-8">
      <p className="text-brand-400 text-xs font-bold tracking-widest mb-2">KORAMP SECURITY</p>
      <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
        <ShieldAlert className="w-6 h-6 text-red-400" />
      </div>
      <h1 className="text-white font-bold text-lg mb-2">Temporary Access Restriction</h1>
      <p className="text-gray-400 text-sm leading-relaxed">
        Abnormal activity has been detected from this connection. Access will automatically
        become available after the restriction expires.
      </p>
      <p className="text-gray-500 text-xs uppercase tracking-widest mt-5">Time remaining</p>
      <p className="text-white font-mono font-black text-3xl mt-1">{left > 0 ? tickFormat(left) : (remaining ?? '-')}</p>
      {restrictionId && <p className="text-gray-600 text-xs mt-2 font-mono">Ref: {restrictionId}</p>}
      <p className="text-gray-500 text-xs mt-4">If you believe this is a mistake, contact KORAMP support.</p>
    </div>
  );
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [error, setError] = useState('');
  const [restriction, setRestriction] = useState<{ retryAfter: number; remaining?: string; restrictionId?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [secsLeft, setSecsLeft] = useState(30);

  // Ask the server whether authenticator 2FA is enforced (public flag).
  useEffect(() => {
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => {
        if (d.authenticated) router.push('/admin');
        else setTotpEnabled(!!d.totpEnabled);
      })
      .catch(() => {});
  }, [router]);

  // 30s rotating-code countdown hint (matches authenticator apps).
  useEffect(() => {
    if (step !== 2) return;
    const tick = () => setSecsLeft(30 - (Math.floor(Date.now() / 1000) % 30));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [step]);

  const cleanKey = key.replace(/\s+/g, '').toLowerCase();
  const cleanCode = code.replace(/\s+/g, '');

  if (restriction) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <RestrictedCountdown
          remaining={restriction.remaining}
          retryAfter={restriction.retryAfter}
          restrictionId={restriction.restrictionId}
          onExpire={() => setRestriction(null)}
        />
      </div>
    );
  }

  const handleKeyNext = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (totpEnabled) setStep(2);
    else void doLogin(cleanKey, '');
  };

  const doLogin = async (adminKey: string, totpCode: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey, totpCode }),
      });

      const data = await res.json();

      if (res.ok && data.authenticated) {
        router.push('/admin');
      } else if (res.status === 403 && data?.retryAfter) {
        // Temporary restriction: server-computed countdown (visual only).
        setRestriction({
          retryAfter: data.retryAfter,
          remaining: data.remaining,
          restrictionId: data.restrictionId,
        });
        setError('');
      } else {
        setError(data.error?.message ?? 'Login failed. Please try again.');
        if (data.error?.code === 'INVALID_TOTP') setCode('');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    await doLogin(cleanKey, cleanCode);
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">KORAMP ADMIN</h1>
          <p className="text-gray-400 text-sm mt-2">
            {step === 1 ? 'Admin Access Key Authentication' : 'Kode Authenticator'}
          </p>
        </div>

        <div className="bg-surface-2 border border-line rounded-xl p-6">
          {step === 1 ? (
            <form onSubmit={handleKeyNext} className="space-y-4">
              <div>
                <label
                  htmlFor="adminKey"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  Admin Access Key
                </label>
                <input
                  id="adminKey"
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value.replace(/\s+/g, '').toLowerCase())}
                  placeholder="64-character hex key"
                  className="w-full px-4 py-3 bg-base border border-line-strong rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-brand-500/50 transition-colors font-mono text-sm"
                  autoComplete="off"
                  spellCheck="false"
                />
                <p className="text-gray-500 text-xs mt-1.5">
                  64 karakter hexadecimal. Spasi/newline saat paste otomatis dibuang.
                  <span className={cleanKey.length === 64 ? 'text-green-400' : 'text-gray-600'}> ({cleanKey.length}/64)</span>
                </p>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || cleanKey.length !== 64}
                className="w-full py-3 bg-brand-500 hover:bg-brand-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {totpEnabled ? 'Lanjut →' : loading ? <span className="animate-pulse">Loading...</span> : 'Access Dashboard'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor="totpCode"
                    className="block text-sm font-medium text-gray-300"
                  >
                    Kode Authenticator (6 digit)
                  </label>
                  <span className="text-yellow-400 text-xs font-mono">:{String(secsLeft).padStart(2, '0')}</span>
                </div>
                <input
                  id="totpCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="123456"
                  className="w-full px-4 py-3 bg-base border border-line-strong rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-brand-500/50 transition-colors font-mono text-center text-2xl tracking-[0.5em]"
                />
                <p className="text-gray-500 text-xs mt-1.5">
                  Buka aplikasi authenticator, masukkan kode yang tampil. Kode berganti tiap 30 detik. Anda punya ~1 menit (toleransi ±1 langkah).
                </p>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || cleanCode.length < 6}
                className="w-full py-3 bg-brand-500 hover:bg-brand-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span className="animate-pulse">Loading...</span>
                ) : (
                  'Access Dashboard'
                )}
              </button>
              <button
                type="button"
                onClick={() => { setStep(1); setError(''); }}
                className="w-full text-gray-500 hover:text-white text-xs"
              >
                ← Kembali
              </button>
            </form>
          )}

          <div className="mt-4 pt-4 border-t border-line">
            <p className="text-gray-500 text-xs text-center">
              1 kunci = 1 perangkat. Login baru menendang session lama.
            </p>
          </div>
        </div>

        <p className="text-gray-600 text-xs text-center mt-6">
          Admin Access Key + kode authenticator.
             Tidak ada email, password, atau role hierarchy.
          <br />
          <span className="text-gray-700">Kehilangan key? Generate dari server: <span className="font-mono">npm run admin:setup</span></span>
        </p>
      </div>
    </div>
  );
}
