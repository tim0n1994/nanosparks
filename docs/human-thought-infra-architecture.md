# NanoSparks Human Thought Infrastructure Architecture

> Date: 2026-06-04
> Status: design proposal
> Supersedes: `docs/architecture-review.md` product framing only. The current code remains the implementation baseline.

## 1. North Star

NanoSparks should become infrastructure for extracting high-value intelligence from real human conversation.

The first product shape was:

```text
YouTube podcast -> transcript -> LLM analysis -> interactive idea map
```

The broader product shape is:

```text
Any conversation media -> grounded transcript -> thought units -> insight graph -> reusable context
```

The key abstraction is not `Episode`. It is `Conversation`: a bounded exchange between people where ideas, objections, decisions, questions, evidence, and tacit knowledge appear in time.

Supported sources should eventually include:

- Public media: YouTube videos, podcasts, RSS feeds, interviews, livestream recordings.
- Work media: Zoom, Google Meet, Microsoft Teams, sales calls, user interviews, research calls.
- Local media: uploaded audio/video, phone recordings, offline meeting recordings.
- Derived text: existing transcripts, notes, chat logs, meeting summaries, imported research docs.

The long-term asset is not the transcript. The asset is a time-grounded, source-grounded representation of human thought.

## 2. Market Research Summary

### 2.1 Product categories

| Category | Representative tools | What they prove | Gap NanoSparks can own |
| --- | --- | --- | --- |
| Revenue conversation intelligence | Gong | Enterprises pay for conversation graphs tied to business outcomes. Gong positions around capturing every interaction, a revenue graph, specialized agents, and workflow automation. | Gong is domain-specific to GTM. NanoSparks can be domain-general and idea-centric. |
| AI meeting memory | Fireflies, Read AI, Granola, Fathom, tl;dv | The market has moved from transcription to searchable meeting memory, cross-meeting insights, action items, and AI integrations. | These tools optimize notes, tasks, CRM updates, and summaries. They rarely model argument structure deeply. |
| Research repository / customer intelligence | Dovetail, Condens, Looppanel | The highest-value workflow is evidence-backed synthesis across many conversations, not per-call summaries. | These tools focus on customer research. NanoSparks can generalize to debates, expert interviews, strategy sessions, podcasts, and private discussions. |
| Podcast knowledge tools | Podwise, Snipd, NotebookLM | Users want mind maps, Q&A, export, and recall from long-form spoken content. | Existing podcast tools emphasize summary and personal knowledge. NanoSparks can emphasize relational thought graphs. |
| Deliberation and argument mapping | Polis, Kialo, Argdown | Structured opinion spaces and argument maps are known forms for representing collective thought. | These systems usually require explicit user input. NanoSparks can infer structure from raw conversation. |
| Voice AI infrastructure | Deepgram, AssemblyAI, Speechmatics, Recall.ai | Speech-to-text, diarization, real-time streams, meeting capture, and compliance are infrastructure commodities. | NanoSparks should integrate or swap providers, not compete on raw speech recognition. |
| AI memory / vector / graph infra | Qdrant, Chroma, Neo4j, Mem0, GraphRAG, LightRAG | Hybrid search, graph structures, temporal memory, and entity linking are becoming standard infra. | NanoSparks needs a conversation-native schema on top of these primitives. |

### 2.2 Direct lessons

1. Transcription is not a moat.
   Deepgram, AssemblyAI, Speechmatics, Whisper, WhisperX, pyannote, and Recall.ai cover this layer well.

2. The winning product unit is a corpus, not a recording.
   Dovetail, Gong, Fireflies, Read AI, and tl;dv all converge on cross-conversation search, trends, summaries, and automated action.

3. Provenance is mandatory.
   Any extracted insight must link to source media, timestamp, speaker, confidence, and the source utterances used to produce it.

4. The durable differentiation is structural extraction.
   NanoSparks should model claims, questions, objections, evidence, assumptions, decisions, tensions, open loops, and conceptual dependencies.

