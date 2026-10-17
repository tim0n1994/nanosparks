# NanoSparks research loop operating contract

Scope: production aggregate evidence and research proposals for NanoSparks. This contract does not grant production deployment, database migration, user outreach, permission changes, or approval of a new product direction.

## Wake host and authority

A Codex task heartbeat wakes this existing task daily at 09:00 Asia/Shanghai. It is only the observation/research host. AUA remains the authority for owner/intent/PRD versions, implementation dispatch, UNKNOWN reconciliation and acceptance. Do not start another queue or run the general AUA scheduler worker.

Current mode: `research_only_until_production_admission`. This is not a claim that AUA successor iterations or production browser wake have passed acceptance. A missing product execution gate must remain visible.

## One wake

1. Read `state.json` and the latest proposal/evidence. Check whether the user has stopped or changed scope; respect pauses immediately.
2. Inspect the existing owned browser conversation before sending any message when its result is RUNNING or UNKNOWN. Recover from its canonical URL, never resend on observation timeout.
3. Use only already admitted source configuration and dedicated read-only credentials. Never fall back to application credentials, start stopped production dependencies, scan other servers, or read secret settings. Snapshot reads cannot trigger live collection.
4. Check source coverage, generation times, collection version, data hash, sampling window and failure categories. Missing/inaccessible/stale data must remain UNKNOWN. Do not spend a 6 Pro research round on an unchanged blocker.
5. If a fresh snapshot or completed experiment can change a decision, choose at most two independent research axes. Use Chat mode and verify visible `6 Pro` once per new tab. Use actual Deep Research only for a source-heavy question; record its mode separately and keep its underlying model UNKNOWN unless directly established.
6. Persist each prompt before submission. Budget: four sent messages per wake, counting initial prompts, corrections and synthesis. At most one Deep Research run per wake, with a concrete source scope; search-count limits in prompts are not enforced quotas. Stop on limit/fallback notices and notify once, without switching accounts/models.
7. Save canonical URLs, observed model/mode, submitted prompt, completion ending, rendered report and links. Verify decisive primary sources. Produce one ranked proposal tied to snapshot hash and candidate manifest.
8. Compare the new proposal with the previous hypothesis and test result. Advance, reject, or retain uncertainty. A research document alone is not product progress.
9. Implementation proceeds only inside already approved scope and through accepted AUA authority. Require a specific metric, guardrails, allowed paths, baseline/candidate identity, meaningful tests, independent acceptance and rollback. While those gates are unavailable, save a candidate proposal and identify the concrete next decision.
10. Update `state.json` only for this research task. Do not edit Codex private state or AUA database directly. Notify only meaningful changes, completed findings, failures or required user action. Otherwise stay quiet.

## Proposal contract

Every proposal includes project/run ID; intent and PRD revision/digest (both null if no accepted PRD); source snapshot ID/hash/time/coverage; base commit and reviewed worktree manifest; question and falsifiable hypothesis; primary references and counterevidence; baseline metric/denominator/window; smallest change and allowed files; experiment/candidate identity; acceptance and stop thresholds; rollback; decision (`proposed`, `approved`, `rejected`, `inconclusive`) and evidence for that decision.

## Performance acceptance

Model reads must perform zero live production queries. Collector overhead is evaluated separately: connection ceiling, fixed query/row/byte limits, statement and lock deadlines, minimum interval, and observed application p95/resource change against an agreed baseline. Prefer a replica or existing preaggregation. Do not promise zero degradation from read-only transactions or timeouts alone.

Unmeasured thresholds are proposals. Never infer first-readable latency from `updatedAt`, infer correctness from span counts, infer worker execution from queue health, or infer durable error rates from differently retained job histories. Small cohorts and derived differences require disclosure review; coarse suppression alone is not a general privacy guarantee.

## Stop and recovery

