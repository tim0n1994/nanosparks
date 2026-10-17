# NanoSparks five-direction iteration report — 2026-09-21

Scope: the five ranked directions from the 6 Pro iteration proposal, landed in
the ChatProj MCP package (mcp/) and verified against local tests and the live
production stack. Evidence grades are stated per claim; nothing below is
attributed to a model answer without direct observation.

## Landed and verified

1. Task-level diagnostics + time-window metrics (VERIFIED). Snapshot v2 sealed
   envelope (started_at/generated_at/duration_ms), trailing 24h window metrics
   per queue (completed_24h/failed_24h, exclusive lower bound), nine failure
   classes, and per-queue sanitized diagnostics (oldest waiting-children age,
   newest event age, top classified failure counts). Raw reasons, job IDs and
   payloads never leave the server. Evidence: mcp verify 27/27 GREEN,
   disposable-integration evidence file.
2. Failure recovery / dependency terminal states (VERIFIED IN PRODUCTION).
   The missing-dependency failure class and waiting-children oldest-age metric
   make stuck dependency fan-out observable from the snapshot alone. Recovery
   is now built: scripts/reap-orphaned-extraction-runs.mjs fails extraction
   runs stuck in status='running' for more than 48 hours (dry-run default,
   --apply explicit, idempotent, original params preserved, recovery marker
   and timestamp merged into params jsonb). Applied to production on
   2026-09-21: dry-run matched all 17 orphaned runs (kind=extract, model
   glm-5.2, started 2026-07-31/08-01, stuck ~1205-1216h), apply returned
   updated:17, and the business_counts view then reconciled exactly:
   extractions 132 = 115 completed + 17 failed + 0 pending + 0 running, all
   17 rows carrying the orphaned_running_reaped marker. The served snapshot
   reflects the same numbers (extractions_failed=17, extractions_running=0).
3. completed vs deliverable terminal-state alignment (VERIFIED IN PRODUCTION).
   business_counts view v2 adds extractions_pending/extractions_running; the
   strict collector contract (exact column match), policy schema and README
   semantics moved to eight columns. Production view upgraded via the local
   OrbStack container (previous no-admin-credential blocker resolved; view
   owner and grants preserved). After the direction-2 reap, live production
   reconciles exactly: extractions 132 total = 115 completed + 17 failed +
   0 pending + 0 running. The 17 running rows that motivated this direction
   are fully explained and terminal; completed vs deliverable accounting now
   has zero unexplained residue.
4. Snapshot contract + controlled content evidence (VERIFIED). documentEntry
   strict schema (title sanitised <=200 chars, bytes <=524288, sha256),
   sourceSchema kind rss with scope public_feed_transcripts and consistency
   bounded_fetch, max 8 documents, documents stripped from STALE snapshots,
   validateSnapshot binds rss OK state to documents.length ===
   transcripts_fetched. pg/redis sources reject documents.
5. Transcript-first RSS pilot, two publishers (VERIFIED IN PRODUCTION).
   podnews-rss: 1 feed OK, 24 episodes, 8 VTT documents. changelog-transcripts
   (added 2026-09-21): Changelog feed OK, 24 recent episodes parsed, 3 carrying
   podcast:transcript tags, 3 HTML transcripts fetched (27KB) - cross-publisher
   validation of the same bounded contract (8MiB feed / 512KiB transcript /
   20s deadline / max 8 docs per source). Discovery-layer boundary probed
   empirically: Apple feeds carry no transcript tags (3 head shows, 0 tags);
   Podcast Index's keyless namespace endpoint serves only the SPA shell (HTML,
   no JSON) and its API host needs an authenticated key; the Podcasting 2.0
   route is the only keyless path to transcripts. A Jupiter Broadcasting feed
  was rejected as a pilot source on measured evidence: 10.2MB feed exceeds
  the 8MiB contract limit. Podcast Index API key registration remains the
  sole user action; the pilot itself is production-validated.
   The Podcast Index discovery adapter is now implemented as dormant code
   (2026-09-21): authenticated by-tag discovery with 2MiB/10s/15s/2-redirect
   bounds, count-only metrics, API key and secret delivered via NS_MCP_
   environment references (never in config files), access-denied and
   contract-failure mapping, audit whitelist entry. mcp verify 29/29 GREEN.
   Enabling it once the operator key exists is only a config source entry
   (config.example.json carries the dormant template) plus the two env vars;
   discovery-to-curation stays a human-approved config change.
   Live host contract observed (2026-09-21T18:38Z): a fake-credential call
   through the real adapter to api.podcastindex.org returned 401 and mapped
   to ACCESS_DENIED in 2.2s, proving endpoint reachability, request shape and
   live error mapping; only the authorized path remains, and it needs the
   operator key.

## Production admission (VERIFIED 2026-09-20T17:46Z)

- Redis ACL extended incrementally (+zcount +zrange +xrange and eight
  ~bull:{queue}:events key patterns; never reset), re-attested, receipt binds
  72 key patterns. Tool: scripts/acl-apply.mjs (additive-only, dry-run mode).
- All three sources OK in the served snapshot: primary-db 8 metrics,
  primary-queues 80 metrics, podnews-rss 5 metrics + 8 documents.
  snapshot_hash 5fe69a6b...; ChatGPT proxy end-to-end VERIFY_OK (initialize,
  tools/list, tools/call overview on the same hash). After the orphan reap the
  served snapshot is 6fc48bbf... (generated 2026-09-20T17:57:04Z), three
  sources OK, extractions_failed=17 / extractions_running=0; the public
  ChatGPT proxy re-verified end-to-end on that hash (VERIFY_OK). After adding
  the changelog-transcripts pilot source the live snapshot is 794164b3...
  (4 sources, all OK; collection duration 4.4s, launchd-only, no request-path
  impact); proxy re-verified end-to-end on that hash (VERIFY_OK).
- Root cause found and fixed for the earlier collection exit-1: a stale
  diagnostic node process held the single-slot nanosparks_mcp_reader
  connection, leaving an idle server-side backend. Terminated; collector now
  connects cleanly. The 300s refresh throttle legitimately reuses a fresh
  snapshot; failures during that window are transient collisions, not data loss.

## Gates and remaining work

 Local: mcp verify (29 tests) GREEN including the dormant Podcast Index
 discovery adapter; disposable docker integration GREEN including the
 eight-aggregate assertion. Production collection, the orphan reap, and the
 ChatGPT-proxy tool surface are observed working (re-verified 2026-09-21 on
 snapshot 3e7b0748..., 4 sources OK, proxy VERIFY_OK). Not yet done: Podcast
 Index API key registration (requires the user's account and terms consent;
 sole user action — enabling the adapter is then only a config source entry
 plus NS_MCP_PI_API_KEY/NS_MCP_PI_API_SECRET) and a Deep Research run over
 the live snapshot inside the 6 Pro loop. The research loop contract in
 loop-runbook.md governs those next rounds.