5. Privacy is product architecture.
   Real human conversation contains sensitive private data. Consent, retention, redaction, access boundaries, and source deletion must be first-class.

## 3. Product Thesis

NanoSparks is a human intelligence distillation system.

It listens to real exchanges and builds a reusable, queryable representation of:

- what was said,
- who said it,
- what idea it expressed,
- what it supports or contradicts,
- what evidence grounds it,
- what changed over time,
- what the group seems to know,
- what remains uncertain.

This makes the system useful for:

- founders extracting market signals from customer calls,
- researchers synthesizing interviews,
- investors tracking expert conversations,
- teams preserving decision context,
- writers and analysts mining podcasts and interviews,
- communities understanding collective opinion,
- agents needing grounded, high-signal context from human discussion.

## 4. Architecture Principles

1. Conversation-first.
   YouTube videos, meetings, uploads, and transcripts are input adapters. The core domain starts at `Conversation`.

2. Preserve raw evidence.
   Store original media metadata, transcript segments, speaker turns, and extraction provenance. Never store only summaries.

3. Separate perception from interpretation.
   Speech recognition, diarization, OCR, and metadata extraction produce observations. LLM passes produce interpretations. They must be stored separately.

4. Build layered intelligence.
   Do not jump from transcript directly to final brief. Extract small typed units first, then derive higher-level graphs and briefs.

5. Keep M0 boring.
   Current Next.js, Prisma, Postgres, Redis, BullMQ, Whisper, Cytoscape, and D3 remain enough for the first migration. Add Qdrant or Neo4j only when query patterns prove the need.

6. Treat deletion as a graph operation.
   Removing a source must remove or invalidate all derived embeddings, thought units, graph edges, briefs, exports, and cached outputs.

## 5. Target System Overview

```text
                    +----------------------+
                    |  Source Connectors   |
                    |  upload / YouTube /  |
                    |  RSS / meeting API / |
                    |  local recorder      |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |  Ingestion Ledger    |
                    |  source, consent,    |
                    |  ownership, status   |
                    +----------+-----------+
                               |
                               v
+----------------+   +----------------------+   +------------------+
| Object Storage |<--|  Media Processing    |-->| Transcript Store |
| raw media      |   |  STT, diarization,   |   | turns, words,    |
| thumbnails     |   |  OCR, metadata       |   | timestamps       |
+----------------+   +----------+-----------+   +------------------+
                               |
                               v
                    +----------------------+
                    |  Thought Extraction  |
                    |  claims, questions,  |
                    |  objections, etc.    |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |  Insight Graph       |
                    |  entities, topics,   |
                    |  stances, relations  |
                    +----------+-----------+
                               |
             +-----------------+-----------------+
             v                                   v
  +----------------------+            +----------------------+
  | Retrieval Interfaces |            | Synthesis Interfaces |
  | search, ask, compare |            | briefs, maps, clips, |
  | graph traversal      |            | exports, agent ctx   |
  +----------------------+            +----------------------+
```

## 6. Core Domain Model

### 6.1 Current model problem

Current schema:

```text
Channel -> Episode -> Analysis -> ReferenceLink
Playlist -> PlaylistEpisode
```

This fits YouTube but not general conversation intelligence.

### 6.2 Proposed model

```text
Workspace
  |
  +-- Corpus
        |
        +-- Source
        |     |
        |     +-- MediaAsset
        |     +-- Transcript
        |
        +-- Conversation
              |
              +-- Participant
              +-- Turn
              |     |
              |     +-- Utterance
              |
              +-- ThoughtUnit
              |     |
              |     +-- EvidenceSpan
              |
              +-- InsightGraph
                    |
                    +-- GraphNode
                    +-- GraphEdge
                    +-- IntelligenceBrief
```

### 6.3 Entity definitions

