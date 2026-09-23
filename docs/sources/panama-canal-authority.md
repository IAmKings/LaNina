# Source Spike — Panama Canal Authority（ACP）

## Decision

- Status: candidate contracts documented; implementation and production collection are blocked.
- Review date: 2026-09-08.
- Owning institution: Autoridad del Canal de Panamá (ACP).
- Post-authorization adapter candidates only:
  - `acp-gatun-lake-level-history-v1`: official historical CSV, observation facts only;
  - `acp-advisory-index-v1`: official advisory index metadata only, no PDF-body extraction.
- Pre-authorization implementation policy: do not create adapters, fixtures, registry entries or
  source/indicator seeds. If written authorization is later granted and implementation is approved,
  the initial seed posture remains `enabled=0`, `redistribution=forbidden`, `public=0` until the
  remaining activation gates pass.
- Coverage gaps: Alhajuela lake level, watershed precipitation, daily transit count, booking slots,
  current queue and authoritative official draft values remain unimplemented until access, terms
  and schemas are verified. Gatún observations and advisory metadata are blocked candidates, not
  live coverage.

The technically simplest feed is the official Gatún historical CSV. It is not yet legally safe to
copy into R2 or republish: ACP's data page says the content may only be used for information and
must not be copied, distributed, published or used to create derivative works without prior written
consent. The general site terms also require prior express authorization for commercial or
profit-making use. Public reachability is therefore not treated as a data licence.

- ACP Gatún indicator page and data-specific terms:
  <https://evtms-rpts.pancanal.com/eng/h2o/index.html>
- ACP general terms of use: <https://pancanal.com/en/terms-of-use/>
- ACP contact page: <https://pancanal.com/en/contactus/>

## Source inventory

| Candidate | Fact or text | Public machine-readable form | Decision |
|---|---|---|---|
| Gatún daily lake level history | Observed numeric fact | CSV, no login | Post-authorization candidate; no adapter or seed before written consent |
| Gatún projected level/draft | Forecast/estimate | CSV, no login | Do not mix with observations; not in the minimal adapter |
| Alhajuela daily lake level | Observed numeric fact | Public AQUARIUS chart UI; no supported API confirmed | Coverage gap |
| Watershed precipitation | Observed numeric fact | Authenticated Hydrology API advertises JSON | Coverage gap pending account, schema and terms |
| Daily transit count | Observed numeric fact | Authenticated Operations API advertises JSON | Coverage gap pending account, schema and terms |
| Booking slots / current queue | Operational rule/current state | Dashboards; no supported authoritative numeric API confirmed | Coverage gap; no dashboard-internal scraping |
| Official maximum draft / slot rule changes | Event-driven operational state | Advisories; signed PDF is authoritative | Coverage gap; metadata may only route a document to editorial review |
| Advisory to Shipping | Official publication text | Server-rendered HTML index plus linked PDFs | Post-authorization metadata-only candidate; no body extraction |

## 1. Gatún lake-level history

### Official discovery and URL

ACP's English home page links **Gatun Water Levels Indicators** to its own
`evtms-rpts.pancanal.com` reporting host. That page labels the resource **Gatun Lake Historical
Water Levels (CSV)** and links this stable-looking URL:

```text
https://evtms-rpts.pancanal.com/eng/h2o/Download_Gatun_Lake_Water_Level_History.csv
```

- ACP English home page: <https://pancanal.com/en/>
- ACP Gatún indicator page: <https://evtms-rpts.pancanal.com/eng/h2o/index.html>
- Historical CSV:
  <https://evtms-rpts.pancanal.com/eng/h2o/Download_Gatun_Lake_Water_Level_History.csv>

### Observed wire contract

A read-only probe on 2026-09-08 returned HTTP 200, `Content-Type: application/octet-stream`,
`Content-Length: 405555`, `ETag`, `Last-Modified` and the following two-column CSV contract:

```csv
DATE_LOG,GATUN_LAKE_LEVEL(FEET)
1965-01-01,86.49
```

The file started at 1965-01-01 and, at the probe time, ended at 2026-09-06. The response was last
modified on 2026-09-07 15:30:06 UTC. That one observation suggests daily publication with roughly
one-to-two days of lag, but it is not a published service-level guarantee. ACP does not state a
release hour or revision schedule on the indicator page.

