# Evidence coordinate repair proposal

Status: user explicitly approved implementation on 2026-09-09; local repair implemented and isolated full verification passed. No data migration, re-extraction, ASR change, or service restart is included in this code repair.

## Delivery evidence

- Window text now carries actual global turnIndex and absolute startMs/endMs alongside speaker markers. Both structured and fallback outputs are verified against retained source turns.
- `evidence-coordinates.ts` accepts only a unique normalized source quotation, preserves Unicode/CJK, rejects repeated/short/missing/partial-word quotes and invalid coordinates, and derives bounds from source turns. Adjacent multi-turn quotes use first/last source bounds. It never estimates word-level timestamps.
- Persistence validates again against the whole conversation using one reusable immutable source index. A quote unique in a window but repeated elsewhere is not saved as an exact evidence anchor. Thought units remain available without unresolved evidence spans.
- Regression coverage includes 19 helper cases, 4 extraction-contract cases, and 1 pipeline persistence case. The earlier coordinate-loss probe now verifies distinct model inputs for distinct global positions.
- `npm run verify` passed in the isolated copy: 118 test files / 1030 tests passed, 2 files / 8 tests skipped; type-check, lint, build, postbuild and design checks exited 0. 520 source/config files were synchronized; none changed during the run. Database was read-only and live-write integration was skipped. Result: `.omo/evidence/2026-09-08-iteration/verification-coordinate-repair-2026-09-09.json`; full log: `verify-coordinate-repair-2026-09-09.log`.
- A real historical K-12 span was inspected inside a database-enforced read-only transaction. The resolver uniquely proposed turn 400, 4500250–4510890 ms, replacing the suggestion of turn 2 / 78000 ms in memory only. The persisted record was not changed. Script exited 0; evidence: `quote-readonly-repair-check.log`.

Limitations: this repairs future windowed extraction when the new code runs; it does not migrate existing spans or deploy the worker. Legacy episode-only extraction is outside this windowed-contract change. Actual LLM output quality and browser acceptance of historical graph data remain unverified. Conservative matching intentionally yields no anchor for ambiguous/paraphrased/short quotes. The original root-cause finding below describes the pre-repair implementation.

## Verified mechanism

createWindows retains global turnIndices/startMs/endMs in the window object, but serializes each input turn only as `[speaker] text`. extractFromWindow sends only window.text through the extraction prompt. The prompt asks for time intervals and illustrates turnIndex, yet supplies neither the actual per-turn indices nor timestamps. Persistence treats the response as global coordinates and does not check quote containment.

The deterministic probe `.omo/evidence/2026-09-08-iteration/probe-window-coordinate-loss.ts` ran via `npx tsx` and exited 0 on 2026-09-09. It confirms that identical text at turn 2 / 53965 ms and turn 400 / 4500250 ms produces identical model input. This proves coordinate information is lost before extraction. It does not prove which model response or historical run produced every existing incorrect span.

## Smallest proposed implementation

1. Serialize the actual global turn index and absolute millisecond bounds with each source turn; preserve the existing speaker markers. State explicitly that indices are global and times are absolute, not relative to a window.
2. Validate extracted evidence against source turns before persistence. Treat model-supplied coordinates as suggestions requiring verification. Bind only evidence whose quote has a supported, unambiguous source match; do not invent an exact source for unresolved text.
3. Use the same validation for structured and fallback model responses. Define multi-turn quotes and repeated quotes explicitly; a short/common quote must not silently choose the first match.
4. Add regression fixtures for late windows, wrong indices, fabricated times, Chinese/English punctuation, repeated quotes, missing quotes, and fallback responses. Verify meaningful failure behavior as well as successful linking.
5. Run the current-source isolated full verify gate again after implementation. Existing data remains unchanged, so historical graph acceptance remains a separate gate until a reviewed repair strategy is authorized.

## Scope decision

Recommend authorizing this local extraction-contract repair first. A later read-only historical repair report can classify uniquely recoverable, ambiguous, and unresolved spans; applying it to business data requires a separate explicit decision. A reader-only search fallback would conceal the generating defect and should not replace this repair.
