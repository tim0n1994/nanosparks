const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';

export const isValidClerkKey =
  (clerkKey.startsWith('pk_test_') || clerkKey.startsWith('pk_live_')) &&
  clerkKey.length > 20 &&
  !clerkKey.includes('placeholder');

/**
 * Fail-fast guard: in production, Clerk keys MUST be configured. Without
 * them `isValidClerkKey` is false and every API route silently skips auth,
 * leaving the app wide open. Call this at worker/server boot so the process
 * refuses to start rather than running unauthenticated.
 */
export function assertClerkConfiguredForProduction(): void {
  if (process.env.NODE_ENV === 'production' && !isValidClerkKey) {
    throw new Error(
      'FATAL: Clerk keys not configured in production. Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY before starting. Refusing to run unauthenticated.',
    );
  }
}
