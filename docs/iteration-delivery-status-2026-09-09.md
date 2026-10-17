# NanoSparks iteration delivery and remaining acceptance

Status: local implementation and a single historical evidence pilot delivered; overall goal remains incomplete. This is a consolidated handoff, not a new test run or deployment claim.

Updated2026-09-11: user directed local chain completion first, with a decision only when a paid step becomes necessary. Real full-audio Qwen processing and1788-turn persistence now passed in isolation. Analysis encountered verified GPU OOM; bounded-request repairs passed the latest full gate and the same interrupted analysis job is awaiting normal BullMQ recovery. Final analysis/evidence/reader acceptance remains open. See docs/zero-cost-chain-run-2026-09-10.md for current process handles and exact runtime evidence.

## Outcome

The recommended iteration kept the existing submit → attribution → reading → original-evidence workflow. Parallel work implemented conversation access boundaries, non-destructive retry admission, safer queue recovery, unified transcription inputs, truthful analysis completion, evidence deep links, and stable first-completion tracking. User-approved follow-ups fixed lost extraction coordinates and applied one historical K-12 evidence correction. Real browser testing then exposed and repaired the reader's paginated response mismatch and off-screen deep-link scrolling.

Existing work was preserved. Changes remain in the working tree; this report does not claim a commit, merge, release, or updated production worker.

## Evidence by acceptance gate

| Gate | Strongest current evidence | Remaining limitation |
| --- | --- | --- |
| G1 access boundaries | Conversation-access route tests and auth-role/proxy tests included in the successful full suite | Authenticated deployed-browser scenarios not established |
| G2 safe retry | Retry, cache, batch and transcription failure tests included in full suite | DB/Redis crash atomicity has no outbox; fresh external-provider retry not exercised |
| G3 queue recovery | Queue/watchdog tests plus real dedicated-Redis policy tests in the full suite | Existing running worker has not been deployed with these changes |
| G4 transcription input and replacement | Real76-minute Qwen output retained with audio/output hashes;19818word segments normalized to1788persisted turns. Independent real PostgreSQL19818-row test committed20batches; deliberate second-batch failure preserved old turn/participant/TU/evidence | Speaker diarization remains unavailable; language and attribution quality need final real-reader review |
| G5 original evidence and reading | K-12 graph-list → reader flow and mobile reader deep link verified. Separate writable synthetic browser runs prove progress persistence, stable completedAt, short-session resume, and repaired cross-page resume to turn 250 after loading 310 turns | Other historical spans remain unrepaired; atlas/3D, mobile graph selection, audio and production-authenticated acceptance remain incomplete |
| G6 complete engineering verification | Latest bounded-analysis-final isolated npm verify exit0;120testfiles/1095tests passed,3files/10tests skipped; type/lint/build/design passed;526synchronized files unchanged. Explicit real PostgreSQL2tests and Python8tests/3subtests passed separately | Full-suite live-write integration remains skipped; production auth/deployment acceptance remains open |
| G7 named source and real processing | New ingest conversation cmtuuhvrx0002bmyfqnowyxbe, real full-audio ASR and persistence passed. First analysis failed0/16windows following localGPU OOM; repaired correction passed2real batches/48turns on owned local8083 | Whole repaired analysis and ten-link matrix remain incomplete. Anonymous fresh download failed403; processing used hash-identical retained audio, not a successful fresh download |
| Business success | No new external-user measurement was performed | Ten external readers, first-episode P50 under ten minutes, and D7 retention remain unverified |

## Authoritative artifacts

- Latest full gate: `.omo/evidence/2026-09-08-iteration/verification-bounded-analysis-final-2026-09-11.json` and `verify-bounded-analysis-final-2026-09-11.log`.
- Real processing, failures and recovery: `docs/zero-cost-chain-run-2026-09-10.md`; retained actual ASR receipt, PostgreSQL fault tests, GPU OOM logs and real bounded-correction probe are linked there. The correction probe initially wrote2expiring LLM-cache keys to business Redis because its env omitted REDIS_URL; exact keys/TTLs were read back and recorded, then the probe was corrected. No business DB writes arose from this probe, and no other cache keys were modified or deleted.
- Media isolation controls and limits: `docs/media-isolation-2026-09-10.md`. Custom audio/upload directories and disabled-cookie mode are locally tested; no real external provider acceptance is inferred.
- Writable reading and short/long resume: `docs/reader-writable-acceptance-2026-09-09.md` and `docs/long-reader-resume-fix-2026-09-09.md`, including browser RED/GREEN and independent database readback.
- Browser observations and inspected screenshot: `k12-pilot-browser.json`, `k12-pilot-reader.png`, `k12-pilot-graph.png` in that evidence directory.
- One-row transaction receipt and reversible before-image: `k12-pilot-receipt-2026-09-09T05-51-16-164Z.json` and `k12-pilot-before-2026-09-09T05-51-16-164Z.json`.
- Extraction repair details: `docs/evidence-coordinate-repair-proposal-2026-09-09.md`.
- Refreshed historical data preview: `docs/historical-evidence-preview-2026-09-09.md`. Current snapshot has 314 candidates, 1 unchanged corrected span, 152 unresolved; selected-field comparison changed only the approved K-12 row. Recheck transaction preconditions before any approved batch write.
- Pilot and reader defects: `docs/k12-evidence-pilot-result-2026-09-09.md`.
- Withdrawn early claims: `.omo/evidence/2026-09-08-iteration/acceptance-correction-2026-09-09.md`.

## Recommended next sequence

1. Mobile reader deep-link acceptance is now verified at 375 × 812: all 410 turns loaded, the exact K-12 source quotation focused and fully visible (top 376.125, bottom 548.125), and document scroll width matched viewport width (375). Evidence: `k12-pilot-mobile-browser.json` and visually inspected `k12-pilot-mobile-reader.png`. This covers the reader deep link, not mobile graph selection, atlas/3D, audio, or progress persistence. Continue remaining visualization checks with business DB read-only.
2. Historical preview refresh is complete. Keep unresolved cases excluded and the 314 candidates preview-only until a bounded batch decision. Any approved batch needs source preconditions and before-images.
3. User-prioritized next action: finish the current zero-API-cost analysis on retained real transcription, then inspect window success, evidence links, reader output and unknown speaker coverage. Follow `docs/next-release-acceptance-2026-09-09.md` before any release. No cost approval is currently needed; paid services require a concrete decision if local processing proves insufficient. No production restart is implied. Existing deploy script and worker-health endpoint have documented acceptance gaps.
4. After fresh technical acceptance, arrange external-user measurement. Do not send invitations or claim retention without authorized outreach and observed data.

The temporary 7558 QA server and owned browser tab were closed after the pilot. The inspected URL is not a promise of a currently live test environment. The main production build and older worker/probe/re-extraction processes were not restarted by the pilot.
