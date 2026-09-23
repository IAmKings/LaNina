# Source Spike — 天然橡胶实物事实与日频市场

## Decision

- Status: **coverage gap**. No adapter, fixture, registry entry or seed is approved by this Spike.
- Review date: 2026-09-08.
- Physical-data outcome: Malaysian Rubber Board (MRB/LGM) and Rubber Authority of Thailand
  (RAOT) publish useful official daily physical prices, but neither source grants the product a
  confirmed right to automate, retain and redistribute them. MRB expressly requires prior written
  consent for copying, distribution, publication and commercial dealing.
- Daily-market outcome: SGX SICOM, JPX/OSE and SHFE/INE all publish authoritative rubber futures
  information, but their official terms reserve automated/non-display use or commercial secondary
  use for licensed customers. Public reachability is not a market-data licence.
- Clearest low-frequency fallback candidate: the World Bank catalogue labels Commodity Prices
  CC BY 4.0 and the workbook contains monthly RSS3 and TSR20 nearby-contract series. Because the
  series definitions cite exchange/third-party inputs, exact-value redistribution still needs a
  rights review. In every case it is only a monthly cross-check and does not satisfy the PRD's
  daily-market or physical-supply requirements.
- Activation rule: do not create a production source until the owner or a licensed vendor confirms
  in writing the exact rights for automated fetching, private snapshot retention, derived-signal
  creation and public display/redistribution.

This decision keeps `RUBBER-TH-01` honest: southern-Thailand rainfall is available as a proxy, but
the platform still lacks a licensed automatic physical confirmation and a licensed daily market
confirmation. A futures price alone must never be described as proof that weather reduced tapping
or tightened raw-material supply.

## Candidate matrix

| Owner/source | Fact and frequency | Public machine form | Access and recent availability | Rights outcome | Decision |
|---|---|---|---|---|---|
| MRB/LGM | FOB physical reference prices and farmgate prices; business daily | Official HTML UI backed by JSON services; some routes use Basic authentication | Current daily values and calendar history are visible; no public SLA, rate limit or complete 12-month API guarantee | Official copyright notice bars copying, distribution, publication, licensing and commercial dealing without express prior written consent | Best physical candidate after written licence; blocked now |
| RAOT | Central-market opening price, auction trade price, local price and noon FOB; daily pages/announcements | HTML/PDF pages; no supported public API contract found | Historical navigation exists, but an end-to-end recent 12-month machine feed and revision contract were not established | Site states copyright; no open-data or redistribution grant was found | Physical coverage gap; use manually only with citation |
| DOSM Malaysia | Production, exports, imports, domestic consumption and closing stocks; monthly | Official monthly PDF publications | Recent monthly publications exist; no current catalogue CSV/API for the rubber table was confirmed | Publication access does not itself establish bulk-extraction/republication rights for this product | Valuable manual supply cross-check; not an automatic v1 feed |
| SGX SICOM | TSR20/RSS3 contract-month settlement and trading data; daily | Public chart/UI; licensed Derivatives Market Direct Feed for machine use | Current contract pages are available; no unlicensed supported 12-month historical API was found | SGX policy covers real-time, delayed, EOD and historical data; website terms prohibit storing, deriving or redistributing without prior permission | Daily market coverage gap pending SGX licence |
| JPX/OSE | RSS3/TSR20 and Shanghai Natural Rubber contract settlement prices; daily | A current OSE/TOCOM CSV is posted each business day; historical OHLC is paid CSV/DataCube or FTP/SFTP | Current daily file is public; paid history covers rubber. Public page is not a supported free rolling 12-month API | Commercial data collection/secondary use is prohibited without permission or paid contract | Technically simplest exchange candidate after contract; blocked now |
| SHFE/INE | RU and NR contract OHLC, settlement, volume/open interest; daily | Queryable official HTML tables and downloads; exchange/member market APIs are permissioned | Date queries demonstrate recent daily coverage; no supported public API/SLA for a Worker was confirmed | Non-commercial browsing/downloading is permitted, but commercial copying, storage, electronic scraping and dissemination require written permission | Daily market coverage gap pending written permission/licensed feed |
| World Bank Pink Sheet | RSS3 and TSR20 nearby-contract monthly averages | Official XLSX, about 587 KiB at review; no auth | Current file includes the recent 12 months and is updated on the second business day of each month | Dataset catalogue states CC BY 4.0, while the definitions cite exchange/third-party inputs; confirm exact-value redistribution | Best low-frequency candidate; not a substitute for the two missing feeds |
| IMF Primary Commodity Prices | Global rubber benchmark; monthly | Official downloadable database/Excel | Updated monthly and covers the recent 12 months | IMF permits reuse of statistical data with attribution, but asks potential commercial reusers to request permission; some inputs may have third-party terms | Do not prefer over the clearer World Bank CC BY dataset |
| FRED `PRUBBUSDM` | IMF global rubber price; monthly, US cents/lb | JSON/XML API with per-application API key; table download | Recent observations exist | Series is marked copyrighted; FRED says third-party permission is required and its current API terms restrict storing/caching/archiving | Rejected for this architecture |