The endpoint republishes the complete history on each request. Old rows may therefore change in
place; use the full-body hash and row-level observation revisions rather than assuming historical
immutability. `ETag` and `Last-Modified` may be used for conditional requests, but the adapter must
still handle a 200 response whose content hash is unchanged.

### Proposed v1 normalization

- Source ID: `acp-gatun-lake-level-history-v1`.
- Indicator ID: `panama_canal_gatun_lake_level_daily_v1`.
- Date: parse exact ISO `YYYY-MM-DD` as ACP/Panama local calendar date and store the period as
  `00:00:00.000Z`; metadata must retain `sourceCalendarTimezone=America/Panama` so this convention
  is visible rather than implying an intraday UTC measurement.
- Value: finite decimal, plausible validation band `0 < feet < 200`; do not silently convert the
  stored source observation to metres.
- Unit: exact `ft` derived from the versioned header
  `GATUN_LAKE_LEVEL(FEET)`; a header or unit change is `SCHEMA_DRIFT`.
- Quality: `provisional`, because the feed has no per-row publication/version marker and may revise
  prior rows.
- Citation: indicator page and exact CSV URL.
- Publication time: `sourcePublishedAt=Last-Modified` only as file-level metadata; it is not a
  per-observation publication time.
- Duplicate dates, decreasing date order, impossible dates, empty bodies, non-numeric values or
  an unexpected header reject the snapshot rather than partially ingesting it.
- On each run normalize a bounded recent window (recommended 45 days), but hash and retain the
  exact full file only after ACP grants permission to copy it.

The v1 series represents ACP's published **daily Gatún lake level in feet**. Any later switch to an
API, a different daily timestamp convention, a derived change/anomaly, metres, or a forecast must
use a different indicator ID. Observation corrections within the same CSV contract create new
revisions under this v1 indicator.

### Resource budget

- One conditional GET per daily run.
- Observed payload about 396 KiB; hard response limit: 1 MiB.
- One private R2 raw object only after consent; no public raw route.
- At most 45 normalized rows and one transaction per scheduled run.
- Provisional Worker targets: at most 15 ms CPU and 4 MiB transient body/parser memory; verify these
  with a synthetic full-size fixture before implementation rather than treating them as measurements.
- SHA-256 over exact bytes; identical hash returns `unchanged`.
- The body is small enough for a Cloudflare Worker, but the full file must be read with a streaming
  size guard because `Content-Length` can be absent or incorrect.

## 2. Gatún projection is not an observation or official draft

The same ACP indicator page publishes a separate forecast file:

```text
https://evtms-rpts.pancanal.com/eng/h2o/Gatun_Water_Level_Projection.csv
```

Its preamble explicitly states that the shown maximum drafts are estimates for reference only and
that official maximum transit drafts are communicated through **Advisories to Shipping**. The
columns observed on 2026-09-08 were:

```csv
projected_date,projected_gatun_water_level,surcharge_pcent,max_neopanamax_draft_ft,max_panamax_draft_ft
```

- Projection CSV:
  <https://evtms-rpts.pancanal.com/eng/h2o/Gatun_Water_Level_Projection.csv>
- Authoritative advisory index:
  <https://pancanal.com/en/maritime-services/advisory-to-shipping/>

Do not join these forecast rows to the historical observation indicator. If later approved, a
forecast adapter needs a separately versioned `forecastIssuedAt`, `validForDate` and model-vintage
contract; the current file exposes no documented model version or revision history. Draft estimates
must never be presented as ACP's current official maximum draft.

## 3. Alhajuela level and precipitation

ACP's water page links current Gatún and Alhajuela reservoir levels to a public AQUARIUS WebPortal
dashboard. Its historical deep links expose charts and UI export controls, but this research did not
find an ACP-published, versioned API contract for Alhajuela lake level. Scraping internal AQUARIUS
AJAX endpoints would bind the product to an undocumented third-party UI and would not establish
permission to copy the data.

- ACP water page: <https://pancanal.com/agua/>
- Current reservoir dashboard linked by ACP:
  <https://panama.aquaticinformatics.net/Data/Dashboard/1>
- AQUARIUS public portal manual linked by the portal:
  <https://panama.aquaticinformatics.net/Content/Manuals/en/UserGuide.pdf>

