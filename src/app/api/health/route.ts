import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health — liveness only.
 *
 * 2026-10-20: this is the cheap probe the deploy gate and uptime monitors
 * hit, so it answers from process state alone: no DB, Redis, or queue
 * calls, and no imports of those modules either (importing @/lib/prisma
 * opens a pg Pool and @/lib/redis an ioredis connection at module scope).
 * A dependency outage must not take the process-liveness signal down with
 * it. The DB/Redis/queue checks moved to /api/health/deep unchanged.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: Math.floor(process.uptime()),
  });
}
