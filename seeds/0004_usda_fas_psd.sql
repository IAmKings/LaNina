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
