import type { SourceAdapter } from "../../../domain/ingestion";
import { jpxOseSettlementAdapter } from "./jpx-ose-settlement";
import { noaaRoniAdapter } from "./noaa-roni";
import {
  createUnctadLsciAdapter,
  UNCTAD_ADAPTER_KEY,
} from "./unctad-lsci";
import {
  createUsaCensusIntlTradeAdapter,
  USA_CENSUS_ADAPTER_KEY,
} from "./usa-census-intltrade";
import { worldBankPinkSheetAdapter } from "./world-bank-pink-sheet";
import { nasaPowerRegionalRainfallAdapter } from "./nasa-power-regional-rainfall";
import {
  createUsdaFasPsdAdapter,
  USDA_FAS_PSD_ADAPTER_KEY,
} from "./usda-fas-psd";
import {
  createEiaEuropeBrentSpotAdapter,
  EIA_EUROPE_BRENT_ADAPTER_KEY,
} from "./eia-europe-brent-spot";

/**
 * 无凭证的已批准适配器实例。新增 key-only 适配器只需把实例加入此数组——
 * 注册表与批准键判定都从这里推导。
 */
const keyOnlyApprovedAdapters: readonly SourceAdapter[] = [
  noaaRoniAdapter,
  nasaPowerRegionalRainfallAdapter,
  worldBankPinkSheetAdapter,
  jpxOseSettlementAdapter,
];

export interface SourceAdapterRegistryOptions {
  usdaFasApiKey?: string;
  eiaApiKey?: string;
  censusApiKey?: string;
  unctadClientId?: string;
  unctadApiKey?: string;
}

/** 凭证注入型适配器工厂：新增适配器只改这一张表（键 + 工厂各一处）。 */
const approvedAdapterFactories: readonly {
  key: string;
  create(options: SourceAdapterRegistryOptions): SourceAdapter;
}[] = [
  {
    key: USA_CENSUS_ADAPTER_KEY,
    create: (options) => createUsaCensusIntlTradeAdapter(options.censusApiKey),
  },
  {
    key: UNCTAD_ADAPTER_KEY,
    create: (options) =>
      createUnctadLsciAdapter({ clientId: options.unctadClientId, apiKey: options.unctadApiKey }),
  },
  {
    key: USDA_FAS_PSD_ADAPTER_KEY,
    create: (options) => createUsdaFasPsdAdapter(options.usdaFasApiKey),
  },
  {
    key: EIA_EUROPE_BRENT_ADAPTER_KEY,
    create: (options) => createEiaEuropeBrentSpotAdapter(options.eiaApiKey),
  },
];

/** 凭证注入型适配器的批准键常量表：isApprovedSourceAdapterKey 的唯一判定来源之一。 */
const FACTORY_KEYS: readonly string[] = approvedAdapterFactories.map(({ key }) => key);

export function createSourceAdapterRegistry(
  options: SourceAdapterRegistryOptions = {},
): ReadonlyMap<string, SourceAdapter> {
  return new Map([
    ...keyOnlyApprovedAdapters.map((adapter) => [adapter.key, adapter] as const),
    ...approvedAdapterFactories.map(({ key, create }) => [key, create(options)] as const),
  ]);
}

export function isApprovedSourceAdapterKey(key: string): boolean {
  return (
    FACTORY_KEYS.includes(key) ||
    keyOnlyApprovedAdapters.some((adapter) => adapter.key === key)
  );
}
