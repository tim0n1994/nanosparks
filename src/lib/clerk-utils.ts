const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';

export const isValidClerkKey =
  (clerkKey.startsWith('pk_test_') || clerkKey.startsWith('pk_live_')) &&
  clerkKey.length > 20 &&
  !clerkKey.includes('placeholder');
