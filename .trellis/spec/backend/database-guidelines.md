# D1 Database Guidelines

## Storage Contract

D1 stores normalized facts, source runs, thesis versions and audit records. R2 stores raw source bodies. Do not store large payloads in D1 JSON columns.

The authoritative initial schema is `migrations/0001_initial.sql`; product field meanings are in PRD §9.

## Query Patterns

- Parameterize every value; never interpolate external strings into SQL.
- Use a single query/batch at a module interface where possible; routes must not create N+1 reads.
- Always select explicit columns for public projections.
- Query the latest observation by `(indicator_id, observed_at DESC, revision DESC)` and exclude `quality='invalid'` explicitly.
- Inspect `EXPLAIN QUERY PLAN` for overview/detail queries before release.
- Every read that joins a growing fact table (observations, source_runs) must be bounded in SQL:
  a per-entity row cap via `ROW_NUMBER() OVER (PARTITION BY … ORDER BY … DESC)` (see
  `MAX_OBSERVATIONS_PER_INDICATOR` in `cloudflare-read-models.ts`) and/or a structural `LIMIT`
  guard. Bounding may not change current visible semantics — it caps future growth. Do not add an
  `observed_at` lower bound unless every selector is confirmed to reject older evidence.
- Freeze queries that the query-plan regression asserts as named exported constants, and pin the
  indexes they depend on in a migration (e.g. `idx_source_runs_source_status_finished`).

## Migrations

- Names: `NNNN_short_description.sql`.
- Migrations are additive-first and committed with compatible code.
- Constraints and uniqueness live in SQLite, not only TypeScript.
- Never edit a migration after it has reached staging; add the next migration.
- Trigger changes land as a new migration (`DROP TRIGGER` + `CREATE`) and the trigger body stays a
  single-layer `SELECT RAISE(...)` chain — wrangler's statement splitter fails on nested compound
  markers inside trigger bodies (see 0010 header note and 0012).
- Local verification: `npm run db:migrate:local` twice; the second run must report no migrations.

## Naming

- Tables and columns: lower snake_case, plural table names.
- Indexes: `idx_<table>_<purpose>`.
- UTC timestamps: ISO-8601 `TEXT` ending in `Z` at application boundaries.
- Boolean values: integer `0/1` with a CHECK constraint.

## Transactions and Append-only Data

- A source result must not be marked successful before required R2/D1 writes complete.
- Observations are revised with a new row and `supersedes_id`; never overwrite history.
- A retry must claim its existing `source_run` with a bounded lease token before external I/O. Every dependent retry write must verify that token in SQL so an expired or losing worker cannot mutate observations, source health or recovery facts.
- The first scheduled collection claims its slot the same way: an atomic `INSERT` of a placeholder run carrying a `retry_claim_token` (the `source_runs.status` CHECK forbids a `'running'` value, so the placeholder reuses `'failed'`). A UNIQUE conflict on `(source_id, scheduled_at)` means another worker holds the slot. Crash recovery flows through the unchanged retry path once the token expires.
- Source-health changes reference `changes.source_id` directly. Never attach a source-level recovery event to an arbitrary indicator merely to satisfy a foreign key.
- `audit_log` is append-only and protected by update/delete triggers.
- Daily briefs freeze exact thesis version IDs in `daily_brief_theses`.
- **Derived indicators** (second-order metrics computed from existing observations, e.g. rainfall
  anomaly %, USDA YoY %) are rows in `indicators` attributed to their **parent source** — the
  evaluation pipeline joins `run.source_id = indicators.source_id`, so derived and base indicators
  must share a source. The derivation step runs inside the evaluation cron **before** per-thesis
  evaluation and writes with the same append-only semantics (same `(indicator_id, observed_at)`
  unchanged → skip; changed → new revision + `supersedes_id`); any missing input is fail-closed
  (no derived row). Pure computation lives in `src/domain/derived-indicators.ts`; on a fresh
  database the migration's indicator rows are a no-op (`WHERE EXISTS` parent guard) and the seed
  layer re-inserts them after the parent sources exist — keep migration and seed rows identical.

## Common Mistakes

- Full table scans count against D1 row-read quotas: add the query index before shipping.
- SQLite foreign keys do not replace application validation of business transitions.
- Do not use missing columns to mean unknown; store nullable values explicitly and document them.
