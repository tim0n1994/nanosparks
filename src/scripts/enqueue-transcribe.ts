import { config as loadEnv } from 'dotenv';
loadEnv();
import { transcribeQueue } from '../lib/queue/config';

async function main() {
  const job = await transcribeQueue.add('transcribe', {
    conversationId: 'cmrwrwvjy001x7eyfwigm3z70',
    audioPath: '/tmp/nanosparks-audio/knx2wrILP1M.mp3',
    step: 'transcribe',
  });
  console.log('job:', job.id);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
