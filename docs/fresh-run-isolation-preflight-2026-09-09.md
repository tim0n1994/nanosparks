# Fresh processing isolation preflight

Update 2026-09-10: local media-path and cookie controls have now been implemented; see `docs/media-isolation-2026-09-10.md` and its verification evidence. The hardcoded-path observations below describe the pre-repair state. They no longer require a separate filesystem solely to change these paths, but all other provider, queue, explicit MediaAsset and model-cache isolation requirements still apply.

Read-only code review; no worker, download, provider request, cookie read, or deployment executed. Existing synthetic reader QA is not a fully isolated URL-processing environment.

1. Use explicit isolated DATABASE_URL and REDIS_URL, an independent cwd, and an environment allowlist. Worker starts eight queues, retention scheduling and watchdog activity immediately; it is not a passive probe.
2. Set STORAGE_PROVIDER=local with an independent cwd/data/uploads. UPLOAD_DIR is mentioned in comments but not read by LocalStorageProvider. YouTube downloaders and transcription/watchdog fallbacks hardcode /tmp/nanosparks-audio; TMPDIR does not isolate them. They may reuse a video-ID cache, and download defaults read Chrome cookies. Complete URL acceptance therefore requires configurable isolated paths and cookie policy, or an independent filesystem environment. Merely isolating Postgres and Redis is insufficient.
3. Require the actual selected ASR provider to be observed. Missing override credentials can fall through to local Qwen or mock. Deepgram requires DEEPGRAM_API_KEY and explicit selection; Paraformer expects a public URL while current audio-input resolution returns a file path. Pyannote runs in the flow and may download models, so its cache and provider scope must also be explicit.
4. Select LLM configuration in the isolated database: Setting values override environment fallbacks. Embedding has separate EMBEDDING_BASE_URL, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS and EMBEDDING_API_KEY configuration. Do not copy all business settings or silently use defaults.
5. Exclude unrelated publication/telemetry credentials: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, BAIDU_PUSH_SITE, BAIDU_PUSH_TOKEN and GOOGLE_INDEXING_TOKEN. The completed analysis path can otherwise send prompts or indexing requests. Existing completion notification writes database records, not email.

Code references: src/lib/storage/provider.ts, src/lib/youtube/ytdlp.ts, src/lib/youtube/downloader.ts, src/lib/transcription/factory.ts, src/lib/queue/flow.ts, src/lib/queue/worker.ts, src/lib/settings.ts, src/lib/embeddings/index.ts, src/lib/observability.ts, src/lib/queue/jobs/analyze.ts.

Credential presence-only inspection is recorded in `.omo/evidence/2026-09-08-iteration/fresh-run-credential-presence.json`. Presence is not validation of credentials, provider availability or budget. A user question is pending for one real processing run and its cost ceiling. No external operation may be inferred from elapsed time or an automatic goal continuation.
