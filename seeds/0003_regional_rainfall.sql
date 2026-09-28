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

-- Derived indicators (signed 2026-09-27). Same rows as migrations/0014_derived_indicators.sql.
-- Migrations apply before seeds on a fresh database, so 0014 is a no-op until parent
-- sources exist; these inserts cover that order. A repeated insert is ignored.

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'thai_rain_anomaly_30d_pct',
  'Derived: Thailand Rubber 30-day Rainfall Anomaly',
  'rubber',
  'Southern Thailand',
  '%',
  'daily',
  'nasa_power_rainfall_southern_thailand_rubber_v1',
  'Derived indicator: 30-day rolling rainfall total of the southern Thailand rubber proxy versus the WMO 1991-2020 climatology total over the same 30-day window, in percent; negative means drier than normal. Computed by the derived-indicator step from regional_rainfall_southern_thailand_rubber_v1 daily observations with the monthly climatology day-weighted across the window; observed_at is the window end day. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4); Basis is the NASA POWER 1991-2020 monthly climatology collected for the parent source.',
  'relief',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_southern_thailand_rubber_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'sea_rain_anomaly_90d_pct',
  'Derived: Maritime Continent Palm 90-day Rainfall Anomaly',
  'agriculture',
  'Maritime Continent',
  '%',
  'daily',
  'nasa_power_rainfall_maritime_continent_palm_v1',
  'Derived indicator: 90-day rolling rainfall total of the maritime-continent palm proxy versus the WMO 1991-2020 climatology total over the same 90-day window, in percent; negative means drier than normal. Computed by the derived-indicator step from regional_rainfall_maritime_continent_palm_v1 daily observations with the monthly climatology day-weighted across the window; observed_at is the window end day. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4); Basis is the NASA POWER 1991-2020 monthly climatology collected for the parent source.',
  'relief',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_maritime_continent_palm_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'sa_maize_rain_anomaly_crop_window_pct',
  'Derived: Southern Africa Maize Crop-Window Rainfall Anomaly',
  'agriculture',
  'Southern Africa',
  '%',
  'seasonal',
  'nasa_power_rainfall_southern_africa_maize_v1',
  'Derived indicator: November-March crop-window rainfall total of the southern Africa maize proxy versus the WMO 1991-2020 climatology total over the same months, in percent; negative means drier than normal. Computed by the derived-indicator step from regional_rainfall_southern_africa_maize_v1 daily observations with the monthly climatology summed across the five months; observed_at is the window end (31 March). An unfinished window produces no observation. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4). Basis is the NASA POWER 1991-2020 monthly climatology collected for the parent source.',
  'relief',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_southern_africa_maize_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'thai_rainfall_climatology_monthly',
  'WMO 1991-2020 Monthly Climatology: Southern Thailand Rubber Rainfall',
  'rubber',
  'Southern Thailand',
  'mm/day',
  'monthly',
  'nasa_power_rainfall_southern_thailand_rubber_v1',
  'Basis data for rainfall-anomaly derivations: 1991-2020 monthly climatology (mm/day) of the southern Thailand rubber rainfall proxy, 12 observations with month-order semantics; observed_at uses representative year 2020 on the 15th of each month and must not be read as a time series. Collected by the NASA POWER climatology variant for 1991-2020. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'context',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_southern_thailand_rubber_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'sea_rainfall_climatology_monthly',
  'WMO 1991-2020 Monthly Climatology: Maritime Continent Palm Rainfall',
  'agriculture',
  'Maritime Continent',
  'mm/day',
  'monthly',
  'nasa_power_rainfall_maritime_continent_palm_v1',
  'Basis data for rainfall-anomaly derivations: 1991-2020 monthly climatology (mm/day) of the maritime-continent palm rainfall proxy, 12 observations with month-order semantics; observed_at uses representative year 2020 on the 15th of each month and must not be read as a time series. Collected by the NASA POWER climatology variant for 1991-2020. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'context',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_maritime_continent_palm_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'sa_maize_rainfall_climatology_monthly',
  'WMO 1991-2020 Monthly Climatology: Southern Africa Maize Rainfall',
  'agriculture',
  'Southern Africa',
  'mm/day',
  'monthly',
  'nasa_power_rainfall_southern_africa_maize_v1',
  'Basis data for rainfall-anomaly derivations: 1991-2020 monthly climatology (mm/day) of the southern Africa maize rainfall proxy, 12 observations with month-order semantics; observed_at uses representative year 2020 on the 15th of each month and must not be read as a time series. Collected by the NASA POWER climatology variant for 1991-2020. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'context',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_southern_africa_maize_v1');

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
)
SELECT
  'panama_rainfall_climatology_monthly',
  'WMO 1991-2020 Monthly Climatology: Panama Canal Catchment Rainfall',
  'shipping',
  'Panama Canal catchment proxy',
  'mm/day',
  'monthly',
  'nasa_power_rainfall_panama_canal_catchment_v1',
  'Basis data for rainfall-anomaly derivations: 1991-2020 monthly climatology (mm/day) of the Panama Canal catchment rainfall proxy, 12 observations with month-order semantics; observed_at uses representative year 2020 on the 15th of each month and must not be read as a time series. Collected by the NASA POWER climatology variant for 1991-2020. Basis period signed by research 2026-09-27 (threshold backfill sheet section 4).',
  'context',
  1
WHERE EXISTS (SELECT 1 FROM sources WHERE id = 'nasa_power_rainfall_panama_canal_catchment_v1');
