import { describe, expect, it } from "vitest";

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
});
