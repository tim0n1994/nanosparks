import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';
import Navbar from '@/components/ui/Navbar';
import { getLang } from '@/lib/i18n/getLang';

export const metadata: Metadata = { title: '登录 · NanoSparks' };

const copy = {
  zh: {
    title: '登录',
    subtitle: '登录以继续',
    prompt: '还没有账号？',
    action: '注册',
  },
  en: {
    title: 'Sign in',
    subtitle: 'Sign in to continue',
    prompt: 'New to NanoSparks?',
    action: 'Create an account',
  },
} as const;

export default async function SignInPage() {
  const lang = getLang((await cookies()).toString());
  const content = copy[lang];

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main
        id="main"
        className="flex min-h-[calc(100dvh-3.25rem)] items-center justify-center px-5 py-12 sm:py-16"
      >
        <div className="w-full max-w-form rounded-lg bg-surface-raised px-5 py-8 sm:px-8 sm:py-10">
          <header className="mb-6 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{content.title}</h1>
            <p className="mt-2 text-sm text-ink-muted">{content.subtitle}</p>
          </header>
          <div className="flex justify-center">
            <SignIn
              appearance={{
                variables: {
                  colorBackground: '#ffffff',
                  colorPrimary: '#4f46e5',
                  borderRadius: '0.5rem',
                  fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
                },
              }}
            />
          </div>
          <p className="mt-5 text-center text-sm text-ink-muted">
            {content.prompt}{' '}
            <Link
              href="/sign-up"
              className="font-medium text-link underline-offset-4 hover:underline"
            >
              {content.action}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
