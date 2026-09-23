import { describe, expect, it } from "vitest";

import { EIA_EUROPE_BRENT_SOURCE_ID } from "../adapters/sources/eia-europe-brent-spot";
import { NOAA_RONI_SOURCE_ID } from "../adapters/sources/noaa-roni";
import { USDA_FAS_PSD_SOURCE_CONFIGS } from "../adapters/sources/usda-fas-psd";
import { selectLiveSmokeTargets } from "./live-smoke-targets";

describe("live smoke target activation", () => {
  it("defaults to no targets even when source IDs and secrets are present", () => {
    expect(selectLiveSmokeTargets({
      enabled: false,
      sourceIds: [NOAA_RONI_SOURCE_ID, EIA_EUROPE_BRENT_SOURCE_ID],
      eiaApiKey: "must-not-be-read",
    })).toEqual({ targets: [], skippedSourceIds: [] });
    expect(selectLiveSmokeTargets({ enabled: true, sourceIds: [] })).toEqual({
      targets: [],
      skippedSourceIds: [],
    });
  });

  it("selects only explicitly named code-owned sources", () => {
    const selection = selectLiveSmokeTargets({
      enabled: true,
      sourceIds: [NOAA_RONI_SOURCE_ID],
    });

    expect(selection.targets).toHaveLength(1);
    expect(selection.targets[0]).toMatchObject({ sourceId: NOAA_RONI_SOURCE_ID });
    expect(selection.skippedSourceIds).toEqual([]);
  });

  it("skips selected credentialed sources when their secrets are absent", () => {
    const usdaSourceId = USDA_FAS_PSD_SOURCE_CONFIGS[0].sourceId;
    const selection = selectLiveSmokeTargets({
      enabled: true,
      sourceIds: [EIA_EUROPE_BRENT_SOURCE_ID, usdaSourceId],
    });

    expect(selection.targets).toEqual([]);
    expect(selection.skippedSourceIds).toEqual([EIA_EUROPE_BRENT_SOURCE_ID, usdaSourceId]);
  });

  it("selects a named credentialed source without exposing its secret in the target", () => {
    const secret = "private-live-eia-key";
    const selection = selectLiveSmokeTargets({
      enabled: true,
      sourceIds: [EIA_EUROPE_BRENT_SOURCE_ID],
      eiaApiKey: secret,
    });

    expect(selection.targets).toHaveLength(1);
    expect(selection.targets[0].sourceId).toBe(EIA_EUROPE_BRENT_SOURCE_ID);
    expect(Object.keys(selection.targets[0].adapter).sort()).toEqual(["collect", "key"]);
    expect(JSON.stringify(selection)).not.toContain(secret);
  });

  it("rejects unknown and duplicate source IDs as configuration errors", () => {
    expect(() => selectLiveSmokeTargets({
      enabled: true,
      sourceIds: ["database-provided-source"],
    })).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    expect(() => selectLiveSmokeTargets({
      enabled: true,
      sourceIds: [NOAA_RONI_SOURCE_ID, NOAA_RONI_SOURCE_ID],
    })).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    expect(() => selectLiveSmokeTargets({
      enabled: true,
      sourceIds: ["*"],
    })).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  });
});