| Entity | Meaning |
| --- | --- |
| `Workspace` | Ownership and permission boundary. Maps to user/org in Clerk. |
| `Corpus` | A collection of conversations for a purpose: customer discovery, AI safety podcasts, investment diligence, team decisions. |
| `Source` | Original input reference: YouTube URL, uploaded file, Zoom meeting, transcript file, RSS item. |
| `MediaAsset` | Stored audio/video/image/file metadata and object storage key. |
| `Conversation` | A bounded exchange. One source can produce one or more conversations. |
| `Participant` | Human or role identity inside a conversation. May be known, pseudonymous, or unresolved. |
| `Turn` | A contiguous speaker segment with timestamps. |
| `Utterance` | Smaller text span inside a turn. Used for evidence anchoring. |
| `ThoughtUnit` | Extracted semantic unit: claim, question, evidence, objection, decision, assumption, risk, example, definition, prediction, preference. |
| `EvidenceSpan` | Exact transcript/media provenance for a thought unit. |
| `GraphNode` | Canonical entity, concept, claim cluster, topic, participant, artifact, decision, or unresolved question. |
| `GraphEdge` | Typed relation: supports, contradicts, refines, depends_on, answers, cites, exemplifies, raised_by, agreed_by, disputed_by. |
| `IntelligenceBrief` | Human-readable output generated from graph and evidence. |

### 6.4 Thought unit taxonomy

M0 should support only the types needed to prove value:

```text
claim       A falsifiable or debatable assertion.
question    An explicit or implicit information need.
evidence    A fact, example, citation, metric, anecdote, or observation.
objection   A challenge to a claim, plan, premise, or evidence.
decision    A resolved choice, commitment, or agreement.
risk        A downside, uncertainty, blocker, or failure mode.
insight     A synthesized high-value pattern from multiple utterances.
```

Later types:

```text
assumption, definition, prediction, preference, emotion, value, tradeoff,
action_item, contradiction, analogy, principle, strategy, open_loop
```

## 7. Processing Pipeline

### 7.1 Jobs

Replace the current three-stage pipeline with a stage graph. BullMQ can still run it.

```text
ingest_source
  -> fetch_metadata
  -> acquire_media
  -> transcribe_media
  -> diarize_speakers
  -> normalize_turns
  -> extract_thought_units
  -> link_entities
  -> build_relations
  -> index_retrieval
  -> synthesize_briefs
  -> publish_artifacts
```

Each job writes durable state and can be retried safely. Idempotency means running the same job twice should not duplicate graph nodes or corrupt derived outputs.

### 7.2 Perception layer

Inputs:

- audio/video bytes,
- existing transcript,
- meeting API transcript,
- YouTube metadata,
- chat/sidebar logs,
- calendar metadata,
- speaker metadata if available.

Outputs:

- normalized transcript,
- word/segment timestamps,
- speaker labels,
- confidence scores,
- language detection,
- media clips,
- privacy redaction markers.

Provider strategy:

```text
local:   Whisper + WhisperX + pyannote for self-hosted and cost control
cloud:   Deepgram / AssemblyAI / Speechmatics for real-time or enterprise accuracy
meeting: Recall.ai when exact participant audio streams matter
```

### 7.3 Interpretation layer

Run extraction in small windows, then merge.

```text
Transcript turns
  |
  +-- window by time/topic/speaker shift
        |
        +-- extract thought units
        +-- extract entities and concepts
        +-- extract local relations
        +-- assign confidence and evidence spans
  |
  +-- global merge
        |
        +-- dedupe semantically equivalent units
        +-- cluster claims and themes
        +-- link support/contradiction/refinement
        +-- detect unresolved questions and decisions
```

Do not ask the LLM for one giant summary. Ask it for typed, evidence-backed JSON records.

### 7.4 Synthesis layer

Synthesis should be generated from the graph, not directly from raw transcript.

Outputs:

- conversation map,
- argument map,
- timeline,
- participant stance map,
- decision log,
- open questions,
- high-signal quotes,
- cross-conversation trend report,
- agent-ready context pack.

