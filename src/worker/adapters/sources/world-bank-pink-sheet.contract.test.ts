import { describe, expect, it } from "vitest";
import type { CollectContext } from "../../../domain/ingestion";
import {
  WORLD_BANK_RSS3_INDICATOR_ID,
  WORLD_BANK_SOURCE_URL,
  WORLD_BANK_TSR20_INDICATOR_ID,
  monthPeriodFromLabel,
  pinkSheetColumnLetters,
  worldBankPinkSheetAdapter,
} from "./world-bank-pink-sheet";
import { storedZip } from "./testing/stored-zip";

/** 仓库内合成 XLSX：STORED 打包，模拟 Monthly Prices 的结构（不包含任何第三方数据行）。 */
function buildSyntheticWorkbook(): Uint8Array {
  const shared =
    "<sst>" +
    "<si><t>Rubber, RSS3</t></si>" +
    "<si><t>Rubber, TSR20 **</t></si>" +
    "<si><t>…</t></si>" +
    "</sst>";
  const headerRow =
    '<row r="5">' +
    '<c r="BD5" t="s"><v>1</v></c>' +
    '<c r="BE5" t="s"><v>0</v></c>' +
    "</row>";
  const dataRows = [0, 1, 2, 3, 4, 5]
    .map((offset) => {
      const year = 2026;
      const month = 3 + offset;
      const label = `${year}M0${month}`;
      const rss3 = (2.4 + offset * 0.1).toFixed(2);
      const tsr20 = offset === 1 ? "…" : (2.05 + offset * 0.05).toFixed(2);
      const rowNumber = 6 + offset;
      return (
        `<row r="${rowNumber}">` +
        `<c r="A${rowNumber}"><v>${label}</v></c>` +
        `<c r="BE${rowNumber}"><v>${rss3}</v></c>` +
        `<c r="BD${rowNumber}"><v>${tsr20}</v></c>` +
        "</row>"
      );
    })
    .join("");
  const sheetXml = `<worksheet>${headerRow}${dataRows}</worksheet>`;
  const files: Record<string, string> = {
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="Mismatch Details" r:id="rId1"/><sheet name="Monthly Prices" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/sharedStrings.xml": shared,
    "xl/worksheets/sheet2.xml": sheetXml,
  };
  return storedZip(files);
}

function response(body: Uint8Array | null, headers: Record<string, string> = {}, status = 200): Response {
  const payload = body === null ? null : (body.slice().buffer as ArrayBuffer);
  return new Response(payload, { status, headers });
}

function collectContext(overrides: Partial<CollectContext> = {}): CollectContext {
  return {
    sourceId: "world_bank_commodity_prices",
    sourceUrl: WORLD_BANK_SOURCE_URL,
    scheduledAt: "2026-09-19T00:00:00.000Z",
    fetchedAt: "2026-09-19T00:00:00.000Z",
    previousEtag: null,
    previousLastModified: null,
    previousContentHash: null,
    fetch: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

async function digest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength).fill(0);
  view: {
    copy.set(bytes);
    break view;
  }
  const view = await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  return [...new Uint8Array(view)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("World Bank Pink Sheet 零成本来源", () => {
  it("monthly label → 月首/月末 UTC 区间", () => {
    const period = monthPeriodFromLabel("2026M08");
    expect(period).toEqual({
      periodStart: "2026-08-01T00:00:00.000Z",
      observedAt: "2026-08-31T00:00:00.000Z",
    });
    expect(monthPeriodFromLabel("2026M99")).toBeNull();
  });

  it("候选列字母覆盖 Pink Sheet 的 BD/BE", () => {
    const letters = pinkSheetColumnLetters();
    expect(letters[0]).toBe("A");
    expect(letters).toContain("BD");
    expect(letters).toContain("BE");
  });

  it("collect：304 → unchanged；本体变化 → 两条月度观测", async () => {
    const workbook = buildSyntheticWorkbook();
    const workbookDigest = await digest(workbook);
    const unchanged = await worldBankPinkSheetAdapter.collect(collectContext({
      previousContentHash: workbookDigest,
      fetch: async () => response(null, { "content-type": "application/octet-stream" }, 304),
    }));
    expect(unchanged.status).toBe("unchanged");
    expect(unchanged.observations).toHaveLength(0);

    const changed = await worldBankPinkSheetAdapter.collect(collectContext({
      fetch: async () => response(workbook, { "content-type": "application/octet-stream", "last-modified": "Tue, 02 Sep 2026 06:00:00 GMT" }),
    }));
    expect(changed.status).toBe("changed");
    expect(changed.observations.map((observation) => observation.indicatorId)).toContain(WORLD_BANK_RSS3_INDICATOR_ID);
    expect(changed.observations.map((observation) => observation.indicatorId)).toContain(WORLD_BANK_TSR20_INDICATOR_ID);
    expect(changed.observations).toHaveLength(11);
    expect(changed.warnings).toContain("SOURCE_PUBLISHED_AT_UNKNOWN");
  });

  it("fail-closed：非工作簿响应 / 表头漂移抛 SCHEMA_DRIFT", async () => {
    await expect(worldBankPinkSheetAdapter.collect(collectContext({
      fetch: async () => response(new TextEncoder().encode("<html>lost</html>")),
    }))).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
  });
});
