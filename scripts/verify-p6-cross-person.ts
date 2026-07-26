import { config as loadEnv } from 'dotenv'; loadEnv();
import { comparePersonsOnTopic } from '@/lib/person/cross-person';
async function main(){ const v = await comparePersonsOnTopic('cmrwkqaw0000d7eyfwwd20622', 'AI'); console.log(JSON.stringify({topic:v.topic, distribution:v.distribution, persons:v.persons.map(p=>({name:p.name, stance:p.stance, claim:p.claimText.slice(0,60)}))}, null, 2)); }
main().catch(e=>{console.error(e);process.exit(1);});
