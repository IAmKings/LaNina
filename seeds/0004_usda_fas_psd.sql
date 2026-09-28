INSERT OR IGNORE INTO sources (
  id, name, organization, tier, homepage_url, license_url, adapter_key,
  cadence_minutes, late_after_minutes, stale_after_minutes, next_due_at,
  last_success_at, consecutive_failures, enabled, redistribution,
  created_at, updated_at
) VALUES
  (
    'usda_psd_malaysia_palm_oil',
    'USDA FAS PSD Malaysia Palm Oil',
    'USDA Foreign Agricultural Service', 'A',
    'https://api.fas.usda.gov/api/psd',
    'https://dts.fsa.usda.gov/help/policies-and-links/index',
    'usda-fas-psd-v1',
    1440, 2880, 10080, '2026-09-09T18:17:00.000Z', NULL, 0, 1, 'derived_only',
    '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z'
  ),
  (
    'usda_psd_south_africa_corn',
    'USDA FAS PSD South Africa Corn',
    'USDA Foreign Agricultural Service', 'A',
    'https://api.fas.usda.gov/api/psd',
    'https://dts.fsa.usda.gov/help/policies-and-links/index',
    'usda-fas-psd-v1',
    1440, 2880, 10080, '2026-09-09T18:17:00.000Z', NULL, 0, 1, 'derived_only',
    '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z'
  );

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
) VALUES
  (
    'usda_psd_malaysia_palm_oil_production_1000mt',
    'USDA Estimate: Malaysia Palm Oil Production',
    'agriculture', 'Malaysia', '1000 MT', 'monthly',
    'usda_psd_malaysia_palm_oil',
    'USDA PSD marketing-year estimate for Malaysia palm-oil production; not an MPOB monthly actual.',
    'context', 1
  ),
  (
    'usda_psd_malaysia_palm_oil_exports_1000mt',
    'USDA Estimate: Malaysia Palm Oil Exports',
    'agriculture', 'Malaysia', '1000 MT', 'monthly',
    'usda_psd_malaysia_palm_oil',
    'USDA PSD marketing-year estimate for Malaysia palm-oil exports; not an MPOB monthly actual.',
    'context', 1
  ),
  (
    'usda_psd_malaysia_palm_oil_ending_stocks_1000mt',
    'USDA Estimate: Malaysia Palm Oil Ending Stocks',
    'agriculture', 'Malaysia', '1000 MT', 'monthly',
    'usda_psd_malaysia_palm_oil',
    'USDA PSD marketing-year estimate for Malaysia palm-oil ending stocks; not an MPOB monthly actual.',
    'context', 1
  ),
  (
    'usda_psd_south_africa_corn_production_1000mt',
    'USDA Estimate: South Africa Corn Production',
    'agriculture', 'South Africa', '1000 MT', 'monthly',
    'usda_psd_south_africa_corn',
    'USDA PSD marketing-year estimate for South Africa corn production; not a CEC forecast or SAGIS actual.',
    'context', 1
  ),
  (
    'usda_psd_south_africa_corn_exports_1000mt',
    'USDA Estimate: South Africa Corn Exports',
    'agriculture', 'South Africa', '1000 MT', 'monthly',
    'usda_psd_south_africa_corn',
    'USDA PSD marketing-year estimate for South Africa corn exports; not a CEC forecast or SAGIS actual.',
    'context', 1
  ),
  (
    'usda_psd_south_africa_corn_ending_stocks_1000mt',
    'USDA Estimate: South Africa Corn Ending Stocks',
    'agriculture', 'South Africa', '1000 MT', 'monthly',
    'usda_psd_south_africa_corn',
    'USDA PSD marketing-year estimate for South Africa corn ending stocks; not a CEC forecast or SAGIS actual.',
    'context', 1
  );

-- Derived indicators (signed 2026-09-27). Same rows as migrations/0014_derived_indicators.sql.
-- Migrations apply before seeds on a fresh database, so 0014 is a no-op until parent
-- sources exist; these inserts cover that order. A repeated insert is ignored.

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'usda_malaysia_palm_ending_stocks_yoy_pct',
  'Derived: Malaysia Palm Oil Ending Stocks Year-over-Year',
  'agriculture',
  'Malaysia',
  '%',
  'monthly',
  'usda_psd_malaysia_palm_oil',
  'Derived indicator: current USDA PSD marketing-year Malaysia palm-oil ending stocks versus the same indicator one marketing year earlier, in percent (negative = year-over-year stock drawdown). Computed by the derived-indicator step from usda_psd_malaysia_palm_oil_ending_stocks_1000mt observations; observed_at and period_start mirror the base marketing-year period end and start, and marketing-year ordering follows the base series exactly. A missing prior marketing year fails closed (no observation). Threshold semantics signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'relief',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'usda_psd_malaysia_palm_oil');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'sa_maize_production_vs_5yr_mean_pct',
  'Derived: South Africa Corn Production vs Five-Year Mean',
  'agriculture',
  'South Africa',
  '%',
  'monthly',
  'usda_psd_south_africa_corn',
  'Derived indicator: current USDA PSD marketing-year South Africa corn production versus the mean of the five prior marketing years, in percent (negative = below the five-year mean). Computed by the derived-indicator step from usda_psd_south_africa_corn_production_1000mt observations; observed_at and period_start mirror the base marketing-year period end and start, and marketing-year ordering follows the base series exactly. Any missing marketing year inside the five-year window fails closed (no observation). Threshold semantics signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'relief',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'usda_psd_south_africa_corn');

