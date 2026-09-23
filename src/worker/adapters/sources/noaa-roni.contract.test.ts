import { describe, expect, it, vi } from "vitest";

import type { CollectContext } from "../../../domain/ingestion";
import invalidHtml from "./fixtures/noaa-roni-invalid.html?raw";
import normalHtml from "./fixtures/noaa-roni-normal.html?raw";
import { defineAdapterContract } from "./testing/adapter-contract";
import {
  NOAA_RONI_AUTOMATED_WINDOW,
  NOAA_RONI_URL,
  noaaRoniAdapter,
  parseRoniHtml,
} from "./noaa-roni";

const baseContext: Omit<CollectContext, "fetch"> = {
  sourceId: "noaa_cpc_roni",
  sourceUrl: NOAA_RONI_URL,
  scheduledAt: "2026-09-07T00:00:00.000Z",
  fetchedAt: "2026-09-07T00:00:01.000Z",
  previousEtag: '"previous"',
  previousLastModified: "Sat, 05 Sep 2026 00:00:00 GMT",
  previousContentHash: null,
};

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      etag: '"current"',
    },
  });
}

defineAdapterContract({
  name: "NOAA RONI",
  adapter: noaaRoniAdapter,
  normal: {
    createContext: () => ({
      ...baseContext,
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("If-None-Match")).toBe('"previous"');
        expect(headers.get("If-Modified-Since")).toBe("Sat, 05 Sep 2026 00:00:00 GMT");
        return htmlResponse(normalHtml);
      }),
    }),
    assertResult: (result) => {
      expect(result.status).toBe("changed");
      expect(result.observations).toHaveLength(19);
      expect(result.observations[0]).toMatchObject({
        observedAt: "2025-02-28T00:00:00.000Z",
        periodStart: "2024-12-01T00:00:00.000Z",
        value: -1.1,
        unit: "°C",
        quality: "verified",
      });
      expect(result.observations.at(-1)).toMatchObject({
        observedAt: "2026-08-31T00:00:00.000Z",
        value: 1.4,
        quality: "estimated",
        metadata: { season: "JJA", year: 2026, datasetVersion: "ERSSTv6" },
      });
      expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.rawBody?.byteLength).toBeGreaterThan(0);
    },
  },
  unchanged: {
    createContext: () => ({
      ...baseContext,
      previousContentHash: "known-hash",
      fetch: vi.fn(async () => new Response(null, { status: 304 })),
    }),
    assertResult: (result) => {
      expect(result.contentHash).toBe("known-hash");
      expect(result.etag).toBe('"previous"');
      expect(result.lastModified).toBe("Sat, 05 Sep 2026 00:00:00 GMT");
    },
  },
  invalid: {
    createContext: () => ({
      ...baseContext,
      fetch: vi.fn(async () => htmlResponse(invalidHtml)),
    }),
    expectedError: { code: "SCHEMA_DRIFT", retryable: false, httpStatus: null },
  },
});

describe("NOAA RONI adapter behavior", () => {
  it("keeps full parsing available but emits only the latest 24 automatic observations", async () => {
    const oldRow = `<tr><th>2024</th>${Array.from({ length: 12 }, () => "<td>0.1</td>").join("")}</tr>`;
    const longHistory = normalHtml.replace("<tbody>", `<tbody>${oldRow}`);

    expect(parseRoniHtml(longHistory)).toHaveLength(31);
    const result = await noaaRoniAdapter.collect({
      ...baseContext,
      fetch: vi.fn(async () => htmlResponse(longHistory)),
    });

    expect(result.observations).toHaveLength(NOAA_RONI_AUTOMATED_WINDOW);
    expect(result.observations[0].metadata).toMatchObject({ year: 2024, season: "JAS" });
    expect(result.warnings).toContain("AUTOMATED_WINDOW_TRUNCATED");
  });

  it("returns unchanged when a 200 response has the same content hash", async () => {
    const first = await noaaRoniAdapter.collect({
      ...baseContext,
      fetch: vi.fn(async () => htmlResponse(normalHtml)),
    });
    const second = await noaaRoniAdapter.collect({
      ...baseContext,
      previousContentHash: first.contentHash,
      fetch: vi.fn(async () => htmlResponse(normalHtml)),
    });

    expect(second.status).toBe("unchanged");
    expect(second.observations).toEqual([]);
    expect(second.rawBody).toBeNull();
  });

  it.each([
    [408, "NETWORK", true],
    [429, "RATE_LIMIT", true],
    [404, "NOT_FOUND", false],
    [503, "NETWORK", true],
  ] as const)("classifies HTTP %i as %s", async (status, code, retryable) => {
    const action = noaaRoniAdapter.collect({
      ...baseContext,
      fetch: vi.fn(async () => new Response(null, { status })),
    });

    await expect(action).rejects.toMatchObject({ code, retryable, httpStatus: status });
  });
});
