import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithinTimeout } from "./http";

const SOURCE_URL = "https://example.test/source";

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchWithinTimeout", () => {
  it("classifies a hung upstream as a retryable NETWORK timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // 永不 resolve 的假 fetch：模拟来源无响应（且不消费 abort 信号）的最坏情况。
    const fetch = vi.fn(async () => new Promise<Response>(() => {}));
    const action = fetchWithinTimeout(fetch, SOURCE_URL);
    const assertion = expect(action).rejects.toMatchObject({
      code: "NETWORK",
      retryable: true,
      httpStatus: null,
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS);
    await assertion;
  });

  it("honors a shorter per-call timeout override", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetch = vi.fn(async () => new Promise<Response>(() => {}));
    const action = fetchWithinTimeout(fetch, SOURCE_URL, undefined, { timeoutMs: 25 });
    const assertion = expect(action).rejects.toMatchObject({ code: "NETWORK", retryable: true });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("passes non-timeout fetch failures through for the adapter to classify", async () => {
    const failure = new TypeError("fetch failed");
    const fetch = vi.fn(async () => {
      throw failure;
    });

    await expect(fetchWithinTimeout(fetch, SOURCE_URL)).rejects.toBe(failure);
  });

  it("resolves normally and clears the deadline timer on success", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let observedSignal: AbortSignal | null = null;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? null;
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    });

    const response = await fetchWithinTimeout(fetch, SOURCE_URL, {
      headers: { Accept: "text/plain" },
    });

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(vi.getTimerCount()).toBe(0);
  });
});
