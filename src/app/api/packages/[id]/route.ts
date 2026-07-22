/**
 * PATCH /api/packages/:id — PRD §B2 用户回填链接 + PublishPackage.status.
 *
 * After a user exports a package and publishes it on the target platform, they
 * backfill the published URL so we can record the distribution funnel metric
 * (packageToPublishedRate) and keep an AuditLog. Status moves draft→exported→published.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { audit } from '@/lib/audit';

const patchSchema = z.object({
  status: z.enum(['draft', 'exported', 'published']).optional(),
  publishedUrl: z.string().url().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pkg = await prisma.publishPackage.findUnique({ where: { id } });
  if (!pkg) return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
  return NextResponse.json({ success: true, package: pkg });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let userId = 'dev-user';
  if (isValidClerkKey) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    userId = clerkUserId;
  }

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }

  const existing = await prisma.publishPackage.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ success: false, error: 'Package not found' }, { status: 404 });
  if (existing.userId !== userId) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

 const updated = await prisma.publishPackage.update({
    where: { id },
    data: {
      ...(parsed.data.status && { status: parsed.data.status }),
      ...(parsed.data.publishedUrl !== undefined && { publishedUrl: parsed.data.publishedUrl }),
    },
  });

  await audit({
    actorId: userId,
    action: 'export',
    resourceType: 'publish_package',
    resourceId: id,
    metadata: { status: updated.status, publishedUrl: updated.publishedUrl },
  }).catch(() => { /* audit is best-effort */ });

  return NextResponse.json({ success: true, package: updated });
}
