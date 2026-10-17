# Media isolation configuration

Local implementation for the planned isolated processing run. No media download, browser-cookie access, external ASR/LLM call, production restart or business-data write was performed.

## Configuration

| Variable | Explicit isolated behavior | Unset behavior |
| --- | --- | --- |
| NSP_AUDIO_DIR | Absolute directory used by both downloaders and transcription/watchdog legacy-file lookup | /tmp/nanosparks-audio |
| UPLOAD_DIR | Absolute directory used by LocalStorageProvider when no constructor directory is supplied | cwd/data/uploads |
| NSP_YTDLP_COOKIES_FROM_BROWSER=none | No browser-cookie arguments; --ignore-config prevents local yt-dlp configuration from enabling them | Existing downloader policy retained |

Empty or relative directory overrides fail rather than silently writing elsewhere. Explicit storage constructor paths retain precedence. In ytdlp.ts, cookie policy accepts chrome or none; disabling cookies issues one anonymous attempt rather than repeating the same failed command. Legacy downloader keeps its prior anonymous default and ignores config when explicitly disabled. Metadata subprocess fallback also respects disabled-cookie mode.

These controls are not a filesystem sandbox: explicit media paths and database MediaAsset paths still refer to their specified locations. Use a fresh isolated database, queue, storage directory and environment allowlist; do not copy business media records. Provider credentials, Pyannote/model caches and external publication/telemetry remain separate preflight requirements.

Independent follow-up review found that the reprocess HTTP route still searched the default audio cache, potentially enqueueing it as an explicit path. That route now also uses NSP_AUDIO_DIR. Two regression tests demonstrated the defect (2 failed / 21 passed), then passed after repair (23 passed): configured-cache discovery succeeds, and files existing only in the default cache are never probed or enqueued in isolated mode. Evidence: `retry-isolation-red.log` under the iteration evidence directory.

The legacy manual `src/scripts/enqueue-transcribe.ts` contains a one-off explicit audio path and must not be used for isolated acceptance. It is not an automatic pipeline entry. Explicit paths are intentionally not rewritten by these configuration controls.

## Validation

Initial targeted execution exposed incomplete mock-module interop in the interrupted parallel tasks. The main agent corrected default/named fs exports and retained meaningful filesystem-path observations. Then 63 tests across five files passed: downloads, transcription inputs, watchdog behavior and storage. Real temporary-file save/read and transcription input checks were included; subprocess/download responses were mocked, so this does not prove remote YouTube or ASR availability.

The first full verification stopped at lint because a non-React helper named useBrowserCookies triggered Hook naming rules. Renaming it to browserCookiesEnabled fixed the issue. The failed run remains recorded as `verification-media-isolation-2026-09-10.json`.

Final complete `npm run verify` exited 0: 119 test files / 1054 tests passed, 2 files / 8 tests skipped; type-check, lint, build and design passed. All 522 synchronized files stayed unchanged during the run. Authoritative result: `.omo/evidence/2026-09-08-iteration/verification-media-isolation-final-2026-09-10.json` and `verify-media-isolation-final-2026-09-10.log`. The full suite used a read-only database and skipped live-write integration; targeted real file checks were confined to test temporary directories.

After the independently reviewed retry-route correction, the newer complete gate also exited 0: **119 files / 1056 tests passed, 2 files / 8 tests skipped**, type-check, lint, build and design passed; 522 synchronized files unchanged. This supersedes the previous 1054-test result as the latest gate. Evidence: `verification-media-retry-isolation-2026-09-10.json` and `verify-media-retry-isolation-2026-09-10.log` in the same directory. The reviewer confirmed the original finding resolved and reported no remaining actionable finding in the limited media-isolation review.
