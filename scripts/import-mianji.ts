#!/usr/bin/env node
/**
 * Import podcast-intel 面基 episodes into nanosparks DB.
 *
 * Reads v3.1 packet.md files + guest_map_cleaned.json from podcast-intel.
 * Creates: Corpus (面基) + Conversation + Turn + Participant per episode.
 *
 * Run: npx tsx scripts/import-mianji.ts
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config as loadEnv } from 'dotenv';
loadEnv();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PODCAST_INTEL = '/Users/chillbit/Proj/podcast-intel';
const V31_DIR = join(PODCAST_INTEL, 'data/extractions/v3.1');
const GUEST_MAP = JSON.parse(readFileSync(join(PODCAST_INTEL, 'data/guest_map_cleaned.json'), 'utf-8'));

interface ParsedTurn {
  startSec: number;
  endSec: number;
  speaker: string;
  text: string;
}

function parsePacket(filepath: string): { title: string; durationSec: number; guests: string[]; turns: ParsedTurn[] } {
  const content = readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');

  // Header: "# Episode Packet: E05一个技术派买房者的自白"
  const titleLine = lines[0] || '';
  const title = titleLine.replace(/^# Episode Packet:\s*/, '').trim();

  // "Duration: 6060.9s"
  const durMatch = lines.find(l => l.startsWith('Duration:'));
  const durationSec = durMatch ? parseFloat(durMatch.match(/([\d.]+)/)?.[1] || '0') : 0;

  // Guests: ["Nick"]
  const guestLine = lines.find(l => l.startsWith('Guests:'));
  const guestsRaw = guestLine?.replace(/^Guests:\s*/, '').trim() || '[]';
  let guests: string[] = [];
  try { guests = JSON.parse(guestsRaw); } catch { /* empty */ }

  // Parse segment lines: "[0.0-18.3][Chunk-001] **老钱**: text"
  const turns: ParsedTurn[] = [];
  const segRegex = /\[([\d.]+)-([\d.]+)\]\[Chunk-\d+\]\s+\*\*(.+?)\*\*:\s*(.+)/;
  for (const line of lines) {
    const m = line.match(segRegex);
    if (m) {
      turns.push({
        startSec: parseFloat(m[1]),
        endSec: parseFloat(m[2]),
        speaker: m[3].trim(),
        text: m[4].trim(),
      });
    }
  }

  return { title, durationSec, guests, turns };
}

async function main() {
  const episodeDirs = readdirSync(V31_DIR).filter(d => {
    const packetPath = join(V31_DIR, d, 'packet.md');
    return existsSync(packetPath);
  });

  console.log(`Found ${episodeDirs.length} episodes to import`);

  // Create or find Corpus for 面基
  let corpus = await prisma.corpus.findFirst({ where: { name: '面基' } });
  if (!corpus) {
    const ws = await prisma.workspace.findFirst();
    corpus = await prisma.corpus.create({
      data: { name: '面基', description: '个人理财播客', workspaceId: ws!.id },
    });
  }
  console.log(`Corpus: ${corpus.name} (${corpus.id})`);

  let imported = 0;
  let skipped = 0;
  const speakerCache = new Map<string, string>(); // speaker name → participant id (per conversation)

  for (const epDir of episodeDirs.sort()) {
    const packetPath = join(V31_DIR, epDir, 'packet.md');
    const { title, durationSec, guests, turns } = parsePacket(packetPath);

    if (turns.length === 0) {
      console.log(`  ⚠ ${epDir}: no turns parsed, skipping`);
      skipped++;
      continue;
    }

    // Check if already imported (by title)
    const existing = await prisma.conversation.findFirst({ where: { title } });
    if (existing) {
      skipped++;
      continue;
    }

    // Create Source
    const source = await prisma.source.create({
      data: {
        corpusId: corpus.id,
        kind: 'media_upload',
        sourceType: 'xiaoyuzhou',
        platform: 'xiaoyuzhou',
        status: 'completed',
      },
    });

    // Create Conversation
    const conv = await prisma.conversation.create({
      data: {
        title,
        corpusId: corpus.id,
        sourceId: source.id,
        language: 'zh',
        status: 'completed',
        isSharedCache: true,
      },
    });

    // Create Participants (unique speakers)
    speakerCache.clear();
    const speakers = [...new Set(turns.map(t => t.speaker))];
    for (const sp of speakers) {
      const participant = await prisma.participant.create({
        data: {
          conversationId: conv.id,
          name: sp,
          speakerLabel: sp,
        },
      });
      speakerCache.set(sp, participant.id);
    }

    // Create Turns (batch)
    const turnData = turns.map((t, i) => ({
      conversationId: conv.id,
      turnIndex: i,
      startMs: Math.round(t.startSec * 1000),
      endMs: Math.round(t.endSec * 1000),
      text: t.text,
      participantId: speakerCache.get(t.speaker) ?? null,
    }));

    // Batch insert in chunks of 100
    for (let i = 0; i < turnData.length; i += 100) {
      await prisma.turn.createMany({ data: turnData.slice(i, i + 100) });
    }

    imported++;
    if (imported % 10 === 0) console.log(`  imported ${imported}/${episodeDirs.length}...`);
  }

  console.log(`\nDone: ${imported} imported, ${skipped} skipped`);

  // Create Entities for guests
  console.log('\n=== Importing guest entities ===');
  let entityCount = 0;
  for (const [eid, info] of Object.entries(GUEST_MAP as Record<string, { guest?: string; title?: string }>)) {
    const guestName = info.guest;
    if (!guestName || guestName === 'None') continue;

    // Split multi-guest names (e.g. "易志扬、宇白")
    const names = guestName.split(/[、,，]/).map(n => n.trim()).filter(Boolean);
    for (const name of names) {
      const existing = await prisma.entity.findFirst({
        where: { canonicalName: name, type: 'person' },
      });
      if (!existing) {
        await prisma.entity.create({
          data: {
            canonicalName: name,
            type: 'person',
            workspaceId: corpus.workspaceId,
          },
        });
        entityCount++;
      }
    }
  }
  console.log(`Guests: ${entityCount} new entities created`);

  // Final stats
  const stats = await prisma.conversation.groupBy({
    by: ['status'],
    where: { corpusId: corpus.id },
    _count: true,
  });
  console.log('\n=== Final corpus stats ===');
  console.log(`Corpus: ${corpus.name}`);
  for (const s of stats) console.log(`  ${s.status}: ${s._count}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
