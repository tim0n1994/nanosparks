/**
 * Import 面基 podcast-intel transcripts into NanoSparks.
 * Pre-transcribed, no Deepgram needed. Direct → analyze queue.
 * npx tsx scripts/import-mianji.ts
 */
import { prisma } from '../src/lib/prisma';
import { addAnalyzeJob } from '../src/lib/queue/config';
import { toPrismaJson } from '../src/lib/prisma-json';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TRANSCRIPTS_DIR = '/Users/chillbit/Proj/podcast-intel/transcripts_json';
const PID = '6388760f22567e8ea6ad070f';
const PODCAST = '面基';

// 9 episodes to import
const EPISODES = [
  { num: 153, eid: '69dcb8a5e2c8be315517e2b4', title: 'E153.股神的牌局：复利公式 + 凯利公式', duration: 5427, desc: '🎤 本期嘉宾\n徐倬迅 | 公众号「徐倬迅的投资日记」，望岳投资 投资经理（偏量化方向）\n⏯️ 本期简介\n我一直希望面基能够多元化一些，无论是在选题还是嘉宾层面，因此，无论是价值的，成长的，交易的，套利的，我希望都能有机会和真正谙熟这些方法的人聊聊。本期节目就和嘉宾从好几个数学公式切入，尽量用听得懂的方式聊聊什么是凯利公式，以及复利的底层逻辑。' },
  { num: 152, eid: '69d46da0b977fb2c47432aa0', title: 'E152.跟着卡车司机行中国：生活可不就是一直往前开嘛~', duration: 6683, desc: '🎤 本期嘉宾\n《三联生活周刊》驳静、魏倩，相关报道被编入《滚动的车轮》\n⏯️ 本期简介\n中国有2000万名卡车司机，但不同于快递员、外卖员，你很少能看到这个群体，因为白天要让位于正常的城市通勤和生产运输，他们只在夜里出没。本期节目和两位记者聊聊这个庞大而隐秘的群体。' },
  { num: 151, eid: '69c93575e2c8be3155d17c9d', title: 'E151.相信的力量 与 押注101游戏', duration: 7884, desc: '🎤 本期嘉宾\n南添@望岳投资，私募投资经理，「面基」半个主播\n⏯️ 本期简介\n南添是老朋友了，这次想聊聊「相信」这件事。相信的本质是什么？为什么有些人天然更容易相信一些东西？你相信什么，决定了你最后会得到什么。这不是玄学，是概率游戏。' },
  { num: 148, eid: '69ae1ef65b2d0ed0690a60df', title: 'E148.站在美股之巅，满眼山雨欲来', duration: 5246, desc: '🎤 本期嘉宾\n林晓明｜「周期循环图谱」作者，《经济周期实证理论及应用》作者，思睿首席经济学家\n⏯️ 节目简介\n本期节目录制于2026年2月中旬。林老师上次来面基坐客聊的周期上行，这次站在美股高位上，感觉反而没那么乐观了。' },
  { num: 147, eid: '69a55b15de29766da91fbe4f', title: 'E147.控制论与系统论：写给江湖儿女的案头书', duration: 6657, desc: '🎤本期嘉宾\n石磊、敏姐 ｜ 播客「十分吸引」\n⏯️ 本期简介\n本期节目录制与 2026 年 1 月。聊聊金观涛先生的《控制论与系统论》，试图用这两门思考框架来理解我们身处这个复杂世界。' },
  { num: 146, eid: '699bf594de29766da9389239', title: 'E146.财富在β中，α在生活里', duration: 5511, desc: '🎤本期嘉宾\n江东猫草 | 前券商社服行业首席，「远行者与碎冰匠」主理人\n⏯️ 本期简介\n有一次我参加一个投资论坛，发现台上嘉宾讲很专业的话题时台下没什么反响，但一聊到生活态度、消费观念之类的，大家立刻活跃起来。这期节目就想聊聊财富中的β（被动收益）和生活中的α（个人选择）。' },
  { num: 145, eid: '6989441da22480add63804cb', title: 'E145.上钟了！4000点之上的心理按摩', duration: 5230, desc: '🎤 本期嘉宾\n张翼轸｜CFA，EarlETF、播客「精分派」主理人\n⏯️ 本期简介\n本期节目录制于2026年1月27日。4000点之上，有人恐高，有人亢奋，来看看张老师怎么给大家做心理按摩。' },
  { num: 144, eid: '698308e0c4e2b0f1e2cbce49', title: 'E144.交易的艺术：不预测，统计优势，分散，红利，随机波动', duration: 3900, desc: '🎤 本期嘉宾\n老钱 solo\n⏯️ 本期简介\n交易和投资到底有什么区别？交易者的思维方式是什么样的？本期老钱从统计优势、分散化、随机波动这些概念出发，聊聊交易的艺术。' },
  { num: 34, eid: 'local_e34_001', title: 'E34.诶到底还是聊上价值投资了', duration: 3651, desc: '🎤 本期嘉宾\n老钱、郑永明\n⏯️ 本期简介\n面基终于聊价值投资了。嘉宾郑永明是一位深度价值投资者，用最朴素的语言解释了价值投资的底层逻辑。' },
];

async function main() {
  // Ensure channel
  const channel = await prisma.channel.upsert({
    where: { youtubeId: `xyz_${PID}` },
    update: { title: PODCAST, description: '老钱的面基播客 — 投资与人生对话' },
    create: { youtubeId: `xyz_${PID}`, title: PODCAST, description: '老钱的面基播客 — 投资与人生对话' },
  });
  console.log(`Channel: ${channel.id} (${PODCAST})`);

  // Build local file map
  const files = fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.json'));
  const localMap = new Map<number, string>();
  for (const f of files) {
    const m = f.match(/E(\d+)/);
    if (m) localMap.set(parseInt(m[1]), f);
  }

  let imported = 0;
  for (const ep of EPISODES) {
    const filename = localMap.get(ep.num);
    if (!filename) {
      console.log(`E${ep.num} — no local transcript`);
      continue;
    }

    const filePath = path.join(TRANSCRIPTS_DIR, filename);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Build transcript segments (in Deepgram format: {start, end, text, speaker})
    const segments = (raw.segments || []).map((seg: Record<string, unknown>) => ({
      start: typeof seg.start === 'number' ? seg.start : 0,
      end: typeof seg.end === 'number' ? seg.end : 0,
      text: typeof seg.text === 'string' ? seg.text : '',
      speaker: typeof seg.speaker === 'string' ? seg.speaker : undefined,
    }));

    const duration = typeof raw.duration_s === 'number' ? Math.round(raw.duration_s) : ep.duration;

    // Create/update episode — skip Deepgram, go straight to analysis
    const episode = await prisma.episode.upsert({
      where: { youtubeId: `xyz_${ep.eid}` },
      create: {
        youtubeId: `xyz_${ep.eid}`,
        title: ep.title,
        description: ep.desc,
        duration,
        thumbnailUrl: '',
        channelId: channel.id,
        status: 'TRANSCRIBED',
        transcript: toPrismaJson(segments) as never,
      },
      update: {
        title: ep.title,
        description: ep.desc,
        duration,
        transcript: toPrismaJson(segments) as never,
        status: 'TRANSCRIBED',
      },
    });

    await addAnalyzeJob({ episodeId: episode.id });
    console.log(`E${ep.num} ✅ ${segments.length} segments → ANALYSIS`);
    imported++;
  }

  console.log(`\nDone! ${imported} episodes imported. Worker will process.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
