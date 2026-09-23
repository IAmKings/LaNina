# Backend Development Guidelines

The backend is one Cloudflare Module Worker written in strict TypeScript. It owns public/admin HTTP routes, scheduled work, D1 access and R2 access.

## Guidelines Index

| Guide | Owns | Status |
|---|---|---|
| [Platform Contract](./platform-contract.md) | Worker, env, HTTP and storage cross-layer contract | Active |
| [Directory Structure](./directory-structure.md) | Backend module placement | Active |
| [Database Guidelines](./database-guidelines.md) | D1 schema, migrations and queries | Active |
| [Error Handling](./error-handling.md) | Public errors and internal failure categories | Active |
| [Logging Guidelines](./logging-guidelines.md) | Structured Workers logs and redaction | Active |
| [Source Ingestion](./source-ingestion.md) | Source adapters, private snapshots and opt-in live smoke | Active |
| [Quality Guidelines](./quality-guidelines.md) | Type, test and review requirements | Active |

## Pre-Development Checklist

1. Read `platform-contract.md` for any route, env, D1, R2 or Cron change.
2. Read `database-guidelines.md` before adding a table, field, query or migration.
3. Read `error-handling.md` and `logging-guidelines.md` before touching a trust boundary.
4. Read `quality-guidelines.md` before changing a public contract or writing tests.
5. Read `source-ingestion.md` before changing source adapters, snapshot persistence, source
   logging or live smoke behavior.
6. Check `docs/PRD-ENSO市场影响监测平台.md` and `CONTEXT.md` for product/domain semantics.

All project spec documentation is written in English. Product and domain documents may remain Chinese.
