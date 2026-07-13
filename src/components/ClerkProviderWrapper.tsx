'use client';

import { ClerkProvider } from '@clerk/nextjs';
import type { ReactNode } from 'react';
import { isValidClerkKey } from '@/lib/clerk-utils';

export default function ClerkProviderWrapper({ children }: { children: ReactNode }) {
  if (!isValidClerkKey) {
    return <>{children}</>;
  }
  return <ClerkProvider>{children}</ClerkProvider>;
}
