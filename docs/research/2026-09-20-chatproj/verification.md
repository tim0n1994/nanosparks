# Verification ledger

## Existing application baseline

Executed `npm run verify` in `/tmp/nanosparks-chatproj-verify.kxTYIE`, an isolated copy of the dirty working tree with copied dependencies. Production `.env`, private tooling/evidence and existing `.next` were excluded. Database/Redis variables pointed to an unusable loopback test endpoint; `SKIP_INTEGRATION=true`; dedicated live-write integration variables were unset. No production service or database was changed.

2026-09-20 05:45:53 UTC start; Vitest duration 102.72 seconds; command exit 1.

| Gate | Observed result |
| --- | --- |
| TypeScript | Passed |
| ESLint | Passed for the application snapshot and MCP files present when copied |
| Vitest | 119 files passed, 2 failed, 4 skipped; 1103 tests passed, 21 failed, 11 skipped; 2 unhandled errors |
| Build | Not reached because test stage failed |
| Design gate | Not reached because test stage failed |

The common error is `No "resolveLlmTimeoutMs" export is defined on the "@/lib/llm/client" mock`, raised at `src/lib/queue/jobs/analyze.ts:423`. The two affected suites are `src/__tests__/pipeline/analyze-completion.test.ts` and `src/__tests__/pipeline/e2e.test.ts`. One pending-tail assertion subsequently times out. These files were already modified/untracked before this task and were not edited by the MCP work. Source and isolated-copy hashes are compared separately. This result supersedes historical green counts for today's observed snapshot; it is not a passing full gate.

## New MCP package

Implementation and focused protocol/security tests are still in progress. No production source data, browser MCP call, Deep Research citation or production-overhead measurement has passed acceptance yet.

## ChatGPT / scheduler

- NanoSparks project creation was observed at `https://chatgpt.com/g/g-p-6aaf70666d048191a7d8815cc2a6e164/project`.
- Chat mode and `6 Pro` were visibly observed; the plus menu exposed Deep Research.
- A `z` draft restored into new chats/projects. A user confirmation is pending before clearing it. No research messages have been sent.
- Project settings instructions were attempted through two supported input methods; both reopened blank. Do not claim those settings persisted. As an independent supported project-context path, the same locally saved, non-sensitive text was added as a project source. The UI visibly listed `NanoSparks-研究目标与证据规则-·-2026-09-20.txt` afterward; model retrieval has not yet been verified.
- Supported automation creation returned ID `nanosparks-6-pro`, ACTIVE, daily 09:00. This proves configuration only, not a future wake or an end-to-end iteration.
