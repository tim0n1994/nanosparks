# NanoSparks ChatProj read-only MCP

Standalone Node 22 package. It uses the official MCP SDK 1.30.0 with stdio and
stateless Streamable HTTP. All implementation, dependencies, tests and evidence
live under `mcp/`; the application and its package/lock/config are independent.

The collector is an explicit one-shot operator command. It writes sanitized,
immutable snapshots. The serving process loads and validates one snapshot at
startup, then tools read only its frozen in-memory representation. Serving does
not import database adapters or resolve their credentials. No tool can trigger
collection, run SQL/HTTP/shell, select a file, inspect logs, or read raw content.

## Supported evidence and boundaries

- PostgreSQL: eight exact aggregate counts: Conversation total/completed/failed and
  ExtractionRun total/completed/failed/pending/running. Dataset scope is the
  entire configured database, including synthetic conversations and all
  extraction runs/retries. These are not distinct episodes, retention, quality,
  spend, or latency metrics. `total - completed - failed` equals
  `pending + running`: a nonzero remainder means work is queued or in flight,
  not silently lost. In particular, `updatedAt` is not completion time and is
  not used.
- Redis: counts for any explicitly configured subset of eight known BullMQ queues
  (`ingest`, `transcribe`, `analyze`, `diarize`, `normalize_turns`, `retention`,
  `project`, `person_profile`). LLEN: wait/active/paused. ZCARD:
  delayed/failed/completed/prioritized/waiting-children. ZCOUNT windows over the
  trailing 24 hours: completed_24h/failed_24h (exclusive lower bound, timestamp
  scores). Exact per-key counts at each command's instant; the pipeline is not an
  atomic cross-key snapshot. Per queue, sanitized diagnostics are exported: the
  oldest waiting-children age, the newest stream event age, and up to four
  classified failure counts (timeout/stalled/connection/rate_limit/auth/
  missing_dependency/oom/assertion/unknown) derived from stream events; raw
  reasons, job IDs and payloads never leave the server.
  A missing approved key returns Redis's actual zero; a command/connection failure
  makes the whole source UNKNOWN and publishes no numeric values.
- RSS (transcript-first pilot): bounded HTTPS fetch of explicitly configured
  Podcasting 2.0 feeds. Per run: 8 MiB feed cap, 512 KiB per transcript, 20 s
  source deadline, 10 s per fetch, 3 https-only redirects, max 24 episodes and
  max 8 documents per source. Discovery reads `<podcast:transcript>` (VTT
  preferred). Evidence per fetched transcript: feed URL, episode title,
  transcript URL/type, byte count, SHA-256 and fetch time. No audio download,
  no transcript body inside the snapshot, no non-https or userinfo/port URLs.
  The Podcast Index discovery adapter is implemented but dormant: it calls the
  authenticated Podcast Index "by tag: transcript" discovery endpoint only when
  an operator configures a `podcastindex` source and supplies its API key and
  secret through `NS_MCP_`-prefixed environment references, never inside
  config files. Per discovery call: 2 MiB response cap, 10 s fetch timeout,
  15 s total deadline, 2 https-only redirects; it exports only aggregate
  discovery counts, never feed URLs, titles or body content. Moving from a
  discovered feed to an ingested source remains a separate, human-approved
  config change.
- No web, ASR, embedding, LLM, health-endpoint, content, users, settings,
  ReadingProgress/cohort, raw error or arbitrary server adapters. The outbound
  network adapters are the bounded RSS feed fetcher above and the bounded
  Podcast Index by-tag discovery call described above; together they fetch
  nothing beyond explicitly configured https feed and transcript URLs and that
  one authenticated discovery endpoint. An unsupported `kind` fails config
  validation. This iteration is not a complete server-health product,
  scheduler, AUA admission mechanism, or AUA replacement.
- One logical source per explicit config entry, max 16 including disabled entries.
  Counts are per source; never sum across servers without proving datasets are
  disjoint. Replicas may overlap and may lag. There is no auto-discovery.

Every source exposes its logical ID, kind, enabled flag, operator revision,
provenance hash, generated_at, content hash, fixed sample scope, status, reason,
accuracy and consistency. No hostname, port, database name, connection URL,
credential, environment reference, free text or error text is exported. Source
IDs must be approved nonsecret labels, not tenant/user identities. Counts are
`exact` when available, otherwise `unavailable`; no estimates are fabricated.

Coverage reasons distinguish `DISABLED`, `MISSING_CREDENTIAL`,
`INVALID_CREDENTIAL_CONFIG`, `UNREACHABLE`, `ACCESS_DENIED`, `COLLECTION_FAILED`,
and `STALE`. Unclassified transport/query errors fail as COLLECTION_FAILED.
UNKNOWN never means zero. Disabled sources never connect. Missing credentials
never fall back to app credentials. PG/Redis errors are not serialized.

