# Source Spike — 区域降水（NASA POWER）

## Decision

- Status: adapter/fixture implementation approved; production scheduling not approved yet.
- Seed policy: `enabled=0`, `redistribution=derived_only`.
- Primary source: NASA Langley POWER Daily Point API.
- Parameter: `PRECTOTCORR`, Agroclimatology community, metric output, UTC.
- Adapter key: `nasa-power-regional-rainfall-v1`.
- Region-definition version: `rainfall-regions-v1`.
- Review date: 2026-09-08.

The P0 implementation will fetch a small, code-owned set of points for each region and publish
only a derived regional daily mean. It will not download a global raster and will not expose raw
NASA responses from private R2.

## Why NASA POWER

NASA documents the Daily API as analysis-ready daily data intended for direct application use.
The API supports JSON, UTC, daily meteorological parameters and a point endpoint that requires no
API key. The official OpenAPI contract currently reports API version `v2.9.7` and defines
conventional 422, 429, 500 and 503 responses.

- Daily API: <https://power.larc.nasa.gov/docs/services/api/temporal/daily/>
- OpenAPI: <https://power.larc.nasa.gov/api/temporal/daily/openapi.json>
- Data FAQ: <https://power.larc.nasa.gov/docs/faqs/data/>
- Parameter dictionary: <https://power.larc.nasa.gov/parameters/>
- Referencing guide: <https://power.larc.nasa.gov/docs/referencing/>

The regional endpoint is technically viable and the official Data Access Viewer documents a
10° × 10° regional limit. P0 nevertheless uses fixed point samples because they produce smaller,
more predictable payloads and let the definition target production/catchment proxies rather than
including every ocean or unrelated grid cell in a coarse rectangle.

- Regional/DAV limit: <https://power.larc.nasa.gov/docs/tutorials/data-access-viewer/user-guide/>

## Access, authentication and policy

- Authentication: none documented for the POWER Daily API.
- Cookie/login: none required by the documented endpoint.
- Request style: synchronous HTTPS GET.
- Official attribution: publications should name POWER, service version and access date.
- Redistribution: the POWER guide requests notification when data is transmitted to other
  researchers, but it does not provide a conventional software/data license on that page.
- Conservative public policy: store response bundles privately and expose only derived regional
  statistics plus attribution and links; therefore `redistribution=derived_only`.

Policy ambiguity remains: the current `https://power.larc.nasa.gov/robots.txt` disallows `/api/`
for web crawlers, while NASA's API documentation and tutorials explicitly describe programmatic
API integration. The platform must obtain written clarification from the POWER contact before
changing these sources to `enabled=1`. API accessibility alone is not approval.

Contact from the official OpenAPI/referencing material: `larc-power-project@mail.nasa.gov`.

## API request contract

Base URL:

```text
https://power.larc.nasa.gov/api/temporal/daily/point
```

The adapter constructs every query in code; D1 cannot supply arbitrary coordinates, parameters
or hosts.

```text
parameters=PRECTOTCORR
community=AG
latitude={code-owned latitude}
longitude={code-owned longitude}
start={YYYYMMDD}
end={YYYYMMDD}
format=JSON
time-standard=UTC
```

P0 requests a rolling 14-day window ending three UTC calendar days before `fetchedAt`, matching
NASA's published 2–3 day meteorological latency. The adapter must still treat the actual response
as authoritative because parameter-level availability can lag the service configuration date.

## Observed response shape

A live 4° × 4° regional probe on 2026-09-08 confirmed the documented response concepts:

- point/grid features contain `[longitude, latitude, elevation]` coordinates;
- `properties.parameter.PRECTOTCORR` maps `YYYYMMDD` to a number;
- `header.fill_value` was `-999.0`;
- `parameters.PRECTOTCORR.units` was `mm/day`;
- `header.time_standard` was `UTC`;
- the response reported API `v2.9.7` and source `GEOSIT`.

The configuration endpoint reported an archive end of 2026-09-08, but the sampled precipitation
response contained valid values through 2026-08-31 and `-999` on 2026-09-01. Therefore the
adapter must never infer precipitation availability from the configuration endpoint alone.

- Configuration endpoint: <https://power.larc.nasa.gov/api/temporal/daily/configuration>

## Versioned v1 region definitions

These are deliberately labelled proxy samples, not administrative boundaries, crop-area masks or
hydrological polygons. Every point has equal weight in v1. A definition change creates a new
definition version and new indicator IDs; it must not revise observations under the old series.

### `southern_thailand_rubber_v1`

| Point | Latitude | Longitude | Proxy |
|---|---:|---:|---|
| `st01` | 9.14 | 99.33 | Surat Thani rubber belt |
| `st02` | 8.43 | 99.96 | Nakhon Si Thammarat |
| `st03` | 7.19 | 100.60 | Songkhla |
| `st04` | 6.43 | 101.82 | Narathiwat |

### `maritime_continent_palm_v1`

| Point | Latitude | Longitude | Proxy |
|---|---:|---:|---|
| `mc01` | 3.14 | 101.69 | Peninsular Malaysia |
| `mc02` | 0.51 | 101.45 | Riau/Sumatra |
| `mc03` | -2.21 | 113.92 | Central Kalimantan |
| `mc04` | 0.13 | 109.33 | West Kalimantan |
| `mc05` | 5.98 | 116.07 | Sabah |

This is an oil-palm exposure proxy, not full geographic coverage of the Maritime Continent.

### `southern_africa_maize_v1`

