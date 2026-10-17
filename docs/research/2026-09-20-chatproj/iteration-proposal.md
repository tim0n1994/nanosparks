# NanoSparks iteration proposal — evidence baseline, pending 6 Pro review

Status: local engineering proposal. The browser research prompts are prepared; no 6 Pro answer or Deep Research report has been received yet. Do not attribute this document to GPT-6 Pro.

## Decision

First make production evidence trustworthy and finish the measurable submit-to-evidence workflow. Research new product directions in parallel with that evidence work, then choose the smallest experiment likely to change a real user's behavior. Do not start broad performance rewrites from historical failures or source inspection alone.

## Phase 0: Production evidence source

Deliver a standalone MCP package, independent from the Next.js runtime and worker. Its model-facing process reads only sanitized snapshots. A separate bounded collector uses a dedicated identity per approved PostgreSQL or Redis source. Multiple instances are listed separately; replicas and primaries must not be added together as if they represented distinct business populations.

The initial database interface is fixed aggregate counts; queue evidence covers all eight known queue names. Raw content, user identities, secrets, arbitrary SQL/URLs/paths and operational actions are excluded. More useful duration, cost, evidence-quality and reading metrics require a versioned field review; their future presence must not be inferred from an overview count tool.

Accept local protocol and security tests first, then actual production collection, transport authentication and ChatGPT invocation. Treat those as different gates. Use a secure account-supported tunnel or an accepted OAuth gateway for remote access. A bearer-protected loopback HTTP endpoint is not by itself a completed ChatGPT OAuth connection.

Current blocker: the configured local business database/Redis/application sources are unreachable and no dedicated evidence-reader identity was found. Their actual production replacements must be identified before privilege provisioning and load acceptance. Do not start old services or reuse application write credentials to create a misleading baseline.

## Phase 1: Measure the path the user experiences

| Question | Required observation | Avoid |
| --- | --- | --- |
| How long until useful reading? | Submission, first transcript, first verified readable output, final evidence completion; cold/cache paths separately | Using mutable updatedAt or extraction-only duration as end-to-end latency |
| Where does time go? | Queue wait, ASR, correction, each extraction window, persistence and derived stages | Treating the longest visible spinner as the root cause |
| Can users trust citations? | Fixed corpus with expected quotation/turn/time; text jump and audio jump checked independently | Equating nonempty EvidenceSpan rows with correctness |
| Does recovery preserve useful work? | Failed-window retry with candidate/model/prompt/input identity and unchanged prior products | Restarting an unknown job or silently recomputing everything |
| Do users return? | Versioned exposure/activation/finish/revisit definitions with denominator and observation window | Claiming D7 from a small convenience sample or a changed completion timestamp |

Proposed first measurement corpus: a fixed set of short/long, single/multi-speaker, clean/noisy and cold/cached examples, with all source availability and provider identities recorded. Choose final sample counts and latency thresholds after baseline collection. Historical P50 under ten minutes remains a target, not a verified current property.

## Phase 2: Three discriminating performance experiments

1. **Provider concurrency and long-audio progress.** Compare the same approved corpus with measured current concurrency and one bounded provider-wide in-flight request. Record p50/p95 completion, queue time, peak memory, OOM/timeouts, successful windows, replayed windows and evidence accuracy. Advance only if throughput/latency improves without completeness or citation regression; stop on memory pressure and restore the previous policy. The current per-job serial setting does not establish a global semaphore.
2. **Progress and dashboard query amplification.** Measure rows, SQL time and request count with increasing active progress subscribers and library sizes. Compare the current design with one shared progress sample and bounded dashboard fetch. Advance only on measured database-load and response improvement with no missed state transitions or access-control regression. Restore the old query path if freshness or ownership checks regress.
3. **Long-reader and evidence navigation.** Use an identified candidate and fixed evidence beyond the first page. Measure time to locate exact source, bytes loaded, rendering/interaction latency and mobile memory. Reuse the existing pagination and deep-link implementation; only change the bottleneck shown by measurements. Correct quotation and focus/navigation behavior are hard guardrails, not secondary metrics.

These are proposals, not authorization to deploy. Each implementation proposal must name exact paths, source/candidate hashes, metric definitions and a rollback before AUA dispatch.

## Product research decision

Compare four user jobs: reading one long episode with reliable evidence; reusing knowledge across episodes; understanding a speaker's evolving claims; producing derivative content. The first is the current provisional priority because it matches the approved workflow and outstanding acceptance. This is an inference from project history, not market evidence.

The prepared Deep Research axis must supply current first-party competitor facts and counterexamples, distinguish replacement products from genuine unmet demand, and propose small observed-behavior experiments. No interviews, invitations, retention, or conversion data have been generated by this task. Do not turn feature comparisons into proof of willingness to adopt.

## Recurring decision loop

`fresh admitted snapshot → choose a decision → 6 Pro / Deep Research → versioned proposal → applicable approval → Codex implementation → independent candidate acceptance → approved preview/release → metric readback`

The daily heartbeat can host bounded observation and research. It does not close the currently missing AUA admission, multi-iteration execution, production connection or business-outcome gates. No new evidence means no new research message.

## Next concrete decisions

1. Identify the authoritative production services that replace or validate the unreachable local configuration and where dedicated read-only credentials will be injected. Never paste credentials into ChatGPT or this conversation.
2. Accept an exact remote authentication route after it is prepared. Browser trust/access expansion must be confirmed at that action.
3. Resolve the preserved `z` draft so the prepared two research prompts can be sent, then replace this provisional ranking with the captured 6 Pro findings and verified primary sources.

Evidence: `baseline.md`, `brief.md`, `loop-runbook.md`, the MCP README and test receipts. Production benefit remains UNKNOWN until the actual observation window completes.
