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

## Migrations

- Names: `NNNN_short_description.sql`.
- Migrations are additive-first and committed with compatible code.
- Constraints and uniqueness live in SQLite, not only TypeScript.
- Never edit a migration after it has reached staging; add the next migration.
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
- Source-health changes reference `changes.source_id` directly. Never attach a source-level recovery event to an arbitrary indicator merely to satisfy a foreign key.
- `audit_log` is append-only and protected by update/delete triggers.
- Daily briefs freeze exact thesis version IDs in `daily_brief_theses`.

## Common Mistakes

- Full table scans count against D1 row-read quotas: add the query index before shipping.
- SQLite foreign keys do not replace application validation of business transitions.
- Do not use missing columns to mean unknown; store nullable values explicitly and document them.
