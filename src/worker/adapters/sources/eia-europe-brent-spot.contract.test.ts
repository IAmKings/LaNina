import { describe, expect, it, vi } from "vitest";

import type { CollectContext } from "../../../domain/ingestion";
import fixtureRaw from "./fixtures/eia-europe-brent-spot.json?raw";
import { defineAdapterContract } from "./testing/adapter-contract";
import {
  createEiaEuropeBrentSpotAdapter,
  EIA_EUROPE_BRENT_INDICATOR_ID,
  EIA_EUROPE_BRENT_MAX_BYTES,
  EIA_EUROPE_BRENT_SOURCE_ID,
  EIA_EUROPE_BRENT_SOURCE_URL,
} from "./eia-europe-brent-spot";

const SYNTHETIC_API_KEY = "synthetic-eia-test-key";
const adapter = createEiaEuropeBrentSpotAdapter(SYNTHETIC_API_KEY);
const baseContext: Omit<CollectContext, "fetch"> = {
  sourceId: EIA_EUROPE_BRENT_SOURCE_ID,
  sourceUrl: EIA_EUROPE_BRENT_SOURCE_URL,
  scheduledAt: "2026-09-08T18:17:00.000Z",
  fetchedAt: "2026-09-08T18:17:01.000Z",
  previousEtag: '"previous"',
  previousLastModified: "Mon, 07 Sep 2026 18:00:00 GMT",
  previousContentHash: null,
};

defineAdapterContract({
  name: "EIA Europe Brent spot",
  adapter,
  normal: {
    createContext: () => ({
      ...baseContext,
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(`${url.origin}${url.pathname}`).toBe(EIA_EUROPE_BRENT_SOURCE_URL);
        expect([...url.searchParams.entries()]).toEqual([
          ["api_key", SYNTHETIC_API_KEY],
          ["frequency", "daily"],
          ["data[0]", "value"],
          ["facets[series][]", "RBRTE"],
          ["start", "2026-07-16"],
          ["end", "2026-09-08"],
          ["sort[0][column]", "period"],
          ["sort[0][direction]", "asc"],
          ["offset", "0"],
          ["length", "40"],
        ]);
        const headers = new Headers(init?.headers);
        expect(headers.get("Accept")).toBe("application/json");
        expect(headers.get("If-None-Match")).toBe('"previous"');
        expect(headers.get("If-Modified-Since")).toBe(
          "Mon, 07 Sep 2026 18:00:00 GMT",
        );
        return jsonResponse(fixture());
      }),
    }),
    assertResult: (result) => {
      expect(result).toMatchObject({
        status: "changed",
        sourcePublishedAt: null,
        warnings: [],
      });
      expect(result.observations).toHaveLength(3);
      expect(result.observations[0]).toMatchObject({
        indicatorId: EIA_EUROPE_BRENT_INDICATOR_ID,
        observedAt: "2026-09-01T00:00:00.000Z",
        periodStart: "2026-09-01T00:00:00.000Z",
        value: 96.02,
        unit: "USD/bbl",
        publishedAt: null,
        quality: "verified",
        citationUrl: EIA_EUROPE_BRENT_SOURCE_URL,
        metadata: {
          series: "RBRTE",
          product: "EPCBRENT",
          process: "PF4",
          wireUnit: "$/BBL",
          sourceDateHasNoTimezone: true,
        },
      });
      expect(JSON.stringify(result)).not.toContain(SYNTHETIC_API_KEY);
    },
  },
  unchanged: {
    createContext: async () => {
      const first = await adapter.collect({
        ...baseContext,
        fetch: fixtureFetch(fixture()),
      });
      return {
        ...baseContext,
        previousContentHash: first.contentHash,
        fetch: fixtureFetch(fixture()),
      };
    },
  },
  invalid: {
    createContext: () => ({
      ...baseContext,
      fetch: fixtureFetch(fixture((payload) => {
        payload.response.data[0].series = "WRONG";
      })),
    }),
    expectedError: { code: "SCHEMA_DRIFT", retryable: false, httpStatus: null },
  },
});

