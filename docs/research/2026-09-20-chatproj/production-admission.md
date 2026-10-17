# Production admission packet

Status: prepared for target identification and operator review; no production
permissions, collection, deployment, tunnel or ChatGPT connector has been applied.

## Resolve the actual targets

The inspected local configuration does not establish the current production fleet.
Supply the existing deployment manifest path or SSH host alias, not credentials in
chat. Reconcile that authoritative inventory with the configured logical sources
before making an “all servers” claim. Never discover infrastructure by scanning.

For each server/dataset record: logical ID; service kind; operator owner; primary,
replica or independent dataset; private endpoint reference; credential version;
approved aggregate fields; source revision; freshness budget; admission state.
The endpoint mapping and secrets stay in the operator environment. Only nonsecret
logical IDs and coverage states enter MCP output. Shared datasets must not be summed.

| Surface | Current adapter | Required admission evidence |
| --- | --- | --- |
| PostgreSQL business counts | Six fixed aggregate counts | Dedicated role, reviewed view, real denied-read/write probes and measured scan cost |
| Redis eight queue families | Exact LLEN/ZCARD keys | Effective ACL proof outside the collector identity; otherwise UNKNOWN |
| Web, worker, ASR, embedding and LLM runtime | Not implemented | Approved bounded metrics export with a separate disclosure and overhead review |
| Latency, cost, retention and evidence quality | Not implemented | Versioned event/metric definitions, denominator/window and privacy review |

Registering two example sources does not cover the fleet. Queue depth does not
prove worker execution; gateway TCP reachability does not prove an inference or
model identity. Unsupported service classes remain a visible rollout gap rather
than being represented as zero or healthy.

## Permissions and transport

1. Review `mcp/sql/provision.sql` against the actual schema and effective PUBLIC
   privileges. Prefer an isolated reporting database or replica. Its CREATE/TEMP
   restrictions may require a broader DBA decision; never silently revoke shared
   production PUBLIC grants. Apply only after exact targets and impact are known.
2. Provision separate credentials outside this conversation. The collector never
   loads application credentials. Validate raw content, writes and privilege
   escalation are denied using disposable fixtures first and the approved target
   identity second. Redis ACL inspection must not grant the collector access to
   other users' password hashes. Missing trustworthy ACL evidence blocks Redis.
3. Run the collector with only source credentials; run the MCP process with only
   sanitized snapshot/config access and audit append access. Restrict the serving
   process's production-network access. Model tools never start a collection.
4. Choose an account-supported Secure MCP Tunnel or existing HTTPS/OAuth gateway.
   The package's loopback bearer is a local transport boundary, not an OAuth
   implementation. Confirm account association, authorized audience and minimal
   scopes at the actual connector permission step. No URL-secret endpoint.
5. Route authenticated citation URLs as well as MCP calls. Prove authorized access,
   unauthorized rejection and correct source/hash/freshness in both ordinary Chat
   and an actual Deep Research run. A visible 6 Pro launcher is not proof of the
   Deep Research executor's model.

## Performance acceptance

First collect baseline measurements during a comparable application workload with
the collector off. Then run an approved bounded sampling window at the proposed
300-second interval; one source at a time, one PostgreSQL connection, fixed SQL,
2-second statement and 250-ms lock deadlines. Retain counts of queries, scanned
rows/buffers, query duration, CPU/I/O, app p50/p95 latency, error rate, replica lag
and sampling failures. Record workload and sample counts beside every comparison.

Agree an application p95 and resource budget after observing the baseline. Do not
invent an accepted threshold or call a small/noisy sample proof of no impact. A
whole-table COUNT can consume substantial I/O despite a short timeout. If its
cost exceeds the agreed budget, use existing preaggregation or a reporting replica
and remeasure. Model request volume must generate zero additional production
queries in a trace of the serving process.

Stop collection on a budget breach, unexpected permission, secret/content output
or new source mismatch. Disable only the affected MCP source and preserve receipts.
Do not restart the app, mutate queues or widen grants as recovery. The operator
can revoke the dedicated identity and stop the standalone MCP without an app
release. No production rollback has been exercised yet.

## Freshness, audit and acceptance receipts

The serving process pins one immutable snapshot. Adopting a newer snapshot requires
restarting that standalone MCP process after successful scheduled collection;
the application remains separate. Until an accepted scheduler/supervisor performs
this sequence, there is no continuous live-data service. An old process eventually
withholds expired counts. Preserve failed/partial source coverage at every refresh.

Before accepting the deployment, retain a candidate file manifest, source inventory
revision, permission-check receipt, snapshot hash/time, measured overhead report,
gateway/tunnel identity, Chat tool invocation, Deep Research citation, audit rows
and recovery outcome. Keep production secrets and raw business content out of these
receipts. Local audit rotation/off-host retention needs an operator policy; local
append files alone do not provide tamper-proof compliance storage.

Final acceptance requires actual target collection and both ChatGPT surfaces, then
one research proposal tied to that evidence and a measured subsequent experiment.
Local tests and the daily research heartbeat do not satisfy those gates.
