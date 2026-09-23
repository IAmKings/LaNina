# Source Spike — 棕榈油与南部非洲玉米事实

## Decision

- Review date: 2026-09-08.
- Status: **USDA FAS PSD is activation-ready for one bounded adapter; national monthly facts retain
  explicit coverage gaps**.
- Approved scope: the official FAS Open Data PSD API may provide USDA marketing-year estimates for
  Malaysian palm oil and South African corn. It is an owner-documented programmatic interface for
  publicly available commodity data, requires a free `api.data.gov` key, returns compact JSON and
  exposes release-month/revision metadata.
- Not approved as substitutes: USDA marketing-year forecasts must not be named MPOB monthly actuals,
  Malaysian physical stock movements, South African CEC forecasts, SAGIS deliveries, or domestic
  maize prices. Those are distinct facts with separate owners and rights.
- MPOB monthly production/stocks/exports, South African CEC releases and SAGIS flows remain disabled
  until a supported machine contract and rights for automated fetch, private retention, derivation
  and public display/redistribution are recorded. Do not scrape their HTML, PDF or frontend calls.
- FAOSTAT is a lawful machine-readable annual cross-check under its database terms, but is too slow
  for the current monitoring thesis. GIEWS/FPMA is timely and useful editorial evidence, but no
  documented stable public data endpoint for the selected series was verified in this Spike.

This decision enables a narrow, honest first implementation: USDA's own estimated production,
exports and ending stocks can be revision-tracked, while the product continues to show that monthly
national physical confirmation is missing.

## Candidate matrix

| Owner/source | Fact and frequency | Machine form/access | Rights result | Decision |
|---|---|---|---|---|
| USDA FAS PSD Open Data | Country/commodity marketing-year production, supply and distribution estimates; generally updated with monthly USDA releases | Documented JSON REST API; free `api.data.gov` key | FAS explicitly offers programmatic access to publicly available data; USDA information is normally public-domain, with attribution/no-endorsement and third-party exceptions observed | Activation-ready, initially disabled pending production key and live smoke |
| USDA WASDE | Monthly official U.S./world forecasts; current report at 12:00 p.m. ET | XML, XLS, text and PDF; consolidated historical CSV is refreshed the following day | U.S. Government publication; public access. File discovery and much larger payload are less bounded than PSD | Citation/manual fallback; PSD is the runtime contract |
| MPOB | Malaysia monthly actual production, stocks and exports | Official monthly publication/table surfaces; machine and rights outcome recorded below | Public viewing is not sufficient evidence of automated bulk reuse/redistribution | National monthly palm-oil coverage gap |
| South Africa CEC / Department of Agriculture | Repeated area and production forecasts, final estimate; 15:30 South Africa time from 27 Jan 2026 | Official HTML index plus report PDFs; no supported JSON/CSV API located | Department pages assert copyright; no product-specific automated reuse grant located | National forecast coverage gap; manual citation only |
| SAGIS NPC | Weekly/monthly deliveries, imports/exports, stocks and supply/demand | Public XLS/XLSX files linked from HTML; no auth | SAGIS, not CEC/Department, owns the data surface; no open-data licence or automation/redistribution grant located | Physical-flow coverage gap pending written permission |
| FAO GIEWS/FPMA | Monthly/weekly domestic and international food price series and narrative warnings | Official interactive tool/download; no documented stable selected-series API verified | FPMA is listed under FAO statistical database terms, but underlying national contributors may retain third-party rights | Editorial corroboration only until series metadata and endpoint are frozen |
| FAOSTAT | Annual crop production/area/yield and other statistics | Official API/bulk JSON/CSV, free | CC BY 4.0 plus database terms; dataset metadata may identify third-party restrictions | Lawful low-frequency cross-check, not a P0 live adapter |

## 1. USDA FAS PSD — bounded adapter contract

### Authority, access and rights

- FAS database catalogue: <https://fas.usda.gov/data/databases-applications>
- Open Data API portal and Swagger contract:
  <https://apps.fas.usda.gov/opendatawebV2/>
