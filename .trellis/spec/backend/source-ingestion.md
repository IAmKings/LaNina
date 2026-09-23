# Source Ingestion Contract

## Scenario: Private ingestion and opt-in live source smoke

### 1. Scope / Trigger

Read this scenario when adding or changing a source adapter, registry entry, Worker source secret,
raw R2 snapshot, source log, dispatcher isolation behavior or live source check.

### 2. Signatures

```ts
export interface SourceAdapter {
  key: string;
  collect(context: CollectContext): Promise<CollectResult>;
}

export async function runSourceIngestion(
  request: RunSourceRequest,
  dependencies: RunSourceDependencies,
): Promise<RunSourceOutcome>;

export async function runLiveSmoke(
  request: RunLiveSmokeRequest,
): Promise<LiveSmokeReport>;
```

The explicit operator command is:

```text
npm run smoke:live
```

### 3. Contracts

- Adapter URLs, source IDs and adapter keys are code-owned allowlists. D1 or operator input must
  never introduce an arbitrary fetch URL.
- Source credentials are optional Worker/process secrets captured by adapter factories. A secret
  may enter the exact upstream authentication field only; it must not enter source configuration,
  results, D1, R2, fixtures, errors or logs.
- Raw response bodies are written only through `RawSnapshotStore`. R2 keys are content-addressed
  under `raw/{sourceId}/...`; custom metadata contains only `sourceId` and `contentHash`, and HTTP
  metadata contains only a normalized allowlisted media type.
- `npm run smoke:live` is a safe no-op unless `LIVE_SMOKE_ENABLED=true` and
  `LIVE_SMOKE_SOURCE_IDS` contains exact comma-separated allowlisted IDs. Credentialed targets are
  skipped without a network call when their secret is absent.
- Live smoke calls adapter `collect` directly with injected time and fetch. It never touches D1/R2,
  source health, retry state or scheduling cursors, and it never persists `rawBody`.
- Upstream failures are per-source non-blocking warnings. Local configuration errors such as an
  unknown/duplicate source ID or invalid canonical UTC timestamp fail closed before collection.
- Normal tests, builds and Worker Cron paths do not import or run the live suite. A dedicated
  Vitest config owns `*.live.test.ts`; the default config excludes those files.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Same ETag/content hash | `unchanged`; no new observation or R2 object |
| Changed value for an existing period | Append a revision with `supersedes_id` |
| Adapter `SCHEMA_DRIFT` in production | Safe failed run, non-retryable, source becomes observable as broken |
| Adapter/network failure in live smoke | Structured warning; continue the next selected source; command remains successful |
| Ordinary unknown exception in live smoke | Safe `VALIDATION` warning without raw exception text |
| Unknown or duplicate live source ID | Configuration failure before any fetch |
| Credentialed live source without secret | Safe skipped result; no fetch |
| Invalid smoke timestamp | Configuration failure before adapter collection/fetch |
| R2 failure | `STORAGE`; run cannot be marked successful |

### 5. Good/Base/Bad Cases

- Good: an explicitly selected NOAA smoke run validates the current upstream shape, emits only
  `handler`, `sourceId`, `outcome` and `errorCode`, and writes nothing.
- Base: `npm run smoke:live` without activation variables emits one structured no-op and performs
  no network request.
- Bad: a normal unit test imports a live test, a smoke runner reads source URLs from D1, an upstream
  exception is serialized, or a query credential appears in a snapshot key/metadata.

### 6. Tests Required

- Every adapter registers normal, unchanged and malformed fixtures through the shared adapter
  contract harness.
- Ingestion tests assert hash/ETag idempotency, append-only revision, R2 failure, safe persisted
  error text and exact snapshot key/metadata fields.
- Dispatcher tests use an observable second adapter to prove one failed source does not stop later
  candidates.
- Live smoke tests cover default no-op, explicit selection, missing credentials, unknown/duplicate
  IDs, invalid UTC, `SCHEMA_DRIFT`, network failure and ordinary exceptions.
- Negative assertions cover URL/query, Authorization, Cookie, secret values, raw response text,
  snapshot keys, content hashes and raw exception messages in live/Cron logs and reports.

### 7. Wrong vs Correct

#### Wrong

```ts
console.warn(JSON.stringify({ sourceUrl, error, rawBody }));
await snapshots.put(rawBody);
```

#### Correct

```ts
console.warn(JSON.stringify({
  handler: "live_smoke.source",
  sourceId,
  outcome: "warning",
  errorCode: safeSourceErrorCode(error),
}));
```

The correct smoke path reports contract health without becoming a second ingestion path.
