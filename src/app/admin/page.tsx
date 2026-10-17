import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Settings } from 'lucide-react';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { clerkBackend, ADMIN_ROLE } from '@/lib/auth/clerk-client';
import Navbar from '@/components/ui/Navbar';
import AdminPanel from '@/components/admin/AdminPanel';
import { getLang } from '@/lib/i18n/getLang';

export const metadata: Metadata = { title: '管理后台 · NanoSparks' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const lang = getLang((await cookies()).toString());

  // Gate: resolve the visitor's role. In dev (no Clerk key), allow through so
  // local work keeps working.
  let role: 'admin' | 'user' = 'user';
  if (isValidClerkKey) {
    const { userId } = await auth();
    if (!userId) {
      redirect('/sign-in');
    }
    const u = await clerkBackend().users.getUser(userId);
    role = (u.publicMetadata as Record<string, unknown>)?.role === ADMIN_ROLE ? 'admin' : 'user';
  } else {
    role = 'admin'; // dev
  }

  if (role !== 'admin') {
    return (
      <div className="min-h-[100dvh] bg-surface">
        <Navbar />
        <main id="main" className="mx-auto max-w-app px-5 pt-[20vh] text-center">
          <p className="text-lg text-ink-muted">
            {lang === 'en' ? 'Admins only.' : '仅管理员可访问。'}
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="mx-auto max-w-app px-5 py-10">
        <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold tracking-tight text-ink">
          <Settings aria-hidden="true" size={18} strokeWidth={1.5} />
          {lang === 'en' ? 'Admin' : '管理后台'}
        </h1>
        <AdminPanel />
      </main>
    </div>
  );
}