The ACP Developer Portal advertises an authenticated **Hydrology API** with precipitation and
evaporation products. Its public overview describes OAuth2 bearer authentication, POST requests,
structured timestamps/location/unit metadata, and a free plan of 50 API hits per month. The public
overview names `/hydrology/v1/precipitation`; it does not expose the production base URL, complete
request/response schema, station catalogue, timezone, pagination, latency, revision semantics or
error contract without signing in and subscribing.

- ACP Developer Portal: <https://developer.pancanal.com/>

One daily request would fit the advertised 50-hit free tier, but this cannot be assumed until the
registered plan confirms whether token, service-information and test calls consume the same quota.
No secrets should be placed in source code or D1; Cloudflare secrets should hold client credentials,
and token caching must respect the returned expiry.

At review time the developer portal's TLS certificate failed normal certificate validation during a
direct probe. Treat this as a live availability risk, not permission to disable TLS verification in
production. Alhajuela and official precipitation therefore remain visible coverage gaps until:

1. an ACP account and product subscription are approved;
2. the applicable API terms are saved and reviewed;
3. normal TLS validation succeeds;
4. station/location IDs and a full schema fixture are obtained; and
5. a seven-day smoke run establishes latency, quota behavior and revision handling.

## 4. Transit count, booking slots and draft

### Authenticated Operations API

The Developer Portal advertises a Maritime Operations API with:

- `/operations/v1/transit-count`: daily transit count;
- `/operations/v1/vessel-arrivals`: historical ETA/vessel information;
- `/operations/v1/transit-times`: estimated transit duration.

It requires a registered application, client ID/secret and an OAuth2 bearer token. The public plan
page advertises 50/200/500 hits per month at USD 0/50/100 respectively. The same unknowns as the
Hydrology API remain: the exact base URL, body schema, classifications, publication lag, revisions,
timezone and rate-limit/error headers are not public in the unauthenticated overview. Consequently
`transit-count` is a promising second numeric adapter, but not implementable from guessed fields.

- ACP Developer Portal: <https://developer.pancanal.com/>

### Booking/queue dashboards

ACP's public maritime page links booking-slot availability, projected booking slots, vessels waiting,
transit planning, arrivals and historical non-booked waiting times. ACP Advisory A-27-2023 describes
the planning/arrival dashboards as a nine-day view by date, direction and vessel-size category. They
are browser dashboards, not a documented public API contract; customer booking applications and
EVTMS also have authenticated workflows.

- Dashboard landing page:
  <https://pancanal.com/en/maritime-services/vessel-eta-and-transit-booking/>
- ACP Advisory A-27-2023:
  <https://pancanal.com/wp-content/uploads/2023/01/ADV27-2023-Maritime-Information-Dashboards_Actualizado-20-jun-23.pdf>
- Transit Reservation System overview:
  <https://pancanal.com/en/transit-reservation-system/>
- EVTMS overview:
  <https://pancanal.com/en/maritime-services/enhanced-vessel-traffic-management-system-evtms/>

Do not automate Tableau/dashboard internals, customer applications or authenticated systems without
an ACP-supported API and explicit authorization. Booking slots and current queue values remain a
coverage gap.

### Official draft and slot changes

ACP states in its own projection CSV that official maximum drafts are communicated through
Advisories to Shipping. Advisories also announce effective dates and slot changes; for example,
A-29-2026 combines reduced-precipitation measures, daily slot changes and draft schedule changes.
These are event-driven rules, not daily observations, and later advisories can postpone or supersede
earlier effective dates.

- Advisory index: <https://pancanal.com/en/maritime-services/advisory-to-shipping/>
- A-29-2026 official PDF:
  <https://pancanal.com/wp-content/uploads/2026/08/ADV-29-2026-Additional-Measures-to-Address-Reduced-Precipitation-in-the-Canal-Watershed.pdf>
- A-33-2026 official PDF:
  <https://pancanal.com/wp-content/uploads/2026/09/ADV-33-2026-Postponement-of-Maximum-Authorized-Draft-Adjustment-in-the-Neopanamax-Locks.pdf>

Do not regex a single PDF into an assumed current numeric state. Correct state reconstruction needs
document issue date, effective date, affected lock/vessel class, units, postponement/cancellation and
supersession links, plus editorial review. That is outside the minimal adapter.

## 5. Advisory metadata adapter

The official server-rendered advisory index contains, for each item, the advisory ID, subject and
direct ACP-hosted PDF URL, grouped by year. It currently retains archives back to 2002 and is updated
on an event-driven schedule. No RSS/Atom feed or published update SLA was confirmed.

