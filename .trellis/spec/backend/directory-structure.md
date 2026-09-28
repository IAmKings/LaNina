# Backend Directory Structure

## Layout

```text
src/
├── domain/               # Pure cross-layer contracts, business enums, internal/ shared utils
└── worker/
    ├── index.ts          # Env types, cron constants, worker export, HEAD normalization, top-level fallback
    ├── http/             # Transport mechanics: router (route table), envelope, errors, body
    ├── routes/           # Route table assembly + public/admin/discovery handlers
    ├── context.ts        # AppContext: per-env lazy singleton repos, memoized access config
    ├── scheduled.ts      # Cron task composition (handleScheduled + per-job handlers)
    ├── edge-cache.ts     # Edge cache seam for whitelisted public GETs
    ├── modules/          # Deep behavior: ingestion, evaluation, publishing, read model
    │   └── derived-indicators.ts + climatology-refresh.ts  # L0 derivation step (runs before evaluation)
    ├── adapters/         # External source, D1 and R2 adapters
    └── adapters/sources/adapter-base.ts  # Shared HTTP source adapter factory
migrations/               # Ordered, additive D1 migrations
seeds/                    # Idempotent reference/domain seed SQL
```

Only create a directory when the first real file needs it.

## Module Rules

- `src/worker/index.ts` maps runtime events; it does not accumulate domain logic. New routes are
  added to the route table in `src/worker/routes/index.ts` — never by growing index.ts.
- Route handlers go through `publicRead` / `withAdmin` higher-order wrappers; request/response
  envelopes, cache-control values and error mappings live in `http/`, not in handlers.
- Domain files cannot import Cloudflare, React or database row types.
- Domain-internal duplicated helpers (deepFreeze, compareText, parseCanonicalUtc…) live in
  `src/domain/internal/`; do not re-inline copies in domain modules.
- New HTTP source adapters extend `createHttpSourceAdapter` (`adapters/sources/adapter-base.ts`);
  adapters that genuinely need multi-request flows (jpx/unctad/census pattern) reuse its exported
  helpers instead of copying them.
- External payload parsing belongs to source adapters.
- SQL belongs inside the owning backend module/D1 adapter, not routes or frontend.
- Avoid one-file-per-table repositories and one-implementation interfaces.

## Naming

- Files: lowercase kebab-case except React files.
- Module interfaces: capability names such as `IngestionModule`, not `Manager` or `Helper`.
- Stable business IDs use the terms defined in `CONTEXT.md`.

## Current Examples

- Runtime composition: `src/worker/index.ts` (≤ ~130 lines)
- Route table: `src/worker/routes/index.ts`
- Shared contract: `src/domain/contracts.ts`
- Initial schema: `migrations/0001_initial.sql`
