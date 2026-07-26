/** Dev utility: read LLM settings (key names + base URL only, never key values) and probe the endpoint. */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';

async function main() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ['llm_model', 'llm_base_url', 'llm_api_format'] } },
    select: { key: true, value: true },
  });
  const all = await prisma.setting.findMany({ select: { key: true } });
  const llmKeys = all.map((r) => r.key).filter((k) => /llm|api|model/i.test(k) && !/key|secret|token/i.test(k));
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key] = r.value;
  let probe = 'not-attempted';
  const base = cfg['llm_base_url'] ?? process.env.OPENAI_BASE_URL;
  if (base) {
    try {
      const res = await fetch(base.replace(/\/$/, '') + '/models', { signal: AbortSignal.timeout(4000) }).catch(() =>
        fetch(base, { signal: AbortSignal.timeout(4000) }),
      );
      probe = `HTTP ${res.status}`;
    } catch (e) {
      probe = `unreachable: ${String(e).slice(0, 80)}`;
    }
  }
  console.log(JSON.stringify({ llmSettingKeys: llmKeys, cfg, probe, envOpenaiBase: process.env.OPENAI_BASE_URL ?? null }, null, 1));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(String(e)); process.exit(1); });
