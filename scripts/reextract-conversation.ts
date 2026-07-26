/**
 * 重跑 conversation 的 windowed extraction（修复 extraction 在归属前跑导致覆盖不全的问题）。
 * 现在归属已修正，extraction 会基于正确 speaker 切窗并覆盖整集。
 * Usage: npx tsx scripts/reextract-conversation.ts <conversationId>
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { processAnalyzeJob } from '@/lib/queue/jobs/analyze';
async function main() {
  const conversationId = process.argv[2];
  if (!conversationId) { console.error('Usage: reextract-conversation.ts <conversationId>'); process.exit(1); }
  console.log(JSON.stringify({ msg: 'reextract start', conversationId, ts: new Date().toISOString() }));
  await processAnalyzeJob({ conversationId });
  console.log(JSON.stringify({ msg: 'reextract done', conversationId, ts: new Date().toISOString() }));
}
main().catch(e => { console.error(JSON.stringify({ msg: 'reextract failed', error: String(e), stack: e?.stack })); process.exit(1); });
