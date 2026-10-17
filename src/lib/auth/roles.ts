/**
 * Role system — stored in Clerk user publicMetadata.
 *
 * Roles:
 *   admin — full access to /admin, feature flags, user management
 *   user  — default, regular authenticated user
 *
 * IMPORTANT: Clerk's session JWT does NOT include publicMetadata by default,
 * so we cannot read the role from sessionClaims. Instead, requireAdmin() fetches
 * the authoritative role from the Clerk Backend API (getUser().publicMetadata).
 * This is the same source the admin page uses, so they stay consistent.
 */

import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { clerkBackend, ADMIN_ROLE } from '@/lib/auth/clerk-client';

export type UserRole = 'admin' | 'user';

/** Dev fallback when Clerk is not configured (local dev / E2E). */
const DEV_USER = {
  userId: 'dev-user',
  role: 'admin' as UserRole,
};

export interface AuthUser {
  userId: string;
  role: UserRole;
}

/**
 * Resolve the current request's userId (lightweight — does NOT fetch the role).
 * requireAdmin() separately fetches the authoritative role from the backend API.
 */
export async function getCurrentUser(): Promise<{ userId: string }> {
  if (!isValidClerkKey) {
    return { userId: process.env.NODE_ENV === 'production' ? '' : DEV_USER.userId };
  }
  const { userId } = await auth();
  return { userId: userId ?? '' };
}

/** Require an authenticated user. Returns userId or an unauthorized sentinel. */
export async function requireUser(): Promise<{ userId: string } | { unauthorized: true }> {
  const { userId } = await getCurrentUser();
  if (!userId) return { unauthorized: true };
  return { userId };
}

/**
 * Require an admin. Fetches the authoritative role from the Clerk Backend API
 * (not the JWT claims, which don't carry publicMetadata by default).
 */
export async function requireAdmin(): Promise<AuthUser | { unauthorized: true } | { forbidden: true }> {
  const { userId } = await getCurrentUser();
  if (!userId) return { unauthorized: true };

  try {
    const user = await clerkBackend().users.getUser(userId);
    const meta = user.publicMetadata as Record<string, unknown>;
    const role: UserRole = meta?.role === ADMIN_ROLE ? 'admin' : 'user';
    if (role !== 'admin') return { forbidden: true };
    return { userId, role };
  } catch {
    // Backend API failure — fail closed (deny) rather than fail open.
    return { forbidden: true };
  }
}
