'use client';

import Link from 'next/link';
import { UserButton, SignInButton, useAuth } from '@clerk/nextjs';

export default function ClerkAuthSection() {
  const { isSignedIn } = useAuth();

  if (isSignedIn) {
    return (
      <>
        <Link href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
          Dashboard
        </Link>
        <UserButton />
      </>
    );
  }

  return (
    <SignInButton mode="modal">
      <button className="text-sm text-primary-600 hover:text-primary-700 font-medium">
        Sign In
      </button>
    </SignInButton>
  );
}
