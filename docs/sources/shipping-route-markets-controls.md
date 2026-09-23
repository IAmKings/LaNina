# Source Spike — 亚洲至美东/欧洲航线市场与控制变量

## Decision

- Review date: 2026-09-08.
- Status: **US East and Europe route-rate coverage gap; one bounded fuel-control adapter is
  technically activation-ready**.
- No reviewed source provides a free, supported machine interface plus rights to automatically
  retain, derive from and publicly redistribute Asia—US East or Asia—Europe freight rates.
  SCFI/CCFI expressly prohibit unlicensed extraction/reuse; FBX, Drewry, Xeneta and
  Sea-Intelligence reserve route history, API delivery or onward use to licensed/subscription
  products.
- Consequently the two route-rate facts remain a visible `COVERAGE_GAP`. A thesis that lacks a
  licensed route-rate observation must have confidence capped at **59**. Fuel, trade, port,
  connectivity, canal or security facts are controls/proxies and must never close that gap or be
  renamed as freight rates.
- The official EIA API v2 daily Europe Brent series `RBRTE` is the only v1 runtime candidate from
  this Spike. It is a broad fuel-cost control, **not** marine bunker fuel, a freight rate, vessel
  capacity or a causal Red Sea signal. Start disabled and private/derived-only because the EIA
  table identifies third-party price input; exact-value public redistribution needs a final rights
  confirmation even though the API terms permit services to retrieve, display and analyse API
  content.
- UKMTO/JMIC and U.S. Maritime Alert/Advisory metadata are lawful editorial signals, but no stable
  documented JSON/RSS contract was verified. Suez traffic, Eurostat, UNCTAD, U.S. Census and port
  data remain manual/future adapter candidates until a narrow wire contract is separately frozen.

## Candidate matrix

| Owner/source | What it actually measures | Machine/access and rights result | v1 decision |
|---|---|---|---|
| Shanghai Shipping Exchange Institute, SCFI/CCFI | Weekly Shanghai spot prices by Europe/USEC and broader China export indices | Public pages and paid history/subscription. SSE says without written authorization data are for perusal only and may not be duplicated, extracted, republished, reused or used for derivatives/public/commercial purposes | **Rate coverage gap**; no HTML/API reverse engineering, snapshot or seed |
| Freightos/Baltic FBX | Daily/weekly 40-foot-container market indices by trade lane | Supported JSON API requires `apikey` and `secret-key`; access frequency, lanes, history, derived data and resale depend on the commercial PO. Public reproduction requires credit, but automated/API and investment-model use are not granted by merely viewing the site | **Rate coverage gap** pending an explicit PO covering this product |
| Drewry WCI | Weekly composite and eight route spot-rate indices, including Shanghai—New York and Shanghai—Rotterdam | Public current commentary exists; history, downloads and API are subscription/site-licence products and unauthorized redistribution is prohibited | **Rate coverage gap** |
| Xeneta XSI-C | Daily median short-term FAK price per 40-foot container on regulated lanes | Current site values may be cited with attribution; daily delivery/history and protected index uses require registration/licensing. Free internal viewing is not a supported redistribution API grant | **Rate coverage gap** |
| Sea-Intelligence GLP | Monthly schedule reliability and late-arrival delay across carriers/trade lanes | Press releases expose selected global/carrier headlines; the monthly lane-level GLP is a subscription report and may only be shared inside the subscribing company | Editorial citation only; not a route reliability adapter |
| Carrier schedules/dashboards | One carrier's planned/actual movements or customer performance | Maersk's DCSA schedule API is for Maersk Ocean customers; Hapag-Lloyd exposes customer/UI products. Neither is a neutral cross-carrier market rate/reliability series | Do not scrape; manual carrier evidence only |
| Suez Canal Authority | Vessel count, net tonnage and cargo, sometimes by direction/type | Official monthly/annual PDF/HTML reports; no stable documented data API, revision feed or reusable-data licence was verified | Manual citation; canal activity proxy only |
| UKMTO/JMIC | Warnings, advisories and verified incident/security summaries | Official pages/PDFs, Crown copyright and site content under the Open Government Licence; no supported structured feed located | Future metadata-only adapter or manual review; title/status is not a numeric direction |
| U.S. Maritime Alert and Advisory System | Effective/cancelled security alerts and guidance | Official server-rendered tables/pages with effective/expiry dates; no documented API/RSS contract located | Future metadata-only adapter or manual review |
| UNCTAD Data Hub LSCI/PLSCI | Country/port liner-shipping connectivity | Official statistical data; low-frequency structural connectivity, not route price, live capacity or reliability. Exact current endpoint/schema was not frozen in this Spike | Manual/future structural proxy |
| Eurostat maritime transport | Quarterly/annual tonnes, vessels and container TEU from reporting ports | Free REST/SDMX APIs and reuse with attribution; database is latest-value-only, updated twice daily, while maritime releases lag up to 10/16 months | Lawful future slow port-demand proxy, not v1 market feed |
| Port Authority of NY/NJ and other ports | Monthly local port TEU/cargo | Official releases are valuable destination-side throughput, but no stable supported machine contract and complete reuse terms were frozen here | Manual/future port proxy |
| U.S. Census International Trade API | Monthly imports/exports by port/district, country, commodity and transport mode | Official JSON API, all calls now require a free key; data products are public at no cost. A bounded port/country/vessel query still needs dimension, suppression, revision and release-lag fixtures | Strong future route-demand proxy; not a rate |
| EIA API v2, `RBRTE` | Europe Brent daily closing spot price, published in weekly batches | Official JSON API with free key; API terms allow services to retrieve/display/analyse and require attribution. Bounded live response verified below | **Implementable derived-only fuel control**, disabled by default |