| Point | Latitude | Longitude | Proxy |
|---|---:|---:|---|
| `sa01` | -28.45 | 26.80 | South Africa Free State |
| `sa02` | -26.00 | 29.50 | South Africa Mpumalanga |
| `sa03` | -17.82 | 31.05 | Zimbabwe maize zone proxy |
| `sa04` | -15.42 | 28.28 | Zambia maize zone proxy |
| `sa05` | -13.96 | 33.77 | Malawi maize zone proxy |

### `panama_canal_catchment_v1`

| Point | Latitude | Longitude | Proxy |
|---|---:|---:|---|
| `pc01` | 9.26 | -79.92 | Gatún catchment proxy |
| `pc02` | 9.21 | -79.58 | Alhajuela/Madden catchment proxy |
| `pc03` | 9.00 | -79.65 | Pacific-side corridor proxy |

This is not an official Panama Canal watershed polygon. Panama Canal Authority rainfall and lake
levels remain the required first-party cross-check in the next source slice.

## Normalization and aggregation

For every response:

1. Require JSON, the expected point coordinates, `PRECTOTCORR`, `mm/day`, UTC and a numeric fill
   value.
2. Treat the declared fill value and non-finite/negative precipitation as missing.
3. Group the same UTC date across all points in the region.
4. Emit a regional mean only when at least 75% of configured points are valid.
5. Store `validPointCount`, `totalPointCount`, `coverageRatio`, definition ID/version, method,
   API version and source name in observation metadata.
6. Round only the published derived value to four decimals; retain the raw response bundle.

Output unit is exactly `mm/day`. Daily observations use `00:00:00.000Z` for both `periodStart`
and `observedAt`. Values are `provisional`: POWER inputs and recent values may be revised, and the
source does not expose a per-value publication timestamp.

If some requested days fail the coverage threshold but at least one day is usable, return
`partial` with explicit warnings. If no date is usable, reject the run as `VALIDATION`. A malformed
shape, coordinate mismatch or unit change is `SCHEMA_DRIFT`.

## Snapshot, hash and conditional requests

Each regional run makes three to five point requests sequentially, remaining below the Workers
six-simultaneous-connection limit. The adapter stores a deterministic private JSON bundle with:

- bundle schema/version;
- definition ID/version;
- exact request URL for each code-owned point;
- exact UTF-8 response body for each point.

SHA-256 is calculated over that bundle. If it matches `previousContentHash`, the result is
`unchanged`. ETag and Last-Modified cannot safely represent several point responses and are not
used unless NASA later documents a stable aggregate validator.

## Resource budget

- Requests per source run: 3–5 sequential GETs.
- Date window: 14 days.
- Parameters per request: 1.
- Maximum accepted point response: 128 KiB.
- Maximum bundled raw snapshot: 1 MiB.
- Expected normal bundle: tens of KiB, not a global raster.
- Expected observations per run: at most 14, within the existing D1 query budget.
- Cron group after approval: daily cadence in the hourly dispatcher.

## Revision and freshness

- NASA documents daily meteorological availability from 1981 to near real time.
- The official FAQ gives a collective meteorological latency of 2–3 days.
- POWER derives meteorological data from NASA GMAO products; it is not a rain-gauge-only series.
- A later value for the same region definition and UTC date becomes a new observation revision.
- Source health measures collection success; evaluation must separately check the newest
  observation date so a healthy API cannot disguise stale precipitation.

## Failure and fallback

| Condition | Handling |
|---|---|
| 408/5xx/network | retryable `NETWORK` |
| 429 | retryable `RATE_LIMIT` |
| 401/403 | non-retryable `AUTH` |
| 404 | non-retryable `NOT_FOUND` |
| 422 or invalid configured request | non-retryable `VALIDATION` |
| JSON/coordinate/unit drift | non-retryable `SCHEMA_DRIFT` |
| partial point/day coverage | `partial`; do not silently reweight below 75% |

Manual fallback: an editor may use the official POWER viewer to recompute the exact v1 points and
aggregation, with the dated inputs and calculation attached to the audit record. A statistic using
different points, boundaries or weighting must use a separate indicator/definition version rather
than enter this automatic series. Accepted manual values use `quality=manual`.

## Alternatives reviewed

### ClimateSERV / CHIRPS

ClimateSERV officially supports polygon statistics and documents CHIRPS/IMERG datasets, but its
workflow is asynchronous (`submitDataRequest` → poll → retrieve). A 2026-09-08 availability probe
for a 2025-09-01–2026-09-01 interval returned data only through 2026-07-31, and the response did
not expose a stable dataset version suitable for the current daily SLO. Keep it as a manual or
future secondary validation source, not the P0 scheduled source.

- Official developer API: <https://climateserv.servirglobal.net/develop-api>
- Official help/metadata: <https://climateserv.servirglobal.net/help>

### IRI Data Library

IRI can perform server-side slicing, but the owning institution states that the current Data
Library will most likely shut down by the end of October 2026, possibly earlier. It is unsuitable
for a new production dependency.

- Official sunset notice: <https://iri.columbia.edu/resources/data-library/sunset/>

## Activation gate

Keep every regional source disabled until all of the following are recorded:

1. Written clarification from NASA POWER on automated API access despite the robots rule.
2. Confirmation that derived public statistics with attribution fit the intended use.
3. Three consecutive daily live smoke runs with bounded response sizes.
4. A 12-month monthly-point availability sample for every configured point.
5. Review of point representativeness by the research editor.
6. A visible coverage-gap label until Panama Canal Authority and sector-specific weather sources
   provide independent confirmation.

Until this gate passes, fixtures and local/manual runs are allowed, but production Cron must not
collect these sources.
