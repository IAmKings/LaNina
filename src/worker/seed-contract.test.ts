import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import sourceSeed from "../../seeds/0002_sources_indicators.sql?raw";
import rainfallSeed from "../../seeds/0003_regional_rainfall.sql?raw";
import usdaPsdSeed from "../../seeds/0004_usda_fas_psd.sql?raw";
import eiaBrentSeed from "../../seeds/0005_eia_europe_brent.sql?raw";
import {
  USDA_FAS_PSD_ADAPTER_KEY,
  USDA_FAS_PSD_SOURCE_CONFIGS,
  USDA_FAS_PSD_SOURCE_URL,
} from "./adapters/sources/usda-fas-psd";
import {
  EIA_EUROPE_BRENT_ADAPTER_KEY,
  EIA_EUROPE_BRENT_INDICATOR_ID,
  EIA_EUROPE_BRENT_SOURCE_ID,
  EIA_EUROPE_BRENT_SOURCE_URL,
} from "./adapters/sources/eia-europe-brent-spot";

describe("local source seed contract", () => {
  it("seeds the approved NOAA source and indicator idempotently", () => {
    expect(sourceSeed.match(/INSERT OR IGNORE/g)).toHaveLength(2);
    expect(sourceSeed).toContain("'noaa_cpc_roni'");
    expect(sourceSeed).toContain("'noaa-cpc-roni-v6'");
    expect(sourceSeed).toContain("'enso_roni_ersstv6'");
    expect(sourceSeed).toContain("1440");
    expect(sourceSeed).toContain("'2026-09-08T00:00:00.000Z'");
  });

  it("runs every ordered seed in the local seed command", () => {
    expect(packageJson.scripts["db:seed:local"]).toContain("seeds/0001_theses.sql");
    expect(packageJson.scripts["db:seed:local"]).toContain("seeds/0002_sources_indicators.sql");
    expect(packageJson.scripts["db:seed:local"]).toContain("seeds/0003_regional_rainfall.sql");
    expect(packageJson.scripts["db:seed:local"]).toContain("seeds/0004_usda_fas_psd.sql");
    expect(packageJson.scripts["db:seed:local"]).toContain("seeds/0005_eia_europe_brent.sql");
  });

  it("seeds four enabled, derived-only versioned rainfall series idempotently", () => {
    expect(rainfallSeed.match(/INSERT OR IGNORE/g)).toHaveLength(2);
    expect(rainfallSeed.match(/nasa_power_rainfall_[a-z_]+_v1/g)).toHaveLength(8);
    expect(rainfallSeed.match(/regional_rainfall_[a-z_]+_v1/g)).toHaveLength(4);
    expect(rainfallSeed.match(/'nasa-power-regional-rainfall-v1'/g)).toHaveLength(4);
    expect(rainfallSeed.match(/1440, 2880, 10080/g)).toHaveLength(4);
    expect(rainfallSeed.match(/NULL, 0, 1, 'derived_only'/g)).toHaveLength(4);
  });

  it("seeds two disabled USDA PSD sources and six private estimate indicators idempotently", () => {
    expect(usdaPsdSeed.match(/INSERT OR IGNORE/g)).toHaveLength(2);
    expect(usdaPsdSeed.match(/'usda-fas-psd-v1'/g)).toHaveLength(2);
    expect(usdaPsdSeed.match(/1440, 2880, 10080/g)).toHaveLength(2);
    expect(usdaPsdSeed.match(/NULL, 0, 1, 'derived_only'/g)).toHaveLength(2);
    expect(usdaPsdSeed.match(/'1000 MT', 'monthly'/g)).toHaveLength(6);
    expect(usdaPsdSeed.match(/'context', 1/g)).toHaveLength(6);
    expect(usdaPsdSeed).not.toContain("X-Api-Key");
    expect(usdaPsdSeed).not.toMatch(/[?&](?:api_)?key=/i);
  });

  it("keeps every USDA runtime source and indicator ID aligned with the seed", () => {
    expect(usdaPsdSeed).toContain(`'${USDA_FAS_PSD_SOURCE_URL}'`);
    expect(usdaPsdSeed.match(new RegExp(`'${USDA_FAS_PSD_ADAPTER_KEY}'`, "g"))).toHaveLength(2);
    for (const config of USDA_FAS_PSD_SOURCE_CONFIGS) {
      expect(usdaPsdSeed).toContain(`'${config.sourceId}'`);
      for (const indicatorId of Object.values(config.indicators)) {
        expect(usdaPsdSeed).toContain(`'${indicatorId}'`);
      }
    }
  });

  it("seeds one disabled derived-only EIA control and one private daily indicator", () => {
    expect(eiaBrentSeed.match(/INSERT OR IGNORE/g)).toHaveLength(2);
    expect(eiaBrentSeed).toContain(`'${EIA_EUROPE_BRENT_SOURCE_ID}'`);
    expect(eiaBrentSeed).toContain(`'${EIA_EUROPE_BRENT_ADAPTER_KEY}'`);
    expect(eiaBrentSeed).toContain(`'${EIA_EUROPE_BRENT_SOURCE_URL}'`);
    expect(eiaBrentSeed).toContain(`'${EIA_EUROPE_BRENT_INDICATOR_ID}'`);
    expect(eiaBrentSeed).toContain("1440, 10080, 20160");
    expect(eiaBrentSeed).toContain("NULL, 0, 1, 'derived_only'");
    expect(eiaBrentSeed).toContain("'USD/bbl', 'daily'");
    expect(eiaBrentSeed).toContain("'context', 1");
    expect(eiaBrentSeed).not.toMatch(/[?&]api_key=/i);
  });
});