## PRD §8.7 verification status

This Spike closes the checklist by recording unknowns as blockers rather than treating public web
pages as production contracts:

| Check | Result |
|---|---|
| URL, documentation, access and format | Candidate URLs and observed HTML/PDF/JSON/CSV/XLSX forms are recorded above. MRB exposes undocumented authenticated JSON calls; licensed exchange feeds require contracts; the World Bank workbook needs no authentication. No third-party response body or data row is checked into this repository. |
| Timezone, unit, missing values and revisions | Known contract units and the MRB/JPX publication times are recorded below. Complete missing-value, correction and trading-calendar rules were not confirmed for any eligible daily machine feed, so these remain activation blockers rather than parser assumptions. |
| `ETag` / `Last-Modified` and rate limits | The World Bank HEAD probe returned `Last-Modified` without `ETag`. Supported validators, quotas and stable error contracts were not established for the blocked physical/exchange candidates; licensed-feed documentation must supply them before fixtures or code are added. |
| Robots, terms and redistribution | The linked owner terms were reviewed where a terms page was available. No robots rule or frontend-visible endpoint is treated as permission; RAOT has no located open-data grant. Automation remains blocked until explicit product rights cover fetching, retention, derivation and display/redistribution. |
| Recent 12-month availability | Only the World Bank monthly workbook was verified across the full recent 12-month window. Public physical pages and unlicensed exchange interfaces did not establish a supported rolling 12-month machine feed; paid/licensed history does not become available until entitlement is granted. |
| Failure fallback | Editors may enter individually cited official facts with manual quality marking. They may not scrape or reconstruct a bulk series, copy restricted tables, silently convert preliminary data, or let a monthly/futures value stand in for physical confirmation. |
| CPU, memory and object size | The only measured candidate was the World Bank XLSX at about 587 KiB; a guarded fetch could fit the 1 MiB snapshot ceiling, but XLSX parsing cost remains unbenchmarked and no adapter is approved. Runtime cost for all blocked feeds is deliberately unmeasured until a supported wire contract and lawful fixture exist. |

Unknown values above are a failed technical-verification outcome under PRD §8.7, not deferred
implementation details. Any candidate that advances must replace each unknown with an owner-backed
contract and a measured fixture before it can be registered or seeded.

## 1. MRB/LGM physical reference and farmgate prices

MRB is the strongest physical candidate because its official site distinguishes two facts:

- **reference prices for physical rubber (FOB)**, published once daily at 3:00 p.m. effective
  2 January 2025, for grades including SMR CV, SMR L, SMR 5, SMR GP, SMR 10, SMR 20 and bulk
  latex; and
- **farmgate prices** by region, including cup lump and latex categories.

The FOB page labels values in Malaysian sen/kg and US cents/kg. Its disclaimer says they are
reference prices and actual traded prices remain subject to negotiation, so they must not be named
"transaction prices" or used as a quantity/supply fact. The legacy MRE page also describes these
as official FOB physical prices and shows calendar history.

- MRB official site/current physical price:
  <https://www.lgm.gov.my/webv2/coreActivities/cropManagement/%28crop%3Aconsultancy%29>
- MRE daily price page: <https://www3.lgm.gov.my/smhargagetah/Daily5.aspx>
- MRE monthly history: <https://www3.lgm.gov.my/smhargagetah/MonthlyPrices.aspx>
- MRB copyright page: <https://www.lgm.gov.my/webv2/copyright>

