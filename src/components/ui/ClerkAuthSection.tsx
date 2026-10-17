'use client';

import { UserButton, SignInButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { LogIn, ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { buttonStyles } from '@/components/ui/Button';

export default function ClerkAuthSection() {
  const { isSignedIn, user } = useUser();
  const { t } = useTranslation();

  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button type="button" className={buttonStyles('ghost', 'sm')}>
          <LogIn className="size-4" strokeWidth={1.5} aria-hidden="true" />
          {t('nav.signIn')}
        </button>
      </SignInButton>
    );
  }

  const role = (user?.publicMetadata?.role as string | undefined) === 'admin' ? 'admin' : 'user';

  return (
    <div className="flex items-center gap-2">
      {role === 'admin' && (
        <Link
          href="/admin"
          className={buttonStyles('ghost', 'sm')}
        >
          <ShieldCheck className="size-4" strokeWidth={1.5} aria-hidden="true" />
          管理
        </Link>
      )}
      <UserButton />
    </div>
  );
}
