import { describe, expect, it, vi } from "vitest";

import {
  NOAA_RONI_ADAPTER_KEY,
  NOAA_RONI_URL,
} from "./adapters/sources/noaa-roni";
import {
  NASA_POWER_DAILY_POINT_URL,
  NASA_POWER_RAINFALL_ADAPTER_KEY,
} from "./adapters/sources/nasa-power-regional-rainfall";
import {
  createSourceAdapterRegistry,
  isApprovedSourceAdapterKey,
} from "./adapters/sources/registry";
import {
  USDA_FAS_PSD_ADAPTER_KEY,
  USDA_FAS_PSD_SOURCE_URL,
} from "./adapters/sources/usda-fas-psd";
import {
  EIA_EUROPE_BRENT_ADAPTER_KEY,
  EIA_EUROPE_BRENT_SOURCE_ID,
  EIA_EUROPE_BRENT_SOURCE_URL,
} from "./adapters/sources/eia-europe-brent-spot";
import {
  UNCTAD_ADAPTER_KEY,
} from "./adapters/sources/unctad-lsci";
import {
  WORLD_BANK_ADAPTER_KEY,
} from "./adapters/sources/world-bank-pink-sheet";
import {
  JPX_OSE_ADAPTER_KEY,
} from "./adapters/sources/jpx-ose-settlement";
import {
  USA_CENSUS_ADAPTER_KEY,
} from "./adapters/sources/usa-census-intltrade";