## Install and local validation

```sh
cd /Users/chillbit/Proj/nanosparks/mcp
npm ci --ignore-scripts
npm run verify
cd ..
npm exec -- eslint mcp/src mcp/test mcp/scripts
```

`verify` runs syntax checks and `node:test` policy/protocol scenarios. Tests use
`test/*.node.mjs`, so root Vitest does not collect them. Each scenario writes a
nonempty JSON artifact under `mcp/.omo/evidence/`, naming the invocation, binary
assertion result and captured protocol/data facts. Runtime fixture directories
and restricted audit logs are retained there. Tests start only temporary local
MCP processes/listeners and never use production credentials or services.

Optional, separate disposable integration test (not part of `verify`):

```sh
cd /Users/chillbit/Proj/nanosparks/mcp
npm run test:integration
```

This requires **already present** `postgres:16-alpine` and `redis:7-alpine` Docker
images. It creates random `nanosparks-mcp-test-*` containers with a unique label,
256 MiB / 0.5 CPU / 128 PID caps, read-only root filesystems, tmpfs data, no
persistent volumes, loopback ephemeral ports and fixture-only data. It applies
the SQL template only to its fresh DB and verifies view counts, raw SELECT/write
denials, READ ONLY and effective PUBLIC privileges, plus Redis key/command ACLs.
It stops only containers carrying this invocation's matching label and records
`disposable-integration.json` after successful assertions and cleanup. It is not
production acceptance. Do not run concurrently with another reviewer unless
separate fixture work was explicitly intended.

Root `npm run verify` remains a separate app acceptance gate, owned by the lead.
This package's tests do not turn a pre-existing root failure into a pass.

## Configuration and credentials

```sh
cd /Users/chillbit/Proj/nanosparks/mcp
cp config.example.json config.local.json
chmod 600 config.local.json
```

The example deliberately disables its two sources and uses a reserved `.invalid`
citation host. Copy an entry for each approved server/dataset, assign a unique
logical ID, and enable only after DBA review. Minimum refresh interval is 60 s
(default example 300 s); stale threshold must be at least refresh interval.

Use separate, explicit environment variables named in `env`. The PG example uses
`NS_MCP_PRIMARY_PG_HOST`, `_PORT`, `_DATABASE`, `_USER`, `_PASSWORD`.
Username must be `nanosparks_mcp_reader`. Redis uses
`NS_MCP_PRIMARY_REDIS_HOST`, `_PORT`, `_USER`, `_PASSWORD`, with username
`nanosparks_mcp_counts`. Inject actual secrets through approved process/secret
management. RSS sources (`kind: "rss"`) carry no credentials and list one to
four `feeds` with explicit https URLs. The package never loads `.env`,
`DATABASE_URL`, `REDIS_URL` or app configuration. Do not paste credentials
into commands or evidence.

`tls: "verify"` uses certificate validation; configure a trusted CA through your
runtime's trusted CA mechanism when needed. `tls: "loopback"` permits plaintext
only to the literal addresses `127.0.0.1` or `::1`. No arbitrary DSNs, options or
SQL are accepted. Redis is deliberately limited to DB 0 and prefix `bull`.

Snapshot inventory and source provenance hashes bind IDs, kind, enabled, queue
selection, feed selection, TLS policy, **environment reference names**, and
`revision`. Neither hash includes credential values. Changing those config
fields invalidates old snapshots. Changing an endpoint/database behind the same
env reference requires an operator revision bump; it cannot be inferred without
inspecting secrets. Password rotation alone does not change dataset identity.
Retain the original nonsecret configuration for historical verification.

## PostgreSQL and Redis permissions

`sql/provision.sql` is a **DBA-review template**, not an applied migration or a
claim that an actual DBA has approved the target. It creates a new NOLOGIN view
owner with SELECT only on the two `status` columns, a dedicated reader with a
one-connection limit, one security-barrier aggregate view, and only schema USAGE,
database CONNECT and view SELECT for the reader. No passwords are included.

The template intentionally fails if the reader inherits database CREATE/TEMP,
schema CREATE or executable SECURITY DEFINER functions. PostgreSQL normally
grants TEMP through PUBLIC; a per-role revoke cannot negate it. A DBA must review
PUBLIC privileges and preserve application permissions through explicit grants,
or use an isolated reporting database. This package never revokes production
PUBLIC permissions or provisions roles itself. The runtime also rejects role
memberships, superuser/replication/role-management privileges, non-view table or
column reads, any table/column writes, sequence access, CREATE/TEMP and executable
SECURITY DEFINER functions, including effective PUBLIC grants.

