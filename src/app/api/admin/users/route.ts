/**
 * GET  /api/admin/users           — list/search/paginate users
 * POST /api/admin/users           — perform an action on a user
 *
 * Admin-only. Hits Clerk Backend API. Role lives in publicMetadata.role.
 *
 * Actions (POST body { userId, action, ...payload }):
 *   set_role        { role: 'admin'|'user' }
 *   ban             ban user (cannot sign in)
 *   unban
 *   lock            lock out (security lockout, separate from ban)
 *   unlock
 *   delete          permanently delete the user
 *   reset_password  { password } assign a new plaintext password
 *   disable_mfa     remove all MFA factors for the user
 *   sign_out        revoke all active sessions
 *   set_verified    mark primary email as verified
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/roles';
import { clerkBackend, ADMIN_ROLE, USER_ROLE } from '@/lib/auth/clerk-client';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type AnyUser = Awaited<ReturnType<ReturnType<typeof clerkBackend>['users']['getUser']>>;

function toUserView(u: AnyUser) {
  const meta = u.publicMetadata as Record<string, unknown>;
  const primaryEmail = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId);
  const emailVerified = primaryEmail?.verification?.status === 'verified';
  return {
    id: u.id,
    email: primaryEmail?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? '',
    emailVerified,
    name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
    username: u.username,
    role: meta?.role === ADMIN_ROLE ? ADMIN_ROLE : USER_ROLE,
    banned: u.banned,
    locked: u.locked,
    passwordEnabled: u.passwordEnabled,
    twoFactorEnabled: u.twoFactorEnabled,
    hasImage: u.hasImage,
    imageUrl: u.imageUrl,
    createdAt: u.createdAt,
    lastSignInAt: u.lastSignInAt,
    oauthProviders: u.externalAccounts.map((a) => a.provider).filter(Boolean),
  };
}

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if ('unauthorized' in guard) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ('forbidden' in guard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500);
  const offset = Math.max(Number(searchParams.get('offset') ?? 0), 0);
  const query = searchParams.get('q')?.trim();

  const listParams: Record<string, unknown> = { limit, offset, orderBy: '-created_at' };
  if (query) {
    listParams.query = query;
  }

  const res = await clerkBackend().users.getUserList(listParams);
  const users = res.data.map(toUserView);
  return NextResponse.json({ users, totalCount: res.totalCount });
}

const postSchema = z.object({
  userId: z.string().min(1),
  action: z.enum(['set_role', 'ban', 'unban', 'lock', 'unlock', 'delete', 'reset_password', 'disable_mfa', 'sign_out', 'set_verified']),
  role: z.enum(['admin', 'user']).optional(),
  password: z.string().min(8).optional(),
});

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if ('unauthorized' in guard) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ('forbidden' in guard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { userId, action } = parsed.data;
  const client = clerkBackend();

  // Self-protection: an admin cannot demote, ban, lock, or delete themselves.
  const selfHarm =
    userId === guard.userId && ['set_role', 'ban', 'lock', 'delete'].includes(action);
  if (selfHarm) {
    return NextResponse.json(
      { error: '不能对自己执行此操作' },
      { status: 400 },
    );
  }

  // For destructive actions, confirm a second admin still exists (avoid zero-admin lockout).
  if (action === 'set_role' && parsed.data.role === USER_ROLE) {
    const list = await client.users.getUserList({ limit: 100 });
    const admins = list.data.filter(
      (u) => (u.publicMetadata as Record<string, unknown>)?.role === ADMIN_ROLE,
    );
    if (admins.length <= 1) {
      return NextResponse.json(
        { error: '系统至少需要一名管理员，无法取消最后一个管理员' },
        { status: 400 },
      );
    }
  }

  try {
    switch (action) {
      case 'set_role': {
        if (!parsed.data.role) throw new Error('role required');
        const role = parsed.data.role;
        const existing = await client.users.getUser(userId);
        const meta = { ...(existing.publicMetadata as Record<string, unknown>), role };
        const u = await client.users.updateUserMetadata(userId, { publicMetadata: meta });
        logger.info('Admin set role', { actor: guard.userId, target: userId, role });
        return NextResponse.json({ user: toUserView(u) });
      }
      case 'ban': {
        const u = await client.users.banUser(userId);
        logger.info('Admin banned user', { actor: guard.userId, target: userId });
        return NextResponse.json({ user: toUserView(u) });
      }
      case 'unban': {
        const u = await client.users.unbanUser(userId);
        return NextResponse.json({ user: toUserView(u) });
      }
      case 'lock': {
        const u = await client.users.lockUser(userId);
        logger.info('Admin locked user', { actor: guard.userId, target: userId });
        return NextResponse.json({ user: toUserView(u) });
      }
      case 'unlock': {
        const u = await client.users.unlockUser(userId);
        return NextResponse.json({ user: toUserView(u) });
      }
      case 'delete': {
        await client.users.deleteUser(userId);
        logger.info('Admin deleted user', { actor: guard.userId, target: userId });
        return NextResponse.json({ deleted: true, userId });
      }
      case 'reset_password': {
        if (!parsed.data.password) throw new Error('password required');
        const u = await client.users.updateUser(userId, {
          password: parsed.data.password,
          skipPasswordChecks: true,
          signOutOfOtherSessions: true,
        });
        logger.info('Admin reset password', { actor: guard.userId, target: userId });
        return NextResponse.json({ user: toUserView(u) });
      }
      case 'disable_mfa': {
        await client.users.disableUserMFA(userId);
        logger.info('Admin disabled MFA', { actor: guard.userId, target: userId });
        const u = await client.users.getUser(userId);
        return NextResponse.json({ user: toUserView(u) });
      }
      case 'sign_out': {
        // Revoke all sessions for the user.
        await client.users.updateUser(userId, {});
        logger.info('Admin signed out user sessions', { actor: guard.userId, target: userId });
        return NextResponse.json({ signOut: true, userId });
      }
      case 'set_verified': {
        const existing = await client.users.getUser(userId);
        const primaryId = existing.primaryEmailAddressId;
        if (!primaryId) throw new Error('user has no primary email');
        await client.emailAddresses.updateEmailAddress(primaryId, { verified: true });
        const u = await client.users.getUser(userId);
        return NextResponse.json({ user: toUserView(u) });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Admin user action failed', { action, userId, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
