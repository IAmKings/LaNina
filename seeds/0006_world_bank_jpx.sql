-- A-Ⅱ 零成本来源登记：World Bank Pink Sheet（月度）与 JPX/OSE（当日结算 CSV）。
-- 2026-09-20 解锁：World Bank 的 Pink Sheet exact-value 复核与 JPX/OSE 当日 CSV 授权
-- 已按登记册口径核对确认（来源权利审核 approved），两个来源自此起 `enabled=1`、
-- 指标 `public=1`；本文件同时承载本地与生产种子。NASA/USDA/EIA 等其余来源仍按
-- seeds/9002 的 TEST ONLY 探针模式启用，未过三项签署前不翻身。
-- 来源条款锚点见 docs/sources/rubber-physical-market.md §4/§5。

INSERT OR IGNORE INTO sources (
  id, name, organization, tier, homepage_url, license_url, adapter_key,
  cadence_minutes, late_after_minutes, stale_after_minutes, next_due_at,
  last_success_at, consecutive_failures, enabled, redistribution,
  created_at, updated_at
) VALUES
  (
    'world_bank_commodity_prices',
    'World Bank Commodity Prices (Pink Sheet)',
    'World Bank',
    'A',
    'https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx',
    'https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections',
    'world-bank-pink-sheet-monthly-v1',
    1440, 10080, 43200, '2026-09-08T00:00:00.000Z',
    NULL, 0, 1, 'allowed',
    '2026-09-15T00:00:00.000Z', '2026-09-15T00:00:00.000Z'
  ),
  (
    'jpx_ose_rubber_settlement',
    'JPX/OSE Rubber Settlement Prices',
    'Japan Exchange Group',
    'A',
    'https://www.jpx.co.jp/english/markets/derivatives/settlement-price/',
    'https://www.jpx.co.jp/english/term-of-use/',
    'jpx-ose-settlement-v1',
    1440, 2880, 10080, '2026-09-08T00:00:00.000Z',
    NULL, 0, 1, 'allowed',
    '2026-09-15T00:00:00.000Z', '2026-09-15T00:00:00.000Z'
  );

INSERT OR IGNORE INTO indicators (
  id, name, domain, geography, unit, frequency, source_id,
  definition, higher_means, public
) VALUES
  (
    'world_bank_rubber_rss3_monthly',
    'World Bank Rubber RSS3 Monthly Benchmark',
    'rubber',
    'Singapore nearby contract',
    'USD/kg',
    'monthly',
    'world_bank_commodity_prices',
    'World Bank Pink Sheet Monthly Prices sheet RSS3 nearby-contract monthly average, USD per kg. The nearby definition belongs to the World Bank series; this is not a Thai farmgate or spot price.',
    'pressure',
    1
  ),
  (
    'world_bank_rubber_tsr20_monthly',
    'World Bank Rubber TSR20 Monthly Benchmark',
    'rubber',
    'Singapore nearby contract',
    'USD/kg',
    'monthly',
    'world_bank_commodity_prices',
    'World Bank Pink Sheet Monthly Prices sheet TSR20 nearby-contract monthly average (cup lump excluded), USD per kilogram.',
    'pressure',
    1
  ),
  (
    'jpx_ose_rss3_settlement_daily',
    'JPX/OSE RSS3 Rubber Future Settlement (daily)',
    'rubber',
    'OSE Tokyo',
    'JPY/kg',
    'daily',
    'jpx_ose_rubber_settlement',
    'OSE physically delivered RSS3 rubber futures daily settlement price, JPY per kilogram, per contract month, for the nearest listed maturity on the trade date.',
    'pressure',
    1
  ),
  (
    'jpx_ose_tsr20_settlement_daily',
    'JPX/OSE TSR20 Rubber Future Settlement (daily)',
    'rubber',
    'OSE Tokyo',
    'JPY/kg',
    'daily',
    'jpx_ose_rubber_settlement',
    'OSE physically delivered TSR20 rubber futures daily settlement price, JPY per kilogram, per contract month, for the nearest listed maturity on the trade date.',
    'pressure',
    1
  );
