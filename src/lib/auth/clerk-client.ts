/**
 * Clerk Backend API client — used for admin user management.
 *
 * Wraps createClerkClient with the secret key so admin routes can list users,
 * read/set roles (publicMetadata.role), and ban/unban. Kept separate from
 * roles.ts so non-admin routes don't pull the backend client into their bundle.
 */

import { createClerkClient } from '@clerk/backend';
import { logger } from '@/lib/logger';

export type { User } from '@clerk/backend';

/** Singleton backend client. Only usable when CLERK_SECRET_KEY is set. */
let _client: ReturnType<typeof createClerkClient> | null = null;

export function clerkBackend() {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    throw new Error('CLERK_SECRET_KEY is not configured');
  }
  if (!_client) {
    _client = createClerkClient({ secretKey: secret });
    logger.info('Clerk backend client initialized');
  }
  return _client;
}

/** Whether the backend client is usable (secret key present). */
export function hasClerkBackend(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

export const ADMIN_ROLE = 'admin' as const;
export const USER_ROLE = 'user' as const;

/** Count current users (for first-user-becomes-admin detection). */
export async function countClerkUsers(): Promise<number> {
  const client = clerkBackend();
  const res = await client.users.getCount();
  return res;
}