- PSD interactive/download service: <https://apps.fas.usda.gov/psdonline/>
- `api.data.gov` key and rate-limit contract:
  <https://api.data.gov/docs/developer-manual/>
- USDA digital rights example/policy: <https://dts.fsa.usda.gov/help/policies-and-links/index>
- U.S. Government-work rule: <https://www.govinfo.gov/content/pkg/USCODE-2023-title17/pdf/USCODE-2023-title17-chap1-sec105.pdf>

The FAS portal says the API is for programmatic access to publicly available ESR, GATS and PSD
commodity data. A key is obtained from `api.data.gov`; the application must send it in
`X-Api-Key`, store it as a Cloudflare secret and never place it in a URL, log, source row, snapshot
or fixture. `api.data.gov` documents a default 1,000 requests/hour but warns that an agency can set
a different service limit. A live `DEMO_KEY` probe on the review date returned
`X-RateLimit-Limit: 10`; the production adapter must obey the headers actually returned and must not
assume the generic default.

USDA policy says public-domain information may be distributed or copied with appropriate credit,
while separately labelled third-party material keeps its own rights. PSD rows are official USDA
estimates delivered by the FAS API, not copied GAIN narrative or logos. The implementation should
attribute `USDA Foreign Agricultural Service, Production, Supply and Distribution` and must not
imply USDA endorsement. Initial source rows should use `redistribution=derived_only` until the
product/legal review records whether exact API rows will be exposed outside the United States;
private retention and derived internal use are allowed by the documented programmatic/public-data
purpose. Do not display USDA or FAS seals.

### Fixed requests and identifiers

Base URL: `https://api.fas.usda.gov`. Only the following fixed templates are allowed:

```text
GET /api/psd/commodity/4243000/country/MY/year/{marketYear}
GET /api/psd/commodity/0440000/country/SF/year/{marketYear}
X-Api-Key: <Cloudflare secret>
Accept: application/json
```

Reference endpoints used to freeze the code-owned IDs are:

```text
GET /api/psd/commodities
GET /api/psd/countries
GET /api/psd/commodityAttributes
GET /api/psd/unitsOfMeasure
```

They confirmed these identities on 2026-09-08:

| Dimension | Code | Meaning |
|---|---:|---|
| commodity | `4243000` | Oil, Palm |
| commodity | `0440000` | Corn |
| country | `MY` | Malaysia |
| country | `SF` | South Africa (`gencCode=ZAF`) |
| country warning | `ZA` | Zambia, **not** South Africa |
| attribute | `28` | Production |
| attribute | `88` | Exports |
| attribute | `176` | Ending Stocks |
| unit | `8` | 1,000 metric tonnes (`1000 MT`) |

The minimal v1 emits only these six indicators:

```text
usda_psd_malaysia_palm_oil_production_1000mt
usda_psd_malaysia_palm_oil_exports_1000mt
usda_psd_malaysia_palm_oil_ending_stocks_1000mt
usda_psd_south_africa_corn_production_1000mt
usda_psd_south_africa_corn_exports_1000mt
usda_psd_south_africa_corn_ending_stocks_1000mt
```

Do not infer monthly values by dividing the marketing-year value. Other returned attributes such as
area, imports, domestic consumption and yield are validated but ignored in v1.

### Response shape and measured budget

The country/year endpoint returns a JSON array with one row per attribute:

```json
{
  "commodityCode": "0440000",
  "countryCode": "SF",
  "marketYear": "2026",
  "calendarYear": "2026",
  "month": "08",
  "attributeId": 28,
  "unitId": 8,
  "value": 16500.0
}
```

On 2026-09-08 the Malaysia palm-oil response was 1,930 bytes and the South Africa corn response was
2,220 bytes. Both were `application/json; charset=utf-8`. The endpoint returned no `ETag`,
`Last-Modified` or `Cache-Control`; it did return `Age`, `X-Cache`, `X-RateLimit-Limit` and
`X-RateLimit-Remaining`. `HEAD` returned 405 with `Allow: GET`. `robots.txt` returned a structured
404; because this is an expressly documented API, absence of a robots file is not used as either a
permission grant or denial.