The WordPress media REST API can expose official attachment metadata such as `date_gmt`,
`modified_gmt`, `title.rendered` and `source_url`, but attachment dates are CMS upload times and must
not replace the date printed in the signed advisory. Use it only to enrich/index a PDF URL already
found on the official advisory page.

- Advisory index: <https://pancanal.com/en/maritime-services/advisory-to-shipping/>
- WordPress media API collection: <https://pancanal.com/wp-json/wp/v2/media>
- Notices to Shipping (separate rule corpus):
  <https://pancanal.com/en/maritime-services/notices-to-shipping/>

Proposed metadata-only v1 contract:

- Source ID: `acp-advisory-index-v1`.
- Store only advisory ID, exact index subject, PDF URL, index year, first-seen/last-seen time,
  index-page `ETag`/`Last-Modified` when present, and content hash of a deterministic metadata list.
- Do not fetch, OCR, extract, summarize or redistribute PDF bodies automatically.
- Do not convert titles into numeric draft/slot observations.
- A changed subject or URL for the same advisory ID creates a metadata revision and warning; it must
  not overwrite audit history.
- Poll once daily with a 10-second minimum interval from any other `pancanal.com` page request,
  matching ACP's current `robots.txt` crawl delay.
- `sourcePublishedAt` remains null unless the date is taken from the signed PDF under a later,
  approved extraction workflow; CMS upload time remains metadata only.

This adapter is useful as a timely **event signal**: matching a conservative title taxonomy such as
`draft`, `precipitation`, `reservation`, `booking`, `slot`, `operations summary` may route the item
to editorial review, but the taxonomy is not a directional market interpretation.

## Twelve-month availability and resource checks

- Gatún: the single 2026-09-08 response contained daily rows covering the preceding 12 months, but
  one current full-history file does not prove endpoint availability, publication latency or the
  absence of historical revisions across that period. No repeated 12-month availability sample or
  smoke history has been completed.
- Advisory index: the one-time discovery confirmed a current server-rendered index and older
  archives, but did not establish 12 months of page availability, validator stability, edit history
  or publication latency.
- Hydrology/Operations APIs: no authenticated sample was taken. Twelve-month coverage, payload
  size, pagination, latency and revision behavior are unknown.
- Gatún's observed response and proposed Worker budget are recorded above. For the advisory index,
  the provisional post-authorization guard is one daily request with a 1 MiB response limit and a
  256 KiB deterministic metadata-bundle limit, at most 10 ms CPU and 4 MiB transient parser memory;
  actual HTML size, CPU and memory baselines must be measured before implementation. No defensible
  API resource budget exists until the authenticated schema and sample payload are available.

These are technical gaps independent of the permission gap. Passing an availability or resource
check would not authorize collection; obtaining permission would not by itself prove reliability.

## Access, authentication, robots and licence

### Public site and files

As observed on 2026-09-08, `https://pancanal.com/robots.txt` allowed crawling and declared
`Crawl-delay: 10`. Robots instructions can change and are not a licence. The general terms identify
site information/documents/reports as ACP property and prohibit modification, copying,
distribution, transmission, reproduction or publication for commercial/profit use without prior
express ACP authorization.

The Gatún data page is stricter and says linked content is for information only and may not be
copied, modified, distributed, transmitted, displayed, published or used to create derivative works
without prior written ACP consent. Therefore both proposed sources remain:

```text
enabled=0
redistribution=forbidden
public=0
```

Do not store raw CSV/PDF/page bodies in R2, expose normalized values, or enable Cron before written
ACP authorization covers the intended collection, private retention, derived calculations and public
display. Any future contract fixtures must be synthetic URL/title/hash records, not copied ACP
tables or PDF text, and must not be described as production coverage.

### Developer APIs

The Developer Portal is the strongest evidence that ACP intends authenticated programmatic access,
but access is product- and plan-bound. Registration, app credentials, subscription and bearer tokens
are mandatory. The unauthenticated page does not establish rights beyond the selected plan's terms.
Do not request or store credentials until the product owner approves the relevant plan and terms.

## Failure model

