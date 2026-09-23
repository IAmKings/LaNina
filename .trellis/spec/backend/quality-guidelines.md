# Backend Quality Guidelines

## Required Patterns

- Strict TypeScript; no implicit `any`.
- Validate external `unknown` once at the adapter boundary.
- Keep runtime composition thin and business logic behind module interfaces.
- Preserve idempotency in database constraints and tests.
- Use Node.js 24 LTS for development and CI.
- Keep `package-lock.json` resolved against the official npm registry so optional Cloudflare runtime binaries install reproducibly in CI.

## Forbidden Patterns

- Unlicensed scraping or arbitrary admin-provided fetch URLs.
- Route code that embeds SQL, external payload parsing or thesis calculation.
- Silent catch blocks, raw exception responses or log secrets.
- Overwriting observations/audit history.
- New infrastructure or dependency without an accepted requirement.

## Testing

- Every non-trivial branch/parser gets the smallest runnable test.
- Public contract tests assert status, payload and security-relevant headers.
- Source adapters require fixed normal, unchanged and malformed fixtures. Register them through
  `defineAdapterContract` in `src/worker/adapters/sources/testing/adapter-contract.ts`; keep
  source-specific mapping assertions beside the adapter and run the suite with
  `npm run test:contract`.
- D1 migrations run on a fresh local database in CI.
- Full validation: lint, typecheck, unit/contract/integration tests and build.

## Review Checklist

- Contract matches product PRD and `src/domain` types.
- Failure and stale data behavior are observable.
- Query plan and indexes match expected access.
- UTC/Asia-Shanghai conversion occurs at the presentation/scheduling edge only.
- No private fact or draft thesis can enter a public projection.
