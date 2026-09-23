import { describe, expect, it } from "vitest";

import {
  PublicApiBenchmarkFailure,
  assertPublicApiBenchmark,
  parsePublicApiBenchmarkArguments,
  percentile95,
  publicApiBenchmark,
} from "./public-api-benchmark.mjs";

const options = {
  baseUrl: "https://staging.example.test",
  concurrency: 1,
  expectedCacheControl: "public, max-age=60, stale-while-revalidate=300",
  expectedCfCacheStatus: null,
  maxP95Ms: 800,
  path: "/api/v1/overview",
  requestCount: 3,
  timeoutMs: 100,
};

describe("public API benchmark", () => {
  it("requires an explicit HTTPS origin, public path and cache expectation", () => {
    expect(() => parsePublicApiBenchmarkArguments([])).toThrow("--base-url 是必填项");
    expect(() => parsePublicApiBenchmarkArguments([
      "--base-url", "http://staging.example.test",
      "--path", "/api/v1/overview",
      "--expect-cache-control", "public, max-age=60",
    ])).toThrow("HTTPS origin");
    expect(() => parsePublicApiBenchmarkArguments([
      "--base-url", "https://staging.example.test",
      "--path", "/api/admin/runs",
      "--expect-cache-control", "public, max-age=60",
    ])).toThrow("/api/v1/");
    expect(() => parsePublicApiBenchmarkArguments([
      "--base-url", "https://staging.example.test",
      "--path", "/api/v1/overview?token=secret",
      "--expect-cache-control", "public, max-age=60",
    ])).toThrow("没有查询参数");
    for (const path of ["/api/v1/../admin/runs", "/api/v1/%2e%2e/admin/runs"]) {
      expect(() => parsePublicApiBenchmarkArguments([
        "--base-url", "https://staging.example.test",
        "--path", path,
        "--expect-cache-control", "public, max-age=60",
      ])).toThrow("规范的 /api/v1/");
    }
    expect(() => parsePublicApiBenchmarkArguments([
      "--base-url", "https://token:secret@staging.example.test",
      "--path", "/api/v1/overview",
      "--expect-cache-control", "public, max-age=60",
    ])).toThrow("没有路径、查询参数或凭据");
    expect(() => parsePublicApiBenchmarkArguments([
      "--base-url", "https://staging.example.test?token=secret",
      "--path", "/api/v1/overview",
      "--expect-cache-control", "public, max-age=60",
    ])).toThrow("没有路径、查询参数或凭据");
  });

  it("uses nearest-rank p95 and retains a non-zero duration for a failed response", async () => {
    const durations = [10, 60, 20];
    let now = 0;
    let sample = 0;
    const summary = await publicApiBenchmark(options, {
      fetch: async () => {
        now += durations[sample];
        const status = sample === 1 ? 503 : 200;
        sample += 1;
        return new Response(null, {
          headers: {
            "cache-control": "public, max-age=60, stale-while-revalidate=300",
          },
          status,
        });
      },
      now: () => now,
    });

    expect(summary.p95Ms).toBe(60);
    expect(summary.failures).toEqual({ count: 1, samples: [{ index: 2, kind: "http", status: 503 }] });
    expect(percentile95([10, 60, 20])).toBe(60);
  });

  it("reports unavailable Cloudflare cache evidence and fails an explicit HIT expectation", async () => {
    await expect(assertPublicApiBenchmark({ ...options, expectedCfCacheStatus: "HIT" }, {
      fetch: async () => new Response(null, {
        headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
        status: 200,
      }),
      now: monotonicClock(),
    })).rejects.toMatchObject({
      name: "PublicApiBenchmarkFailure",
      reasons: ["CF-Cache-Status 与预期不一致或不可用"],
      summary: {
        cache: {
          cacheHitEvidence: "unavailable",
          cfCacheStatus: { availability: "unavailable", expected: "HIT", matches: false, observed: [] },
        },
      },
    });
  });

  it("cancels timed-out samples and fails an exceeded p95 threshold with the JSON summary", async () => {
    await expect(assertPublicApiBenchmark({ ...options, maxP95Ms: 1, requestCount: 1 }, {
      clearTimeout: () => {},
      fetch: abortableFetch,
      now: monotonicClock(2),
      setTimeout: (callback) => {
        callback();
        return 1;
      },
    })).rejects.toBeInstanceOf(PublicApiBenchmarkFailure);

    try {
      await assertPublicApiBenchmark({ ...options, maxP95Ms: 1, requestCount: 1 }, {
        clearTimeout: () => {},
        fetch: abortableFetch,
        now: monotonicClock(2),
        setTimeout: (callback) => {
          callback();
          return 1;
        },
      });
    } catch (error) {
      expect(error).toMatchObject({
        reasons: expect.arrayContaining(["1 个样本失败或返回非 2xx", "p95 2ms 超过 1ms 阈值"]),
        summary: {
          failures: { count: 1, samples: [{ index: 1, kind: "timeout", status: null }] },
          p95Ms: 2,
        },
      });
    }
  });

  it("does not wait forever when a fetch implementation ignores an aborted signal", async () => {
    const summary = await publicApiBenchmark({ ...options, requestCount: 1 }, {
      clearTimeout: () => {},
      fetch: () => new Promise(() => {}),
      now: monotonicClock(2),
      setTimeout: (callback) => {
        callback();
        return 1;
      },
    });

    expect(summary).toMatchObject({
      failures: { count: 1, samples: [{ index: 1, kind: "timeout", status: null }] },
      cache: { cacheHitEvidence: "unavailable" },
      p95Ms: 2,
    });
  });

  it("does not describe a failed or incomplete response set as a cache hit", async () => {
    let request = 0;
    const summary = await publicApiBenchmark({ ...options, requestCount: 2 }, {
      fetch: async () => {
        request += 1;
        return new Response(null, {
          headers: {
            "cache-control": "public, max-age=60, stale-while-revalidate=300",
            "cf-cache-status": request === 1 ? "HIT" : "MISS",
          },
          status: request === 1 ? 200 : 503,
        });
      },
      now: monotonicClock(),
    });

    expect(summary.cache.cacheHitEvidence).toBe("not-observed");
  });
});

function monotonicClock(step = 1) {
  let current = 0;
  return () => {
    current += step;
    return current;
  };
}

function abortableFetch(_, request) {
  return new Promise((_, reject) => {
    if (request.signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}
