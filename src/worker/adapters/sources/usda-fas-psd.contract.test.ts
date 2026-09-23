import { describe, expect, it, vi } from "vitest";

import type { CollectContext } from "../../../domain/ingestion";
import palmFixtureRaw from "./fixtures/usda-psd-malaysia-palm-oil.json?raw";
import cornFixtureRaw from "./fixtures/usda-psd-south-africa-corn.json?raw";
import { defineAdapterContract } from "./testing/adapter-contract";
import {
  createUsdaFasPsdAdapter,
  USDA_FAS_PSD_MAX_BYTES,
  USDA_FAS_PSD_SOURCE_URL,
} from "./usda-fas-psd";

const SYNTHETIC_API_KEY = "synthetic-test-key";
const adapter = createUsdaFasPsdAdapter(SYNTHETIC_API_KEY);
const baseContext: Omit<CollectContext, "fetch"> = {
  sourceId: "usda_psd_malaysia_palm_oil",
  sourceUrl: USDA_FAS_PSD_SOURCE_URL,
  scheduledAt: "2026-09-08T18:17:00.000Z",
  fetchedAt: "2026-09-08T18:17:01.000Z",
  previousEtag: '"previous"',
  previousLastModified: "Mon, 07 Sep 2026 18:00:00 GMT",
  previousContentHash: null,
};

defineAdapterContract({
  name: "USDA FAS PSD",
  adapter,
  normal: {
    createContext: () => ({
      ...baseContext,
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          `${USDA_FAS_PSD_SOURCE_URL}/commodity/4243000/country/MY/year/2025`,
        );
        const headers = new Headers(init?.headers);
        expect(headers.get("Accept")).toBe("application/json");
        expect(headers.get("X-Api-Key")).toBe(SYNTHETIC_API_KEY);
        expect(headers.get("If-None-Match")).toBe('"previous"');
        expect(headers.get("If-Modified-Since")).toBe(
          "Mon, 07 Sep 2026 18:00:00 GMT",
        );
        return jsonResponse(palmFixture());
      }),
    }),
    assertResult: (result) => {
      expect(result.status).toBe("changed");
      expect(result.sourcePublishedAt).toBeNull();
      expect(result.observations).toHaveLength(3);
      expect(result.observations.map(({ indicatorId }) => indicatorId)).toEqual([
        "usda_psd_malaysia_palm_oil_production_1000mt",
        "usda_psd_malaysia_palm_oil_exports_1000mt",
        "usda_psd_malaysia_palm_oil_ending_stocks_1000mt",
      ]);
      expect(result.observations[0]).toMatchObject({
        observedAt: "2026-09-30T00:00:00.000Z",
        periodStart: "2025-10-01T00:00:00.000Z",
        value: 19500,
        unit: "1000 MT",
        publishedAt: null,
        quality: "estimated",
        metadata: {
          releaseYear: 2026,
          releaseMonth: 8,
          marketYear: 2025,
          commodityCode: "4243000",
          countryCode: "MY",
          attributeId: 28,
          attributeName: "Production",
          unitId: 8,
        },
      });
      expect(JSON.stringify(result)).not.toContain(SYNTHETIC_API_KEY);
    },
  },
  unchanged: {
    createContext: async () => {
      const first = await adapter.collect({
        ...baseContext,
        fetch: vi.fn(async () => jsonResponse(palmFixture())),
      });
      return {
        ...baseContext,
        previousContentHash: first.contentHash,
        fetch: vi.fn(async () => jsonResponse(palmFixture())),
      };
    },
  },
  invalid: {
    createContext: () => ({
      ...baseContext,
      fetch: fixtureFetch(palmFixture((rows) => {
        rows[0].countryCode = "ZA";
      })),
    }),
    expectedError: { code: "SCHEMA_DRIFT", retryable: false, httpStatus: null },
  },
});