The current Angular application calls JSON services for dated farmgate and FOB data, but some calls
use Basic authentication embedded in the public client. This Spike neither records nor uses those
credentials. A frontend-visible credential is not a public API agreement, and an undocumented
route is not a stable production contract.

Most importantly, MRB's official copyright notice says that no part of the portal may be modified,
copied, distributed, retransmitted, displayed, reproduced, published, licensed, transferred, sold
or commercially dealt with without MRB's express prior written consent. Therefore a private R2 raw
copy, automated daily database and public derived signal are all blocked until MRB answers in
writing.

### Post-authorization contract proposal

If authorization is obtained, request an official service account and documented endpoint instead
of depending on the website client. A minimal v1 should ingest only:

- farmgate cup-lump price for the official Peninsular region, in `sen/kg`, with the stated dry-rubber
  content/category retained in metadata; and
- FOB SMR20 reference price at 3:00 p.m. Malaysia time (`Asia/Kuala_Lumpur`), preserving both
  `sen/kg` and `US cents/kg` as separate indicators rather than converting one silently.

The owner must define holidays, corrections, publication timestamp, record version, rate limits,
ETag/Last-Modified support and a stable error schema. Until then, the recent calendar shown in the
UI is evidence of data existence, not a 12-month API guarantee.

## 2. RAOT and Thai official supply publications

RAOT's official rubber-information portal lists daily central-market opening prices, auction trade
prices, local prices and noon FOB announcements, as well as historical pages. These facts are closer
to the Thai transmission thesis than a futures quote.

- RAOT rubber-price catalogue:
  <https://www.raot.co.th/ewtadmin/ewt/rubber_web/more_news.php?cid=520&filename=Contact_South_Up2>
- RAOT noon FOB section: <https://www.raot.co.th/more_news.php?cid=517&filename=>
- Thailand rubber statistics, Department of Agriculture:
  <https://www.doa.go.th/rubber/?p=2140>

The public material is presentation-oriented HTML/PDF, and the reviewed site did not publish a
versioned machine API, authentication/rate-limit contract, timezone and correction rules, or an
open redistribution licence. Some older pages also expose inconsistent freshness, so a recent
12-month machine series must be supplied by RAOT rather than reconstructed by scraping navigation
or undocumented endpoints.

After written permission, prefer actual auction price and volume by named central market over a
national headline price. Each grade, market, DRC convention and Thai-baht unit must have a distinct
indicator ID. Monthly/annual PDFs remain editorial evidence; PDF extraction must not silently turn
preliminary values into final observations.

## 3. Malaysian production and stock facts

Malaysia's Department of Statistics publishes **Principal Statistics of Rubber, Malaysia** each
month. The release includes production, exports, imports, domestic consumption and closing stocks
in metric tonnes, and marks preliminary figures where applicable.

- Example official publication:
  <https://storage.dosm.gov.my/rubber/rubber_2025-01.pdf>
- OpenDOSM publications portal: <https://open.dosm.gov.my/>

This is a valid first-party manual cross-check for supply, especially closing stocks, but the current
data catalogue did not expose the rubber table as a maintained CSV/OpenAPI dataset during this
review. P0 may attach a cited publication and manually entered fact with `quality=manual`; it must
not scrape chart pixels or infer unprinted values. Automation awaits a maintained machine dataset
with an explicit licence on its catalogue page.

## 4. SGX SICOM daily market data

SGX lists SICOM TSR20 (`TF`) and RSS3 (`RT`) futures. The official specification states 12
consecutive contract months, a 5-metric-tonne contract and quotation in US cents/kg. The public
chart describes its series as daily settlement price for the selected contract month.

- Product and contract specification:
  <https://www.sgx.com/derivatives/products/sicom-rubber?cc=TF>
- SGX Market Data Policy: <https://www.datadirect.sgx.com/Market-Data-Policy>
- Website/material terms:
  <https://www.datadirect.sgx.com/LinkClick.aspx?fileticket=BOhAdVqTUVQ%3D&portalid=0>

The SGX policy expressly covers Derivatives Market Direct Feed variants including real-time,
delayed, end-of-day and historical data. The website terms allow personal non-commercial viewing
but prohibit copying, electronic storage, derivative works, transmission or redistribution without
prior written permission. A chart's network request must therefore not be reverse-engineered into
an adapter.

