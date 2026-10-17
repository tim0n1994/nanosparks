# Long-session reader resume repair

## Reproduction

A new isolated synthetic conversation `qa_reader_long_20260909` contains 310 turns and a saved unfinished reading position at index 250. On the previous reader, gstack clicked “继续阅读” successfully, but the page remained at scrollY 0 with only 200 turns loaded and the target absent. Evidence: `.omo/evidence/2026-09-08-iteration/long-resume-red.json`.

The generating mechanism was `scrollToTurn`: it searched only currently loaded turns and silently returned when the saved index lay beyond the initial page. It did not ask the existing paginator for missing turns.

## Change

Explicit turn navigation now retains its target while requesting subsequent pages. Once the target exists in rendered content, the reader scrolls instantly to its exact source element and focuses it. Explicit navigation disables deferred paragraph layout to keep geometry stable. Exhausting available turns produces a visible missing-position message instead of jumping to an unrelated paragraph. Existing evidence-anchor behavior is preserved.

Application changes are confined to `src/components/reader/ReaderShell.tsx` and `src/__tests__/components/reader.test.tsx`, preserving prior work in both files.

## Verification complete for this repair

The new regression first failed with the other 13 tests passing. After repair, all 15 reader tests pass, including the missing-target boundary. Targeted lint and diff whitespace validation passed. The RED log is preserved as `long-resume-unit-red.log` in the evidence directory.

Complete isolated `npm run verify` exited 0: 118 test files and 1032 tests passed, 2 files and 8 tests skipped; type-check, lint, build and design passed. All 520 synchronized files stayed unchanged during the run. Evidence: `verification-long-resume-2026-09-09.json` and `verify-long-resume-2026-09-09.log`. Live-write integration remained skipped in that suite.

The same synthetic database fixture then passed real-browser acceptance: clicking “继续阅读” loaded all 310 turns, focused exact turn 250, and displayed its text at y=403.5–427.5 in the 720 px viewport. Evidence: `long-resume-green.json` and visually inspected `long-resume-green.png`. This browser ran against the isolated writable fixture, not business data. No formal deployment or fresh external processing occurred. The temporary web process and owned browser tab were closed after acceptance; the isolated synthetic database remains available.