### Primary-source references

- SSE SCFI definition, route units, ownership and reuse restriction:
  <https://en.sse.net.cn/indices/fqaen.jsp>
- SSE subscription and written-authorization terms:
  <https://en.sse.net.cn/indices/agreetext.htm>
- Freightos data/API terms and FBX endpoint documentation:
  <https://www.freightos.com/freightos-data-terms-conditions/> and
  <https://apidocs.freightos.com/reference/get_fbx-data>
- Drewry WCI methodology and subscription surface:
  <https://www.drewry.co.uk/logistics-executive-briefing/logistics-executive-briefing-articles/world-container-index-methodology>
  and
  <https://www.drewry.co.uk/maritime-research-products/container-freight-rate-insight-annual-subscription>
- Xeneta XSI-C public/licensed-use explanation: <https://xsi.xeneta.com/>
- Sea-Intelligence GLP product and current press releases: <https://sea-intelligence.com/> and
  <https://sea-intelligence.com/press-room>
- Maersk customer schedule API:
  <https://developer.maersk.com/api-catalogue/ocean-commercial-schedules/Learn-more>
- Suez navigation-statistics page and official 2025 report:
  <https://www.suezcanal.gov.eg/English/Navigation/pages/navigationstatistics.aspx> and
  <https://www.suezcanal.gov.eg/English/Downloads/DownloadsDocLibrary/Navigation%20Reports/Annual%20Reports%E2%80%8B%E2%80%8B%E2%80%8B/2025.pdf>
- UKMTO/JMIC products and Open Government Licence terms:
  <https://www.ukmto.org/partner-products/jmic-products>,
  <https://www.ukmto.org/partner-products/jmic-products/weekly-dashboard> and
  <https://www.ukmto.org/terms-and-conditions>
- U.S. Maritime Advisories: <https://www.maritime.dot.gov/msci-advisories>
- Eurostat APIs, update/version behavior, maritime latency and reuse:
  <https://ec.europa.eu/eurostat/data/web-services>,
  <https://ec.europa.eu/eurostat/web/transport/information-data/maritime-transport> and
  <https://ec.europa.eu/eurostat/help/copyright-notice>
- U.S. Census international-trade guide and products:
  <https://www.census.gov/foreign-trade/reference/guides/Guide_to_International_Trade_Datasets.pdf>
  and <https://www.census.gov/foreign-trade/data/dataproducts.html>

## EIA Europe Brent daily — bounded adapter contract

### Authority, rights and scope

- API documentation: <https://www.eia.gov/opendata/documentation.php>
- Key registration/API terms: <https://www.eia.gov/opendata/register.php>
- EIA copyrights and reuse: <https://www.eia.gov/about/copyrights_reuse.php>
- Series page, missing-value legend and release dates:
  <https://www.eia.gov/dnav/pet/hist/RBRTED.htm>
- Table definition: <https://www.eia.gov/dnav/pet/tbldefs/pet_pri_spt_tbldef2.asp>

EIA requires a free API key and permits development of a service to search, display, analyse,
retrieve and view API information, with `EIA` or `U.S. Energy Information Administration`
attribution and no implied endorsement. Do not display the EIA logo. EIA's general site policy
permits use/distribution of its data but excludes separately protected third-party material. The
Brent spot-price table has historically identified Reuters/Refinitiv as an input; v1 therefore
keeps raw API bodies private and the source `derived_only`, with the exact indicator `public=0`,
until product/legal confirms exact-value public display under the current upstream arrangement.

