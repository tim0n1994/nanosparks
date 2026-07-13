# Contributing — NanoSparks

## Branch Strategy

Per `docs/iteration-plan-2026-07.md` milestone plan (I0–I6):

- **`main`** — always green (type-check + tests + build pass). Protected.
- **Iteration branches** — one per milestone: `i0-engineering-hygiene`, `i1-base-upgrade`, `i2-diarization`, `i3-interpretation-v2`, `i4-retrieval-v2`, `i5-product-closure`, `i6-platform-hardening`.
- **Feature branches** — `feat/<short-desc>` off the current iteration branch. Squash-merge back.
- **Fix branches** — `fix/<short-desc>` off `main` for hotfixes.

Merge gate: type-check 0 errors + all tests green + Docker build passes (per plan §3 execution-order gate).

## Environment Setup

1. `cp .env.example .env` — fill in real values.
2. **Never commit `.env`** — it is gitignored. API keys live only in your local `.env` or CI secrets.
3. `docker compose up -d postgres redis` — start infra.
4. `npm ci && npx prisma generate && npx prisma migrate deploy`
5. `npm run dev`

## Iteration Workflow

Each iteration (I0–I6) follows:

1. Branch from `main`.
2. Implement per the plan's exit criteria.
3. Verify: `npm run type-check && npm test -- --run && npm run build`.
4. Squash-merge to `main` with a commit message referencing the iteration (e.g. `feat(i0): engineering hygiene baseline`).
