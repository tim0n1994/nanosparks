# NanoSparks — Human Thought Infrastructure

[![CI](https://github.com/tim0n1994/nanosparks/actions/workflows/ci.yml/badge.svg)](https://github.com/tim0n1994/nanosparks/actions/workflows/ci.yml)
[![Security](https://github.com/tim0n1994/nanosparks/actions/workflows/security.yml/badge.svg)](https://github.com/tim0n1994/nanosparks/actions/workflows/security.yml)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

> Turn real conversations into evidence-linked thought units and reusable knowledge.

NanoSparks treats a **Conversation** as the core unit of human intelligence. It turns audio, video, or text into timestamped evidence, typed thought units, insight graphs, and context that can be searched, compared, and reused.

`source → transcript with evidence → thought units → insight graph → reusable context`

The current codebase is a Next.js 16 application backed by Prisma/Postgres and Redis/BullMQ, with graph and visualization components for reading, searching, asking, and exploring people and ideas. Product direction is recorded in the PRDs; implementation status remains the authority for what is actually available.

## Run locally

```bash
cp .env.example .env
npm ci
npx prisma generate
npm run dev
```

The development server uses port `7557`.

Set the local PostgreSQL, Redis, authentication, and provider values in `.env`
before using ingestion or background processing. `.env.example` contains key
names only and deliberately contains no credentials.

## Verify

```bash
npm run verify
```

This runs database generation, type checking, lint, tests, build, and the design-system check. Configure the required database and service environment before running the full gate.

The CI workflow provisions isolated PostgreSQL and Redis services for its
integration checks. Run the same command locally when those services and the
required environment are available.

## Architecture boundary

NanoSparks stores conversations as timestamped evidence, derives typed thought
units and insight graphs, and publishes reusable context through the Next.js
application. PostgreSQL is the system of record; Redis and BullMQ drive the
ingest, transcription, analysis, embedding, projection, and retention queues.

Production credentials, databases, queue state, generated builds, and host
configuration are kept outside Git. See [SECURITY.md](SECURITY.md) before
reporting a vulnerability.

## Read next

- [Human thought infrastructure architecture](docs/human-thought-infra-architecture.zh.md)
- [Knowledge presentation and Person Skill PRD](docs/prd-knowledge-presentation-2026-08.md)
- [Person distillation PRD](docs/prd-person-distillation-2026-07.md)
