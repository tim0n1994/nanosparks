'use client';

import { UserButton, SignInButton, useAuth } from '@clerk/nextjs';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function ClerkAuthSection() {
  const { isSignedIn } = useAuth();
  const { t } = useTranslation();

  // The dashboard link lives in the nav itself — no duplicate here.
  if (isSignedIn) return <UserButton />;

  return (
    <SignInButton mode="modal">
      <button type="button" className="text-sm font-medium text-link hover:opacity-80">
        {t('nav.signIn')}
      </button>
    </SignInButton>
  );
}
