INSERT OR IGNORE INTO sources (
  id, name, organization, tier, homepage_url, license_url, adapter_key,
  cadence_minutes, late_after_minutes, stale_after_minutes, next_due_at,
  last_success_at, consecutive_failures, enabled, redistribution,
  created_at, updated_at
) VALUES (
  'eia_europe_brent_spot',
  'EIA Europe Brent Spot Price',
  'U.S. Energy Information Administration', 'A',
  'https://api.eia.gov/v2/petroleum/pri/spt/data/',
  'https://www.eia.gov/opendata/terms-of-service.php',
  'eia-petroleum-spot-v1',
  1440, 10080, 20160, '2026-09-09T18:17:00.000Z', NULL, 0, 1, 'derived_only',
  '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z'
);

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
) VALUES (
  'eia_europe_brent_spot_usd_per_bbl_daily',
  'EIA Europe Brent Spot Price',
  'control', 'Europe/global-control', 'USD/bbl', 'daily',
  'eia_europe_brent_spot',
  'Daily Europe Brent crude spot-price control; not bunker fuel, a carrier surcharge or a route freight rate.',
  'context', 1
);