Runtime guardrails:

- one fixed country/commodity/year GET per source run, sequential within the common dispatcher;
- 64 KiB maximum response per GET and `application/json` only;
- exact raw response stays in private R2, below 64 KiB; two sources and two active market years are
  less than 256 KiB per changed monthly cycle before object overhead;
- no call to `/dataReleaseDates` in scheduled collection: a probe returned about 819 KiB because it
  includes commodity history across countries/years, which is unnecessary and too broad;
- daily polling after `18:00Z` is sufficient to catch either 12:00 ET standard- or daylight-time
  releases; unchanged SHA-256 produces no snapshot/observation. The monthly schedule is not encoded
  as a brittle day-of-month rule.

### Time, revision, unit and missing-data semantics

The current response exposes only release `calendarYear` and two-digit `month`, not an exact release
day, clock time or timezone. Therefore:

- `publishedAt` and `sourcePublishedAt` remain `null`; fetch time must never be substituted;
- `calendarYear`/`month` are retained as `metadata.releaseYear` and `metadata.releaseMonth`;
- `quality=estimated`, because these are forecasts/estimates subject to revision;
- Malaysia palm oil market year is October–September; `periodStart` is 1 October and `observedAt`
  is 30 September of the following calendar year;
- South Africa corn market year is May–April; `periodStart` is 1 May and `observedAt` is 30 April
  of the following calendar year;
- unit ID `8` stays `1000 MT`; do not silently multiply to tonnes in the source indicator;
- missing one of attributes 28/88/176 makes the run `partial`; missing/duplicate identity rows,
  unknown unit, non-finite/negative values, inconsistent commodity/country/year, invalid month or
  changed field types are `SCHEMA_DRIFT`/`VALIDATION` and write no invalid observation;
- a changed content hash for the same indicator and market-year end is an append-only revision.
  Same-month corrections are detected by content hash even if `calendarYear`/`month` do not change.

USDA states PSD values can be revised for multiple years. The API contains data for most commodities
since 1960, and current 2025/2026 market-year rows plus monthly release metadata were observed, so
recent source availability is sufficient for a forward-running adapter. The API does not preserve
every historical monthly vintage; the product can only promise revision history collected after its
own activation. A separate bounded backfill may fetch one country/year at a time, never the all-
country or full-release-history payload inside Cron.

- FAS palm-oil production page: <https://www.fas.usda.gov/data/production/commodity/4243000>
- Official Malaysia market-year explanation (October–September):
  <https://ipad.fas.usda.gov/highlights/2012/12/Malaysia/index.htm>
- Official grain circular documenting South Africa corn May–April and metric-ton conventions:
  <https://apps.fas.usda.gov/PSDOnline/Circulars/2025/02/Grain.pdf>

### Seed, fixture and activation plan

Create two source rows, not one mixed source, so failures and health stay isolated:

```text
usda_psd_malaysia_palm_oil   adapter=usda-fas-psd-v1   cadence=1440   enabled=0
usda_psd_south_africa_corn  adapter=usda-fas-psd-v1   cadence=1440   enabled=0
```

Both start as `redistribution=derived_only`; the six indicators start public only after the public-
display rights review. The production activation gate is: real key stored as a Worker secret,
current-key rate limit observed, three consecutive live smoke runs, response/identity/market-year
checks passing, and product/legal approval of attribution plus international exact-value display.

Fixtures should be small synthetic JSON arrays shaped like the observed response, containing all
three selected attributes and harmless ignored attributes. Contract tests must cover normal,
same-hash unchanged, 304 if ever supported, partial missing attribute, wrong `SF`/`MY`, the `ZA`
country-code trap, duplicate attribute, wrong unit, invalid month/value, 401/403, 404, 429, 5xx,
oversize body and schema drift. The adapter must never include an API key in fixture snapshots or
error messages.

### Failures and manual fallback

- missing/invalid key or 401/403: `AUTH`, no retry loop; keep source disabled until provisioning is
  corrected;
