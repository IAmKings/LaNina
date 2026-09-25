import { describe, expect, it, vi } from "vitest";

import type { CollectContext } from "../../../domain/ingestion";
import { RAINFALL_REGIONS_V1 } from "../../../domain/rainfall-regions";
import pointFixtureRaw from "./fixtures/nasa-power-rainfall-point.json?raw";
import {
  NASA_POWER_BUNDLE_MAX_BYTES,
  NASA_POWER_DAILY_POINT_URL,
  NASA_POWER_POINT_MAX_BYTES,
  nasaPowerRegionalRainfallAdapter,
  REGIONAL_RAINFALL_SOURCE_CONFIGS,
} from "./nasa-power-regional-rainfall";
import { defineAdapterContract } from "./testing/adapter-contract";

const PANAMA_SOURCE_ID = "nasa_power_rainfall_panama_canal_catchment_v1";
const baseContext: Omit<CollectContext, "fetch"> = {
  sourceId: PANAMA_SOURCE_ID,
  sourceUrl: NASA_POWER_DAILY_POINT_URL,
  scheduledAt: "2026-09-08T00:00:00.000Z",
  fetchedAt: "2026-09-08T12:34:56.000Z",
  previousEtag: null,
  previousLastModified: null,
  previousContentHash: null,
};

defineAdapterContract({
  name: "NASA POWER regional rainfall",
  adapter: nasaPowerRegionalRainfallAdapter,
  normal: {
    createContext: () => ({ ...baseContext, fetch: normalFetch() }),
    assertResult: (result) => {
      expect(result.status).toBe("changed");
      expect(result.observations).toHaveLength(14);
      expect(result.observations[0]).toMatchObject({
        indicatorId: "regional_rainfall_panama_canal_catchment_v1",
        observedAt: "2026-08-23T00:00:00.000Z",
        periodStart: "2026-08-23T00:00:00.000Z",
        value: 2.1111,
        unit: "mm/day",
        publishedAt: null,
        quality: "provisional",
        metadata: {
          regionDefinitionId: "rainfall-regions-v1",
          regionDefinitionVersion: 1,
          regionId: "panama_canal_catchment_v1",
          method: "equal_weight_mean",
          validPointCount: 3,
          totalPointCount: 3,
          coverageRatio: 1,
          apiVersion: "v2.9.7",
          sourceName: "GEOSIT",
        },
      });
      expect(result.observations[0].citationUrl).toContain("latitude=9.26");
      expect(new TextDecoder().decode(result.rawBody!)).toContain('"rawBody"');
    },
  },
  unchanged: {
    createContext: async () => {
      const first = await nasaPowerRegionalRainfallAdapter.collect({
        ...baseContext,
        fetch: normalFetch(),
      });
      return {
        ...baseContext,
        previousContentHash: first.contentHash,
        fetch: normalFetch(),
      };
    },
  },
  invalid: {
    createContext: () => ({
      ...baseContext,
      fetch: normalFetch((payload, call) => {
        if (call === 0) payload.parameters.PRECTOTCORR.units = "inch/day";
      }),
    }),
    expectedError: { code: "SCHEMA_DRIFT", retryable: false, httpStatus: null },
  },
});

