# Next release and fresh-run acceptance

Status: reviewed preparation only. No deployment, existing-process restart, external-provider job, or batch historical write was performed.

2026-09-11 update: the user authorized running the chain with existing local resources and reserving paid steps for their decision. The isolated fresh conversation has now completed real local Qwen ASR and committed1788turns from retained full audio; anonymous fresh YouTube download failed403. Local analysis is running after bounded-request and correction-integrity fixes. See zero-cost-chain-run-2026-09-10.md for current evidence. The original preparation-only and provider-approval statements below are historical; release activation and additional historical writes remain outside this run.

## Verified release hazards

- `scripts/deploy-prod.sh` restarts only `com.nanosparks.web`. Its claim that the next job picks up changed tsx source is not supported by `src/lib/queue/worker.ts`, which statically imports processors and creates long-lived workers. This iteration changes those processors, so worker release must be explicit.
- The deploy script prints `/settings` HTTP status without rejecting non-2xx responses, tolerates curl failure, and then prints success. That output is not release acceptance.
- `src/app/api/health/worker/route.ts` substitutes zero queue counts after Redis errors. Its apparent empty queues cannot establish a safe worker restart. It also covers only ingest/transcribe/analyze, whereas the worker registers additional queues.

## Execution order

Complete isolated fresh-processing acceptance before updating existing services. Isolation must cover Postgres, Redis, media storage and both processes; merely changing the web port is insufficient. Worker startup registers retention and watchdog activity. The existing read-only QA environment cannot establish persistence acceptance.

Fresh-run entry is `POST /api/ingest` for `https://www.youtube.com/watch?v=knx2wrILP1M`, with `mode: "robot"`; require `cached: false` and a new isolated conversation. Provider selection and cost ceiling remain a decision, and the actual provider must be observed because fallback may select mock. `scripts/verify-pipeline.ts` executes distillation and bypasses ingest/ASR/worker, so it is neither a read-only probe nor proof of this full chain. `npm start` uses port 2333, not the existing standalone port 7557.

1. Freeze the reviewed source snapshot and preserve the currently working release and launchd configuration. Record exact service PIDs, active jobs across every registered queue, and confirmed Redis connectivity. Do not infer idle from the current health endpoint. Resolve existing active jobs before any restart decision.
2. Prepare the candidate in an isolated release directory. Run the complete engineering gate and preserve outputs. The previous full gate passed, but a changed candidate requires fresh validation. Avoid building over the currently served standalone directory.
3. Obtain a concrete scope decision for the isolated writable environment and one fresh external-processing run. The single historical-row approval does not cover provider processing. Cost ceiling and provider choice remain unspecified.
4. In that isolated environment, submit a fresh test conversation under a known authorized account through the actual ingestion route. Capture its new conversation ID, queue/flow job IDs, timestamps and fresh worker logs. Confirm actual media input, transcription output, analysis persistence and final status; no old-record reuse as fresh evidence.
5. Use gstack to verify the resulting reader and original-source links on desktop/mobile. Check exact quotation, source turn/time, authorization boundaries, and persisted reading progress. Inspect downstream job failures and degradation notices before declaring completion. A provider failure must preserve existing content and must not falsely promote completion.
6. After isolated acceptance, obtain a release-window decision covering existing Web/Worker services, active-job handling and rollback target. Activate both only within that scope. Record old/new PIDs, release identity, startup results, authenticated route outcomes, and queue connectivity. Require explicit expected HTTP statuses and fail on connectivity errors. Do not use the existing deploy script as an unattended acceptance gate.
7. Roll out additional historical repairs only under a separate bounded decision. Current preview contains 314 candidates, 1 corrected unchanged span and 152 unresolved spans. Exclude unresolved spans, compare source and old values in the transaction, and retain reversible before-images.

## Acceptance limits

One fresh successful run establishes one scenario, not the full ten-link/source matrix or business retention targets. External-user outreach, first-episode latency distribution and D7 retention require separately observed data. Do not claim these from unit tests or a single pilot.

The original source matrix remains: Xiaoyuzhou ×3, YouTube ×2, Apple Podcasts ×2, RSS ×1, Bilibili ×1, MP3 ×1. Remaining exact URLs and authorized external-reader recruitment are not established by this review. Do not run `scripts/backup-postgres.sh` blindly: it can upload backups and delete older backups, so release backup scope must be reviewed independently.
