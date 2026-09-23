import type { SourceAdapter } from "../../../domain/ingestion";
import {
  JPX_OSE_ADAPTER_KEY,
  jpxOseSettlementAdapter,
} from "./jpx-ose-settlement";
import {
  NOAA_RONI_ADAPTER_KEY,
  noaaRoniAdapter,
} from "./noaa-roni";
import {
  createUnctadLsciAdapter,
  UNCTAD_ADAPTER_KEY,
} from "./unctad-lsci";
import {
  createUsaCensusIntlTradeAdapter,
  USA_CENSUS_ADAPTER_KEY,
} from "./usa-census-intltrade";
import {
  WORLD_BANK_ADAPTER_KEY,
  worldBankPinkSheetAdapter,
} from "./world-bank-pink-sheet";
import {
  NASA_POWER_RAINFALL_ADAPTER_KEY,
  nasaPowerRegionalRainfallAdapter,
} from "./nasa-power-regional-rainfall";
import {
  createUsdaFasPsdAdapter,
  USDA_FAS_PSD_ADAPTER_KEY,
} from "./usda-fas-psd";
import {
  createEiaEuropeBrentSpotAdapter,
  EIA_EUROPE_BRENT_ADAPTER_KEY,
} from "./eia-europe-brent-spot";

const keyOnlyApprovedAdapters = new Map<string, SourceAdapter>([
  [NOAA_RONI_ADAPTER_KEY, noaaRoniAdapter],
  [NASA_POWER_RAINFALL_ADAPTER_KEY, nasaPowerRegionalRainfallAdapter],
  [WORLD_BANK_ADAPTER_KEY, worldBankPinkSheetAdapter],
  [JPX_OSE_ADAPTER_KEY, jpxOseSettlementAdapter],
]);

export interface SourceAdapterRegistryOptions {
  usdaFasApiKey?: string;
  eiaApiKey?: string;
  censusApiKey?: string;
  unctadClientId?: string;
  unctadApiKey?: string;
}

export function createSourceAdapterRegistry(
  options: SourceAdapterRegistryOptions = {},
): ReadonlyMap<string, SourceAdapter> {
  return new Map([
    ...keyOnlyApprovedAdapters,
    [USA_CENSUS_ADAPTER_KEY, createUsaCensusIntlTradeAdapter(options.censusApiKey)] as const,
    [UNCTAD_ADAPTER_KEY, createUnctadLsciAdapter({ clientId: options.unctadClientId, apiKey: options.unctadApiKey })] as const,
    [USDA_FAS_PSD_ADAPTER_KEY, createUsdaFasPsdAdapter(options.usdaFasApiKey)] as const,
    [EIA_EUROPE_BRENT_ADAPTER_KEY, createEiaEuropeBrentSpotAdapter(options.eiaApiKey)] as const,
  ]);
}

export function isApprovedSourceAdapterKey(key: string): boolean {
  return (
    key === USA_CENSUS_ADAPTER_KEY ||
    key === UNCTAD_ADAPTER_KEY ||
    key === USDA_FAS_PSD_ADAPTER_KEY ||
    key === EIA_EUROPE_BRENT_ADAPTER_KEY ||
    keyOnlyApprovedAdapters.has(key)
  );
}
