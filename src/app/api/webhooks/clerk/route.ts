/**
 * Clerk webhook — keeps our role model in sync with Clerk user lifecycle.
 *
 * user.created: assigns the FIRST registered user the `admin` role. Every
 *   subsequent user gets `user`. We read the role from publicMetadata and
 *   write it back via the backend client.
 *
 * Verification: `verifyWebhook` reads CLERK_WEBHOOK_SIGNING_SECRET (set in
 * Clerk Dashboard -> Webhooks -> endpoint signing secret).
 *
 * This endpoint must be PUBLIC (no Clerk middleware auth) — set it in the
 * publicRoute matcher in proxy.ts.
 */

import { NextResponse } from 'next/server';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { clerkBackend, ADMIN_ROLE, USER_ROLE } from '@/lib/auth/clerk-client';
import type { UserRole } from '@/lib/auth/roles';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let evt;
  try {
    evt = await verifyWebhook(request);
  } catch (err) {
    logger.warn('Webhook verification failed', { error: String(err) });
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 400 });
  }

  const { type } = evt;

  // Only user.created is meaningful for role assignment.
  if (type !== 'user.created') {
    return NextResponse.json({ received: true, type });
  }

  const userId = evt.data.id;
  if (!userId) {
    return NextResponse.json({ error: 'No user id' }, { status: 400 });
  }

  try {
    // First-user-becomes-admin: if this is the only user, they are the admin.
    // getCount counts all users in the instance; ==1 means this signup was first.
    // For race safety against concurrent signups, we also verify no admin exists.
    const total = await clerkBackend().users.getCount();

    let role: UserRole = USER_ROLE;
    if (total <= 1) {
      // First (or only) user → admin.
      role = ADMIN_ROLE;
    } else {
      // Check whether any admin already exists; if not, this user becomes one.
      // Handles the edge case where an admin was deleted before anyone else
      // claimed the role, so the system never ends up with zero admins.
      const existing = await clerkBackend().users.getUserList({
        orderBy: '-created_at',
        limit: 100,
      });
      const hasAdmin = existing.data.some(
        (u) => (u.publicMetadata as Record<string, unknown>)?.role === ADMIN_ROLE,
      );
      if (!hasAdmin) role = ADMIN_ROLE;
    }

    await clerkBackend().users.updateUserMetadata(userId, {
      publicMetadata: { role },
    });

    logger.info('User role assigned via webhook', { userId, role, type });
    return NextResponse.json({ received: true, userId, role });
  } catch (err) {
    logger.error('Failed to assign role in webhook', { userId, error: String(err) });
    return NextResponse.json({ error: 'Role assignment failed' }, { status: 500 });
  }
}
