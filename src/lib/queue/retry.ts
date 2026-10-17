import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkIngestGuardrails, costBreakerTripped, loadGuardrailConfig } from '@/lib/guardrails';
import { getMonthlyQuotaStatus } from '@/lib/quota';
import { getUserTier, monthlyQuotaFor } from '@/lib/billing/tier';
import type { Queue } from 'bullmq';

export const RETRYABLE_STATUSES = ['failed', 'completed'];

export async function checkRetryBudget(userId: string, conversationId: string, durationSec?: number): Promise<NextResponse | null> {
  const config = await loadGuardrailConfig();
  const guard = await checkIngestGuardrails(userId, { durationSec }, config);
  if (!guard.ok) {
    return NextResponse.json({ success: false, error: guard.message, kind: guard.reason }, { status: 429 });
  }
  const cost = await prisma.extractionRun.aggregate({ where: { conversationId }, _sum: { costUsd: true } });
  if (costBreakerTripped(cost._sum.costUsd ?? 0, config)) {
    return NextResponse.json({ success: false, error: 'Episode cost limit reached', kind: 'cost_limit' }, { status: 429 });
  }
  const tier = await getUserTier(userId);
  const quota = await getMonthlyQuotaStatus(userId, { freeMonthlyFirstTranscriptions: monthlyQuotaFor(tier) });
  if (!quota.canTranscribe) {
    return NextResponse.json({ success: false, error: 'Monthly processing quota exhausted', kind: 'quota_exhausted', quota }, { status: 429 });
  }
  return null;
}

export async function claimRetry(conversation: { id: string; status: string; updatedAt: Date }): Promise<Date | null> {
  const claimedAt = new Date(Math.max(Date.now(), conversation.updatedAt.getTime() + 1));
  const result = await prisma.conversation.updateMany({
    where: { id: conversation.id, status: conversation.status, updatedAt: conversation.updatedAt },
    data: { status: 'pending', updatedAt: claimedAt },
  });
  return result.count === 1 ? claimedAt : null;
}

export async function releaseRetry(conversation: { id: string; status: string }, claimedAt: Date): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversation.id, status: 'pending', updatedAt: claimedAt },
    data: { status: conversation.status },
  });
}

export function retryConflict(): NextResponse {
  return NextResponse.json({ success: false, error: 'Conversation already has processing in progress', kind: 'in_progress' }, { status: 409 });
}

export class RetrySubmissionError extends Error {
  constructor(public readonly confirmedAbsent: boolean) {
    super(confirmedAbsent ? 'Retry job was not enqueued' : 'Retry enqueue outcome is unknown; claim retained to prevent duplicate processing');
  }
}

export async function enqueueRetry(queue: Pick<Queue, 'add' | 'getJob'>, name: string, data: Record<string, unknown>, jobId: string): Promise<void> {
  try {
    await queue.add(name, data, { jobId });
  } catch {
    let existing;
    try { existing = await queue.getJob(jobId); } catch { throw new RetrySubmissionError(false); }
    if (existing) return;
    throw new RetrySubmissionError(true);
  }
}