## 8. Storage Architecture

### 8.1 M0 storage

Keep Postgres as the system of record.

Recommended M0:

- Postgres + Prisma for all canonical data.
- `pgvector` optional for embeddings if the deployment can support it.
- Redis + BullMQ for jobs.
- Local filesystem or S3-compatible storage for media.

Avoid adding Neo4j or Qdrant in M0 unless a concrete feature needs it. The graph can be represented relationally first.

### 8.2 M1 storage

Add specialized stores when query pressure appears:

| Need | Store |
| --- | --- |
| Semantic search over utterances and thought units | Qdrant or pgvector |
| Hybrid search with payload filters | Qdrant |
| Deep graph traversal and graph algorithms | Neo4j |
| Fast prototyping of local vector search | Chroma |
| Agent memory and temporal fact recall | Mem0-like memory layer or internal equivalent |

### 8.3 Relational graph tables

```text
thought_units
  id
  conversation_id
  type
  canonical_text
  confidence
  created_by_model
  extraction_version

evidence_spans
  id
  thought_unit_id
  utterance_id
  start_ms
  end_ms
  quote

graph_nodes
  id
  corpus_id
  kind
  label
  canonical_text
  metadata_json

graph_edges
  id
  corpus_id
  source_node_id
  target_node_id
  relation
  confidence
  evidence_json
```

## 9. Retrieval And Query Architecture

The query stack should combine:

```text
keyword search + semantic search + graph traversal + temporal filters + provenance
```

Query examples:

- "What objections repeatedly appear across customer calls?"
- "Which claims did Alice make that Bob later challenged?"
- "What changed between episode 1 and episode 8?"
- "Show the evidence for this insight."
- "What assumptions are unresolved before this decision?"
- "Create a context pack for an AI agent implementing this feature."

Retrieval plan:

1. Parse query intent.
2. Filter by workspace, corpus, source type, time range, participants, privacy labels.
3. Retrieve candidate utterances and thought units.
4. Expand through graph edges.
5. Rank by evidence strength, recency, source diversity, and confidence.
6. Generate answer with citations to evidence spans.

## 10. Privacy, Consent, And Governance

Conversation data is high-risk. The architecture must include governance from the start.

M0 requirements:

- `Source.consentStatus`: unknown, granted, denied, public, imported_by_owner.
- `Source.visibility`: private, workspace, shared_link, public.
- `MediaAsset.retentionPolicy`: keep, delete_after_processing, delete_after_days.
- PII redaction job before broad sharing/export.
- Deletion cascade for media, transcripts, embeddings, thought units, graph edges, briefs.
- Audit log for view, export, share, delete.

M1 requirements:

- Participant-level privacy labels.
- Consent receipts for meeting capture.
- Workspace-level data training policy.
- Per-corpus retention settings.
- Legal hold mode for enterprise.

## 11. API Surface

M0 endpoints can stay close to the current app:

```text
POST /api/sources
GET  /api/sources/:id
GET  /api/sources/:id/status

POST /api/conversations
GET  /api/conversations/:id
GET  /api/conversations/:id/full

GET  /api/corpora/:id/graph
POST /api/corpora/:id/query
POST /api/corpora/:id/briefs
```

Source creation should accept:

```json
{
  "kind": "youtube_url | media_upload | transcript_upload | meeting_import",
  "uri": "string",
  "corpusId": "string",
  "consentStatus": "public | granted | imported_by_owner | unknown",
  "retentionPolicy": "keep | delete_after_processing"
}
```

## 12. Frontend Information Architecture

Current `/visualization/[episodeId]` becomes one view inside a broader workspace.

Recommended navigation:

```text
Workspace
  |
  +-- Corpora
  |     +-- Corpus overview
  |     +-- Conversations
  |     +-- Graph
  |     +-- Search / Ask
  |     +-- Briefs
  |
  +-- Sources
  |     +-- Upload / import
  |     +-- Processing status
  |
  +-- Settings
        +-- privacy
        +-- retention
        +-- connectors
```

