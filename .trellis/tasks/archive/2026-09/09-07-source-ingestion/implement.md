# Implement — 数据采集与来源适配器

## Checklist

- [x] 为所有候选来源创建 `docs/sources/*.md` Source Spike，或记录明确 coverage gap。
- [x] 冻结 CollectContext/CollectResult/ObservationInput/error types。
- [x] 实现 Ingestion、D1/R2 adapter、哈希和幂等运行。
- [x] 完成 source health、due scheduling 与 retry state。
- [x] 建立 adapter contract fixture harness。
- [x] 实现 NOAA CPC/RONI adapter 并完成本地 vertical slice。
- [x] 实现区域降水 adapter 与版本化 region definitions。
- [x] Panama Canal numeric/advisory 完成 **COVERAGE GAP / BLOCKED** 决策：ACP 书面授权、
  许可映射、API schema/terms/TLS 及公告人工审核流程未通过；授权前不得实现、注册或 seed。
- [x] 橡胶事实与合法日频市场来源完成 **COVERAGE GAP** 决策：MRB/RAOT 与
  SGX/JPX/SHFE 均未通过自动抓取、留存、派生和公开再分发许可门；无实物/日频市场 live
  adapter/seed。
- [x] 接入禁用的 USDA FAS PSD 棕榈油/玉米年度估计；MPOB/CEC/SAGIS 月度实际事实明确保持
  coverage gap。
- [x] 美东/欧线运价与航线级准班率提交 coverage gap，并接入禁用/私有的 EIA Brent 广义燃料
  控制变量；其余红海、运力、港口与需求代理 deferred。
- [x] 实现四类 Cron 的采集部分和本地模拟。
- [x] 添加 live smoke test（非 CI blocker）与结构漂移告警。
- [x] 验证快照隐私、日志脱敏和单来源失败隔离。

## Validation

```bash
npm run lint
npm run typecheck
npm test -- ingestion
npm run test:contract
npx wrangler d1 migrations apply enso-monitor-local --local
npm run test:integration -- ingestion
npm run build
```

Fixture assertions must cover duplicate, revision, partial, 429, 404, 5xx, schema drift, missing timestamp/unit and R2 failure.

Live smoke is intentionally outside the normal suite:

```bash
# Safe local noop; performs no network request.
npm run smoke:live

# Example explicit NOAA probe.
LIVE_SMOKE_ENABLED=true \
LIVE_SMOKE_SOURCE_IDS=noaa_cpc_roni \
npm run smoke:live
```

The exact allowlisted source IDs are `noaa_cpc_roni`, the four
`nasa_power_rainfall_*_v1` IDs in `REGIONAL_RAINFALL_SOURCE_CONFIGS`,
`usda_psd_malaysia_palm_oil`, `usda_psd_south_africa_corn`, and
`eia_europe_brent_spot`. USDA/EIA probes additionally require `USDA_FAS_API_KEY` or
`EIA_API_KEY` to be injected by the local/automation secret store; do not place secret values in the
command line. Selecting multiple IDs uses a comma-separated list. An upstream outage or schema
change prints a structured warning and leaves the live suite successful; an unknown/duplicate ID or
invalid local timestamp remains a failing configuration error.

## Delivery Gate

- Core NOAA → D1/R2 path passes before adding secondary adapters.
- Every production-enabled source has an approved Source Spike.
- All six theses have a recorded coverage outcome; missing data is explicit.

## Current Progress

- 2026-09-07: completed the NOAA CPC RONI Source Spike and fixture-first adapter contract.
- Implemented conditional request headers, bounded response reads, SHA-256 same-content detection, stable HTTP failure categories and ERSSTv6 seasonal normalization.
- Completed the NOAA changed/unchanged/partial vertical slice through private R2 snapshots and atomic D1 run/observation writes, including append-only revisions and free-tier query budgeting.
- Scheduled collection is intentionally limited to the latest 24 RONI observations; the full parser remains available for a separate bounded historical backfill.
- Added retry-first due scheduling, canonical cutoff advancement, bounded retry leases, 1/5/20-minute retry state and source-failure isolation.
- Added healthy/delayed/stale/broken calculation and auditable recovery facts linked directly to their source.
- Composed the code-owned NOAA allowlist registry and unified dispatcher into the four Worker
  Cron paths. The 15-minute path owns due retries and sub-hour scheduled sources; the hourly path
  owns only cadence-at-least-hourly scheduled sources, so NOAA normal runs cannot be duplicated.
