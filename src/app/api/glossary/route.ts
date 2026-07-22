/**
 * Glossary API (PRD §A2 热词 API 挂节目级术语词典).
 *
 * GET  /api/glossary?show=<showTitle>  — load a show's terminology glossary
 * PUT  /api/glossary                    — { show, terms: { wrong: right } }
 *
 * Terms feed the LLM correction pass so domain jargon / host names get fixed
 * during transcription (痛点 #5 专有名词/人名转错).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@clerk/nextjs/server';
import {
  loadShowGlossary,
  saveShowGlossary,
  validateGlossaryTerms,
} from '@/lib/transcription/hotwords';
import { isValidClerkKey } from '@/lib/clerk-utils';

async function requireUserId(): Promise<string | NextResponse> {
  if (!isValidClerkKey) return 'dev-user';
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  return userId;
}

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const show = new URL(request.url).searchParams.get('show');
  const glossary = await loadShowGlossary(show);
  return NextResponse.json({ success: true, show: show ?? null, terms: glossary.terms ?? {} });
}

const putSchema = z.object({
  show: z.string().nullable(),
  terms: z.record(z.string(), z.string()),
});

export async function PUT(request: NextRequest) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = await request.json();
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues }, { status: 400 });
  }

  const validation = validateGlossaryTerms(parsed.data.terms);
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }

  await saveShowGlossary(parsed.data.show, validation.terms!);
  return NextResponse.json({ success: true, show: parsed.data.show, terms: validation.terms });
}
