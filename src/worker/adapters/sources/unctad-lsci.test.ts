import { describe, expect, it, vi } from "vitest";

import type { CollectContext } from "../../../domain/ingestion";
import {
  UNCTAD_SOURCE_ID,
  UNCTAD_SOURCE_URL,
  createUnctadLsciAdapter,
  monthWindow,
} from "./unctad-lsci";

const CREDENTIALS = { clientId: "unctad-client-id", apiKey: "unctad-client-secret" };
const SCHEDULED_AT = "2026-09-25T00:00:00.000Z";

interface FactRowFixture {
  readonly month?: string | null;
  readonly economyLabel?: string | null;
  readonly economyCode?: string | null;
  readonly value?: number | string | null;
}

function factRow(fixture: FactRowFixture) {
  return {
    Month: { Code: fixture.month === undefined ? "2026M08" : fixture.month },
    Economy: {
      Code: fixture.economyCode === undefined ? "140" : fixture.economyCode,
      Label: fixture.economyLabel === undefined ? "China" : fixture.economyLabel,
    },
    M4023: { Value: fixture.value === undefined ? 102.5 : fixture.value },
  };
}

function collectContext(
  fetch: CollectContext["fetch"],
  overrides: Partial<CollectContext> = {},
): CollectContext {
  return {
    sourceId: UNCTAD_SOURCE_ID,
    sourceUrl: UNCTAD_SOURCE_URL,
    scheduledAt: SCHEDULED_AT,
    fetchedAt: "2026-09-25T00:00:01.000Z",
    previousEtag: null,
    previousLastModified: null,
    previousContentHash: null,
    fetch,
    ...overrides,
  };
}

function factsResponse(rows: readonly unknown[]): Response {
  return new Response(JSON.stringify({ value: rows }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("UNCTAD LSCI 适配器", () => {
  it("monthWindow 从 scheduledAt 向前取 count 个已完成月", () => {
    expect(monthWindow("2026-09-25T00:00:00.000Z", 3)).toEqual(["2026M08", "2026M07", "2026M06"]);
    expect(() => monthWindow("not-a-date", 1)).toThrowError();
  });

  it("请求 $filter 同时限定 Month 与 Economy/Code（冻结契约），中国月度值正常落观测", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("$select")).toBe("Month,Economy,M4023");
      expect(url.searchParams.get("$filter")).toBe(
        "Month/Code eq '2026M08' and Economy/Code eq '140'",
      );
      return factsResponse([factRow({})]);
    });

    const result = await createUnctadLsciAdapter(CREDENTIALS).collect(collectContext(fetch));

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.status).toBe("changed");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      value: 102.5,
      unit: "index",
      quality: "provisional",
      metadata: { economyCode: "140", month: "2026M08" },
    });
  });

  it("fail-closed：Value 为 null（该月未发布）时抛 SCHEMA_DRIFT，不再静默落库", async () => {
    const fetch = vi.fn(async () => factsResponse([factRow({ value: null })]));

    await expect(
      createUnctadLsciAdapter(CREDENTIALS).collect(collectContext(fetch)),
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT", retryable: false });
  });

  it("fail-closed：Value 为字符串时抛 SCHEMA_DRIFT", async () => {
    const fetch = vi.fn(async () => factsResponse([factRow({ value: "102.5" })]));

    await expect(
      createUnctadLsciAdapter(CREDENTIALS).collect(collectContext(fetch)),
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
  });

  it("fail-closed：Month/Code 缺失或格式漂移时抛 SCHEMA_DRIFT", async () => {
    const fetch = vi.fn(async () => factsResponse([factRow({ month: null })]));

    await expect(
      createUnctadLsciAdapter(CREDENTIALS).collect(collectContext(fetch)),
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
  });

  it("窗口内没有 China 行时保持既有 VALIDATION 语义（回溯未发布月份的现行为不变）", async () => {
    const fetch = vi.fn(async () =>
      factsResponse([factRow({ economyLabel: "Singapore", value: null })]),
    );

    await expect(
      createUnctadLsciAdapter(CREDENTIALS).collect(collectContext(fetch)),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("当月有行但缺 China 时回溯上一月收口（break→continue 语义）", async () => {
    // 当月（2026M08）只返回其他经济体（过滤 China 后为空），上月（2026M07）有 China 行。
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const month = /Month\/Code eq '(\d{4}M\d{2})'/.exec(new URL(String(input)).searchParams.get("$filter") ?? "")?.[1];
      if (month === "2026M08") return factsResponse([factRow({ economyLabel: "Singapore" })]);
      if (month === "2026M07") {
        return factsResponse([factRow({ month: "2026M07", value: 101.25 })]);
      }
      throw new Error(`未预期的请求月份 ${String(month)}`);
    });

    const result = await createUnctadLsciAdapter(CREDENTIALS).collect(collectContext(fetch));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("changed");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      value: 101.25,
      metadata: { month: "2026M07", economyCode: "140" },
    });
  });

  it("当月响应为空（未发布）且回溯仍落空时才 VALIDATION", async () => {
    const fetch = vi.fn(async () => factsResponse([]));

    await expect(
      createUnctadLsciAdapter(CREDENTIALS).collect(collectContext(fetch)),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
