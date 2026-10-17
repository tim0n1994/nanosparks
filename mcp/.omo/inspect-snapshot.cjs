const fs = require('fs');
const id = fs.readFileSync('var/snapshots/current', 'utf8').trim();
const raw = fs.readFileSync('var/snapshots/' + id + '.json', 'utf8');
const s = JSON.parse(raw);
console.log(JSON.stringify({
  snapshot: id.slice(0, 12),
  generated_at: s.generated_at,
  sources: s.sources.map(x => ({ id: x.id, kind: x.kind, status: x.status, reason: x.reason, accuracy: x.accuracy, metrics: x.metrics.length, sample: x.metrics.slice(0, 3) })),
  pii_clean: !raw.includes('PII_SENTINEL'),
  audit_lines: fs.readFileSync('var/audit.jsonl', 'utf8').trim().split(String.fromCharCode(10)).length,
}, null, 1));