- 429: `RATE_LIMIT`, obey `Retry-After` if present plus the common bounded retry policy;
- network/5xx: retryable `NETWORK`; 404 is `NOT_FOUND` and requires code/market-year review;
- unexpected content type/shape: `SCHEMA_DRIFT`; oversize/invalid numeric data: `VALIDATION`;
- retain last verified estimate and mark source delayed/stale. Editors may cite the current PSD or
  WASDE release; they must label the fact as a USDA estimate and record marketing year/unit.

## 2. USDA WASDE — release reference, not the selected wire

- Official report/release schedule:
  <https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report>
- Official archive: <https://esmis.nal.usda.gov/publication/world-agricultural-supply-and-demand-estimates>

USDA publishes WASDE monthly at 12:00 p.m. ET and offers each current report in PDF, XML, Excel and
text. The consolidated 2010–2025 CSV is updated the day after release. An official May 2026 archive
entry shows that a report may be reposted with corrections, confirming that file hash/version
changes must be treated as revisions rather than overwritten.

WASDE is not selected for v1 runtime because the current XML is a multi-table report (an observed
official archive entry was about 1.93 MiB), release asset URLs change, and mapping one country/
commodity is less stable than the filtered PSD API. It remains the authoritative release calendar
and a manual citation/fallback, not a second independently confirming dataset.

## 3. MPOB monthly Malaysian palm-oil facts

MPOB is the required owner for Malaysian monthly actual crude palm-oil production, stocks and
exports. These must remain distinct from USDA's October–September forecast. The official Economics
and Industry Development Division (EID) exposes real XLSX annual tables without authentication;
removing `&excel=Y` from the same URLs returns HTML. The stable candidates are:

| Fact | 2025 table | 2026 table | Required row/unit |
|---|---|---|---|
| CPO production | <https://bepi.mpob.gov.my/stat/web_report1.php?val=202544&excel=Y> | <https://bepi.mpob.gov.my/stat/web_report1.php?val=202644&excel=Y> | CPO production, tonnes |
| Closing stocks | <https://bepi.mpob.gov.my/stat/web_report1.php?val=202511&excel=Y> | <https://bepi.mpob.gov.my/stat/web_report1.php?val=202611&excel=Y> | detailed closing-stock total, tonnes |
| Exports | <https://bepi.mpob.gov.my/stat/web_report1.php?val=202534&excel=Y> | <https://bepi.mpob.gov.my/stat/web_report1.php?val=202634&excel=Y> | `PALM OIL` + `Tonnes`, not `TOTAL` or `RM Mil` |

