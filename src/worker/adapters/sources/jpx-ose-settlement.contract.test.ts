import { describe, expect, it, vi } from "vitest";

import { SourceCollectionError } from "../../../domain/ingestion";
import {
  JPX_OSE_RSS3_INDICATOR_ID,
  JPX_OSE_SOURCE_URL,
  JPX_OSE_TSR20_INDICATOR_ID,
  extractRubberCsvHref,
  jpxOseSettlementAdapter,
  parseRubberSettlementRows,
  selectNearbyContract,
  tradeDateFromCsvHref,
} from "./jpx-ose-settlement";

/** 合成 settlement 页（结构复刻实测：`tvdivq*` 附件目录 + rb_e{date}.csv）。 */
const SETTLEMENT_PAGE =
  '<nav><a href="/english/markets/index.html">Markets</a></nav>' +
  '<p><a href="/english/markets/derivatives/settlement-price/tvdivq00000014l6-att/rb_e20260918.csv">' +
  '<img src="/english/common/images/icon/icon-csv.png" alt="csv"/></a></p>';

/** 合成 rubber 行（列序与实测一致；SUBSET 无第三方数据行）。 */
const SETTLEMENT_CSV = [
  '"— Sorted by Index Futures,JGB Futures, Index Options (Put, Call), Options on 10-year JGB futures, Individual Options,Commodity Futures,Commodity Futures Options each in contract month numerical order.",,,,,,,,,,,,',
  '"— the issues which passed the trading date is not listed in this file.",,,,,,,,,,,', '', '',
  "Issue Code,Issue Name,Put–Call,Contract Month,Strike Price,Settlement Price,Theoretical Price,Underlying Price,Volatility ,Interest Rate,Days until Maturity,Underlying Name",
  "1610900AK,FUT_RSS3_260924,,202609,,455,,,,,6,Rubber(RSS3)",
  "1611000AK,FUT_RSS3_261026,,202610,,454.7,,,,,38,Rubber(RSS3)",
  "1611100AK,FUT_RSS3_261124,,202611,,434.8,,,,,67,Rubber(RSS3)",
  "1611200AK,FUT_RSS3_261222,,202612,,431.5,,,,,95,Rubber(RSS3)",
  "1620100AP,FUT_SHRU_270115,,202701,,18700,,,,,122,Shanghai Rubber",
  "1611000AM,FUT_TSR2_260930,,202610,,350,,,,,12,Rubber(TSR20)",
  "1611100AM,FUT_TSR2_261030,,202611,,349,,,,,42,Rubber(TSR20)",
  "1611200AM,FUT_TSR2_261130,,202612,,348.5,,,,,73,Rubber(TSR20)",
].join("\r\n");