describe("approved source adapter registry", () => {
  it("contains only the approved source adapters", () => {
    const registry = createSourceAdapterRegistry();

    expect([...registry.keys()]).toEqual([
      NOAA_RONI_ADAPTER_KEY,
      NASA_POWER_RAINFALL_ADAPTER_KEY,
      WORLD_BANK_ADAPTER_KEY,
      JPX_OSE_ADAPTER_KEY,
      USA_CENSUS_ADAPTER_KEY,
      UNCTAD_ADAPTER_KEY,
      USDA_FAS_PSD_ADAPTER_KEY,
      EIA_EUROPE_BRENT_ADAPTER_KEY,
    ]);
    expect(registry.get(NOAA_RONI_ADAPTER_KEY)?.key).toBe(NOAA_RONI_ADAPTER_KEY);
    expect(registry.get(NASA_POWER_RAINFALL_ADAPTER_KEY)?.key).toBe(
      NASA_POWER_RAINFALL_ADAPTER_KEY,
    );
    expect(isApprovedSourceAdapterKey(NOAA_RONI_ADAPTER_KEY)).toBe(true);
    expect(isApprovedSourceAdapterKey(NASA_POWER_RAINFALL_ADAPTER_KEY)).toBe(true);
    expect(registry.get(USDA_FAS_PSD_ADAPTER_KEY)?.key).toBe(USDA_FAS_PSD_ADAPTER_KEY);
    expect(isApprovedSourceAdapterKey(USDA_FAS_PSD_ADAPTER_KEY)).toBe(true);
    expect(registry.get(EIA_EUROPE_BRENT_ADAPTER_KEY)?.key).toBe(
      EIA_EUROPE_BRENT_ADAPTER_KEY,
    );
    expect(isApprovedSourceAdapterKey(EIA_EUROPE_BRENT_ADAPTER_KEY)).toBe(true);
    expect(isApprovedSourceAdapterKey("database-provided-adapter")).toBe(false);
  });

  it("injects the optional USDA key only through the adapter factory closure", async () => {
    const key = "synthetic-registry-key";
    const adapter = createSourceAdapterRegistry({ usdaFasApiKey: key }).get(
      USDA_FAS_PSD_ADAPTER_KEY,
    );
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).not.toContain(key);
      expect(new Headers(init?.headers).get("X-Api-Key")).toBe(key);
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });

    await expect(
      adapter!.collect({
        sourceId: "usda_psd_malaysia_palm_oil",
        sourceUrl: USDA_FAS_PSD_SOURCE_URL,
        scheduledAt: "2026-09-08T18:17:00.000Z",
        fetchedAt: "2026-09-08T18:17:01.000Z",
        previousEtag: null,
        previousLastModified: null,
        previousContentHash: null,
        fetch,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps an unprovisioned USDA adapter registered but fails it as AUTH", async () => {
    const adapter = createSourceAdapterRegistry().get(USDA_FAS_PSD_ADAPTER_KEY);
    const fetch = vi.fn(async () => new Response("should not fetch"));

    await expect(
      adapter!.collect({
        sourceId: "usda_psd_malaysia_palm_oil",
        sourceUrl: USDA_FAS_PSD_SOURCE_URL,
        scheduledAt: "2026-09-08T18:17:00.000Z",
        fetchedAt: "2026-09-08T18:17:01.000Z",
        previousEtag: null,
        previousLastModified: null,
        previousContentHash: null,
        fetch,
      }),
    ).rejects.toMatchObject({ code: "AUTH", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("injects the EIA key only through its adapter factory closure", async () => {
    const key = "synthetic-eia-registry-key";
    const adapter = createSourceAdapterRegistry({ eiaApiKey: key }).get(
      EIA_EUROPE_BRENT_ADAPTER_KEY,
    );
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = new URL(String(input));
      expect(requestUrl.searchParams.get("api_key")).toBe(key);
      expect(EIA_EUROPE_BRENT_SOURCE_URL).not.toContain(key);
      return new Response("{}", { headers: { "content-type": "application/json" } });
    });

    await expect(
      adapter!.collect({
        sourceId: EIA_EUROPE_BRENT_SOURCE_ID,
        sourceUrl: EIA_EUROPE_BRENT_SOURCE_URL,
        scheduledAt: "2026-09-08T18:17:00.000Z",
        fetchedAt: "2026-09-08T18:17:01.000Z",
        previousEtag: null,
        previousLastModified: null,
        previousContentHash: null,
        fetch,
      }),
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps an unprovisioned EIA adapter registered but fails it as AUTH", async () => {
    const adapter = createSourceAdapterRegistry().get(EIA_EUROPE_BRENT_ADAPTER_KEY);
    const fetch = vi.fn(async () => new Response("should not fetch"));

    await expect(
      adapter!.collect({
        sourceId: EIA_EUROPE_BRENT_SOURCE_ID,
        sourceUrl: EIA_EUROPE_BRENT_SOURCE_URL,
        scheduledAt: "2026-09-08T18:17:00.000Z",
        fetchedAt: "2026-09-08T18:17:01.000Z",
        previousEtag: null,
        previousLastModified: null,
        previousContentHash: null,
        fetch,
      }),
    ).rejects.toMatchObject({ code: "AUTH", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the URL allowlist inside the registered adapter", async () => {
    const adapter = createSourceAdapterRegistry().get(NOAA_RONI_ADAPTER_KEY);
    const fetch = vi.fn(async () => new Response("should not fetch"));
    expect(adapter).toBeDefined();

    await expect(
      adapter!.collect({
        sourceId: "noaa_cpc_roni",
        sourceUrl: `${NOAA_RONI_URL}?redirect=unapproved`,
        scheduledAt: "2026-09-08T01:17:00.000Z",
        fetchedAt: "2026-09-08T01:17:00.000Z",
        previousEtag: null,
        previousLastModified: null,
        previousContentHash: null,
        fetch,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown source ID", "database-provided-source", NASA_POWER_DAILY_POINT_URL],
    [
      "unknown URL",
      "nasa_power_rainfall_panama_canal_catchment_v1",
      `${NASA_POWER_DAILY_POINT_URL}?latitude=0&longitude=0`,
    ],
  ])("keeps NASA POWER %s outside the fetch boundary", async (_name, sourceId, sourceUrl) => {
    const adapter = createSourceAdapterRegistry().get(NASA_POWER_RAINFALL_ADAPTER_KEY);
    const fetch = vi.fn(async () => new Response("should not fetch"));

    await expect(
      adapter!.collect({
        sourceId,
        sourceUrl,
        scheduledAt: "2026-09-08T01:17:00.000Z",
        fetchedAt: "2026-09-08T01:17:00.000Z",
        previousEtag: null,
        previousLastModified: null,
        previousContentHash: null,
        fetch,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
