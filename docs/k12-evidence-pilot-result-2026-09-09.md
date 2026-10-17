# K-12 evidence pilot result

The user explicitly approved one historical EvidenceSpan coordinate update. On 2026-09-09 at 05:51:16 UTC, a serializable transaction updated exactly one row: `cmtpzmgpd00o8qgyfm2dkcw7s`. Preconditions checked the conversation, thought-unit ID, exact quote, all three old coordinate fields, and a fresh unique source match. The transaction and a subsequent read both verified the expected new values.

| Field | Before | After |
| --- | --- | --- |
| turnId | cmtpnp5cu0005zhyfwrm2vdsd | cmtpnp5cv00b7zhyf60k61z34 |
| startMs | 78000 | 4500250 |
| endMs | 90000 | 4510890 |

The quote and thought-unit ID were preserved. Backup and receipt are under `.omo/evidence/2026-09-08-iteration/`: `k12-pilot-before-2026-09-09T05-51-16-164Z.json` and `k12-pilot-receipt-2026-09-09T05-51-16-164Z.json`. The backup contains conditional rollback fields; rollback was not run. No other evidence candidate was applied.

## Browser findings and repairs

Used the prescribed gstack browse binary against an isolated development copy at 127.0.0.1:7558, with database-enforced read-only connections. Opened an owned tab, selected the actual GraphExplorer list node, then clicked its reader link. The link pointed to the corrected turn and absolute time.

The first run exposed a real client/API mismatch: the route returns `{data, meta.hasMore}`, while the reader consumed `{turns, hasMore}`. The prior component fixture duplicated the incorrect client shape. Updating that fixture reproduced a failure; the reader now consumes the real envelope, maps cleanText and nested participant fields consistently, and uses the same mapping in live-transcript polling.

After pagination worked, a second browser check showed the target focused but off-screen. Deferred paragraph layout with estimated heights made smooth scrolling unstable. Evidence deep links now use actual paragraph layout and an immediate scroll; ordinary reading retains deferred layout. The regression checks this distinction.

Final gstack flow loaded all 410 turns automatically and reached the actual K-12 quote at turn 400. DOM evidence records quotePresent=true, focused=true, top=332, bottom=500 within a 720px viewport. The screenshot was visually inspected. Evidence files: `k12-pilot-browser.json`, `k12-pilot-graph.png`, `k12-pilot-reader.png`.

The read-only browser environment blocked graph layout-cache UPDATE and reading-progress INSERT. The latter produced a PUT /read HTTP 500 and a console resource error. It did not prevent quotation navigation. This is not a clean-console or progress-persistence acceptance claim. The owned browser tab and temporary QA dev process were closed; existing services were not restarted or deployed. The 7558 URL is therefore an inspected test URL, not a currently running service.

## Acceptance scope

The approved single-row update and desktop graph-list-to-original-quote flow are verified. The remaining historical repair candidates, 3D canvas click behavior, mobile layout, audio seeking, real new ASR/LLM jobs, production deployment, and product retention gates are not established by this pilot.

Full `npm run verify` after the reader repairs exited 0 (2026-09-09 06:00:44–06:02:48 UTC): type-check, lint, 118 test files / 1030 tests passed, 2 files / 8 tests skipped, production build, postbuild assets and design gate passed. The 520 synchronized source/config files did not change during the run. Evidence: `.omo/evidence/2026-09-08-iteration/verification-k12-pilot-reader-2026-09-09.json` and `verify-k12-pilot-reader-2026-09-09.log`. Database connections were read-only and live-write integration remained skipped. `git diff --check` exited 0.
