'use client';

import Link from 'next/link';
import { UserButton, SignedIn, SignedOut, SignInButton } from '@clerk/nextjs';

export default function ClerkAuthSection() {
  return (
    <>
      <SignedIn>
        <Link href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
          Dashboard
        </Link>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="text-sm text-primary-600 hover:text-primary-700 font-medium">
            Sign In
          </button>
        </SignInButton>
      </SignedOut>
    </>
  );
}
