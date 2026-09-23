INSERT OR IGNORE INTO sources (
  id, name, organization, tier, homepage_url, license_url, adapter_key,
  cadence_minutes, late_after_minutes, stale_after_minutes, next_due_at,
  last_success_at, consecutive_failures, enabled, redistribution,
  created_at, updated_at
) VALUES
  (
    'nasa_power_rainfall_southern_thailand_rubber_v1',
    'NASA POWER Southern Thailand Rubber Rainfall v1',
    'NASA Langley POWER', 'A',
    'https://power.larc.nasa.gov/api/temporal/daily/point',
    'https://power.larc.nasa.gov/docs/referencing/',
    'nasa-power-regional-rainfall-v1',
    1440, 2880, 10080, '2026-09-09T01:17:00.000Z', NULL, 0, 1, 'derived_only',
    '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z'
  ),
  (
    'nasa_power_rainfall_maritime_continent_palm_v1',
    'NASA POWER Maritime Continent Palm Rainfall v1',
    'NASA Langley POWER', 'A',
    'https://power.larc.nasa.gov/api/temporal/daily/point',
    'https://power.larc.nasa.gov/docs/referencing/',
    'nasa-power-regional-rainfall-v1',
    1440, 2880, 10080, '2026-09-09T01:17:00.000Z', NULL, 0, 1, 'derived_only',
    '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z'
  ),
  (
    'nasa_power_rainfall_southern_africa_maize_v1',
    'NASA POWER Southern Africa Maize Rainfall v1',
    'NASA Langley POWER', 'A',
    'https://power.larc.nasa.gov/api/temporal/daily/point',
    'https://power.larc.nasa.gov/docs/referencing/',
    'nasa-power-regional-rainfall-v1',
    1440, 2880, 10080, '2026-09-09T01:17:00.000Z', NULL, 0, 1, 'derived_only',
    '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z'
  ),
  (
    'nasa_power_rainfall_panama_canal_catchment_v1',
    'NASA POWER Panama Canal Catchment Rainfall v1',
    'NASA Langley POWER', 'A',
    'https://power.larc.nasa.gov/api/temporal/daily/point',
    'https://power.larc.nasa.gov/docs/referencing/',
    'nasa-power-regional-rainfall-v1',
    1440, 2880, 10080, '2026-09-09T01:17:00.000Z', NULL, 0, 1, 'derived_only',
    '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z'
  );

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
) VALUES
  (
    'regional_rainfall_southern_thailand_rubber_v1',
    'Southern Thailand Rubber Rainfall Proxy v1', 'rubber', 'Southern Thailand',
    'mm/day', 'daily', 'nasa_power_rainfall_southern_thailand_rubber_v1',
    'Equal-weight daily mean across rainfall-regions-v1 southern_thailand_rubber_v1 points with at least 75% coverage.',
    'context', 1
  ),
  (
    'regional_rainfall_maritime_continent_palm_v1',
    'Maritime Continent Palm Rainfall Proxy v1', 'agriculture', 'Maritime Continent',
    'mm/day', 'daily', 'nasa_power_rainfall_maritime_continent_palm_v1',
    'Equal-weight daily mean across rainfall-regions-v1 maritime_continent_palm_v1 points with at least 75% coverage.',
    'context', 1
  ),
  (
    'regional_rainfall_southern_africa_maize_v1',
    'Southern Africa Maize Rainfall Proxy v1', 'agriculture', 'Southern Africa',
    'mm/day', 'daily', 'nasa_power_rainfall_southern_africa_maize_v1',
    'Equal-weight daily mean across rainfall-regions-v1 southern_africa_maize_v1 points with at least 75% coverage.',
    'context', 1
  ),
  (
    'regional_rainfall_panama_canal_catchment_v1',
    'Panama Canal Catchment Rainfall Proxy v1', 'shipping', 'Panama Canal catchment proxy',
    'mm/day', 'daily', 'nasa_power_rainfall_panama_canal_catchment_v1',
    'Equal-weight daily mean across rainfall-regions-v1 panama_canal_catchment_v1 points with at least 75% coverage.',
    'context', 1
  );