- Added a strict disabled guard before binding access, explicit evaluation/publication/unknown
  no-ops, waitUntil-backed async completion and redacted per-source outcome logging.
- Added idempotent NOAA source/indicator seeds and verified local migrations and all ordered seeds
  twice.
- Added a reusable, test-only adapter contract harness for fixed normal, unchanged and invalid
  fixtures. NOAA now exercises the shared result invariants while retaining its source-specific
  mapping, bounded-window, hash and HTTP classification assertions; negative harness tests cover
  identity drift, invalid timestamps, missing units, body/hash mismatch and unstable errors.
- Added the immutable `rainfall-regions-v1` definition and NASA POWER Daily Point adapter for four
  code-owned regional proxy series. The adapter enforces a fixed 14-day UTC window, sequential
  point requests, strict response/coordinate/unit decoding, 75% equal-weight coverage, bounded
  deterministic private bundles and shared changed/unchanged/partial/error contracts.
- Registered and idempotently seeded all four v1 sources/indicators with daily cadence,
  `enabled=0` and `redistribution=derived_only`. This is fixture/local readiness only: the NASA
  policy and representativeness activation gate in the Source Spike has not passed, so production
  scheduling remains disabled.
- Completed the Panama Canal Authority Source Spike and recorded candidate Gatún CSV and
  advisory-metadata wire contracts plus their outstanding technical gates. ACP has not granted
  written permission for automated
  collection, private retention, derivative use or redistribution, so no adapter, fixture, registry
  entry, source/indicator seed or R2 workflow was added; the Panama implementation remains BLOCKED.
- Recorded Panama coverage gaps for Alhajuela level, watershed precipitation, authenticated transit
  count, booking slots, current queue and official draft values. Developer Portal OAuth
  schema/terms/TLS and 12-month availability remain unverified, and advisory titles cannot create a
  directional thesis or numeric current state. Any manual slot-reduction and later draft-postponement
  facts must remain separately citable and affect the US East thesis without automatically changing
  the Europe thesis.
- Completed the rubber physical/daily-market Source Spike as an explicit coverage gap. MRB/LGM and
  RAOT remain physical-data candidates, while SGX SICOM, JPX/OSE and SHFE/INE remain daily futures
  candidates; none currently grants the complete automation, retention, derivation and public
  redistribution rights required by this product. No adapter, fixture, registry entry, seed,
  migration, dependency or R2 snapshot workflow was added, and no live rubber physical/daily-market
  coverage is claimed. The disabled southern-Thailand rainfall series remains a weather proxy only.
- Recorded World Bank monthly RSS3/TSR20 as a low-frequency review candidate only. It cannot satisfy
  daily-market monitoring or physical-supply confirmation and receives no XLSX adapter in this task.
  Activation requires written rights, a supported machine contract, timezone/unit/grade/contract and
  revision rules, recent-history availability, continuous smoke checks, and legal/product/editorial
  approval. Until then, editors may add only individually cited official facts with manual quality
  marking; the product must not scrape pages, republish restricted datasets, or infer physical supply
  from futures alone.
- Added the reusable `usda-fas-psd-v1` adapter for two code-owned sources and six selected
  production/exports/ending-stocks indicators. It derives Malaysia October–September and South
  Africa May–April marketing years from `scheduledAt` UTC, enforces the fixed owner endpoint,
  64 KiB JSON boundary, strict identity/type/unit/month decoding, partial selected-attribute output,
  conditional validators and SHA-256 unchanged detection.
