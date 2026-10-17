# Historical evidence repair preview

## Current refresh after approved pilot

The read-only preview was rerun after the K-12 pilot. Current counts are **314 different-turn candidates, 1 unchanged span, 152 unresolved spans**, still 410 turns and 467 spans. Comparing all before/proposed entries against the preserved pre-refresh artifact found exactly one changed entry: approved span `cmtpzmgpd00o8qgyfm2dkcw7s`. No span was added or removed. This comparison covers the selected span fields; it is not a database-wide write audit.

Current snapshot SHA-256: `689093ca333f09f39895ae5d294457e3685f7b3395c65d30fe782af0a46cc2e7`. The current `conversation-evidence-repair-preview.json` contains refreshed values; the previous snapshot is preserved as `conversation-evidence-repair-preview-before-refresh.json`, with the field-level comparison in `historical-preview-refresh-delta.json` under `.omo/evidence/2026-09-08-iteration/`.

The single-row pilot and its desktop/mobile reader checks are complete. The other 314 candidates remain preview-only; the 152 unresolved spans remain excluded from automatic repair. Any batch proposal must recheck source text and old coordinates within its write transaction, retain before-images, and fail on drift. No batch write was performed by this refresh.

## Original pre-pilot snapshot (historical)

Scope: conversation `cmrwrwvjy001x7eyfwigm3z70` only. A repeatable-read, database-enforced read-only transaction retrieved 410 turns and 467 evidence spans. No historical fields were modified.

Command: `npx tsx .omo/evidence/2026-09-08-iteration/preview-conversation-evidence-repair.ts` exited 0.

| Classification | Count |
| --- | ---: |
| Unique quote match in a different source turn | 315 |
| Same turn, different full-turn bounds | 0 |
| Unchanged | 0 |
| Not resolved by the strict matcher | 152 |

The 315 rows are candidates, not approved writes. Each has a unique normalized source quotation under the new resolver. The remaining 152 combine ambiguous, short, absent, paraphrased, or invalid-source cases. They are not a hallucination count. No corpus-wide error rate is inferred.

Detailed before/proposed values, every span ID, classification and snapshot hash are recorded in `.omo/evidence/2026-09-08-iteration/conversation-evidence-repair-preview.json`. The snapshot hash is `2b1ec4e1b1d664a2880d46bd21e79c0a4311e9a1a64252456b8b1a400d31315e`.

## Recommended next decision

Start with the one already-inspected K-12 span `cmtpzmgpd00o8qgyfm2dkcw7s`: old turn `cmtpnp5cu0005zhyfwrm2vdsd`, 78000–90000 ms; proposed turn `cmtpnp5cv00b7zhyf60k61z34`, 4500250–4510890 ms. The quote and thought unit should remain unchanged. Use a transaction that verifies source contents and old values before updating, and retain the before-image for reversal. Abort on any drift.

Business-data writes require a separate user decision; the prior approval covered local extraction code and tests. After a pilot write is approved and succeeds, validate graph-to-reader behavior through the prescribed gstack browser workflow before considering the other candidates. Do not deploy or restart an existing service as an implicit part of the data repair. Historical G5 and the overall product goal remain incomplete.