- Explicit user pause/cancellation stops future research; use the supported automation update tool to pause the heartbeat when asked.
- Active generation: recover before a new submission. UNKNOWN dispatch: AUA reconciliation first.
- Stale candidate/source hash: invalidate the affected conclusion and recollect once under the permitted sampling budget.
- Snapshot binding (2026-09-23 revision): a research prompt binds to the snapshot `generated_at` floor plus the anchor hash recorded at submission (round-4 anchor `756c09a8` @ 2026-09-23T01:02:49.960Z). An overview that observed a newer snapshot (larger `generated_at`) is equally valid, but Status must report the actual hash and time it observed. Stop only when the observed `generated_at` is earlier than the bound floor; an exact-hash mismatch against a rotated snapshot is no longer a protocol violation.
- Harvest protocol (2026-09-24 revision): identify the newest reply by its opening snapshot-binding line, never by the Status footer, because every round ends with the same `proposals: NOT_APPROVED_NOT_EXECUTED` line. Before declaring a send lost, compare assistant message head lines and lengths against the previous round; a backgrounded IAB tab does not discard committed sends.
- Missing read-only identity/transport trust: stop dependent access; complete independent local work, then ask one concrete question. Never put credentials in the chat.
- Tunnel incident (2026-09-26): public 530/error 1033 with local proxy healthy means the cloudflared edge link is down. Verified cause: Clash Verge Rev TUN (utun1024, 198.18.0.1) blocks edge TCP/7844 TLS (EOF) and UDP/7844 (timeout) toward 198.41.192.0/24 and 198.41.200.0/24 while 443 passes; protocol switch to QUIC does not help. Fix belongs to the operator VPN rules (DIRECT for those CIDRs or DST-PORT 7844, or TUN off); cloudflared self-heals once the path opens. Treat same-window collector verify-redis-acl ADMISSION failures as the same network-path class; recovery requires no production change.
- Performance threshold breach, privacy violation or unexpected write permission: disable that source at the operator-controlled collector boundary and report the exact evidence. Do not attempt a broader privilege change.
- No changed evidence: no new browser call and no repeated notification.

## Current gates

G0 local MCP protocol/security tests can be verified independently (29 tests, including the dormant Podcast Index discovery adapter). Real production collection passed on 2026-09-20 and runs on a 300s launchd tick with four sources OK: PostgreSQL eight aggregates, Redis 80 metrics, podnews-rss five metrics + eight VTT documents, changelog-transcripts five metrics + three HTML documents. Authenticated Chat invocation with six verified 6 Pro tool calls is recorded in state.json. Deep Research citation over the live snapshot remains a separate, not-yet-run gate. G1 authorized candidate implementation/independent acceptance/preview, G2 recovery and successor iteration, and G3 external-user benefit must not be marked complete from a scheduler configuration or synthetic test.

## Podcast Index discovery enablement (key pending)

The discovery adapter ships dormant: the local suite covers its auth headers, count-only parsing, ACCESS_DENIED and contract-failure mapping (2MiB/10s/15s bounds, 2 redirects; the snapshot exports only `pi.feeds_found` and `pi.feeds_with_itunes_id`). When the operator key exists:

1. Register at api.podcastindex.org and accept its terms; note the derivative-use restriction before any feed discovered there is ingested.
2. Add `NS_MCP_PI_API_KEY` and `NS_MCP_PI_API_SECRET` to `mcp/var/env.local` only; never in chat, config files committed to git, or research documents.
3. Copy the dormant template from `mcp/config.example.json` (`podcastindex-discovery`) into `mcp/config.local.json`, approve the label, set `enabled: true`, keep `maxResults` <= 100.
4. Wait for the next 300s launchd tick; `mcp/var/collect.log` must show `sources: 5` and the served overview must carry both `pi.*` metrics with status OK. A 401/403 surfaces as ACCESS_DENIED, never as a crash.
5. Re-run `node --env-file=var/env.local scripts/verify-chatgpt-proxy.mjs` inside `mcp/` and require VERIFY_OK on the new snapshot hash.
6. Discovery-to-collection curation stays a human decision: any PI-discovered feed is ingested only by adding an explicit `rss` source under the same bounded transcript contract. Deep Research may use `pi.*` counts as discovery evidence, never as transcript evidence.
