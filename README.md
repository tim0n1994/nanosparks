# NanoSparks — Human Thought Infrastructure

> Turn real conversations into evidence-linked thought units and reusable knowledge.

NanoSparks treats a **Conversation** as the core unit of human intelligence. It turns audio, video, or text into timestamped evidence, typed thought units, insight graphs, and context that can be searched, compared, and reused.

`source → transcript with evidence → thought units → insight graph → reusable context`

The current codebase is a Next.js 16 application backed by Prisma/Postgres and Redis/BullMQ, with graph and visualization components for reading, searching, asking, and exploring people and ideas. Product direction is recorded in the PRDs; implementation status remains the authority for what is actually available.

## Run locally

```bash
npm install
npm run dev
```

The development server uses port `7557`.

## Verify

```bash
npm run verify
```

This runs database generation, type checking, lint, tests, build, and the design-system check. Configure the required database and service environment before running the full gate.

## Read next

- [Human thought infrastructure architecture](docs/human-thought-infra-architecture.zh.md)
- [Knowledge presentation and Person Skill PRD](docs/prd-knowledge-presentation-2026-08.md)
- [Person distillation PRD](docs/prd-person-distillation-2026-07.md)
