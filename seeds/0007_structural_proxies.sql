-- 航运结构代理（A-Ⅱ 层零成本登记稿）：U.S. Census Intl Trade + UNCTAD LSCI/PLSCI。
-- 登记 + seed 仅作为"已识别候选"；两者的 adapter 实现受限于：
--   1) Census 需免费 API key（api.census.gov 申请，人工管理 .dev.vars：CENSUS_API_KEY），
--      且须冻结"维度 / 抑制 / 修订 / 滞后"契约与有界查询 fixture；
--   2) UNCTAD Data Hub 的 exact 端点/schema 在 Spike 中未冻结，须先出小 spike。
-- 因此本文件**只登记不启用**（enabled=0、public=0），adapter 一律未实现，
-- 属登记册所述 pending 状态；不产生任何自动抓取。
INSERT OR IGNORE INTO sources (
  id, name, organization, tier, homepage_url, license_url, adapter_key,
  cadence_minutes, late_after_minutes, stale_after_minutes, next_due_at,
  last_success_at, consecutive_failures, enabled, redistribution,
  created_at, updated_at
) VALUES
  (
    'usa_census_intltrade_route_proxy',
    'U.S. Census International Trade (route demand proxy)',
    'U.S. Census Bureau',
    'A',
    'https://api.census.gov/data/timeseries/intltrade/imports/porths',
    'https://www.census.gov/foreign-trade/reference/codes/index.html',
    'usa-census-intltrade-v1',
    1440, 2880, 10080, '2026-09-21T00:00:00.000Z',
    NULL, 0, 1, 'unknown',
    '2026-09-21T00:00:00.000Z', '2026-09-21T00:00:00.000Z'
  ),
  (
    'unctad_datahub_lsci',
    'UNCTAD Data Hub LSCI',
    'UNCTAD',
    'A',
    'https://unctadstat-user-api.unctad.org/US.LSCI_M/cur/Facts?culture=en',
    'https://unctad.org/pagetext/terms',
    'unctad-lsci-v1',
    1440, 2880, 10080, '2026-09-21T00:00:00.000Z',
    NULL, 0, 1, 'unknown',
    '2026-09-21T00:00:00.000Z', '2026-09-21T00:00:00.000Z'
  );

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
) VALUES
  (
    'usa_imports_east_coast_monthly',
    'U.S. East-Coast Import Volume (census proxy)',
    'shipping',
    'US customs districts (route demand proxy)',
    'kg',
    'monthly',
    'usa_census_intltrade_route_proxy',
    'Bounded US Census International Trade monthly US imports volume (kg) for the two focus trade-lane regions. Structural route-demand proxy: higher means more demand pressure. Never implies a market rate.',
    'pressure',
    0
  ),
  (
    'unctad_lsci_monthly',
    'UNCTAD LSCI Monthly (connectivity proxy)',
    'shipping',
    'per-economy (UNCTAD Data Hub)',
    'index',
    'monthly',
    'unctad_datahub_lsci',
    'UNCTAD Liner Shipping Connectivity Index — monthly per-economy values (Data Hub metric M4023, measure 4023), sourced from UNCTADstat. Structural connectivity proxy: higher means better maritime connectivity. Never implies a market rate.',
    'context',
    1
  );
