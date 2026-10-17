# Reader persistence acceptance

Verified with a real gstack browser against the isolated candidate at localhost:7558 and a newly created synthetic database. This is not production, authenticated Clerk acceptance, or fresh ASR/LLM processing.

## Isolation

- Docker container `nanosparks-writable-qa-20260909`, ID `054f08a7929ac392073a5b745f4c9b3f59e44c7b43f0116a7ee80bc16d7734f6`, pgvector:pg16, loopback port 32773, database `nanosparks_qa`.
- Database data lives in a 512 MB tmpfs. Container is temporary with automatic removal on stop. Only explicitly synthetic fixtures were created; business data was not copied or changed.
- Schema synchronization used Prisma db push against this initially empty database, not the business database. The first invocation rejected the obsolete --skip-generate option; the corrected invocation exited 0. This establishes fixture schema, not migration-history acceptance.
- Web runs from `/tmp/nanosparks-iteration-qa-2m5wl56_`, with an environment allowlist, empty Clerk keys and dedicated QA Redis at 32768. No Worker was started, no external provider called, and no media write performed.

## Observed behavior

Fixture: `qa_reader_progress_20260909`, 30 synthetic turns with alternating participants, owned by development user `dev-user`.

Actual browser scrolling caused PUT /api/conversations/qa_reader_progress_20260909/read responses of 200. Independent GET reads and direct psql readback confirmed persisted progress:

| Stage | Turn index | Scroll ratio | completedAt |
| --- | ---: | ---: | --- |
| First completion | 28 | 1 | 2026-09-09T06:18:18.847Z |
| Read back at an earlier position | 11 | 0.3938333697791384 | same |
| Complete again | 27 | 0.9652812975164724 | same |

The automated artifact comparison asserted the lower-to-higher threshold round trip and byte-identical non-null completion timestamps. The completion screenshot was visually inspected. The actual database field is `completedAt`; “first completion” describes its stable behavior.

## Evidence and remaining scope

Artifacts under `.omo/evidence/2026-09-08-iteration/`: `writable-reader-persistence-result.json`, `writable-reader-db-readback.json`, three stage response JSON files, `writable-reader-completed.png`, fixture and launcher scripts.

The generic gstack scroll command unexpectedly moved to the bottom, so subsequent positioning used explicit DOM anchor scrollIntoView through gstack. Consequently this fixture completed before the unfinished-session resume prompt could be tested; that prompt remains unverified. The run does not establish a clean console: the shared daemon output retained earlier QA messages, so no zero-error claim is made.

No application source changed in this acceptance run. Existing full verify evidence remains applicable to the previously synchronized candidate; no new full test run is claimed.

## Follow-up: unfinished short-session resume

A separate synthetic conversation `qa_reader_resume_20260909` was inserted into the same isolated database with 30 alternating-speaker turns. Browser scrolling saved turn 11, scrollRatio 0.31469508998776863, completedAt null. Re-entering the reader displayed the “继续阅读” button. A sequential navigation-and-click run succeeded and placed the saved source text at viewport y=392–440 within a 720 px viewport. The screenshot was inspected.

Evidence: `reader-resume-before.json`, `reader-resume-after.json`, `reader-resume-after.png`, `reader-resume-db-readback.json`. The first delayed click timed out after the transient toast disappeared; it is not counted as a successful interaction. Short-session resume is now verified, superseding the earlier unverified note for this case only. Long sessions whose saved turn lies beyond initially loaded pages, delayed user action, and production authentication remain unverified.

The owned browser tab and temporary Web process were closed after this follow-up. The isolated tmpfs database remains live for subsequent local acceptance; stopping its container removes that synthetic dataset.
