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
import worker, {
  escapedRequestResponse,
  handleRequest,
  handleScheduled,
  QUARTER_HOURLY_CRON,
  type Env,
} from "./index";
import type { DispatchSourceResult } from "./ingestion/dispatch-sources";

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

const REQUEST_ENV = {
  APP_ENV: "local",
  APP_VERSION: "0.1.0-test",
  ENABLE_CRON: "true",
  ENABLE_AUTO_PUBLICATION: "false",
} as Env;

function scheduledController(cron: string): ScheduledController {
  return {
    cron,
    scheduledTime: Date.parse("2026-09-09T00:15:00.000Z"),
    type: "scheduled",
    noRetry() {},
  } as ScheduledController;
}

function dispatchResult(overrides: Partial<DispatchSourceResult> = {}): DispatchSourceResult {
  return {
    sourceId: "noaa_cpc_roni",
    scheduledAt: "2026-09-09T00:15:00.000Z",
    kind: "scheduled",
    outcome: {
      collectionStatus: "changed",
      run: {
        id: "run-1",
        sourceId: "noaa_cpc_roni",
        scheduledAt: "2026-09-09T00:15:00.000Z",
        status: "success",
        snapshotKey: null,
        observationsInserted: 3,
        observationsRevised: 0,
        errorCode: null,
        retryCount: 0,
        nextRetryAt: null,
        recovered: false,
      },
    },
    dispatcherErrorCode: null,
    ...overrides,
  };
}

function dispatchResultFailed(sourceId: string): DispatchSourceResult {
  return dispatchResult({
    sourceId,
    outcome: {
      collectionStatus: "failed",
      run: {
        id: "run-failed",
        sourceId,
        scheduledAt: "2026-09-09T00:15:00.000Z",
        status: "failed",
        snapshotKey: null,
        observationsInserted: 0,
        observationsRevised: 0,
        errorCode: "NETWORK",
        retryCount: 0,
        nextRetryAt: "2026-09-09T00:30:00.000Z",
        recovered: false,
      },
    },
  });
}

function spyLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("worker request entry", () => {
  it("serves HEAD /api/v1/healthz with 200, an empty body and GET-identical headers", async () => {
    const url = "https://example.test/api/v1/healthz";
    const getResponse = await handleRequest(new Request(url), REQUEST_ENV);
    const headResponse = await handleRequest(new Request(url, { method: "HEAD" }), REQUEST_ENV);

    expect(headResponse.status).toBe(getResponse.status);
    expect(headResponse.statusText).toBe(getResponse.statusText);
    expect(await headResponse.text()).toBe("");

    const headerNames = [...getResponse.headers.keys()];
    expect(headerNames.length).toBeGreaterThan(0);
    for (const name of headerNames) {
      expect(headResponse.headers.get(name)).toBe(getResponse.headers.get(name));
    }
  });

  it("answers HEAD on an unknown /api path with a bodyless 404", async () => {
    const response = await handleRequest(
      new Request("https://example.test/api/v1/not-a-route", { method: "HEAD" }),
      REQUEST_ENV,
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

const MANUAL_RUN_URL = "https://example.test/api/admin/sources/noaa_cpc_roni/run";

function manualRunRequest(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request(MANUAL_RUN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "manual-run-key-0001", ...headers },
    body,
  });
}

describe("administrative write guards", () => {
  it("rejects a role-bearing actor without an email claim before any audit row is written", async () => {
    const manualSourceRun = vi.fn();
    const response = await handleRequest(manualRunRequest(JSON.stringify({ reason: "核对 NOAA 更新" })), REQUEST_ENV, {
      authorizeAdmin: async () => ({ email: null, roles: ["editor"] }),
      manualSourceRun,
    });

    expect(response.status).toBe(403);
    const payload = await response.json() as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("AUTH_FORBIDDEN");
    expect(manualSourceRun).not.toHaveBeenCalled();
  });

  it("keeps the real Access email as the audited administrative identity", async () => {
    const manualSourceRun = vi.fn(async () => ({
      operationId: "operation-1",
      sourceId: "noaa_cpc_roni",
      status: "dispatching" as const,
      run: null,
      replayed: false,
    }));
    const response = await handleRequest(manualRunRequest(JSON.stringify({ reason: "核对 NOAA 更新" })), REQUEST_ENV, {
      authorizeAdmin: async () => ({ email: "editor@example.test", roles: ["editor"] }),
      manualSourceRun,
    });

    expect(response.status).toBe(200);
    expect(manualSourceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "noaa_cpc_roni",
        reason: "核对 NOAA 更新",
        idempotencyKey: "manual-run-key-0001",
        actor: "editor@example.test",
      }),
      REQUEST_ENV,
    );
  });

  it("rejects an oversized administrative body with a 413 envelope before dispatch", async () => {
    const manualSourceRun = vi.fn();
    const response = await handleRequest(
      manualRunRequest(JSON.stringify({ reason: "x".repeat(64 * 1024 + 1) })),
      REQUEST_ENV,
      { authorizeAdmin: async () => ({ email: "editor@example.test", roles: ["editor"] }), manualSourceRun },
    );

    expect(response.status).toBe(413);
    const payload = await response.json() as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("VALIDATION");
    expect(payload.error.message).toBe("请求体超过允许大小");
    expect(manualSourceRun).not.toHaveBeenCalled();
  });

  it("bounds a streamed body with no declared content-length by counting bytes", async () => {
    const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 6; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    const manualSourceRun = vi.fn();
    // 流式 body 不携带 content-length（undici 对流请求不发该头），上限只能靠逐块计数兜底。
    const response = await handleRequest(
      new Request(MANUAL_RUN_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "manual-run-key-0001" },
        body: oversizedStream,
        duplex: "half",
      } as RequestInit),
      REQUEST_ENV,
      { authorizeAdmin: async () => ({ email: "editor@example.test", roles: ["editor"] }), manualSourceRun },
    );

    expect(response.status).toBe(413);
    expect(manualSourceRun).not.toHaveBeenCalled();
  });

  it("leaves normal administrative bodies unaffected by the size guard", async () => {
    const administrativeDraftEdit = vi.fn(async () => {
      throw new Error("guarded route reached its module");
    });
    const response = await handleRequest(
      new Request("https://example.test/api/admin/thesis-versions/version-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thesisId: "ship-eu-01", expectedVersion: 1, reason: "修订措辞", summary: "更正" }),
      }),
      REQUEST_ENV,
      { authorizeAdmin: async () => ({ email: "editor@example.test", roles: ["editor"] }), administrativeDraftEdit },
    );

    // 未超限的载荷应穿过 413 守卫抵达模块层（这里以模块抛错证明解析已放行）。
    expect(response.status).toBe(503);
    expect(administrativeDraftEdit).toHaveBeenCalledOnce();
  });
});