The control answers only: “Did a broad internationally referenced crude-oil spot price move?” It
must not be labelled VLSFO/LSFO, bunker cost, carrier surcharge, Asia—Europe price or
Asia—US-East price, and it cannot determine shipping direction by itself.

### Fixed request

Source ID and adapter key:

```text
source.id      = eia_europe_brent_spot
adapter_key    = eia-petroleum-spot-v1
indicator.id   = eia_europe_brent_spot_usd_per_bbl_daily
secret         = EIA_API_KEY
```

Only this parameterized request is in v1 scope; all dimensions except the recent date window are
code-owned constants:

```text
GET https://api.eia.gov/v2/petroleum/pri/spt/data/
  ?api_key={EIA_API_KEY}
  &frequency=daily
  &data[0]=value
  &facets[series][]=RBRTE
  &start={scheduledAt UTC date minus 54 days, YYYY-MM-DD}
  &end={UTC today, YYYY-MM-DD}
  &sort[0][column]=period
  &sort[0][direction]=asc
  &offset=0
  &length=40
Accept: application/json
```

EIA documents API keys as query parameters. The adapter must construct the URL only at request
time, never serialize or log `request.url`, and redact `api_key` from errors, source runs and
snapshots. `EIA_API_KEY` is a Cloudflare Worker secret, never a D1 value or fixture.

The response envelope is:

```json
{
  "response": {
    "total": "21",
    "dateFormat": "YYYY-MM-DD",
    "frequency": "daily",
    "data": [
      {
        "period": "2026-09-01",
        "duoarea": "ZEU",
        "area-name": "NA",
        "product": "EPCBRENT",
        "product-name": "UK Brent Crude Oil",
        "process": "PF4",
        "process-name": "Spot Price FOB",
        "series": "RBRTE",
        "series-description": "Europe Brent Spot Price FOB (Dollars per Barrel)",
        "value": "96.02",
        "units": "$/BBL"
      }
    ]
  },
  "request": { "command": "/v2/petroleum/pri/spt/data/" },
  "apiVersion": "2.1.13"
}
```

Live probe on 2026-09-08 using the bounded 2026-08-01..2026-09-08 window returned HTTP 200,
`application/json`, 21 observations and **6,364 bytes**. It had no `ETag`, `Last-Modified` or
`Cache-Control`; it exposed `X-RateLimit-Limit: 10` and `X-RateLimit-Remaining: 9` for `DEMO_KEY`.
The generic EIA FAQ says a sustained rate below roughly 9,000/hour and burst below five/second is
normally safe, but route/key-specific throttles can differ. One request/day is deliberately far
below both. EIA caps JSON responses at 5,000 rows; the adapter must require `total <= 40` and reject
an embedded truncation warning rather than paginate or widen scope.

### Time, unit, missing and revision semantics

- `period` is a daily market date; normalize it as `YYYY-MM-DDT00:00:00.000Z` and retain
  `sourceDateHasNoTimezone=true`. Do not invent an intraday close timestamp.
- Store exact unit `USD/bbl`; accept only wire `units="$/BBL"`, `series="RBRTE"`,
  `product="EPCBRENT"`, `process="PF4"`, `frequency="daily"` and
  `dateFormat="YYYY-MM-DD"`.
- `value` is a decimal string. Accept only a finite positive decimal within a conservative
  `0 < value < 1000` validation band. Missing dates/weekends are absence, not zero and not a
  failed run.
- The public table's missing legend is `-` no data, `--` not applicable, `NA` unavailable and `W`
  withheld. Such tokens, null, empty strings and duplicate periods are not observations; an
  unexpected token/duplicate is `SCHEMA_DRIFT`/`VALIDATION`, not zero.
- `sourcePublishedAt=null`; the weekly page-level release date is not present in the API row and
  fetch time must not replace it. Data are daily closes published in weekly batches, so daily
  polling does not imply daily source publication.
- Same normalized rows/content hash return `unchanged`. A changed value for the same period is an
  append-only revision linked to the prior observation. The API supplies only latest values, so
  the platform can preserve vintages only after activation.
- The 55-calendar-day inclusive window contains at most 40 weekdays. Reject `total > 40`, responses
  over 64 KiB, extra series/dimensions, non-JSON and changed field types.

Recent availability is verified: the official history covers 1987 onward; the live API probe and
official release page exposed daily values inside the preceding 12 months. This proves data
coverage, not a 12-month availability SLA. EIA publishes release/next-release dates on the series
page; they may shift around holidays, so poll daily rather than hard-code Wednesday.

### Seed and resource posture

