import { config as loadEnv } from 'dotenv'; loadEnv();
import { GET } from '@/app/api/person/[id]/route';

async function main() {
  const entityId = 'cms0wwhvl0004tvyftlpqmntx'; // Marc Andreessen
  const req = new Request('http://x/api/person/' + entityId);
  const res = await GET(req as never, { params: Promise.resolve({ id: entityId }) });
  const body = await res.json();
  if (!body.success) { console.error('FAIL', body); process.exit(1); }
  const d = body.data;
  console.log(JSON.stringify({
    name: d.entity.canonicalName,
    profileStats: d.profile?.statsJson,
    fingerprintVersion: d.fingerprint?.version,
    fingerprintStyle: d.fingerprint?.styleJson,
    coverage: d.fingerprint?.coverageJson,
    opinionCount: d.opinionLibrary.length,
    opinionWithEvidence: d.opinionLibrary.filter((o: any) => o.evidence).length,
    sampleOpinion: d.opinionLibrary.slice(0,2).map((o:any)=>({text:o.text.slice(0,60), stance:o.stance, modality:o.modality, hasEvidence: !!o.evidence, evidenceQuote: o.evidence?.quote?.slice(0,60)})),
    quoteWallCount: d.quoteWall.length,
    sampleQuote: d.quoteWall.slice(0,1).map((q:any)=>({text:q.text.slice(0,60)})),
  }, null, 2));
}
main().catch(e=>{console.error(e);process.exit(1);});