Each PG collection opens one Client, enters REPEATABLE READ READ ONLY, checks
effective privileges, and executes one fixed SELECT of six columns from the
approved view. Connect timeout 2 s, statement timeout 2 s, lock timeout 250 ms,
query timeout 2.5 s, idle transaction timeout 3 s and a 10 s wall deadline bound
work. Sources run sequentially. Counts may scan the two tables; benchmark on the
actual dataset/replica before approval. Timeout is UNKNOWN, not a retry storm.
The aggregate view definition, owner, database RLS policy and cluster admin are
trusted DBA boundaries; a hash does not authenticate a malicious producer/DBA.

`sql/redis-acl.template.txt` lists exact key permissions. The Redis collector
disables ready checks, client-info commands, reconnect and offline queueing; it
issues only authenticated LLEN/ZCARD/ZCOUNT/ZRANGE/XRANGE pipelines and
disconnects. No BullMQ Queue constructor, INFO, EVAL, job content or writes.
Because the counts-only account cannot introspect its own ACL, DBA validation of
denied commands remains a gate.

## Collect and serve

All commands are explicit operator actions; none installs a service or scheduler.
Run collection in an environment containing only the approved reader credentials:

```sh
cd /Users/chillbit/Proj/nanosparks/mcp
npm run collect -- --config config.local.json --state var/snapshots --audit var/audit/collector.jsonl
```

Collection publishes a content-addressed 0400 snapshot and atomically updates a
0600 `current` pointer inside a 0700 directory. File reads are bounded, final
symlinks are refused, schemas are strict, hashes/provenance/inventory are checked,
and objects are deeply frozen before serving. One directory lock excludes other
collector processes; same-process calls share one flight. A durable last-attempt
timestamp enforces the refresh floor across restarts and failures, returning
cached snapshots when appropriate. A crash may leave `collect.lock`; an operator
must establish no collector is alive before removing that lock. No auto-break.

Launch **only the standalone MCP**, preferably in a restricted container/runtime
using the snapshot owner's UID (the loader enforces ownership), with read-only
access to snapshot/config and append access to audit, and no database secrets or
production network access:

```sh
node src/cli.mjs stdio --config config.local.json --state var/snapshots --audit var/audit/stdio.jsonl
```

The MCP session is explicitly pinned for its process lifetime. After a successful
collection, restart only this MCP process using the same command to adopt the new
snapshot. It does not restart the application or any production service. Without
that restart, counts eventually become UNKNOWN/STALE and are withheld. The source
hash still identifies the original sampled bytes; freshness is evaluated at each
tool call, so fetch text can change to STALE while the source hash stays stable.

Historical snapshots are retained, not automatically deleted. To recover an old
fetch ID, start this MCP against the matching retained snapshot hash and original
configuration (supply the actual 64-character hash as `SNAPSHOT_HASH`):

```sh
node src/cli.mjs stdio --config config.local.json --state var/snapshots --audit var/audit/history.jsonl --snapshot-hash "$SNAPSHOT_HASH"
```

The same argument works for HTTP. Old citation IDs are not served by a process
pinned to a different snapshot; use the historical process/config. Stale values
remain withheld even in historical mode. There is no arbitrary model-side
snapshot/path selector. Retention/rotation of snapshot and audit files is an
operator responsibility.

## HTTP, citations and ChatGPT

Configure a genuine approved canonical `citationOrigin` (HTTPS origin only, no
userinfo, port, path, query or fragment). The server generates URLs such as
`https://approved-host/evidence/ns:primary-db:SOURCE_HASH`. Its authenticated
`GET /evidence/<id>` route returns exactly the same sanitized document as fetch.
Configure the external terminator to protect and route both `/mcp` and `/evidence/`.
The `.invalid` example is only for fixture validation and is not a public link.

`NS_MCP_HTTP_TOKEN` must contain an independently generated base64url-style token
of 43-256 characters, injected out of band. It is a local terminator-to-MCP bearer,
not an OAuth server or a ChatGPT login credential. Start with:

```sh
node src/cli.mjs http --config config.local.json --state var/snapshots --audit var/audit/http.jsonl
```

Binding is hard-coded to IPv4 loopback. Missing/invalid token or public bind config
fails startup. Exact Host must be `127.0.0.1:<port>`; the terminator must rewrite
Host accordingly. Forwarded headers never authorize requests. An absent Origin
is allowed for server-to-server clients; present Origin must exactly match the
configured HTTPS allowlist. Bearer is checked on every request, including
citations; URLs carrying credentials/query strings are rejected. GET/DELETE on
`/mcp` are 405 because this adapter has no session/SSE storage. POST uses stateless
Streamable HTTP with JSON responses and supports initialize/list/call/ping.