```text
id=eia_europe_brent_spot
adapter=eia-petroleum-spot-v1
cadence_minutes=1440
late_after_minutes=10080
stale_after_minutes=20160
enabled=0
redistribution=derived_only

indicator=eia_europe_brent_spot_usd_per_bbl_daily
domain=shipping
geography=Europe/global-control
unit=USD/bbl
frequency=daily
higher_means=context
public=0
```

One GET/day at the 64 KiB hard cap is under 24 MiB/year of transfer/private raw objects before
deduplication. Exact unchanged bytes must not create a new R2 snapshot. Runtime target is one
request, no pagination, at most 40 parsed rows, one transaction and a 64 KiB streaming body limit.
The 40-row boundary stays inside the existing 50-query D1 invocation guard while leaving capacity
for the prior-range read and run/source bookkeeping. Enable only after a real key is provisioned,
three live smoke
runs pass, rate-limit headers are recorded and the current EIA/upstream display decision is signed
off.

### Fixtures, errors and fallback

The synthetic normal fixture should contain three `RBRTE` rows in ascending period order and no
real key. Tests must cover:

- normal and unchanged hash;
- a same-period changed value creating a revision;
- invalid/missing key (401/403), 429 with `Retry-After`, 5xx/network and ordinary 404;
- malformed JSON, wrong content type, invalid UTF-8 and body over 64 KiB;
- wrong `series`, product, process, unit, frequency/date format or mixed dimensions;
- duplicate/out-of-order/impossible periods, null/missing/token/non-finite/negative/out-of-band
  values, `total > 40`, row count inconsistent with `total`, and embedded API warning/truncation.

Map missing/invalid key to `AUTH` without retry; 429 to `RATE_LIMIT` with the common bounded retry;
network/5xx to retryable `NETWORK`; 404 to `NOT_FOUND`; wrong JSON/schema to `SCHEMA_DRIFT`; size
and invalid values to `VALIDATION`. Retain the last verified value and let normal source health
become delayed/stale/broken. The only editorial fallback is the official EIA series page with its
release date and unit; never replace it with a news quotation or infer a route rate from oil.

## Remaining controls and editorial boundaries

### Red Sea/Suez

UKMTO states that its Info Notes are delivered within 24 hours of an incident and JMIC weekly/monthly
products contain verified summaries, statistics and threat assessments. The UKMTO site is published
under the Open Government Licence, but the reviewed product surfaces are HTML indexes plus PDFs;
third-party items remain excluded. A future adapter may store only owner-authored document metadata
(`id`, exact title, status, issue/effective/expiry date, official URL, first/last seen and hash), not
PDF-extracted incident counts or an inferred `risk_up/risk_down` direction.

The U.S. system similarly distinguishes fast Alerts (basic location/type/time) from Advisories
(guidance and attribution). Superseded/cancelled status must be append-only state, not deletion.
Neither signal proves carriers are routing via Suez, how much capacity was removed, or a freight-rate
move. SCA's PDF traffic reports can corroborate monthly/yearly transit activity, but without a
stable machine/data-rights contract they remain manually cited facts.

### Capacity, ports and demand

UNCTAD LSCI/PLSCI and Eurostat maritime data measure structural connectivity or port traffic;
Eurostat is quarterly/annual with release lags up to 10/16 months and exposes only the latest
vintage. Port NY/NJ throughput is destination-side activity. Census port/district imports can
approximate U.S. vessel-trade demand by origin and commodity. None identifies booked Asia—US East
container capacity, spot rate, schedule reliability or whether a ship used Panama/Suez/Cape.

A later Census adapter should be its own Source Spike using only a fixed aggregate request, a free
secret key, explicit vessel/container method, frozen origin set and one month. It must preserve
suppression/missing markers and revisions, and must be named `trade-demand proxy`, never
`route volume`. Eurostat is legally reusable with attribution and supports JSON-stat/SDMX/CSV, but
its latency makes it a cross-check rather than a market alert.

## Activation summary

| Fact needed by product | Result after this Spike |
|---|---|
| Asia—US East route rate | `COVERAGE_GAP`; confidence cap 59 until licensed observation exists |
| Asia—Europe route rate | `COVERAGE_GAP`; confidence cap 59 until licensed observation exists |
| Route-level schedule reliability | `COVERAGE_GAP`; carrier/global headlines do not qualify |
| Suez/Red Sea event metadata | Lawful manual/editorial path; structured runtime contract deferred |
| Port/trade/connectivity control | Lawful future proxies; not frozen for v1 and cannot close rate gap |
| Broad fuel-price control | EIA `RBRTE` adapter contract ready, disabled/private-derived-only |

No freight-rate scraper, dashboard reverse engineering, paid credential, source/indicator seed or
runtime adapter is authorized by this research file alone.