describe("EIA Europe Brent spot adapter behavior", () => {
  it("returns unchanged for a future conditional 304 without retaining a body", async () => {
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

  it("emits a changed same-period value for append-only revision handling", async () => {
    const first = await adapter.collect({ ...baseContext, fetch: fixtureFetch(fixture()) });
    const revisedPayload = fixture((payload) => {
      payload.response.data[0].value = "97.14";
    });
    const revised = await adapter.collect({
      ...baseContext,
      previousContentHash: first.contentHash,
      fetch: fixtureFetch(revisedPayload),
    });

    expect(revised.status).toBe("changed");
    expect(revised.contentHash).not.toBe(first.contentHash);
    expect(revised.observations[0]).toMatchObject({
      observedAt: first.observations[0].observedAt,
      value: 97.14,
    });
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

  it("maps network failures to a fixed retryable error without leaking the URL", async () => {
    let thrown: unknown;
    try {
      await adapter.collect({
        ...baseContext,
        fetch: vi.fn(async (input) => {
          throw new Error(`failed ${String(input)}`);
        }),
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "NETWORK", retryable: true, httpStatus: null });
    expect(String(thrown)).not.toContain("api_key");
    expect(String(thrown)).not.toContain(SYNTHETIC_API_KEY);
    expect(String(thrown)).not.toContain(EIA_EUROPE_BRENT_SOURCE_URL);
  });

  it.each([
    ["wrong content type", new Response(fixtureRaw, { headers: { "content-type": "text/html" } })],
    ["JSONP content type", new Response(fixtureRaw, { headers: { "content-type": "application/jsonp" } })],
    ["malformed JSON", new Response("{", { headers: { "content-type": "application/json" } })],
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

  it.each([
    ["wrong product", (payload: EiaFixture) => { payload.response.data[0].product = "WRONG"; }, "SCHEMA_DRIFT"],
    ["wrong process", (payload: EiaFixture) => { payload.response.data[0].process = "WRONG"; }, "SCHEMA_DRIFT"],
    ["wrong unit", (payload: EiaFixture) => { payload.response.data[0].units = "USD/BBL"; }, "SCHEMA_DRIFT"],
    ["wrong frequency", (payload: EiaFixture) => { payload.response.frequency = "weekly"; }, "SCHEMA_DRIFT"],
    ["wrong date format", (payload: EiaFixture) => { payload.response.dateFormat = "YYYYMMDD"; }, "SCHEMA_DRIFT"],
    ["duplicate date", (payload: EiaFixture) => { payload.response.data[1].period = payload.response.data[0].period; }, "VALIDATION"],
    ["out-of-order date", (payload: EiaFixture) => { payload.response.data.reverse(); }, "VALIDATION"],
    ["impossible date", (payload: EiaFixture) => { payload.response.data[0].period = "2026-02-30"; }, "VALIDATION"],
    ["missing token", (payload: EiaFixture) => { payload.response.data[0].value = "NA"; }, "SCHEMA_DRIFT"],
    ["zero value", (payload: EiaFixture) => { payload.response.data[0].value = "0"; }, "VALIDATION"],
    ["out-of-band value", (payload: EiaFixture) => { payload.response.data[0].value = "1000"; }, "VALIDATION"],
    ["embedded warning", (payload: EiaFixture) => { payload.response.warning = "truncated"; }, "SCHEMA_DRIFT"],
  ] as const)("rejects %s as %s", async (_name, mutate, code) => {
    await expect(
      adapter.collect({ ...baseContext, fetch: fixtureFetch(fixture(mutate)) }),
    ).rejects.toMatchObject({ code, retryable: false });
  });



  it("差分窗口 total：全库行数大于窗口行数不再以 VALIDATION 拒绝", async () => {
    const payload = fixture((value) => {
      value.response.total = "9978";
    });
    const result = await adapter.collect({ ...baseContext, fetch: fixtureFetch(payload) });
    expect(result.observations.length).toBeGreaterThanOrEqual(1);
  });

  it("enforces the 64 KiB response limit", async () => {
    expect(EIA_EUROPE_BRENT_MAX_BYTES).toBe(64 * 1024);
    await expect(
      adapter.collect({
        ...baseContext,
        fetch: vi.fn(async () => new Response("x".repeat(EIA_EUROPE_BRENT_MAX_BYTES + 1), {
          headers: { "content-type": "application/json" },
        })),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", retryable: false });
  });

  it("fails before fetch when the key is missing or the source is not allowlisted", async () => {
    const fetch = fixtureFetch(fixture());
    for (const key of [undefined, "   "]) {
      await expect(
        createEiaEuropeBrentSpotAdapter(key).collect({ ...baseContext, fetch }),
      ).rejects.toMatchObject({ code: "AUTH", retryable: false });
    }
    await expect(
      adapter.collect({ ...baseContext, sourceUrl: `${EIA_EUROPE_BRENT_SOURCE_URL}?bad=1`, fetch }),
    ).rejects.toMatchObject({ code: "VALIDATION", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the key in request-time query only and rejects an upstream echo", async () => {
    expect(fixtureRaw).not.toContain(SYNTHETIC_API_KEY);
    expect(fixtureRaw).not.toContain("api_key");
    const privateKey = "private-eia-query-key";
    const keyedAdapter = createEiaEuropeBrentSpotAdapter(privateKey);
    const fetch = vi.fn<CollectContext["fetch"]>(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("api_key")).toBe(privateKey);
      expect(baseContext.sourceUrl).not.toContain(privateKey);
      return jsonResponse(fixture());
    });
    const result = await keyedAdapter.collect({ ...baseContext, fetch });
    expect(JSON.stringify(result)).not.toContain(privateKey);
    expect(new TextDecoder().decode(result.rawBody!)).not.toContain(privateKey);

    let thrown: unknown;
    try {
      await keyedAdapter.collect({
        ...baseContext,
        fetch: vi.fn(async () => jsonResponse({ leaked: privateKey })),
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "SCHEMA_DRIFT" });
    expect(String(thrown)).not.toContain(privateKey);
  });
});

interface EiaRow {
  period: string;
  duoarea: string;
  "area-name": string;
  product: string;
  "product-name": string;
  process: string;
  "process-name": string;
  series: string;
  "series-description": string;
  value: string;
  units: string;
}

interface EiaFixture {
  response: {
    total: string;
    dateFormat: string;
    frequency: string;
    data: EiaRow[];
    warning?: string;
  };
  request: { command: string };
  apiVersion: string;
}

function fixture(mutate?: (payload: EiaFixture) => void): EiaFixture {
  const payload = JSON.parse(fixtureRaw) as EiaFixture;
  mutate?.(payload);
  return payload;
}

function fixtureFetch(payload: unknown) {
  return vi.fn<CollectContext["fetch"]>(async () => jsonResponse(payload));
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}