Contract-month settlements are the raw facts. A "front month", "main contract" or continuous
series is a platform-owned derived indicator requiring a frozen roll rule and its own version. It
must not splice contracts merely because the UI currently selects one month.

## 5. JPX/OSE daily settlement prices

JPX posts one current CSV containing OSE and TOCOM settlement prices, normally around 4:45 p.m.
Japan time, excluding holiday-trading data. The page does not guarantee that publication will not
be delayed or cancelled.

- Daily settlement page:
  <https://www.jpx.co.jp/english/markets/derivatives/settlement-price/>
- RSS3 contract: <https://www.jpx.co.jp/english/derivatives/products/rubber/rss3-rubber-futures/01.html>
- TSR20 contract: <https://www.jpx.co.jp/english/derivatives/products/rubber/tsr20-rubber-futures/01.html>
- Paid historical data:
  <https://www.jpx.co.jp/english/markets/paid-info-derivatives/historical/01.html>
- JPX terms: <https://www.jpx.co.jp/english/term-of-use/>

RSS3 and TSR20 are distinct physically delivered contracts, each quoted in JPY 0.1/kg with 12
nearby contract months. Their daily settlement is the final execution price of the individual
auction but may be revised by JSCC. OSE's Shanghai Natural Rubber contract is a separate
cash-settled JPY instrument whose final settlement references SHFE RU; it must not be mistaken for
an FX-converted RU price.

- Shanghai Natural Rubber contract:
  <https://www.jpx.co.jp/english/derivatives/products/rubber/shanghai-rubber-futures/01.html>

Although the current CSV is compact and technically suitable for one Worker GET, JPX prohibits
commercial data collection or secondary use without prior permission or a paid contract. Historical
derivatives OHLC is sold through J-Quants DataCube as CSV; OSE reference feeds use FTP/SFTP. A
contract must specify corporate use, public display/redistribution, derived-data rights, retention,
API/file credentials and recent-history entitlement before implementation.

## 6. SHFE RU and INE NR

SHFE's official daily/weekly page provides contract-level open, high, low, close, previous
settlement, settlement, volume and open interest. INE publishes the corresponding 20号胶 (`NR`)
data. Date-query pages show that recent daily dates are available, but the public UI is not a
documented Worker API and has no published ETag, revision or rate-limit contract.

- SHFE daily/weekly data: <https://www.shfe.com.cn/reports/tradedata/dailyandweeklydata/>
- INE daily/weekly data: <https://www.ine.cn/reports/tradedata/dailyandweeklydata/>
- SHFE copyright statement: <https://otc.shfe.com.cn/disclaimer/>
- INE NR contract: <https://www.ine.cn/regulation/ineregulation/rules/202205/t20220516_813427.html>
- SHFE RU contract: <https://www.shfe.com.cn/docview/docview_211235554.htm>

RU and NR are separate deliverables and cannot share an indicator. Both are quoted in CNY/tonne
with 10 tonnes per lot; NR's official quotation is tax-exclusive. Individual expiry contracts must
be retained. Any near/far spread or continuous series requires a versioned roll/selection rule,
including how zero-volume contracts and night sessions are treated.

SHFE's notice permits non-commercial browsing and downloading, but says commercial copying,
downloading, storage, electronic scraping, transmission or dissemination requires written
permission. The published trading API documents are for authorized trading/member access, not a
grant for anonymous website automation. No public endpoint discovered from browser internals is
acceptable as a contract.

## 7. Lawful low-frequency fallback

### World Bank Commodity Prices — best monthly cross-check candidate

The World Bank catalogue classifies **Commodity Prices — History and Projections** as public and
licenses it under CC BY 4.0. It states that commodity prices are updated on the second business day
of each month.

- Dataset and licence:
  <https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections>
- Commodity Markets landing page and current download:
  <https://www.worldbank.org/en/research/commodity-markets>
- Current monthly workbook:
  <https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx>
- Series definitions:
  <https://thedocs.worldbank.org/en/doc/386771467756369668-0050022016/render/CMOHistoricalDataMonthly.pdf>

