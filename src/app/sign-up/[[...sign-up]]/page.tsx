import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { SignUp } from '@clerk/nextjs';
import Navbar from '@/components/ui/Navbar';
import { getLang } from '@/lib/i18n/getLang';

export const metadata: Metadata = { title: '注册 · NanoSparks' };

const copy = {
  zh: {
    title: '注册账号',
    subtitle: '创建你的账号开始使用',
    prompt: '已有账号？',
    action: '登录',
  },
  en: {
    title: 'Create an account',
    subtitle: 'Create your account to get started',
    prompt: 'Already have an account?',
    action: 'Sign in',
  },
} as const;

export default async function SignUpPage() {
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
            <SignUp
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
              href="/sign-in"
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