Six live probes returned OOXML workbooks with
`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and attachment
name `mpobdownload.xlsx`. The year tables cover 2025-08 through 2026-07, the complete recent
12-month window at review. The current official August release was scheduled for 2026-09-10.

- EID home and schedule: <https://bepi.mpob.gov.my/>
- MPOB client charter: <https://mpob.gov.my/corporate-info/>
- July 2026 monthly summary:
  <https://bepi.mpob.gov.my/stat/web_report1.php?val=202675&val1=07>
- 2025 overview fallback: <https://bepi.mpob.gov.my/images/overview/Overview2025.pdf>
- EID copyright: <https://bepi.mpob.gov.my/index.php/import/332-copyright>
- MPOB subscription-price notice:
  <https://bepi.mpob.gov.my/pdf/2025/NOTIS%20CAJ%20DATA%20LANGGANAN.pdf>

EID states monthly publication at 12:30 and the client charter narrows the service window to
12:30–12:45. The pages do not state a timezone. `Asia/Kuala_Lumpur`/MYT (UTC+08) is a reasonable
operational inference but must not become a production contract until MPOB confirms it.

The monthly summary marks the current month preliminary `(p)` and the previous month revised `(r)`;
MPOB explains revisions through licensee corrections and Customs forms received after the release-
day 10:00 cutoff. Future blank/nbsp month cells mean missing, never zero. In July 2026 the detailed
stock table and monthly summary differed by one tonne, so any future adapter must use the detailed
annual table as its canonical series and raise a cross-check warning rather than silently reconcile
the two publications.

Technical probes found no `ETag` or `Last-Modified`. XLSX responses used
`Cache-Control: max-age=0`; HTML supplied no cache validator. `robots.txt` returned 404, which does
not grant permission. The six workbooks are only tens of KiB each: a monthly pull of current/prior
year production, stock and export tables would remain below 100 GETs including bounded retries and
far below 0.1 GB/year in R2. The technical wire is therefore Worker-safe, but it is not rights-safe.

The official copyright page reserves all rights and says data/content may not be republished in
whole or part without prior consent from MPOB's Director-General. The official price notice,
effective 24 May 2025, also treats planted area, production, yield, stock and export data as paid
data: RM0.10/cell, RM50 minimum and a 15% Excel surcharge, with public, consultant, financial,
government-linked and private businesses charged the applicable full rate (overseas companies in
USD). It does not grant an API, quota, retention, derivation or sublicensing right. Therefore the
public XLSX must not be automatically fetched, copied to R2 or displayed by this product until
`eidstat@mpob.gov.my` provides a written licence. A public dashboard or downloadable workbook proves
publication, not the four product rights required for ingestion.

The activation gate is all of the following:

1. MPOB confirms the discovered XLSX tables as a supported service or supplies a stable API/SFTP,
   with calendar-month, unit, preliminary/final and correction definitions.
2. Written terms cover polling frequency/IP/user-agent, private R2 retention period, derived
   indicators and end-user value/API display or redistribution; any credential is a Worker secret.
3. MPOB confirms MYT publication time, quota/SLA, error behavior and revision notifications. The
   recent 12 months and preliminary/revised markers are already technically verified.
4. A measured fixture passes under a 256 KiB response/R2-object budget; one retry policy is frozen.

After authorization, failure fallback would be XLSX → same-URL HTML → official monthly-summary
headline → last successful snapshot marked stale, never a third-party replacement. Until then, an
editor may attach an individual MPOB release citation only within the permission/fair-use policy
approved by the product owner; manual facts cannot reconstruct or republish a bulk table, and a USDA
forecast cannot close the MPOB actual-data gap.

## 4. South Africa CEC and SAGIS

### CEC / Department of Agriculture

- Official crop-estimate index and meeting dates:
  <https://www.nda.gov.za/index.php/publication/320-crop-estimates>
- Example final 2025 summer-crop calculation:
  <https://www.nda.gov.za/images/Branches/Economica%20Development%20Trade%20and%20Marketing/Statistc%20and%20%20Economic%20Analysis/statistical-information/crops-etimates/2026/calculated-final-summer-crops-feb-2026.pdf>

The official index provides more than 12 months of dated CEC releases. From 27 January 2026,
forecasts are released at 15:30 South Africa time (`Africa/Johannesburg`, UTC+02 without daylight
saving). Reports distinguish white maize, yellow maize and total commercial maize, hectares, tonnes,
forecast number and final calculations; these identities must never be collapsed without metadata.

The reviewed surface is HTML plus report PDFs, has no supported machine API/schema, quota or
revision endpoint, and the Department site asserts copyright. PDF/table scraping and bulk
republication are therefore not approved. Editors may cite a specific report and enter a manually
verified value with its forecast number and release date. Activation requires a Department-provided
machine file plus explicit reuse rights and a supersession rule for preliminary, numbered forecast
and final values.

### SAGIS ownership boundary

- SAGIS company/members: <https://www.sagis.org.za/new-about-us/>
- SAGIS monthly data: <https://www.sagis.org.za/sagis-monthly-data/>
- SAGIS legislation/statutory measures: <https://www.sagis.org.za/legislation/>
- SAGIS 2024/25 annual report: <https://www.sagis.org.za/wp-content/uploads/2026/02/Annual-Report-2024-2025.pdf>

SAGIS is the South African Grain Information Service NPC, funded/governed by four industry trusts;
it works with government bodies but is not the Department or CEC. Its public page links long runs of
dated XLS/XLSX files. An observed official link for the 25 August 2026 maize data table was:

<https://www.sagis.org.za/wp-content/uploads/2026/08/Maize_Data_Table_20260825.xlsx>

The page documents monthly maize tables, monthly imports/exports, class/grade, producer deliveries
and supply/demand; its history easily covers the recent 12 months. However, no open licence, API/SLA,
rate limit, robots policy or rights for automated collection, R2 retention, derivation and public
redistribution were located. The workbook may contain proprietary/statutory returns supplied by
market participants. Treat `SAGIS` as the source owner in citations; a CEC report's use of SAGIS
deliveries does not transfer rights to the product. Written SAGIS permission is required before an
adapter or fixture is created.

## 5. FAO GIEWS/FPMA and FAOSTAT

- GIEWS/FPMA home: <https://www.fao.org/giews/food-prices/home/en/>
- FPMA official tool: <https://fpma.fao.org/>
- FAO statistical database terms: <https://www.fao.org/contact-us/terms/db-terms-of-use/en/>
- FAOSTAT/API landing page: <https://www.fao.org/Faostat/en/>
- FAOSTAT API launch and supported JSON/CSV/filtering:
  <https://www.fao.org/statistics/highlights-archive/highlights-detail/faostat-launches-a-new-api-developer-portal-to-make-data-access-easier/en>

FPMA provides timely monthly/weekly domestic prices and analysis, and the database terms list FPMA
among FAO corporate statistical databases. Those terms allow access, copies, adaptation and
re-dissemination under CC BY 4.0 unless dataset metadata says otherwise, require the prescribed FAO
citation/no-endorsement treatment, prohibit misrepresentation, and warn that national or other
third-party contributors may impose different restrictions. No documented, stable public endpoint
and complete series metadata for the selected southern-African maize prices were verified here;
reverse-engineering the interactive tool is not an acceptable contract. Use FPMA narrative as
manual corroboration only until FAO confirms the selected series' endpoint and underlying rights.

FAOSTAT now has an official developer portal supporting all domains, dimension filtering and JSON/
CSV, with no fee advertised. Its annual crop production data are useful for long-history baselines,
not month-to-month forecast changes. A future adapter may be lawful under CC BY 4.0 after checking
the exact dataset metadata for national third-party exceptions, but it does not improve P0 freshness
enough to justify another runtime source now.

## Public/product semantics

1. Label every USDA value `USDA estimate`, retain the marketing year and never call it monthly
   production, physical inventory, delivery or spot price.
2. Palm oil: MPOB monthly actuals and USDA marketing-year forecasts are different indicators and
   can revise on different schedules.
3. Corn: USDA country estimates, CEC numbered/final forecasts, SAGIS actual deliveries/flows and
   FPMA prices are four different fact classes. Agreement can corroborate a thesis; one may not be
   substituted for another.
4. White/yellow maize and total maize remain separate. No regional southern-Africa aggregate is
   produced from South Africa alone.
5. Source publication month is not a publication timestamp. Unknown times stay `null`; Worker fetch
   time is audit metadata only.
6. Every automatic observation carries the owner page/API citation, access time, market-year rule,
   unit and estimate quality. No source alone proves a causal El Niño impact.

## Final coverage outcome

- **Implementable now, disabled by default:** one reusable USDA FAS PSD JSON adapter with two fixed
  source configurations and six forecast indicators.
- **Still missing:** MPOB monthly actual production/stocks/exports; South African CEC national
  numbered forecasts/final estimates; SAGIS physical flows; a documented/right-cleared selected
  FPMA maize-price series.
- **Not selected for P0:** WASDE bulk report parsing and annual FAOSTAT, because PSD supplies the
  smallest current official forecast contract while the others do not close national monthly facts.

## Implementation status

The reviewed contract is implemented locally as `usda-fas-psd-v1` with two disabled source rows and
six private indicators. The adapter uses only the two fixed commodity/country configurations above,
derives the current marketing year from the scheduled UTC date, and accepts its optional API key only
through the Worker environment/factory closure. Synthetic fixtures contain no credential. Activation
still requires a real Worker secret, current-rate-limit observation, three consecutive live smoke
runs, and product/legal approval; none of those activation steps was performed by this task.