The monthly workbook contains `Rubber, RSS3` and `Rubber, TSR20`, in USD/kg. The definition is a
Singapore nearby-contract benchmark, not a Thai farmgate or spot price. “Nearby” is the World Bank
series definition; the platform must not claim a daily contract roll or reconstruct a daily curve
from it.

A read-only HEAD probe on 2026-09-08 observed a 586,735-byte XLSX, `Last-Modified` but no `ETag`.
The current workbook contains complete 2025-09 through 2026-08 values. One monthly conditional GET
fits the Worker connection and 1 MiB snapshot budget, but parsing XLSX safely adds disproportionate
code and CPU risk. The workbook's definitions also attribute some commodity inputs to exchanges
and third parties; the dataset-level CC BY label should not be assumed to override a separately
stated constituent restriction. Recommended P0 is an editor-reviewed monthly cross-check with the
exact workbook hash and attribution, kept non-public until that rights review is recorded. Automate
only if a supported JSON/CSV World Bank endpoint for the same series is confirmed or a bounded XLSX
fixture passes Worker CPU/memory tests.

### IMF and FRED — not selected

IMF Primary Commodity Prices is monthly and the IMF's special data terms permit copying,
derivative works and distribution with attribution. However the same terms tell potential
commercial reusers to request permission and warn that some statistical products incorporate
third-party information. World Bank provides clearer dataset-level CC BY 4.0 coverage for this
specific fallback.

- IMF commodity page: <https://www.imf.org/en/research/commodity-prices>
- IMF copyright/data terms: <https://www.imf.org/en/about/copyright-and-terms>

FRED series `PRUBBUSDM` republishes the IMF monthly global rubber price in US cents/lb and provides
an API requiring a registered application key. It is marked copyrighted. FRED states that its API
does not override third-party rights and its current terms restrict storage, caching and archiving,
which conflicts with D1/R2 audit snapshots.

- FRED series: <https://fred.stlouisfed.org/data/PRUBBUSDM>
- FRED API terms: <https://fred.stlouisfed.org/docs/api/terms_of_use.html>

## Common normalization requirements after licensing

1. Store exchange/owner, product, grade, contract month, currency, unit, trading date and source
   timezone explicitly; never merge physical, futures and derived continuous observations.
2. Preserve the exact owner-published settlement/reference value. FX conversions and unit
   conversions are separate derived indicators with the FX source and timestamp attached.
3. Use the exchange trading date, not the Worker's UTC fetch date. Night-session allocation follows
   the owner's calendar.
4. Treat owner corrections as append-only revisions. `Last-Modified` or `ETag`, when present, is a
   file validator rather than proof that every row is final.
5. A continuous contract must freeze selection and roll rules, create a separately versioned
   indicator, and retain its component contract IDs. Open interest/volume selection is not implicit.
6. Raw licensed data remains private in R2 unless the agreement expressly permits public raw
   redistribution. A derived-only licence does not permit exposing exact source rows.

## Minimal executable scope and authorization gates

No rubber adapter should be implemented from the currently confirmed rights. The smallest safe
next step is:

1. Ask MRB for written permission and a supported service account covering one Peninsular farmgate
   series and FOB SMR20, daily automated retrieval, private retention, derived analytics and public
   display. Request a 12-month test fixture and revision/rate-limit documentation.
2. In parallel, obtain one corporate EOD contract from **one** exchange or licensed vendor. JPX's
   single daily CSV is technically the smallest contract-level adapter; SGX SICOM is economically
   the most relevant benchmark; SHFE/INE best matches RU/NR. Choose by granted rights and cost, not
   by ease of scraping.
3. Until both gates pass, allow only editor-entered, cited MRB/RAOT/DOSM facts with
   `quality=manual`; keep the thesis state `insufficient` when physical confirmation is absent.
4. Optionally add the World Bank monthly RSS3/TSR20 series as a clearly labelled CC BY 4.0
   cross-check after its bounded wire/parser contract is approved. It does not close this checklist
   item and must not upgrade a thesis on its own.

Authorization approval must record permitted audience, exact fields, delay, retention, raw versus
derived redistribution, attribution, fees, quotas, credentials, termination/deletion obligations
and whether archived revisions may remain after termination. Only then may the source be seeded
`enabled=0` for fixture and smoke testing; production enablement is a separate gate.
