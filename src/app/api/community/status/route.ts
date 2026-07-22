/**
 * GET /api/community/status — PRD §C4 数据闸门.
 *
 * Reports whether community features (高亮即评论 / 话题小组 / 主播认领) are
 * unlocked, and why (which threshold was met). The UI gates those surfaces on
 * `unlocked`; the gate stays closed until C1 周 UV > 1k OR C2 周高亮用户 > 100.
 */

import { NextRequest, NextResponse } from 'next/server';
import { evaluateCommunityGate } from '@/lib/community/gate';

export async function GET(_request: NextRequest) {
  const gate = await evaluateCommunityGate();
  return NextResponse.json({ success: true, ...gate });
}
