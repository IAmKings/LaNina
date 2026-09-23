import { expect, it } from "vitest";

import { runLiveSmoke } from "./live-smoke";
import { selectLiveSmokeTargets } from "./live-smoke-targets";

interface RuntimeProcess {
  env: Record<string, string | undefined>;
}

const runtimeProcess = (globalThis as typeof globalThis & { process: RuntimeProcess }).process;

it("runs explicitly selected live adapter smoke checks without persistence", async () => {
  const activation = selectLiveSmokeTargets({
    enabled: runtimeProcess.env.LIVE_SMOKE_ENABLED === "true",
    sourceIds: parseSourceIds(runtimeProcess.env.LIVE_SMOKE_SOURCE_IDS),
    usdaFasApiKey: runtimeProcess.env.USDA_FAS_API_KEY,
    eiaApiKey: runtimeProcess.env.EIA_API_KEY,
  });
  for (const sourceId of activation.skippedSourceIds) {
    console.info(JSON.stringify({
      handler: "live_smoke.source",
      sourceId,
      outcome: "skipped",
      errorCode: "AUTH",
    }));
  }

  const now = new Date().toISOString();
  const report = await runLiveSmoke({
    targets: activation.targets,
    scheduledAt: now,
    fetchedAt: now,
    fetch: fetchWithTimeout,
  });

  expect(report.sourcesChecked).toBe(activation.targets.length);
  expect(report.results.every((result) =>
    result.outcome === "ok" || result.outcome === "warning",
  )).toBe(true);
}, 300_000);

function parseSourceIds(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw.split(",").map((sourceId) => sourceId.trim()).filter(Boolean);
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, 10_000);
  try {
    return await globalThis.fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