Key views:

- Conversation view: transcript, speaker turns, clips, extracted thought units.
- Map view: graph of claims, topics, speakers, evidence, objections.
- Corpus intelligence view: repeated themes, contradictions, decisions, open questions.
- Brief builder: generate shareable outputs from selected graph regions.

## 13. Migration From Current Repo

### 13.1 Keep

- Next.js App Router.
- Prisma/Postgres.
- Redis/BullMQ.
- Current worker factory.
- YouTube parser/downloader as one connector.
- Whisper script as first transcription provider.
- Cytoscape/D3 visualization components as first graph UI.
- Current tests as baseline.

### 13.2 Rename mentally first, physically later

Do not rename everything in one PR. Use compatibility aliases.

```text
Episode       -> Conversation
Playlist      -> Corpus
Analysis      -> ConversationAnalysis / InsightGraph
Argument      -> ThoughtUnit(type=claim/objection/evidence)
ReferenceLink -> ExternalReference / EvidenceLink
```

### 13.3 First schema expansion

Add new models beside existing ones:

```text
Source
Corpus
Conversation
Participant
Turn
ThoughtUnit
EvidenceSpan
GraphNode
GraphEdge
Brief
```

Then backfill existing YouTube `Episode` rows into the new model. Keep current routes working until the new UI is ready.

## 14. Phased Implementation Plan

### Phase 0: Reframe Without Breaking Current Product

Goal: keep YouTube demo working, but introduce the new vocabulary and storage layer.

Deliverables:

- Add this architecture doc.
- Add Prisma models for `Source`, `Corpus`, `Conversation`, `Participant`, `Turn`.
- Add adapter that maps current `Episode` into `Conversation`.
- Add `sourceType=youtube` path for current ingest.

Exit criteria:

- Existing YouTube submit and visualization still work.
- A new conversation record exists for every processed episode.

### Phase 1: Evidence-Grounded Thought Units

Goal: replace loose JSON analysis with typed extraction records.

Deliverables:

- Add `ThoughtUnit` and `EvidenceSpan`.
- Refactor LLM prompts to emit typed units with evidence span IDs.
- Add Zod validation for all model outputs.
- Update visualization to render thought units from normalized tables.

Exit criteria:

- Every claim/objection/evidence item links to timestamped source text.
- Bad LLM JSON fails gracefully and is retryable.

### Phase 2: Multi-Source Conversation Ingest

Goal: expand beyond YouTube.

Deliverables:

- File upload ingest.
- Transcript upload ingest.
- Meeting import abstraction.
- Provider interface for transcription:

```typescript
interface TranscriptionProvider {
  transcribe(input: MediaAsset): Promise<TranscriptResult>;
}
```

- Optional adapters for Deepgram, AssemblyAI, or Speechmatics.
- Evaluate Recall.ai for meeting capture where participant-level audio streams matter.

Exit criteria:

- Same analysis pipeline works for YouTube, uploaded media, and transcript import.

### Phase 3: Corpus-Level Insight Graph

Goal: support intelligence across many conversations.

Deliverables:

- Add `GraphNode` and `GraphEdge`.
- Dedupe and cluster thought units across a corpus.
- Add corpus graph API.
- Add corpus question answering with citations.
- Add first trend report: repeated claims, objections, decisions, unresolved questions.

Exit criteria:

- User can ask questions across many conversations and inspect cited evidence.

### Phase 4: Privacy And Sharing Hardening

Goal: make private conversation data safe enough for serious use.

Deliverables:

- Consent and retention fields enforced in API.
- Deletion cascade tests.
- Redaction job.
- Audit log.
- Shared brief links with scoped visibility.

Exit criteria:

- Deleting a source removes all derived artifacts.
- Shared outputs cannot expose private transcript spans outside scope.

### Phase 5: Specialized Infra

