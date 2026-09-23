export const DEFAULT_PUBLIC_API_BENCHMARK_OPTIONS = Object.freeze({
  concurrency: 2,
  maxP95Ms: 800,
  requestCount: 20,
  timeoutMs: 2_000,
});

const MAX_CONCURRENCY = 10;
const MAX_REQUEST_COUNT = 100;
const MAX_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 100;

export class PublicApiBenchmarkFailure extends Error {
  constructor(summary, reasons) {
    super(`公开 API 基准未通过：${reasons.join("；")}`);
    this.name = "PublicApiBenchmarkFailure";
    this.reasons = reasons;
    this.summary = summary;
  }
}

export function parsePublicApiBenchmarkArguments(argv) {
  const parsed = readArguments(argv);
  if (parsed.help) return { help: true };

  const baseUrl = parseBaseUrl(requiredArgument(parsed, "base-url"));
  const path = parsePublicPath(requiredArgument(parsed, "path"));
  const expectedCacheControl = requiredArgument(parsed, "expect-cache-control").trim();
  if (expectedCacheControl === "") {
    throw new Error("--expect-cache-control 不能为空。");
  }

  const requestCount = parseBoundedInteger(
    parsed.requests ?? String(DEFAULT_PUBLIC_API_BENCHMARK_OPTIONS.requestCount),
    "--requests",
    1,
    MAX_REQUEST_COUNT,
  );
  const concurrency = parseBoundedInteger(
    parsed.concurrency ?? String(DEFAULT_PUBLIC_API_BENCHMARK_OPTIONS.concurrency),
    "--concurrency",
    1,
    MAX_CONCURRENCY,
  );
  if (concurrency > requestCount) {
    throw new Error("--concurrency 不能大于 --requests。");
  }

  return {
    baseUrl,
    concurrency,
    expectedCacheControl,
    expectedCfCacheStatus: optionalNonEmptyArgument(parsed, "expect-cf-cache-status"),
    maxP95Ms: parseBoundedInteger(
      parsed.maxP95Ms ?? String(DEFAULT_PUBLIC_API_BENCHMARK_OPTIONS.maxP95Ms),
      "--max-p95-ms",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    path,
    requestCount,
    timeoutMs: parseBoundedInteger(
      parsed.timeoutMs ?? String(DEFAULT_PUBLIC_API_BENCHMARK_OPTIONS.timeoutMs),
      "--timeout-ms",
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
  };
}

export async function assertPublicApiBenchmark(options, dependencies) {
  const summary = await publicApiBenchmark(options, dependencies);
  const reasons = [];

  if (summary.failures.count > 0) {
    reasons.push(`${summary.failures.count} 个样本失败或返回非 2xx`);
  }
  if (!summary.cache.cacheControl.matches) {
    reasons.push("Cache-Control 与预期不一致");
  }
  if (summary.cache.cfCacheStatus.expected !== null && !summary.cache.cfCacheStatus.matches) {
    reasons.push("CF-Cache-Status 与预期不一致或不可用");
  }
  if (!summary.latency.passed) {
    reasons.push(`p95 ${summary.p95Ms}ms 超过 ${summary.latency.maxP95Ms}ms 阈值`);
  }

  if (reasons.length > 0) {
    throw new PublicApiBenchmarkFailure(summary, reasons);
  }

  return summary;
}

export async function publicApiBenchmark(options, dependencies = {}) {
  const normalized = normalizeOptions(options);
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new Error("当前运行环境没有 fetch；请使用 Node.js 24 运行此基准。");
  }

  const now = dependencies.now ?? (() => performance.now());
  const setTimeoutImplementation = dependencies.setTimeout ?? setTimeout;
  const clearTimeoutImplementation = dependencies.clearTimeout ?? clearTimeout;
  const requestUrl = new URL(normalized.path, normalized.baseUrl).toString();
  const samples = new Array(normalized.requestCount);
  let nextSample = 0;

  const worker = async () => {
    while (nextSample < samples.length) {
      const sampleIndex = nextSample;
      nextSample += 1;
      samples[sampleIndex] = await samplePublicApi({
        clearTimeoutImplementation,
        fetchImplementation,
        now,
        requestUrl,
        setTimeoutImplementation,
        timeoutMs: normalized.timeoutMs,
      });
    }
  };

  await Promise.all(Array.from({ length: normalized.concurrency }, worker));

  const failures = samples.flatMap((sample, index) => sample.failure === null ? [] : [{ index: index + 1, ...sample.failure }]);
  const observedCacheControl = observedHeaders(samples, "cacheControl");
  const observedCfCacheStatus = observedHeaders(samples, "cfCacheStatus");
  const p95Ms = percentile95(samples.map((sample) => sample.durationMs));
  const expectedCfCacheStatus = normalized.expectedCfCacheStatus;

  return {
    target: {
      origin: normalized.baseUrl,
      path: normalized.path,
    },
    sampleCount: samples.length,
    p95Ms,
    failures: {
      count: failures.length,
      samples: failures,
    },
    latency: {
      maxP95Ms: normalized.maxP95Ms,
      passed: p95Ms <= normalized.maxP95Ms,
    },
    cache: {
      cacheControl: {
        expected: normalized.expectedCacheControl,
        matches: samples.every((sample) => sample.cacheControl !== null
          && headersMatch(sample.cacheControl, normalized.expectedCacheControl)),
        observed: observedCacheControl,
      },
      cfCacheStatus: {
        availability: observedCfCacheStatus.length === 0 ? "unavailable" : "available",
        expected: expectedCfCacheStatus,
        matches: expectedCfCacheStatus === null
          ? null
          : samples.every((sample) => sample.cfCacheStatus !== null
            && headersMatch(sample.cfCacheStatus, expectedCfCacheStatus)),
        observed: observedCfCacheStatus,
      },
      cacheHitEvidence: cacheHitEvidence(samples),
    },
    disclaimer: "该外部运行结果仅构成测量证据，不能自动代表 staging 或 production 验收。",
  };
}

export function percentile95(durationsMs) {
  if (!Array.isArray(durationsMs) || durationsMs.length === 0) {
    throw new Error("p95 至少需要一个样本。");
  }
  if (!durationsMs.every((duration) => Number.isFinite(duration) && duration > 0)) {
    throw new Error("p95 样本必须是正数毫秒值。");
  }

  const sorted = [...durationsMs].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

export const PUBLIC_API_BENCHMARK_USAGE = `用法：
  npm run benchmark:public-api -- --base-url https://staging.example.com --path /api/v1/overview --expect-cache-control "public, max-age=60, stale-while-revalidate=300" [选项]

必填：
  --base-url <https origin>            明确的 HTTPS origin；不接受路径、查询参数或凭据。
  --path </api/v1/...>                 明确的公开 API 路径；不接受查询参数或后台路径。
  --expect-cache-control <value>       每个响应都必须匹配的 Cache-Control 值。

可选（保守默认值）：
  --requests <1-${MAX_REQUEST_COUNT}>                请求数，默认 ${DEFAULT_PUBLIC_API_BENCHMARK_OPTIONS.requestCount}。
  --concurrency <1-${MAX_CONCURRENCY}>               并发数，默认 ${DEFAULT_PUBLIC_API_BENCHMARK_OPTIONS.concurrency}。
  --timeout-ms <${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}> 单请求超时，默认 ${DEFAULT_PUBLIC_API_BENCHMARK_OPTIONS.timeoutMs}ms。
  --max-p95-ms <positive integer>      p95 阈值，默认 ${DEFAULT_PUBLIC_API_BENCHMARK_OPTIONS.maxP95Ms}ms（未证明缓存命中时的 PRD 上限）。
  --expect-cf-cache-status <value>     可选 Cloudflare 缓存状态，例如 HIT；缺失时会报告 unavailable，不能据此声称缓存命中。
  --help                               显示本说明。`;

function normalizeOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("基准选项必须是对象。");
  }

  const baseUrl = parseBaseUrl(options.baseUrl);
  const path = parsePublicPath(options.path);
  const expectedCacheControl = requiredString(options.expectedCacheControl, "expectedCacheControl");
  const expectedCfCacheStatus = optionalString(options.expectedCfCacheStatus, "expectedCfCacheStatus");
  const requestCount = boundedOption(options.requestCount, "requestCount", 1, MAX_REQUEST_COUNT);
  const concurrency = boundedOption(options.concurrency, "concurrency", 1, MAX_CONCURRENCY);
  if (concurrency > requestCount) {
    throw new Error("concurrency 不能大于 requestCount。");
  }

  return {
    baseUrl,
    concurrency,
    expectedCacheControl,
    expectedCfCacheStatus,
    maxP95Ms: boundedOption(options.maxP95Ms, "maxP95Ms", 1, Number.MAX_SAFE_INTEGER),
    path,
    requestCount,
    timeoutMs: boundedOption(options.timeoutMs, "timeoutMs", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
  };
}

async function samplePublicApi({
  clearTimeoutImplementation,
  fetchImplementation,
  now,
  requestUrl,
  setTimeoutImplementation,
  timeoutMs,
}) {
  const controller = new AbortController();
  const startedAt = now();
  let timeout;
  const timeoutResult = new Promise((resolve) => {
    timeout = setTimeoutImplementation(() => {
      controller.abort();
      resolve({ kind: "timeout" });
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      Promise.resolve(fetchImplementation(requestUrl, {
        headers: { accept: "application/json" },
        method: "GET",
        signal: controller.signal,
      })).then((response) => ({ kind: "response", response })),
      timeoutResult,
    ]);
    const durationMs = elapsedMilliseconds(startedAt, now());
    if (result.kind === "timeout") {
      return failedSample(durationMs, "timeout");
    }

    const { response } = result;
    const cacheControl = response.headers.get("cache-control");
    const cfCacheStatus = response.headers.get("cf-cache-status");

    return {
      cacheControl,
      cfCacheStatus,
      durationMs,
      failure: response.ok ? null : { kind: "http", status: response.status },
    };
  } catch {
    return failedSample(
      elapsedMilliseconds(startedAt, now()),
      controller.signal.aborted ? "timeout" : "network",
    );
  } finally {
    clearTimeoutImplementation(timeout);
  }
}

function failedSample(durationMs, kind) {
  return {
    cacheControl: null,
    cfCacheStatus: null,
    durationMs,
    failure: { kind, status: null },
  };
}

function elapsedMilliseconds(startedAt, finishedAt) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) {
    throw new Error("基准时钟必须返回有限数值。");
  }
  return Math.max(1, Math.round(finishedAt - startedAt));
}