`search` and `fetch` return canonical HTTPS citation URLs, `structuredContent`,
and identical JSON text content. `search.query` accepts only `overview`, `sources`,
`postgres`, `redis`; optional `source` must be configured. Search pages max 10;
overview pages max 4; coverage covers all max 16 sources without metric arrays.
Fetch uses only IDs returned by this snapshot. Every tool declares readOnlyHint,
but actual safety is enforced by the snapshot boundary and database permissions.

For a public ChatGPT connection, use an existing authenticated HTTPS/OAuth
terminator or a configured Secure MCP Tunnel. This package does **not** implement
OAuth discovery/token validation, create a tunnel, or register a connector.
The [official MCP guidance](https://developers.openai.com/api/docs/mcp)
describes search/fetch citation contracts. [Secure MCP Tunnels](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
require platform tunnel configuration, runtime credentials and organization or
workspace association; those are not configured or verified by this package.
The [SDK v1 documentation](https://ts.sdk.modelcontextprotocol.io/server) describes
the transports used here. No ChatGPT GPT-6 Pro call, Deep Research citation,
production source, public citation URL, OAuth flow or tunnel is accepted merely
because the local SDK tests pass.

### Local ChatGPT proxy and attestation receipts

ChatGPT cloud connectors cannot attach a custom Authorization header, so
`src/chatgpt-proxy.mjs` ships a minimal URL-secret terminator for that one
transport. It binds 127.0.0.1 only, serves
`https://<tunnel-host>/<secret>/{mcp,evidence/<id>,healthz}`, compares the path
secret with a timing-safe digest, refuses any client-supplied Authorization
header, injects the upstream bearer, and never logs URLs. The secret lives in
`var/mcp-tunnel-secret` (0600) and is generated on first start.

The URL-secret model is a deliberate tradeoff: the full secret-bearing URL is
visible in the ChatGPT connector detail page, in tunnel-provider logs, and
wherever the URL is pasted. Treat it as a bearer capability at the tunnel edge,
rotate it by editing the secret file and restarting the proxy, and put
Cloudflare Access or an equivalent authenticated terminator in front for
defense in depth. The proxy does not claim OAuth equivalence and still relies
on the upstream snapshot boundary for authorization.

Evidence receipts keep the attestation chain auditable. `GET /evidence/<id>`
returns the same sanitized document as `fetch` for the pinned snapshot, so a
citation a model renders can be re-verified byte-for-byte without MCP access.
Every forwarded call also lands in the upstream HTTP audit ledger (timestamp,
requestId, tool, argument hash, status, duration; never raw arguments or
tokens), which is the production attestation record for what ChatGPT read.

Registration bootstrap is deliberately not a standing route: while
`var/bootstrap-nonce` exists and is unexpired, `GET /bootstrap/<nonce>`
answers once with the full connector URL and deletes the nonce before
responding. The file must be removed and the temporary route deleted after
connector setup; a proxy that still serves bootstrap in steady state is a
findings-level defect.

## Limits, audit and threat model

Snapshot/config file cap 128 KiB; HTTP/stdin frame cap 8 KiB; tool result cap
64 KiB; max 96 metrics per source; HTTP header cap 8 KiB, 32 sockets, 5 s request
lifetime. HTTP rate and concurrency defaults are 120/min and 4 (caps 600/min and
8). Auth failures consume rate budget; batch messages are rejected before any
tool executes. Stdio has a process-global 120/min, concurrency 4 limit. JSON-RPC
IDs can be safe integers or `[A-Za-z0-9_-]{1,64}` strings; disallowed
IDs are rejected with null ID. SDK errors are replaced with fixed messages.

Audit files are owner-only 0600, O_APPEND, no symlinks/hardlinks, under 0700
directories. Rows contain only timestamp, server-generated requestId, allowlisted
tool/method, SHA-256 of arguments, status and duration. Never raw arguments,
request IDs, tokens, endpoints or errors. STARTED and terminal records distinguish
success, tool error, JSON-RPC error, auth failure, rejection and collector outcomes.
Audit files stop accepting records at 10 MiB; request handling fails closed.
Rotate while the process is stopped, preserve permissions, then restart. This is
local append auditing, not tamper-proof remote compliance storage; the OS account
and parent directories must be trusted. Hashes establish byte/config identity,
not source truth, authenticity or model identity. Whole-dataset counts may still
be confidential and require the same access protection as the product.

Operator secrets and endpoint mapping remain outside model outputs. A malicious
local process with the same account or a DBA can replace trusted snapshots/views;
OS isolation and external access controls address that boundary. The adapter
rejects unknown keys, arbitrary strings, non-count metrics, PII-shaped payloads,
extra fields and invalid hashes even when a tampered file has been rehashed.
