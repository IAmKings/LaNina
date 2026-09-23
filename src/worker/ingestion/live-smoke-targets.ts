import { SourceCollectionError } from "../../domain/ingestion";
import {
  EIA_EUROPE_BRENT_ADAPTER_KEY,
  EIA_EUROPE_BRENT_SOURCE_ID,
  EIA_EUROPE_BRENT_SOURCE_URL,
} from "../adapters/sources/eia-europe-brent-spot";
import {
  NASA_POWER_DAILY_POINT_URL,
  NASA_POWER_RAINFALL_ADAPTER_KEY,
  REGIONAL_RAINFALL_SOURCE_CONFIGS,
} from "../adapters/sources/nasa-power-regional-rainfall";
import {
  JPX_OSE_ADAPTER_KEY,
  JPX_OSE_SOURCE_ID,
  JPX_OSE_SOURCE_URL,
} from "../adapters/sources/jpx-ose-settlement";
import {
  NOAA_RONI_ADAPTER_KEY,
  NOAA_RONI_SOURCE_ID,
  NOAA_RONI_URL,
} from "../adapters/sources/noaa-roni";
import {
  WORLD_BANK_ADAPTER_KEY,
  WORLD_BANK_SOURCE_ID,
  WORLD_BANK_SOURCE_URL,
} from "../adapters/sources/world-bank-pink-sheet";
import { createSourceAdapterRegistry } from "../adapters/sources/registry";
import {
  UNCTAD_ADAPTER_KEY,
  UNCTAD_SOURCE_ID,
  UNCTAD_SOURCE_URL,
} from "../adapters/sources/unctad-lsci";
import {
  USA_CENSUS_ADAPTER_KEY,
  USA_CENSUS_SOURCE_ID,
  USA_CENSUS_SOURCE_URL,
} from "../adapters/sources/usa-census-intltrade";
import {
  USDA_FAS_PSD_ADAPTER_KEY,
  USDA_FAS_PSD_SOURCE_CONFIGS,
  USDA_FAS_PSD_SOURCE_URL,
} from "../adapters/sources/usda-fas-psd";
import type { LiveSmokeTarget } from "./live-smoke";

type SecretRequirement = "usda" | "eia" | "census" | "unctad" | null;

export interface CodeOwnedSourceTarget {
  sourceId: string;
  sourceUrl: string;
  adapterKey: string;
  requiredSecret: SecretRequirement;
}

export interface LiveSmokeActivation {
  enabled: boolean;
  sourceIds: readonly string[];
  usdaFasApiKey?: string;
  eiaApiKey?: string;
  censusApiKey?: string;
  unctadClientId?: string;
  unctadApiKey?: string;
}

export interface LiveSmokeSelection {
  targets: LiveSmokeTarget[];
  skippedSourceIds: string[];
}

const targetDefinitions = new Map<string, CodeOwnedSourceTarget>([
  definition(NOAA_RONI_SOURCE_ID, NOAA_RONI_URL, NOAA_RONI_ADAPTER_KEY, null),
  ...REGIONAL_RAINFALL_SOURCE_CONFIGS.map((config) =>
    definition(
      config.sourceId,
      NASA_POWER_DAILY_POINT_URL,
      NASA_POWER_RAINFALL_ADAPTER_KEY,
      null,
    ),
  ),
  ...USDA_FAS_PSD_SOURCE_CONFIGS.map((config) =>
    definition(config.sourceId, USDA_FAS_PSD_SOURCE_URL, USDA_FAS_PSD_ADAPTER_KEY, "usda"),
  ),
  definition(
    EIA_EUROPE_BRENT_SOURCE_ID,
    EIA_EUROPE_BRENT_SOURCE_URL,
    EIA_EUROPE_BRENT_ADAPTER_KEY,
    "eia",
  ),
  definition(
    WORLD_BANK_SOURCE_ID,
    WORLD_BANK_SOURCE_URL,
    WORLD_BANK_ADAPTER_KEY,
    null,
  ),
  definition(
    JPX_OSE_SOURCE_ID,
    JPX_OSE_SOURCE_URL,
    JPX_OSE_ADAPTER_KEY,
    null,
  ),
  definition(
    USA_CENSUS_SOURCE_ID,
    USA_CENSUS_SOURCE_URL,
    USA_CENSUS_ADAPTER_KEY,
    "census",
  ),
  definition(
    UNCTAD_SOURCE_ID,
    UNCTAD_SOURCE_URL,
    UNCTAD_ADAPTER_KEY,
    "unctad",
  ),
].map((entry) => [entry.sourceId, entry]));

/**
 * Returns the code-owned source identity used by every direct collection path.
 * Callers must still check that the enabled D1 source declares the same adapter.
 */
export function codeOwnedSourceTarget(sourceId: string): CodeOwnedSourceTarget | null {
  return targetDefinitions.get(sourceId) ?? null;
}

/** Selects only explicitly named, code-owned sources; missing secrets skip the named source. */
export function selectLiveSmokeTargets(activation: LiveSmokeActivation): LiveSmokeSelection {
  if (!activation.enabled) return { targets: [], skippedSourceIds: [] };

  const selectedIds = new Set<string>();
  const registry = createSourceAdapterRegistry({
    usdaFasApiKey: activation.usdaFasApiKey,
    eiaApiKey: activation.eiaApiKey,
    censusApiKey: activation.censusApiKey,
    unctadClientId: activation.unctadClientId,
    unctadApiKey: activation.unctadApiKey,
  });
  const targets: LiveSmokeTarget[] = [];
  const skippedSourceIds: string[] = [];

  for (const sourceId of activation.sourceIds) {
    if (selectedIds.has(sourceId)) {
      throw new SourceCollectionError("VALIDATION", "live smoke 来源 ID 不能重复");
    }
    selectedIds.add(sourceId);

    const configured = targetDefinitions.get(sourceId);
    if (configured === undefined) {
      throw new SourceCollectionError("VALIDATION", "live smoke 来源 ID 不在代码白名单");
    }
    if (!hasRequiredSecret(configured.requiredSecret, activation)) {
      skippedSourceIds.push(sourceId);
      continue;
    }
    const adapter = registry.get(configured.adapterKey);
    if (adapter === undefined) {
      throw new SourceCollectionError("VALIDATION", "live smoke 适配器未注册");
    }
    targets.push({ sourceId, sourceUrl: configured.sourceUrl, adapter });
  }

  return { targets, skippedSourceIds };
}

function definition(
  sourceId: string,
  sourceUrl: string,
  adapterKey: string,
  requiredSecret: SecretRequirement,
): CodeOwnedSourceTarget {
  return { sourceId, sourceUrl, adapterKey, requiredSecret };
}

function hasRequiredSecret(
  requirement: SecretRequirement,
  activation: LiveSmokeActivation,
): boolean {
  if (requirement === "usda") return hasText(activation.usdaFasApiKey);
  if (requirement === "eia") return hasText(activation.eiaApiKey);
  if (requirement === "census") return hasText(activation.censusApiKey);
  if (requirement === "unctad") {
    return hasText(activation.unctadClientId) && hasText(activation.unctadApiKey);
  }
  return true;
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