| Condition | Handling |
|---|---|
| 408/5xx/network/TLS failure | retryable `NETWORK`; never disable TLS verification |
| 429 or exhausted API plan quota | retryable `RATE_LIMIT`; honor `Retry-After` when present |
| 401/403/token failure | non-retryable `AUTH` after one token-refresh attempt |
| 404/410 for a fixed source URL | non-retryable `NOT_FOUND`; flag source review |
| HTML/login page returned for CSV/API | non-retryable `SCHEMA_DRIFT` or `AUTH` based on status |
| CSV header, date, unit or numeric drift | non-retryable `SCHEMA_DRIFT` |
| response exceeds hard byte limit | non-retryable `VALIDATION` |
| latest Gatún row is more than three local calendar days old | successful fetch but stale-data warning/health degradation |
| advisory ID duplicated with conflicting title/URL | partial result plus metadata-revision warning |
| dashboard/internal endpoint changes | no fallback scraping; retain coverage gap |

## Offline fixtures and contract tests

No automated test should call ACP.

Recommended minimal fixtures:

1. `gatun-history-valid.csv`: exact two-column header, three historical rows, CRLF termination.
2. `gatun-history-correction.csv`: same dates with one revised value to prove observation revision.
3. `gatun-history-invalid-header.csv`: renamed level/unit column → `SCHEMA_DRIFT`.
4. `gatun-history-invalid-row.csv`: duplicate date, impossible date, blank and non-finite values.
5. `gatun-history-too-large.csv`: generated response crossing 1 MiB stream limit.
6. `advisory-index-valid.html`: two compact `<li class="d_boxes">` records containing ID, title and
   official PDF URL.
7. `advisory-index-revised.html`: same ID with changed title/URL and a new advisory.
8. `advisory-index-malformed.html`: missing ID or off-domain PDF URL; reject it.
9. API response stubs for 304, 401, 403, 404, 429 with `Retry-After`, 500 and timeout.

Fixtures must be synthetic/minimal, retain official citation URLs, and not copy substantive ACP
tables or PDF text. Adapter tests should assert host/path whitelists, no redirects to an unapproved
host, conditional headers, deterministic hash/order, stale warnings and that disabled/unknown source
IDs make zero fetches.

## Activation gates

### Gatún CSV and advisory metadata

Keep disabled until all items are recorded:

1. ACP provides written authorization for automated collection, private retention, derived use and
   intended public display, including the specific CSV and advisory metadata.
2. Product/legal review maps that authorization to `redistribution` and `public` flags.
3. Seven consecutive read-only smoke runs confirm TLS, sizes, validators, latest-date lag and schema.
4. A historical sample confirms whether rows are revised and defines the correction window.
5. Editorial workflow exists for advisory review and supersession; titles cannot directly create a
   directional thesis or an official numeric state.

### Developer APIs

Keep as coverage gaps until account onboarding supplies:

1. accepted API terms and plan details;
2. verified base URLs, OAuth2 discovery/token contract and secret-rotation process;
3. OpenAPI/Postman contract, station catalogue and unit/timezone semantics;
4. confirmed quota accounting and rate-limit/error headers;
5. publication latency and revision policy; and
6. successful normal-TLS smoke tests from a Worker environment.

## Recommended minimum implementation scope

After ACP written consent, product/legal mapping and an approved implementation decision, the
minimum useful slice is:

1. implement the **Gatún observed-history CSV adapter** with one conditional daily GET, strict
   two-column parsing, 45-day normalization window, full-body hash and no public raw snapshot; and
2. implement the **advisory-index metadata adapter** with one daily HTML GET, deterministic
   ID/title/PDF-URL records and editor-facing event alerts only.

Do not include Alhajuela dashboard scraping, precipitation/transit API integration, projection CSV,
PDF text extraction, current-draft state reconstruction, booking-slot scraping, anomaly calculation
or market-direction inference in this slice. Seed both proposed sources disabled with forbidden
redistribution. If permission is not granted, preserve the coverage gaps and use manually entered,
source-linked facts under editorial review rather than bypassing ACP's terms.

For that manual path, retain the advisory ID, source link, issue date, effective date and any later
postponement/cancellation relationship. A slot-reduction advisory and a later draft postponement
must remain two separately citable facts; the latter must not overwrite the former. Editors decide
whether they are supporting or mitigating evidence for the US East thesis, while the Europe thesis
must not inherit the same directional change automatically. Until such reviewed facts exist, expose
the Panama operational layers as `data coverage insufficient`, never as a current value inferred
from a title, projection or dashboard.