describe("top-level fetch fallback", () => {
  it("delegates happy-path routing through worker.fetch", async () => {
    const response = await worker.fetch(
      new Request("https://example.test/api/v1/healthz"),
      REQUEST_ENV,
    );

    expect(response.status).toBe(200);
  });

  it("returns a uniform 500 envelope without leaking the escaped exception", async () => {
    const response = escapedRequestResponse(
      new Request("https://example.test/api/v1/overview"),
      new Error("内部细节：存储绑定与上游地址"),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("服务暂时不可用，请稍后重试");
    expect(body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(JSON.stringify(body)).not.toContain("内部细节");
  });
});

describe("scheduled ingestion aggregation", () => {
  it("returns completed only when every dispatched source succeeds", async () => {
    const logger = spyLogger();
    const outcome = await handleScheduled(scheduledController(QUARTER_HOURLY_CRON), REQUEST_ENV, {
      dispatch: async () => [
        dispatchResult(),
        dispatchResult({ sourceId: "nasa_power_rainfall_panama_canal_catchment_v1" }),
      ],
      logger,
    });

    expect(outcome.outcome).toBe("completed");
    expect(outcome.sourcesDispatched).toBe(2);
    const aggregated = JSON.parse(logger.info.mock.calls.at(-1)![0] as string);
    expect(aggregated.outcome).toBe("completed");
    expect(aggregated.sourcesDispatched).toBe(2);
  });

  it("returns partial when a dispatched source fails collection", async () => {
    const logger = spyLogger();
    const outcome = await handleScheduled(scheduledController(QUARTER_HOURLY_CRON), REQUEST_ENV, {
      dispatch: async () => [
        dispatchResult(),
        dispatchResultFailed("nasa_power_rainfall_panama_canal_catchment_v1"),
      ],
      logger,
    });

    expect(outcome.outcome).toBe("partial");
    expect(outcome.sourcesDispatched).toBe(2);
    const aggregated = JSON.parse(logger.warn.mock.calls.at(-1)![0] as string);
    expect(aggregated.outcome).toBe("partial");
    expect(aggregated.sourcesDispatched).toBe(2);
  });

  it("returns partial when the dispatcher itself fails a source", async () => {
    const logger = spyLogger();
    const outcome = await handleScheduled(scheduledController(QUARTER_HOURLY_CRON), REQUEST_ENV, {
      dispatch: async () => [
        dispatchResult({ outcome: null, dispatcherErrorCode: "DATABASE" }),
      ],
      logger,
    });

    expect(outcome.outcome).toBe("partial");
    const aggregated = JSON.parse(logger.warn.mock.calls.at(-1)![0] as string);
    expect(aggregated.outcome).toBe("partial");
  });
});