Goal: add specialized storage only after product query patterns are real.

Decision gates:

- Add Qdrant if semantic search latency or filtering exceeds Postgres/pgvector.
- Add Neo4j if graph traversal becomes central and relational queries become painful.
- Add Mem0-like memory if agents need low-token, temporal recall across sessions.

Exit criteria:

- New infra has a measured bottleneck, migration plan, backup plan, and local dev story.

## 15. Engineering Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Overbuilding graph infra too early | Neo4j/Qdrant/GraphRAG can distract from product proof | Use Postgres graph tables first |
| LLM hallucinated structure | False claims damage trust | Require evidence spans and confidence on every unit |
| Speaker attribution errors | Wrong speaker means wrong intelligence | Track speaker confidence and allow correction |
| Consent/privacy failures | Conversation data is sensitive | Build consent, retention, deletion, and audit into M0 |
| Multi-source scope creep | Every source has quirks | Use connector interface and ship upload/transcript before live meeting bots |
| Summaries becoming generic | Loses differentiation | Make graph and thought unit extraction the primary artifact |
| Cost blow-up | Long audio + many LLM passes can be expensive | Windowed extraction, caching, provider routing, usage budgets |

## 16. Technical Recommendations

### 16.1 Recommended M0 stack

Use boring pieces:

```text
Next.js + Prisma + Postgres + Redis/BullMQ + object storage
Whisper/WhisperX local first
Claude/OpenAI-compatible LLM abstraction
Cytoscape/D3 for graph and timeline
```

Add one optional dependency:

```text
pgvector if semantic search is needed inside Postgres
```

Do not add:

```text
Neo4j, Qdrant, GraphRAG, LightRAG, Dify, LangChain, LlamaIndex
```

until a concrete Phase 3 feature forces them.

### 16.2 Recommended first product wedge

The best first wedge is not "all conversations".

Recommended wedge:

```text
Expert/customer conversation intelligence for small teams:
upload or import 5-50 calls/interviews/podcasts, extract the argument/insight graph,
then produce evidence-backed briefs and agent-ready context packs.
```

Why:

- High-value users already have painful synthesis workflows.
- Private recordings and public podcasts can share the same pipeline.
- It exercises corpus-level insight without requiring real-time capture.
- It differentiates from notetakers by focusing on structure and evidence.

### 16.3 Recommended first visible feature

Build a `Corpus Graph` page before adding more ingestion connectors.

It should show:

- top claims,
- supporting evidence,
- objections,
- unresolved questions,
- participant/source distribution,
- timestamped proof.

This forces the product to prove the new thesis.

## 17. Source Links

- Gong: https://www.gong.io/
- Fireflies: https://www.fireflies.ai/
- Read AI: https://www.read.ai/
- Granola: https://www.granola.ai/
- Fathom: https://fathom.video/
- tl;dv: https://tldv.io/
- Dovetail: https://dovetail.com/
- Condens: https://condens.io/
- Looppanel: https://www.looppanel.com/
- Deepgram: https://www.deepgram.com/
- AssemblyAI: https://www.assemblyai.com/
- Speechmatics: https://www.speechmatics.com/
- Recall.ai: https://recall.ai/
- Polis: https://pol.is/home
- Polis source: https://github.com/compdemocracy/polis
- Kialo: https://www.kialo.com/
- Argdown: https://argdown.org/
- Qdrant: https://github.com/qdrant/qdrant
- Chroma: https://github.com/chroma-core/chroma
- Neo4j: https://github.com/neo4j/neo4j
- Mem0: https://github.com/mem0ai/mem0
- Whisper: https://github.com/openai/whisper
- WhisperX: https://github.com/m-bain/whisperX
- pyannote.audio: https://github.com/pyannote/pyannote-audio
- GraphRAG: https://github.com/microsoft/graphrag
- LightRAG: https://github.com/HKUDS/LightRAG
- VideoRAG: https://github.com/HKUDS/VideoRAG
