# NanoSparks initial evidence baseline

Observed 2026-09-20 around 05:34 UTC by two independent read-only local audits. No production queries, model inference, database/queue writes, or service restarts were performed.

## Runtime and source coverage

| Logical source | Current observation | Admission requirement |
| --- | --- | --- |
| Business PostgreSQL | Configured endpoint unreachable | Authoritative production endpoint; dedicated credential limited to aggregate evidence views; inspected grants and query plans |
| Business Redis / BullMQ | Configured endpoint unreachable | Exact queue namespace; ACL restricted to count commands and approved keys |
| Web | Expected local listener absent | Verified deployment identity and read-only health contract |
| Worker | No matching current local process/container/launchd entry observed | All eight queue processors and real worker heartbeat; queue existence alone is insufficient |
| ASR | Configured endpoint unreachable | Approved non-inference health measurement; inference benchmark separately authorized |
| LLM gateway | TCP reachable | Actual health, ownership, current provider/model and inference remain UNKNOWN |
| Embeddings | Configured endpoint unreachable | Approved health contract |
| Media storage | Compose declares storage; active backend unknown | Inventory and metadata-only aggregate adapter; no objects or signed URLs |
| Identity / telemetry | Code supports identity and optional telemetry | No private identity data, prompts, tracing payloads or secret settings exposed |

This is the set discoverable from this checkout, not a claim that every production host has been discovered. Database-backed provider overrides cannot be read while the database is unreachable. Unknown or disabled sources must remain in MCP coverage rather than being reported as healthy or zero.

## Source findings that change priorities

1. Analysis worker concurrency is two, with per-job extraction concurrency one or two; the serial setting is per job, not a global provider semaphore. Measure real in-flight inference and memory before increasing throughput.
2. Successful extraction-window outputs accumulate in memory before final coverage persistence. Investigate replay cost and checkpoint identity on retry; do not infer resumability from windowing alone.
3. Dashboard retrieves every conversation and relation counts before applying a display limit. Measure query rows/time and payload against library size.
4. Each progress SSE connection performs a conversation lookup and two aggregate queries every two seconds. Measure amplification by concurrent readers before adding more polling consumers.
5. Atlas loads all projections and related evidence/text; extraction can compare claims pairwise. These are scaling hypotheses, not measured current bottlenecks.
6. Conversation has no `readyAt`; mutable `updatedAt` is not a valid first-readable timestamp. ExtractionRun duration is not end-to-end processing latency.
7. Worker health sees three of eight queues and substitutes zeros on some failures. Retained completed and failed jobs have different retention windows; their ratio is not a durable failure rate.
8. Structural EvidenceSpan coverage cannot prove semantic quotation correctness. Reading and product outcome metrics need denominators and explicit observation windows.

Source pointers: `src/lib/queue/worker.ts`, `src/lib/queue/jobs/analyze.ts`, `src/lib/extraction/windowed-extraction.ts`, `src/app/dashboard/page.tsx`, `src/app/api/conversations/[id]/progress/route.ts`, `src/app/api/corpora/[id]/atlas/route.ts`, `src/app/api/health/worker/route.ts`, `src/lib/metrics.ts`, `prisma/schema.prisma`.

## Existing work and acceptance

At audit time: HEAD `894b357b12fa5ccd9cae56838d3bc415d583bff4`, 81 modified tracked files and 51 pre-existing untracked entries. These counts precede this research/MCP addition and are not a candidate hash. Preserve all prior changes.

The September 11 project handoff reports isolated ASR persistence and verification plus specific reader/evidence pilots. It explicitly leaves full repaired analysis, fresh source matrix, attribution quality, deployed authentication, external readers and retention open. These historical reports have not been rerun by this baseline audit.

## Existing control plane

- Official Desktop project: `local-bcb55a6c1c20428012388eb12be95cb8`, canonical checkout matches.
- AUA project: `01a04c51-f0ed-7740-8c48-a029453a134f`; live reconciliation says matched, conflicts empty, formal admission pending.
- AUA research baseline/capture/proposal routes are present. They require owner/intent/version binding; a proposal is not an approval.
- Existing general AUA heartbeat is paused. Narrow Hatchet product-loop code and isolated evidence exist, but production browser wake and successor iterations are not established.
- Existing Eagleye MCP and named tunnel are running. Its URL-secret proxy is a legacy pattern, not an approved NanoSparks OAuth connection. No reusable OAuth gateway was established by the audit.

These findings justify a standalone snapshot MCP and a bounded research wakeup. They do not establish G0 real Chat invocation, G1 accepted product iteration, or an autonomous production loop.