describe("NASA POWER regional rainfall adapter behavior", () => {
  it("constructs the 14-day UTC window and every query parameter from code", async () => {
    const fetch = normalFetch();
    await nasaPowerRegionalRainfallAdapter.collect({ ...baseContext, fetch });

    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [input, init] of fetch.mock.calls) {
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe(NASA_POWER_DAILY_POINT_URL);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        parameters: "PRECTOTCORR",
        community: "AG",
        latitude: expect.any(String),
        longitude: expect.any(String),
        start: "20260823",
        end: "20260905",
        format: "JSON",
        "time-standard": "UTC",
      });
      // workerd 不支持 redirect:"error"（Node 支持）——部署到 Worker 会抛 TypeError，故改为 manual。
      expect(init).toMatchObject({ redirect: "manual" });
    }
  });

  it("keeps all four source IDs isolated to their code-owned region points", async () => {
    for (const configured of REGIONAL_RAINFALL_SOURCE_CONFIGS) {
      const fetch = normalFetch();
      const result = await nasaPowerRegionalRainfallAdapter.collect({
        ...baseContext,
        sourceId: configured.sourceId,
        fetch,
      });
      const region = RAINFALL_REGIONS_V1.find(({ id }) => id === configured.regionId)!;
      const requestedCoordinates = fetch.mock.calls.map(([input]) => {
        const url = new URL(String(input));
        return [Number(url.searchParams.get("latitude")), Number(url.searchParams.get("longitude"))];
      });

      expect(fetch).toHaveBeenCalledTimes(region.points.length);
      expect(requestedCoordinates).toEqual(
        region.points.map(({ latitude, longitude }) => [latitude, longitude]),
      );
      expect(new Set(result.observations.map(({ indicatorId }) => indicatorId))).toEqual(
        new Set([configured.indicatorId]),
      );
    }
  });

  it("fetches region points serially", async () => {
    let active = 0;
    let maximumActive = 0;
    const fetch = normalFetch(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return undefined;
    });

    await nasaPowerRegionalRainfallAdapter.collect({ ...baseContext, fetch });

    expect(maximumActive).toBe(1);
  });

  it("accepts exactly 75% coverage and treats declared fill and negatives as missing", async () => {
    const result = await nasaPowerRegionalRainfallAdapter.collect({
      ...baseContext,
      sourceId: "nasa_power_rainfall_southern_thailand_rubber_v1",
      fetch: normalFetch((payload, call) => {
        if (call === 0) payload.properties.parameter.PRECTOTCORR["20260823"] = -999;
        if (call === 1) payload.properties.parameter.PRECTOTCORR["20260824"] = -0.01;
        return undefined;
      }),
    });

    expect(result.status).toBe("changed");
    expect(result.observations).toHaveLength(14);
    expect(result.observations[0].metadata).toMatchObject({ validPointCount: 3, coverageRatio: 0.75 });
    expect(result.observations[1].metadata).toMatchObject({ validPointCount: 3, coverageRatio: 0.75 });
  });

  it("returns partial with dated warnings below the coverage threshold", async () => {
    const result = await nasaPowerRegionalRainfallAdapter.collect({
      ...baseContext,
      sourceId: "nasa_power_rainfall_southern_thailand_rubber_v1",
      fetch: normalFetch((payload, call) => {
        if (call < 2) payload.properties.parameter.PRECTOTCORR["20260823"] = -999;
        return undefined;
      }),
    });

    expect(result.status).toBe("partial");
    expect(result.observations).toHaveLength(13);
    expect(result.warnings).toEqual(["LOW_POINT_COVERAGE:2026-08-23"]);
  });

  it("rejects the run when no date reaches minimum coverage", async () => {
    const action = nasaPowerRegionalRainfallAdapter.collect({
      ...baseContext,
      fetch: normalFetch((payload) => {
        for (const date of Object.keys(payload.properties.parameter.PRECTOTCORR)) {
          payload.properties.parameter.PRECTOTCORR[date] = -999;
        }
        return undefined;
      }),
    });

    await expect(action).rejects.toMatchObject({ code: "VALIDATION", retryable: false });
  });

  it.each([
    ["root type", (payload: PointPayload) => { payload.type = "Collection"; }],
    ["unit", (payload: PointPayload) => { payload.parameters.PRECTOTCORR.units = "inch/day"; }],
    ["coordinate", (payload: PointPayload) => { payload.geometry.coordinates[0] += 1; }],
    ["time standard", (payload: PointPayload) => { payload.header.time_standard = "LST"; }],
    ["API version", (payload: PointPayload) => { payload.header.api.version = ""; }],
    ["date key", (payload: PointPayload) => {
      delete payload.properties.parameter.PRECTOTCORR["20260823"];
      payload.properties.parameter.PRECTOTCORR["not-a-date"] = 1;
    }],
    ["value", (payload: PointPayload) => {
      payload.properties.parameter.PRECTOTCORR["20260823"] = "rain" as unknown as number;
    }],
  ] as const)("classifies %s drift as SCHEMA_DRIFT", async (_name, mutate) => {
    const action = nasaPowerRegionalRainfallAdapter.collect({
      ...baseContext,
      fetch: normalFetch((payload, call) => {
        if (call === 0) mutate(payload);
        return undefined;
      }),
    });

    await expect(action).rejects.toMatchObject({ code: "SCHEMA_DRIFT", retryable: false });
  });

  it("returns identical bundle hashes for identical point responses", async () => {
    const first = await nasaPowerRegionalRainfallAdapter.collect({ ...baseContext, fetch: normalFetch() });
    const second = await nasaPowerRegionalRainfallAdapter.collect({ ...baseContext, fetch: normalFetch() });

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.rawBody).toEqual(second.rawBody);
  });

  it("enforces the 128 KiB point-response limit", async () => {
    const fetch = vi.fn(async () =>
      new Response("x".repeat(NASA_POWER_POINT_MAX_BYTES + 1), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      nasaPowerRegionalRainfallAdapter.collect({ ...baseContext, fetch }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("enforces the 1 MiB deterministic bundle limit", async () => {
    const padding = "\\".repeat(60_000);
    const action = nasaPowerRegionalRainfallAdapter.collect({
      ...baseContext,
      sourceId: "nasa_power_rainfall_maritime_continent_palm_v1",
      fetch: normalFetch((payload) => {
        payload.padding = padding;
        return undefined;
      }),
    });

    expect(NASA_POWER_BUNDLE_MAX_BYTES).toBe(1024 * 1024);
    await expect(action).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it.each([
    [408, "NETWORK", true],
    [429, "RATE_LIMIT", true],
    [401, "AUTH", false],
    [403, "AUTH", false],
    [404, "NOT_FOUND", false],
    [422, "VALIDATION", false],
    [503, "NETWORK", true],
  ] as const)("classifies HTTP %i as %s", async (status, code, retryable) => {
    const action = nasaPowerRegionalRainfallAdapter.collect({
      ...baseContext,
      fetch: vi.fn(async () => new Response(null, { status })),
    });

    await expect(action).rejects.toMatchObject({ code, retryable, httpStatus: status });
  });
});

interface PointPayload {
  type: string;
  geometry: { type: string; coordinates: number[] };
  properties: { parameter: { PRECTOTCORR: Record<string, number> } };
  header: {
    api: { version: string; name: string };
    sources: string[];
    fill_value: number;
    time_standard: string;
  };
  parameters: { PRECTOTCORR: { units: string; longname: string } };
  padding?: string;
}

type FixtureMutation = (
  payload: PointPayload,
  call: number,
) => void | Promise<void>;

function normalFetch(mutate?: FixtureMutation) {
  let call = 0;
  return vi.fn<CollectContext["fetch"]>(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const payload = JSON.parse(pointFixtureRaw) as PointPayload;
    payload.geometry.coordinates = [
      Number(url.searchParams.get("longitude")),
      Number(url.searchParams.get("latitude")),
      58.2,
    ];
    const currentCall = call;
    call += 1;
    for (const date of Object.keys(payload.properties.parameter.PRECTOTCORR)) {
      payload.properties.parameter.PRECTOTCORR[date] += currentCall;
    }
    await mutate?.(payload, currentCall);
    return new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json; charset=UTF-8" },
    });
  });
}
