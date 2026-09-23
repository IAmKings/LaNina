# Backend Directory Structure

## Layout

```text
src/
├── domain/               # Pure cross-layer contracts and business enums
└── worker/
    ├── index.ts          # Module Worker fetch/scheduled composition only
    ├── modules/          # Deep behavior: ingestion, evaluation, publishing, read model
    ├── adapters/         # External source, D1 and R2 adapters
    └── routes/           # Public/admin transport mapping
migrations/               # Ordered, additive D1 migrations
seeds/                    # Idempotent reference/domain seed SQL
```

Only create a directory when the first real file needs it. `modules`, `adapters` and `routes` do not exist in the foundation until their owning tasks begin.

## Module Rules

- `src/worker/index.ts` maps runtime events; it does not accumulate domain logic.
- Domain files cannot import Cloudflare, React or database row types.
- External payload parsing belongs to source adapters.
- SQL belongs inside the owning backend module/D1 adapter, not routes or frontend.
- Avoid one-file-per-table repositories and one-implementation interfaces.

## Naming

- Files: lowercase kebab-case except React files.
- Module interfaces: capability names such as `IngestionModule`, not `Manager` or `Helper`.
- Stable business IDs use the terms defined in `CONTEXT.md`.

## Current Examples

- Runtime composition: `src/worker/index.ts`
- Shared contract: `src/domain/contracts.ts`
- Initial schema: `migrations/0001_initial.sql`
