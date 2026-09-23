# Backend Error Handling

## Public Contract

All public errors use `ApiErrorEnvelope` from `src/domain/contracts.ts`:

```json
{"error":{"code":"NOT_FOUND","message":"未找到该接口","requestId":"uuid"}}
```

Codes are stable machine identifiers; messages are safe Chinese copy. Never expose a stack, SQL, upstream body, secret, internal URL or binding name.

## Internal Categories

External ingestion uses NETWORK, RATE_LIMIT, AUTH, NOT_FOUND, SCHEMA_DRIFT, VALIDATION, STORAGE and DATABASE. Preserve the original exception only in a redacted internal log associated with request/run ID.

## Propagation

- Validate once at the trust boundary and return typed domain input.
- Catch at the runtime/job boundary where a stable public result or run status can be written.
- Do not catch merely to rethrow the same error.
- Partial ingestion is an explicit result, not an exception disguised as success.

## Current Examples

- Safe 404 and health responses: `src/worker/index.ts`.
- Contract tests: `src/worker/index.test.ts`.

## Common Mistakes

- Do not serialize `unknown` errors directly.
- Do not map every upstream 404 to a public 404; source failure and route absence are different domains.
- Do not return HTTP 200 with an error envelope.