function readArguments(argv) {
  if (!Array.isArray(argv) || !argv.every((argument) => typeof argument === "string")) {
    throw new Error("命令行参数必须是字符串数组。");
  }

  const knownArguments = new Map([
    ["--base-url", "baseUrl"],
    ["--path", "path"],
    ["--expect-cache-control", "expectCacheControl"],
    ["--expect-cf-cache-status", "expectCfCacheStatus"],
    ["--requests", "requests"],
    ["--concurrency", "concurrency"],
    ["--timeout-ms", "timeoutMs"],
    ["--max-p95-ms", "maxP95Ms"],
  ]);
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      if (argv.length !== 1) throw new Error("--help 不能与其他参数同时使用。");
      return { help: true };
    }

    const key = knownArguments.get(argument);
    if (key === undefined) throw new Error(`不支持的参数：${argument}`);
    if (Object.hasOwn(parsed, key)) throw new Error(`参数不能重复：${argument}`);

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} 缺少值。`);
    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

function parseBaseUrl(value) {
  const text = requiredString(value, "--base-url");
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("--base-url 必须是有效 HTTPS origin。");
  }

  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || url.pathname !== "/") {
    throw new Error("--base-url 必须是没有路径、查询参数或凭据的 HTTPS origin。");
  }
  return url.origin;
}

function parsePublicPath(value) {
  const path = requiredString(value, "--path");
  if (!path.startsWith("/api/v1/") || path.startsWith("//") || path.includes("?") || path.includes("#") || path.includes("\\")) {
    throw new Error("--path 必须是没有查询参数的 /api/v1/ 公开接口路径。");
  }

  // URL resolution normalizes literal and percent-encoded dot segments. Reject a path when that
  // normalization would leave `/api/v1/`, rather than allowing a benchmark invocation to reach a
  // similarly named non-public route such as `/api/admin/...`.
  const resolvedPath = new URL(path, "https://benchmark.invalid").pathname;
  if (resolvedPath !== path || !resolvedPath.startsWith("/api/v1/")) {
    throw new Error("--path 必须是规范的 /api/v1/ 公开接口路径。");
  }
  return path;
}

function requiredArgument(parsed, name) {
  const value = parsed[camelCase(name)];
  return requiredString(value, `--${name}`);
}

function optionalNonEmptyArgument(parsed, name) {
  const value = parsed[camelCase(name)];
  return value === undefined ? null : requiredString(value, `--${name}`);
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} 是必填项。`);
  }
  return value.trim();
}

function optionalString(value, label) {
  if (value === undefined || value === null) return null;
  return requiredString(value, label);
}

function parseBoundedInteger(value, label, minimum, maximum) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} 必须是整数。`);
  }
  return validateBoundedInteger(Number(value), label, minimum, maximum);
}

function boundedOption(value, label, minimum, maximum) {
  return validateBoundedInteger(value, label, minimum, maximum);
}

function validateBoundedInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} 必须介于 ${minimum} 和 ${maximum} 之间。`);
  }
  return value;
}

function headersMatch(actual, expected) {
  return normalizeHeader(actual) === normalizeHeader(expected);
}

function normalizeHeader(value) {
  return value.trim().replaceAll(/\s+/g, " ");
}

function observedHeaders(samples, key) {
  return [...new Set(samples.map((sample) => sample[key]).filter((value) => value !== null))].sort();
}

function cacheHitEvidence(samples) {
  if (samples.every((sample) => sample.cfCacheStatus === null)) return "unavailable";
  return samples.every((sample) => sample.failure === null
    && sample.cfCacheStatus !== null
    && sample.cfCacheStatus.toUpperCase() === "HIT") ? "observed" : "not-observed";
}

function camelCase(kebabCase) {
  return kebabCase.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
