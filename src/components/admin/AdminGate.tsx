'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

/**
 * Shared admin gate: session check with generic restriction handling.
 * Blocked/quarantined sources see RestrictedNotice — never rule details.
 */
export function useAdminGate() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [restriction, setRestriction] = useState<{ remaining: string | null; retryAfter: number | null; restrictionId?: string } | null>(null);

  useEffect(() => {
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((data) => {
        setChecked(true);
        if (data.restricted) {
          setRestriction({
            remaining: typeof data.remaining === 'string' ? data.remaining : null,
            retryAfter: typeof data.retryAfter === 'number' ? data.retryAfter : null,
            restrictionId: typeof data.restrictionId === 'string' ? data.restrictionId : undefined,
          });
          return;
        }
        if (data.authenticated && data.admin) {
          setAuthed(true);
        } else {
          router.push('/admin/login');
        }
      })
      .catch(() => router.push('/admin/login'));
  }, [router]);

  return { checked, authed, restricted: restriction !== null, restriction };
}

function tickFormat(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/**
 * Generic security notice — countdown is server-computed (visual tick only).
 * No counts, rules, IDs (beyond public restriction ID), or infra details.
 */
export function RestrictedNotice({ remaining, retryAfter, restrictionId }: {
  remaining?: string | null;
  retryAfter?: number | null;
  restrictionId?: string;
}) {
  const [left, setLeft] = useState<number | null>(typeof retryAfter === 'number' ? retryAfter : null);

  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      window.location.reload();
      return;
    }
    const id = setTimeout(() => setLeft((v) => (v === null ? v : v - 1)), 1000);
    return () => clearTimeout(id);
  }, [left]);

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center bg-surface-2 border border-line rounded-xl p-8">
        <p className="text-brand-400 text-xs font-bold tracking-widest mb-2">KORAMP SECURITY</p>
        <div className="w-12 h-12 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-6 h-6 text-red-400" />
        </div>
        <h1 className="text-white font-bold text-lg mb-2">Temporary Access Restriction</h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          Abnormal activity has been detected from this connection. For security reasons,
          access has been temporarily restricted.
        </p>
        <p className="text-gray-500 text-xs mt-2">Access will automatically become available after the restriction expires.</p>
        <div className="mt-5 mb-1">
          <p className="text-gray-500 text-xs uppercase tracking-widest">Time remaining</p>
          <p className="text-white font-mono font-black text-3xl mt-1">
            {left === null ? (remaining ?? '-') : tickFormat(left)}
          </p>
          {restrictionId && (
            <p className="text-gray-600 text-xs mt-2 font-mono">Ref: {restrictionId}</p>
          )}
        </div>
        <p className="text-gray-500 text-xs mt-4 leading-relaxed">
          If you believe this is a mistake, contact KORAMP support.
        </p>
      </div>
    </div>
  );
}
