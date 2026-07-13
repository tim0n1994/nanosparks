'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import LangToggle from './LangToggle';

const ClerkAuthSection = dynamic(
  () => import('./ClerkAuthSection'),
  { ssr: false }
);

export default function Navbar() {
  const { t } = useTranslation();

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="text-xl font-bold text-primary-600">
            NanoSparks
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
              {t('nav.dashboard')}
            </Link>
            <Link href="/submit" className="text-sm text-gray-600 hover:text-gray-900">
              {t('nav.analyze')}
            </Link>
            <Link href="/corpora" className="text-sm text-gray-600 hover:text-gray-900">
              {t('nav.search')}
            </Link>
            {isValidClerkKey && <ClerkAuthSection />}
            <Link href="/settings" className="text-sm text-gray-600 hover:text-gray-900" title="LLM Settings">
              ⚙️
            </Link>
            <LangToggle />
          </div>
        </div>
      </div>
    </nav>
  );
}
