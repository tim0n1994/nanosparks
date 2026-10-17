# NanoSparks ChatProj research loop — initial contract

Date: 2026-09-20. Run: `nanosparks-20260920-r1`.
Canonical checkout: `/Users/chillbit/Proj/nanosparks`.
Base commit: `894b357b12fa5ccd9cae56838d3bc415d583bff4`; substantial pre-existing uncommitted work exists. A commit alone does not identify the candidate.

## User outcome

Provide a least-privilege, auditable, read-only production-business MCP source for ChatGPT, then use Chat-mode GPT-6 Pro and orchestra-brower to investigate performance and product direction, produce reviewable proposals, and repeat using fresh evidence. All configured project servers must appear in coverage, including unavailable or not-yet-authorized sources. Never interpret this as authority to scan arbitrary infrastructure.

## Research boundaries

- ChatGPT receives a compact sanitized project brief and explicitly allowed aggregate evidence. No credentials, internal addresses, user identities, private transcript text, raw logs, or database dumps.
- Read-only source collection is separated from model-facing snapshot reads. Model call frequency must not amplify production queries. Background collection still has measurable cost; zero production impact cannot be asserted without measurement.
- A source without a dedicated limited credential is UNKNOWN/BLOCKED, not silently queried using the application's write credential.
- Browser research cannot approve, execute, publish, change access, or replace AUA's authority. Local MCP implementation is authorized by the user's explicit request. Research proposals require the applicable scope/approval before product changes.

## Axes and finite budget

1. A: Performance and evidence architecture. Decide what to measure and fix first, given incomplete long-audio extraction/evidence acceptance. Ordinary 6 Pro Chat with primary-source research.
2. B: Product opportunity and counterevidence. Use actual Deep Research when visibly available; distinguish its execution model from the 6 Pro launcher.
3. Synthesis in A only after both reports: ranked experiments, criteria, guardrails, rollback and next evidence.

Maximum six sent messages for this first cycle, including corrections/follow-ups and synthesis; initially two independent axes. Stop research when another message is unlikely to change the decision, on service limitations, or at the budget. A prompt's requested search count is not an enforceable service quota.

## Evidence to preserve

Saved prompt, observed mode/model, submission observation, canonical conversation URL, completion observation, rendered report and direct source links, capture hash/receipt; MCP source freshness, content hash, capability status, audit receipt, source and output size bounds. Separate code tests, actual production collection, Chat MCP invocation, Deep Research citation, AUA delivery and product impact.

## Initial state

ChatGPT project created and visibly observed: https://chatgpt.com/g/g-p-6aaf70666d048191a7d8815cc2a6e164/project . Chat mode and `6 Pro` observed. Research messages have not yet been submitted. Existing homepage composer restores unrelated draft `z`; preserve it.

Historical documents report isolated engineering verification and a single evidence-navigation pilot. They do not establish current production deployment, full extraction completion, or external-user outcomes. Current runtime must be re-observed.

## Recurring operation

Use one supported Codex task heartbeat for wakeup only; reuse AUA for any product execution authority. No custom scheduling loop, second implementation queue, automatic production deployment, unbounded tabs, or repeated submissions on unknown outcomes. Continue only when fresh evidence changes a decision; remain quiet otherwise. Missing access becomes one actionable blocker, not a repeated poll.