- Added optional `USDA_FAS_API_KEY` Worker-secret composition. The key is captured by the adapter
  factory and sent only as `X-Api-Key`; missing keys and 401/403 are non-retryable AUTH, while
  429 and network/5xx remain retryable. Disabled/evaluation/publication/unknown Cron no-op paths
  still return before binding or secret access.
- Added two disabled, `derived_only`, daily-polled source seeds and six private (`public=0`) monthly-
  release estimate indicators. Synthetic fixtures and shared adapter-contract tests cover normal,
  same-hash unchanged and invalid inputs; source-specific tests cover 304, both market-year cutovers,
  partial rows, identity/unit/month/type drift, duplicate attributes, illegal values, HTTP/network
  classification, oversize responses, URL allowlisting and secret non-disclosure.
- MPOB monthly actuals, South African CEC forecasts/finals and SAGIS flows remain explicit coverage
  gaps. USDA marketing-year estimates do not close or rename those gaps; no MPOB/CEC/SAGIS/FAO
  adapter, credential, production enablement or remote operation was added.
- Completed the US East Coast/Europe route-market and control-variable Source Spike. Asia—US East
  and Asia—Europe freight rates and route-level schedule reliability remain explicit coverage gaps:
  SCFI/CCFI, FBX, WCI, XSI-C and GLP do not provide the free licensed machine contract required for
  this product. No scraper, dashboard reverse engineering, paid credential, carrier schedule or
  runtime adapter was added, and both route-thesis confidence values remain capped at 59 until a
  licensed route observation exists.
- Added the disabled `eia-petroleum-spot-v1` adapter and private daily RBRTE indicator as a broad
  fuel-input control only. It requests a code-owned 55-calendar-day inclusive window with at most
  40 rows and 64 KiB, validates the frozen EIA v2 envelope, identity, unit, dates, ordering, totals
  and warnings, and uses SHA-256 content equality for unchanged runs. `EIA_API_KEY` is injected only
  through a factory closure and placed only in the request-time query; it is excluded from source
  configuration, results, raw snapshots, fixtures and stable errors.
- Seeded the EIA source as `enabled=0`, `redistribution=derived_only` and its indicator as `public=0`.
  It must not be called bunker fuel, a carrier surcharge or a route rate. UKMTO/JMIC/MARAD/SCA event
  metadata and UNCTAD/Eurostat/Port NY-NJ/Census structural controls remain manual/future candidates
  without a runtime adapter in this slice.
- Added an independent, explicitly opt-in live-smoke suite. `npm run smoke:live` is a safe noop by
  default; network access requires both `LIVE_SMOKE_ENABLED=true` and an exact comma-separated
  `LIVE_SMOKE_SOURCE_IDS` allowlist selection. Credentialed USDA/EIA targets are skipped unless the
  matching process secret is present, and NOAA/NASA are never selected implicitly. The normal test
  suite excludes the live file, and neither build nor Cron imports or executes the live runner.
- Live smoke calls each existing adapter contract directly with injected timestamps/fetch and no
  D1/R2 dependency. A source result is emitted as structured `ok` or non-blocking `warning`;
  `SCHEMA_DRIFT`, NETWORK and all other adapter failures use stable error codes and do not stop the
  next source. Unknown/duplicate source IDs remain fail-closed configuration errors. Live fetches
  have a fixed timeout, and no request URL/query, headers, response body, secret or raw exception is
  included in the report or logger fields.
- Completed local security assertions for snapshot and logs. R2 keys and put metadata have exact
  safe field sets, content-type parameters and response bytes cannot become key/metadata, and every
  Wrangler environment exposes RAW only as a bucket binding without a public URL/ACL field. Cron and
  live-smoke logs have negative assertions for URL/query, Authorization, Cookie, private snapshot
  keys and upstream exception/body text. Dispatcher and live-smoke tests both prove that one source
  failure does not block later sources. Remote Cloudflare bucket access settings and three
  consecutive provisioned live runs remain activation-time operational checks, not claims made by
  fixture tests.

## Rollback

Disable a faulty source via D1 configuration; keep the common ingestion module running. Adapter rollback must not delete observations or snapshots. Incorrect facts are marked invalid/revised through a forward change.
