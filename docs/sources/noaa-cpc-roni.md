# Source Spike — NOAA CPC RONI

## Decision

- Status: approved for the first automated vertical slice.
- Source ID: `noaa_cpc_roni`.
- Adapter key: `noaa-cpc-roni-v6`.
- Redistribution: `allowed`, with NOAA attribution and direct citation URL.
- Risk: HTML is a presentation surface rather than a versioned machine API, so structural drift is a first-class failure.

## Authority and access

- Owner: U.S. NOAA / National Weather Service / Climate Prediction Center (Tier A).
- Canonical page: <https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/>.
- Method announcement: <https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/announcement.php>.
- Data license reference: <https://data.noaa.gov/docucomp/xmlComponent/show/690447> (NOAA internal data CC0-1.0 component).
- Authentication: none.
- Robots/access observation: public HTTPS page, no login or Cookie required.

## Format and update behavior

- Response: small HTML document, currently `text/html; charset=UTF-8`.
- Data anchor: table `#roni-v5-table2`; one row per year and the twelve overlapping seasons `DJF` through `NDJ`.
- Coverage: 1950–present; the latest year may contain fewer than twelve cells.
- Frequency: NOAA states that the page is updated by the fifth day of each month.
- Revision: NOAA states that recent ERSSTv6 RONI values may change for up to two months; the adapter marks the latest two values `estimated`.
- HTTP cache validators observed on 2026-09-07: neither `ETag` nor `Last-Modified` was returned. The adapter still sends validators when previously available and always compares SHA-256 content hashes.
- Conservative polling: daily due check; an unchanged hash produces a run record but no new snapshot or observation.

## Automatic window and historical backfill

- The scheduled Worker parses the full page for schema validation but emits only the latest 24 seasonal observations. This covers the two-year revision horizon generously while keeping normal ingestion bounded.
- Historical 1950–present backfill is a separate, explicit maintenance job. It must use the same append-only revision rules and must not run inside the daily automatic invocation.
- Cloudflare D1 Free permits at most 50 queries per Worker invocation. The persistence adapter reads prior observations once per indicator with a bounded UTC range query. A 24-observation NOAA run uses one prior-observation query plus 26 atomic result statements; including idempotency/cursor reads and the reserved failure-record path, it stays below 50.
- All application timestamps use canonical UTC ISO-8601 with millisecond precision (`YYYY-MM-DDTHH:mm:ss.sssZ`) so lexical ranges and idempotency keys represent the same instant consistently.
- A `partial` run keeps its verified observations but does not refresh `last_success_at` or become the next HTTP/hash cursor; the source must be fetched again until a complete or unchanged-successful run is recorded.

## Field mapping

| Source field | Product field | Rule |
|---|---|---|
| Year + season column | `observed_at` | UTC date of the final month-end |
| Year + season column | `period_start` | UTC first day of the first month |
| Cell value | `value_num` | Decimal degrees Celsius |
| ERSST version label | `metadata_json.datasetVersion` | Fixed `ERSSTv6` for this adapter |
| Season label | `metadata_json.season` | One of twelve approved season codes |
| Page URL | `citation_url` | Canonical RONI page |

`published_at` remains `null` because the page does not expose an authoritative publication timestamp. Fetch time must not be substituted for publication time.

## Failure and fallback

- Missing table/season, invalid numeric cells or unexpected content type: `SCHEMA_DRIFT`, no observation writes.
- 429: `RATE_LIMIT`, retryable with common 1/5/20-minute earliest-due thresholds; the next
  15-minute dispatcher heartbeat performs the actual attempt once due.
- 5xx/network failure: `NETWORK`, retryable; ordinary 4xx is not retried blindly.
- Response above 1 MB: reject as `VALIDATION`; do not buffer an unexpectedly large page in the Worker.
- Manual fallback: retain the last verified observation, mark source health stale/broken by policy, and link the official page for researcher review.

## Fixtures and verification

- Normal: `src/worker/adapters/sources/fixtures/noaa-roni-normal.html` mirrors the official table shape with complete and partial-year rows.
- Invalid: `src/worker/adapters/sources/fixtures/noaa-roni-invalid.html` omits the table to prove schema-drift detection.
- Unchanged: contract test uses HTTP 304 and a separate same-hash 200 response.
- Live smoke tests may fetch the canonical page manually, but must not block CI.
