/**
 * Import local podcast-intel transcripts into NanoSparks.
 * Matches with Xiaoyuzhou shownotes, injects into DB, skips Deepgram.
 * Usage: npx tsx scripts/import-podcast-intel.ts
 */

import { prisma } from '../src/lib/prisma';
import { addAnalyzeJob } from '../src/lib/queue/config';
import { toPrismaJson } from '../src/lib/prisma-json';
import { logger } from '../src/lib/logger';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TRANSCRIPTS_DIR = '/Users/chillbit/Proj/podcast-intel/transcripts_json';
const XIAOYUZHOU_PID = '6388760f22567e8ea6ad070f';
const PODCAST_TITLE = '面基';

// Xiaoyuzhou episode data (fetched from page)
const XIAOYUZHOU_EPS = [
  { num: 159, eid: '6a13b560e59ebca9363afd1d', title: 'E159.港股的特殊之处与生存之道', description: '🎤 本期嘉宾\n恽雷@南方基金，基金经理，INFP\n恽雷来坐客的往期节目', duration: 4537, audioUrl: '' },
  { num: 158, eid: '6a097340e1eb34a9398d4dc9', title: 'E158.资产配置与有效前沿', description: '🎤 本期嘉宾\n恽雷@南方基金，基金经理，INFP', duration: 4577, audioUrl: '' },
  { num: 157, eid: '6a014433e1eb34a939256c3d', title: 'E157.我们需要重读鲍曼：液态时代的爱情、工作与孤独', description: '🎤 本期嘉宾\n梁捷 | 经济学者', duration: 5357, audioUrl: '' },
  { num: 155, eid: '69ee387b1d989496e7918058', title: 'E155.似乎没什么人再提「AI 泡沫论」了', description: '🎤 本期嘉宾\n刘平 | 华夏基金投资研究部总监', duration: 5263, audioUrl: '' },
  { num: 154, eid: '69e5b7061e94ae6921aeb1c5', title: 'E154.非一线叙事的重启人生', description: '🎤 本期嘉宾\n冯老板 | 好好住创始人', duration: 5157, audioUrl: '' },
  { num: 153, eid: '69dcb8a5e2c8be315517e2b4', title: 'E153.股神的牌局：复利公式 + 凯利公式', description: '🎤 本期嘉宾\n徐倬迅 | 望岳投资 投资经理', duration: 5427, audioUrl: '' },
  { num: 152, eid: '69d46da0b977fb2c47432aa0', title: 'E152.跟着卡车司机行中国', description: '🎤 本期嘉宾\n《三联生活周刊》驳静、魏倩', duration: 6683, audioUrl: '' },
  { num: 151, eid: '69c93575e2c8be3155d17c9d', title: 'E151.相信的力量 与 押注101游戏', description: '🎤 本期嘉宾\n南添@望岳投资，私募投资经理', duration: 7884, audioUrl: '' },
  { num: 148, eid: '69ae1ef65b2d0ed0690a60df', title: 'E148.站在美股之巅，满眼山雨欲来', description: '🎤 本期嘉宾\n林晓明｜周期循环图谱作者', duration: 5246, audioUrl: '' },
];

async function main() {
  // Ensure channel exists
  const channel = await prisma.channel.upsert({
    where: { youtubeId: `xyz_${XIAOYUZHOU_PID}` },
    update: { title: PODCAST_TITLE, description: '老钱的面基播客' },
    create: { youtubeId: `xyz_${XIAOYUZHOU_PID}`, title: PODCAST_TITLE, description: '老钱的面基播客 — 投资与人生对话' },
  });

  console.log(`Channel: ${channel.id}`);

  const files = fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.json'));
  const localMap = new Map<number, string>();

  for (const f of files) {
    const m = f.match(/E(\d+)/);
    if (m) localMap.set(parseInt(m[1]), f);
  }

  console.log(`Local transcripts: ${localMap.size} files`);

  let imported = 0;
  for (const xyzEp of XIAOYUZHOU_EPS) {
    const filename = localMap.get(xyzEp.num);
    if (!filename) {
      console.log(`E${xyzEp.num} — no local transcript found, skipping`);
      continue;
    }

    const filePath = path.join(TRANSCRIPTS_DIR, filename);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Build transcript segments in Deepgram-like format
    const segments = (raw.segments || []).map((seg: Record<string, unknown>) => ({
      start: typeof seg.start === 'number' ? seg.start : 0,
      end: typeof seg.end === 'number' ? seg.end : 0,
      text: typeof seg.text === 'string' ? seg.text : '',
      speaker: typeof seg.speaker === 'string' ? seg.speaker : undefined,
    }));

    const duration = typeof raw.duration_s === 'number' ? Math.round(raw.duration_s) : xyzEp.duration;

    // Create or update episode
    const episode = await prisma.episode.upsert({
      where: { youtubeId: `xyz_${xyzEp.eid}` },
      create: {
        youtubeId: `xyz_${xyzEp.eid}`,
        title: xyzEp.title,
        description: xyzEp.description,
        duration,
        thumbnailUrl: '',
        channelId: channel.id,
        status: 'TRANSCRIBED',
        transcript: toPrismaJson(segments) as never,
      },
      update: {
        title: xyzEp.title,
        description: xyzEp.description,
        duration,
        transcript: toPrismaJson(segments) as never,
        status: 'TRANSCRIBED',
      },
    });

    // Enqueue analysis directly (skip ingestion + transcription)
    await addAnalyzeJob({ episodeId: episode.id });
    console.log(`E${xyzEp.num} ✅ "${xyzEp.title.slice(0,40)}" (${segments.length} segs) → ANALYSIS`);
    imported++;
  }

  console.log(`\nImported ${imported} episodes. Worker will process analysis.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect().then(() => process.exit(1));
});
