INSERT OR IGNORE INTO sources (
  id, name, organization, tier, homepage_url, license_url, adapter_key,
  cadence_minutes, late_after_minutes, stale_after_minutes, next_due_at,
  last_success_at, consecutive_failures, enabled, redistribution,
  created_at, updated_at
) VALUES (
  'noaa_cpc_roni',
  'NOAA CPC Relative Oceanic Nino Index',
  'NOAA Climate Prediction Center',
  'A',
  'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/',
  'https://data.noaa.gov/docucomp/xmlComponent/show/690447',
  'noaa-cpc-roni-v6',
  1440,
  10080,
  43200,
  '2026-09-08T00:00:00.000Z',
  NULL,
  0,
  1,
  'allowed',
  '2026-09-08T00:00:00.000Z',
  '2026-09-08T00:00:00.000Z'
);

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
) VALUES (
  'enso_roni_ersstv6',
  'Relative Oceanic Nino Index (ERSSTv6)',
  'climate',
  'Nino 3.4 region',
  '°C',
  'seasonal',
  'noaa_cpc_roni',
  'Three-month running mean ERSSTv6 sea-surface temperature anomaly in the Nino 3.4 region, adjusted relative to the tropical mean.',
  'context',
  1
);