describe("JPX/OSE 当日结算零成本来源", () => {
  it("settlement 页抽英文 rb CSV 链接；文件名给出业务日", () => {
    const href = extractRubberCsvHref(SETTLEMENT_PAGE);
    expect(href).toBe("/english/markets/derivatives/settlement-price/tvdivq00000014l6-att/rb_e20260918.csv");
    expect(tradeDateFromCsvHref(href)).toBe("2026-09-18T00:00:00.000Z");
    expect(tradeDateFromCsvHref("/markets/derivatives/settlement-price/x/rb20260918.csv")).toBeNull();
  });

  it("rubber 行解析 + 就近合约（v1 下一个到期合约月）", () => {
    const rows = parseRubberSettlementRows(SETTLEMENT_CSV);
    expect(rows.filter((row) => row.contractMonth === "202609")).toHaveLength(1);
    expect(selectNearbyContract(
      rows.filter((row) => row.issueName.startsWith("FUT_RSS3_")), "2026-09-18T00:00:00.000Z",
    )).toMatchObject({ contractMonth: "202609", settlement: 455 });
  });

  it("collect：两跳 → 就近合约的 provisional 观测（RSS3/TSR20 各一条）", async () => {
    const csvBody = new TextEncoder().encode(SETTLEMENT_CSV);
    const result = await jpxOseSettlementAdapter.collect({
      sourceId: "jpx_ose_rubber_settlement",
      sourceUrl: JPX_OSE_SOURCE_URL,
      scheduledAt: "2026-09-18T08:00:00.000Z",
      fetchedAt: "2026-09-18T08:00:00.000Z",
      previousEtag: null,
      previousLastModified: null,
      previousContentHash: null,
      fetch: async (url) => {
        const target = String(url);
        if (target === JPX_OSE_SOURCE_URL) {
          return new Response(SETTLEMENT_PAGE, { status: 200, headers: { "content-type": "text/html" } });
        }
        if (target.endsWith("rb_e20260918.csv")) {
          return new Response(csvBody, {
            status: 200,
            headers: { "content-type": "text/csv", "last-modified": "Fri, 18 Sep 2026 08:00:00 GMT" },
          });
        }
        throw new Error(`fetch 未预期地址 ${target}`);
      },
    });
    expect(result.status).toBe("changed");
    expect(result.observations.map((observation) => observation.indicatorId)).toEqual([
      JPX_OSE_RSS3_INDICATOR_ID,
      JPX_OSE_TSR20_INDICATOR_ID,
    ]);
    expect(result.observations[0]).toMatchObject({
      value: 455,
      unit: "JPY/kg",
      quality: "provisional",
      observedAt: "2026-09-18T00:00:00.000Z",
      metadata: { contractMonth: "202609", nearbySelection: "next-expiring-contract-month" },
    });
    expect(result.warnings).toContain("NEARBY_SELECTION_V1_NEXT_EXPIRY");
  });

  it("collect：不再伪造 If-None-Match（内容哈希不是 ETag）", async () => {
    const seenHeaders: string[] = [];
    await jpxOseSettlementAdapter.collect({
      sourceId: "jpx_ose_rubber_settlement",
      sourceUrl: JPX_OSE_SOURCE_URL,
      scheduledAt: "2026-09-18T08:00:00.000Z",
      fetchedAt: "2026-09-18T08:00:00.000Z",
      previousEtag: null,
      previousLastModified: null,
      previousContentHash: "a".repeat(64),
      fetch: async (_url, init) => {
        seenHeaders.push(new Headers(init?.headers).get("If-None-Match") ?? "absent");
        if (seenHeaders.length === 1) {
          return new Response(SETTLEMENT_PAGE, { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response(new TextEncoder().encode(SETTLEMENT_CSV), {
          status: 200,
          headers: { "content-type": "text/csv" },
        });
      },
    });
    expect(seenHeaders).toEqual(["absent", "absent"]);
  });

  it("collect：CSV 请求返回 304 时防御性视为 unchanged（不落观测、不写快照）", async () => {
    const result = await jpxOseSettlementAdapter.collect({
      sourceId: "jpx_ose_rubber_settlement",
      sourceUrl: JPX_OSE_SOURCE_URL,
      scheduledAt: "2026-09-18T08:00:00.000Z",
      fetchedAt: "2026-09-18T08:00:00.000Z",
      previousEtag: null,
      previousLastModified: null,
      previousContentHash: "known-hash",
      fetch: async (url) => {
        const target = String(url);
        if (target === JPX_OSE_SOURCE_URL) {
          return new Response(SETTLEMENT_PAGE, { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response(null, {
          status: 304,
          headers: { "last-modified": "Fri, 18 Sep 2026 08:00:00 GMT" },
        });
      },
    });

    expect(result).toMatchObject({
      status: "unchanged",
      contentHash: "known-hash",
      rawBody: null,
      observations: [],
      lastModified: "Fri, 18 Sep 2026 08:00:00 GMT",
    });
  });

  it("fail-closed：橡胶行列形状漂移（缺列/错位）时拒绝整份 CSV", () => {
    const drifted = `${SETTLEMENT_CSV}\r\n1611300AK,FUT_RSS3_270122,,2027,455`;
    expect(() => parseRubberSettlementRows(drifted)).toThrowError(/形状漂移/);
    expect(() => parseRubberSettlementRows(drifted)).toThrowError(SourceCollectionError);
  });

  it("非橡胶品种的畸形行不参与坏行计数（既有跳过语义不变）", () => {
    const noisy = `${SETTLEMENT_CSV}\r\n9999900XX,FUT_SHRU_270115,,,,garbage`;
    const rows = parseRubberSettlementRows(noisy);
    expect(rows.filter((row) => row.issueName.startsWith("FUT_RSS3_"))).toHaveLength(4);
  });

  it("fail-closed：CSV 不是有效 UTF-8 时抛 SCHEMA_DRIFT（不再有损解码）", async () => {
    await expect(jpxOseSettlementAdapter.collect({
      sourceId: "jpx_ose_rubber_settlement",
      sourceUrl: JPX_OSE_SOURCE_URL,
      scheduledAt: "2026-09-18T08:00:00.000Z",
      fetchedAt: "2026-09-18T08:00:00.000Z",
      previousEtag: null,
      previousLastModified: null,
      previousContentHash: null,
      fetch: async (url) => {
        const target = String(url);
        if (target === JPX_OSE_SOURCE_URL) {
          return new Response(SETTLEMENT_PAGE, { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response(new Uint8Array([0xff, 0xfe, 0x00]), {
          status: 200,
          headers: { "content-type": "text/csv" },
        });
      },
    })).rejects.toMatchObject({ code: "SCHEMA_DRIFT", retryable: false });
  });

  it("fail-closed：settlement 页不再带 rb CSV / 橡胶行缺失", async () => {
    await expect(jpxOseSettlementAdapter.collect({
      sourceId: "jpx_ose_rubber_settlement",
      sourceUrl: JPX_OSE_SOURCE_URL,
      scheduledAt: "2026-09-18T08:00:00.000Z",
      fetchedAt: "2026-09-18T08:00:00.000Z",
      previousEtag: null,
      previousLastModified: null,
      previousContentHash: null,
      fetch: async () => new Response("<html><a href='/english/index.html'>home</a></html>", { status: 200 }),
    })).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
  });

  it.each([
    ["站外绝对链接", "https://evil.com/settlement-price/rb_e20260918.csv"],
    ["同域但不在 settlement-price 目录", "https://www.jpx.co.jp/english/other/rb_e20260918.csv"],
  ])("fail-closed：%s 注入时不向其发起抓取", async (_name, injectedHref) => {
    const poisonedPage = `<p><a href="${injectedHref}">csv</a></p>`;
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      const target = String(url);
      if (target === JPX_OSE_SOURCE_URL) {
        return new Response(poisonedPage, { status: 200, headers: { "content-type": "text/html" } });
      }
      throw new Error(`fetch 未预期地址 ${target}`);
    });

    await expect(jpxOseSettlementAdapter.collect({
      sourceId: "jpx_ose_rubber_settlement",
      sourceUrl: JPX_OSE_SOURCE_URL,
      scheduledAt: "2026-09-18T08:00:00.000Z",
      fetchedAt: "2026-09-18T08:00:00.000Z",
      previousEtag: null,
      previousLastModified: null,
      previousContentHash: null,
      fetch,
    })).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
    // 只发生 settlement 页这一次请求：被注入的 CSV 地址从未被 fetch。
    expect(fetch).toHaveBeenCalledOnce();
  });
});
