# Worker Logging Guidelines

## Format

Log one JSON object per event with stable fields. Current Cron example is in `src/worker/index.ts`.

Required fields when applicable: `handler`, `requestId`, `runId`, `sourceId`, `thesisId`, `scheduledAt`, `durationMs`, `environment`, `outcome`, `errorCode`.

## Levels

- `console.info`: completed request/job and expected noop.
- `console.warn`: delayed source, partial result, retryable upstream failure.
- `console.error`: failed job, storage/database failure, invariant violation.
- Avoid debug logs in production unless temporarily sampled.

## Redaction

Never log Authorization, Cookie, API keys, query strings containing tokens, unrestricted upstream bodies, D1/R2 binding objects, personal data or Access JWTs.

## Behavior

- Use IDs to join logs to D1 run/audit records.
- A disabled Cron logs `enabled:false` and `outcome:"noop"` without mutation.
- Ingestion Cron logs one result per source with safe `sourceId`, `runId`, `outcome` and
  `errorCode` fields. Never include source URLs, upstream bodies, private snapshot keys or raw
  exception values.
- Public response messages and internal diagnostic logs are separate.