describe("USDA FAS PSD adapter behavior", () => {
  it.each([
    ["Malaysia before October", "usda_psd_malaysia_palm_oil", "2026-09-30T23:59:59.000Z", 2025, "2025-10-01T00:00:00.000Z", "2026-09-30T00:00:00.000Z"],
    ["Malaysia from October", "usda_psd_malaysia_palm_oil", "2026-10-01T00:00:00.000Z", 2026, "2026-10-01T00:00:00.000Z", "2027-09-30T00:00:00.000Z"],
    ["South Africa before May", "usda_psd_south_africa_corn", "2026-04-30T23:59:59.000Z", 2025, "2025-05-01T00:00:00.000Z", "2026-04-30T00:00:00.000Z"],
    ["South Africa from May", "usda_psd_south_africa_corn", "2026-05-01T00:00:00.000Z", 2026, "2026-05-01T00:00:00.000Z", "2027-04-30T00:00:00.000Z"],
  ] as const)(
    "derives the %s market year from scheduledAt UTC",
    async (_name, sourceId, scheduledAt, marketYear, periodStart, observedAt) => {
      const payload = fixtureForSource(sourceId, marketYear);
      const fetch = fixtureFetch(payload);
      const result = await adapter.collect({
        ...baseContext,
        sourceId,
        scheduledAt,
        fetch,
      });

      expect(String(fetch.mock.calls[0][0])).toMatch(new RegExp(`/year/${marketYear}$`));
      expect(result.observations[0]).toMatchObject({ periodStart, observedAt });
    },
  );

  it("returns partial while retaining valid selected attributes", async () => {
    const payload = palmFixture((rows) => {
      rows.splice(rows.findIndex(({ attributeId }) => attributeId === 88), 1);
    });
    const result = await adapter.collect({ ...baseContext, fetch: fixtureFetch(payload) });

    expect(result.status).toBe("partial");
    expect(result.observations).toHaveLength(2);
    expect(result.warnings).toEqual(["MISSING_ATTRIBUTE:88"]);
  });

  it("keeps the South Africa corn identity and indicator mapping fixed", async () => {
    const fetch = vi.fn<CollectContext["fetch"]>(async (input) => {
      expect(String(input)).toBe(
        `${USDA_FAS_PSD_SOURCE_URL}/commodity/0440000/country/SF/year/2026`,
      );
      return jsonResponse(JSON.parse(cornFixtureRaw) as unknown);
    });
    const result = await adapter.collect({
      ...baseContext,
      sourceId: "usda_psd_south_africa_corn",
      fetch,
    });

    expect(result.observations.map(({ indicatorId }) => indicatorId)).toEqual([
      "usda_psd_south_africa_corn_production_1000mt",
      "usda_psd_south_africa_corn_exports_1000mt",
      "usda_psd_south_africa_corn_ending_stocks_1000mt",
    ]);
    expect(result.observations[0]).toMatchObject({
      unit: "1000 MT",
      metadata: {
        commodityCode: "0440000",
        countryCode: "SF",
        attributeId: 28,
        unitId: 8,
      },
    });
  });

  it("rejects a response with none of the selected attributes", async () => {
    const payload = palmFixture((rows) => {
      rows.splice(0, rows.length, rows.at(-1)!);
    });

    await expect(
      adapter.collect({ ...baseContext, fetch: fixtureFetch(payload) }),
    ).rejects.toMatchObject({ code: "VALIDATION", retryable: false });
  });

  it("handles a future conditional 304 without persisting a body", async () => {
    const result = await adapter.collect({
      ...baseContext,
      previousContentHash: "known-hash",
      fetch: vi.fn(async () => new Response(null, {
        status: 304,
        headers: { etag: '"current"' },
      })),
    });

    expect(result).toMatchObject({
      status: "unchanged",
      contentHash: "known-hash",
      etag: '"current"',
      rawBody: null,
      observations: [],
    });
  });

  it.each([
    ["wrong commodity", (rows: PsdRow[]) => { rows[0].commodityCode = "1111111"; }],
    ["wrong country", (rows: PsdRow[]) => { rows[0].countryCode = "SF"; }],
    ["ZA country trap", (rows: PsdRow[]) => { rows[0].countryCode = "ZA"; }],
    ["wrong market year", (rows: PsdRow[]) => { rows[0].marketYear = "2026"; }],
    ["duplicate attribute", (rows: PsdRow[]) => { rows.push({ ...rows[0] }); }],
    ["wrong selected unit", (rows: PsdRow[]) => { rows[0].unitId = 4; }],
    ["invalid month", (rows: PsdRow[]) => { rows[0].month = "13"; }],
    ["inconsistent month", (rows: PsdRow[]) => { rows[0].month = "07"; }],
    ["string value", (rows: PsdRow[]) => { rows[0].value = "19500" as unknown as number; }],
    ["string attribute", (rows: PsdRow[]) => { rows[0].attributeId = "28" as unknown as number; }],
  ] as const)("classifies %s as SCHEMA_DRIFT", async (_name, mutate) => {
    await expect(
      adapter.collect({ ...baseContext, fetch: fixtureFetch(palmFixture(mutate)) }),
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT", retryable: false });
  });

  it("classifies a negative numeric value as VALIDATION", async () => {
    const payload = palmFixture((rows) => { rows[0].value = -1; });
    await expect(
      adapter.collect({ ...baseContext, fetch: fixtureFetch(payload) }),
    ).rejects.toMatchObject({ code: "VALIDATION", retryable: false });
  });

  it.each([
    [401, "AUTH", false],
    [403, "AUTH", false],
    [404, "NOT_FOUND", false],
    [429, "RATE_LIMIT", true],
    [500, "NETWORK", true],
    [503, "NETWORK", true],
  ] as const)("classifies HTTP %i as %s", async (status, code, retryable) => {
    await expect(
      adapter.collect({
        ...baseContext,
        fetch: vi.fn(async () => new Response(null, { status })),
      }),
    ).rejects.toMatchObject({ code, retryable, httpStatus: status });
  });

  it("classifies network failures as retryable NETWORK", async () => {
    await expect(
      adapter.collect({
        ...baseContext,
        fetch: vi.fn(async () => { throw new Error("synthetic network failure"); }),
      }),
    ).rejects.toMatchObject({ code: "NETWORK", retryable: true, httpStatus: null });
  });

  it.each([
    ["unexpected content type", new Response("[]", { headers: { "content-type": "text/html" } })],
    ["JSONP content type", new Response("[]", { headers: { "content-type": "application/jsonp" } })],
    ["malformed JSON", new Response("[", { headers: { "content-type": "application/json" } })],
    ["non-array JSON", jsonResponse({ rows: [] })],
    [
      "invalid UTF-8",
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "content-type": "application/json" },
      }),
    ],
  ])("classifies %s as SCHEMA_DRIFT", async (_name, response) => {
    await expect(
      adapter.collect({ ...baseContext, fetch: vi.fn(async () => response.clone()) }),
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT", retryable: false });
  });

  it("classifies an empty root array as VALIDATION", async () => {
    await expect(
      adapter.collect({ ...baseContext, fetch: vi.fn(async () => jsonResponse([])) }),
    ).rejects.toMatchObject({ code: "VALIDATION", retryable: false });
  });

  it("enforces the 64 KiB response limit", async () => {
    expect(USDA_FAS_PSD_MAX_BYTES).toBe(64 * 1024);
    await expect(
      adapter.collect({
        ...baseContext,
        fetch: vi.fn(async () => new Response("x".repeat(USDA_FAS_PSD_MAX_BYTES + 1), {
          headers: { "content-type": "application/json" },
        })),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", retryable: false });
  });

  it("fails with stable AUTH before fetch when the key is missing", async () => {
    const fetch = fixtureFetch(palmFixture());

    for (const key of [undefined, "   "]) {
      await expect(
        createUsdaFasPsdAdapter(key).collect({ ...baseContext, fetch }),
      ).rejects.toMatchObject({ code: "AUTH", retryable: false, httpStatus: null });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the API key out of the URL, result, body and errors", async () => {
    const privateSyntheticKey = "private-synthetic-header-only";
    const keyedAdapter = createUsdaFasPsdAdapter(privateSyntheticKey);
    const fetch = vi.fn<CollectContext["fetch"]>(async (input, init) => {
      expect(String(input)).not.toContain(privateSyntheticKey);
      expect(new Headers(init?.headers).get("X-Api-Key")).toBe(privateSyntheticKey);
      return jsonResponse(palmFixture());
    });
    const result = await keyedAdapter.collect({ ...baseContext, fetch });
    expect(JSON.stringify(result)).not.toContain(privateSyntheticKey);

    let thrown: unknown;
    try {
      await keyedAdapter.collect({
        ...baseContext,
        fetch: vi.fn(async () => new Response(null, { status: 401 })),
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(String(thrown)).not.toContain(privateSyntheticKey);

    thrown = undefined;
    try {
      await keyedAdapter.collect({
        ...baseContext,
        fetch: vi.fn(async () => jsonResponse({ leaked: privateSyntheticKey })),
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "SCHEMA_DRIFT" });
    expect(String(thrown)).not.toContain(privateSyntheticKey);
  });

  it.each([
    ["unknown source", "database_provided", USDA_FAS_PSD_SOURCE_URL],
    ["unknown URL", "usda_psd_malaysia_palm_oil", `${USDA_FAS_PSD_SOURCE_URL}?key=bad`],
  ])("rejects an %s before fetch", async (_name, sourceId, sourceUrl) => {
    const fetch = fixtureFetch(palmFixture());
    await expect(
      adapter.collect({ ...baseContext, sourceId, sourceUrl, fetch }),
    ).rejects.toMatchObject({ code: "VALIDATION", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

interface PsdRow {
  commodityCode: string;
  countryCode: string;
  marketYear: string;
  calendarYear: string;
  month: string;
  attributeId: number;
  unitId: number;
  value: number;
}

function palmFixture(mutate?: (rows: PsdRow[]) => void): PsdRow[] {
  const rows = JSON.parse(palmFixtureRaw) as PsdRow[];
  mutate?.(rows);
  return rows;
}

function fixtureForSource(sourceId: string, marketYear: number): PsdRow[] {
  const raw = sourceId === "usda_psd_malaysia_palm_oil" ? palmFixtureRaw : cornFixtureRaw;
  const rows = JSON.parse(raw) as PsdRow[];
  for (const row of rows) row.marketYear = String(marketYear);
  return rows;
}

function fixtureFetch(payload: unknown) {
  return vi.fn<CollectContext["fetch"]>(async () => jsonResponse(payload));
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}
