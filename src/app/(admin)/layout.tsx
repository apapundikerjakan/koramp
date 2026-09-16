import { AuthProvider } from '@/contexts/AuthContext';

// Admin routes only: /admin/* (P2). Public pages never load AuthProvider
// and never auto-call /api/admin/session.
// Dynamic: admin session must be checked at request time, never prerendered.
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
