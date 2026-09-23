import type {
  CollectContext,
  CollectResult,
  ObservationInput,
  SourceAdapter,
} from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import {
  parseWorksheetRows,
  parseSharedStrings,
  readXlsxEntities,
} from "./minimal-xlsx";
import { errorForResponse, readBodyWithinLimit, sha256Hex } from "./http";

export const WORLD_BANK_SOURCE_ID = "world_bank_commodity_prices";
export const WORLD_BANK_ADAPTER_KEY = "world-bank-pink-sheet-monthly-v1";
export const WORLD_BANK_SOURCE_URL =
  "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx";
export const WORLD_BANK_RSS3_INDICATOR_ID = "world_bank_rubber_rss3_monthly";
export const WORLD_BANK_TSR20_INDICATOR_ID = "world_bank_rubber_tsr20_monthly";
/** Spike 观测：工作簿 586,735 字节（2026-09-08），1 MiB 有界读取足够。 */
const MAX_RESPONSE_BYTES = 1_000_000;
/**
 * 24 个整月 × 2 指标 = 48 行，按 D1 单次批语句预算（run-source 的 50 上限）会越界；
 * v1 就取 18 个整月（36 条观测 + 2 范围查询 + 7 条基础语句 ≤ 50）。
 */
const MONTHLY_WINDOW = 18;
const MONTHLY_SHEET_NAME = "Monthly Prices";
/** Spike 记录的 constituent 复核仍 pending；适配器把这一事实随记录携带。 */
const RIGHTS_REVIEW_WARNING = "WORLD_BANK_CONSTITUENT_RIGHTS_REVIEW_PENDING";

interface MonthlyRubberValue {
  readonly label: string;
  readonly periodStart: string;
  readonly observedAt: string;
  readonly rss3: number;
  readonly tsr20: number;
}

export const worldBankPinkSheetAdapter: SourceAdapter = {
  key: WORLD_BANK_ADAPTER_KEY,

  async collect(context: CollectContext): Promise<CollectResult> {
    if (context.sourceUrl !== WORLD_BANK_SOURCE_URL) {
      throw new SourceCollectionError("VALIDATION", "World Bank 来源地址不在允许列表");
    }

    // Spike 实测：工作簿只有 Last-Modified、无 ETag；条件请求用 If-Modified-Since。
    const headers = new Headers({ Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream" });
    if (context.previousLastModified !== null) headers.set("If-Modified-Since", context.previousLastModified);

    let response: Response;
    try {
      response = await context.fetch(context.sourceUrl, { headers, redirect: "follow" });
    } catch {
      throw new SourceCollectionError("NETWORK", "无法连接 World Bank", { retryable: true });
    }

    const lastModified = response.headers.get("last-modified");
    const contentType = response.headers.get("content-type");
    if (response.status === 304) {
      return unchangedResult(context, {
        etag: null,
        lastModified: lastModified ?? context.previousLastModified,
        contentType,
        contentHash: context.previousContentHash,
      });
    }
    if (!response.ok) throw errorForResponse(response);
    if (contentType !== null && contentType.includes("text/html")) {
      throw new SourceCollectionError("SCHEMA_DRIFT", "World Bank 工作簿地址返回 HTML（可能整页移动）");
    }

    const rawBody = await readBodyWithinLimit(response, MAX_RESPONSE_BYTES);
    const contentHash = await sha256Hex(rawBody);
    if (contentHash === context.previousContentHash) {
      return unchangedResult(context, {
        etag: null, lastModified, contentType, contentHash,
      });
    }

    let parsed: readonly MonthlyRubberValue[];
    try {
      parsed = await parsePinkSheetWorkbook(rawBody);
    } catch (error) {
      if (error instanceof SourceCollectionError) throw error;
      throw new SourceCollectionError("SCHEMA_DRIFT", "World Bank 工作簿结构不可解析");
    }
    const values = parsed.slice(-MONTHLY_WINDOW);
    const observations = toObservationInputs(values, context.fetchedAt);

    return {
      sourceId: context.sourceId,
      fetchedAt: context.fetchedAt,
      sourcePublishedAt: null,
      etag: null,
      lastModified,
      contentType,
      contentHash,
      rawBody,
      observations,
      warnings: [
        "SOURCE_PUBLISHED_AT_UNKNOWN",
        RIGHTS_REVIEW_WARNING,
        ...(parsed.length > values.length ? ["AUTOMATED_WINDOW_TRUNCATED"] : []),
      ],
      status: "changed",
    };
  },
};

function unchangedResult(
  context: CollectContext,
  metadata: Pick<CollectResult, "etag" | "lastModified" | "contentType" | "contentHash">,
): CollectResult {
  return {
    sourceId: context.sourceId,
    fetchedAt: context.fetchedAt,
    sourcePublishedAt: null,
    ...metadata,
    rawBody: null,
    observations: [],
    warnings: [],
    status: "unchanged",
  };
}

/** 从工作簿字节解析 Monthly Prices 表的两个橡胶月度序列（测试可直接调用）。 */
export async function parsePinkSheetWorkbook(
  bytes: Uint8Array,
): Promise<readonly MonthlyRubberValue[]> {
  const entries = await readXlsxEntities(bytes);
  const workbook = entries.get("xl/workbook.xml");
  const relationships = entries.get("xl/_rels/workbook.xml.rels");
  const sharedStringsRaw = entries.get("xl/sharedStrings.xml");
  if (workbook === undefined || relationships === undefined || sharedStringsRaw === undefined) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "World Bank 工作簿缺少 workbook/rels/sharedStrings");
  }

  const sheetTarget = resolveMonthlySheetTarget(
    new TextDecoder().decode(workbook),
    new TextDecoder().decode(relationships),
  );
  const sheetXml = entries.get(sheetTarget);
  if (sheetXml === undefined) throw new SourceCollectionError("SCHEMA_DRIFT", "未找到 Monthly Prices 工作表数据");

  const shared = parseSharedStrings(new TextDecoder().decode(sharedStringsRaw));
  const rows = parseWorksheetRows(new TextDecoder().decode(sheetXml), shared);
  return extractMonthlyRubber(rows);
}

/** workbook.xml → 选择名称为 "Monthly Prices" 的工作表文件路径。 */
export function resolveMonthlySheetTarget(workbookXml: string, relationshipsXml: string): string {
  const sheet = /<sheet\b[^>]*name="([^"]*)"[^>]*?r:id="(rId\d+)"/g;
  let monthlyRid: string | null = null;
  for (const match of workbookXml.matchAll(sheet)) {
    if (match[1]?.trim() === MONTHLY_SHEET_NAME && match[2] !== undefined) {
      monthlyRid = match[2];
      break;
    }
  }
  if (monthlyRid === null) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "World Bank 工作簿缺少 Monthly Prices 工作表");
  }
  const target = new RegExp(`Id="${monthlyRid}"[^>]*Target="([^"]+)"`).exec(relationshipsXml)?.[1];
  if (target === undefined) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "Monthly Prices 工作表的关系映射缺失");
  }
  const normalized = target.replace(/^\//, "").replace(/^(?!xl\/)/, "xl/");
  return normalized;
}

export interface MonthlyRubberColumns {
  readonly periodColumn: string;
  readonly rss3Column: string;
  readonly tsr20Column: string;
}

/** 从 Monthly Prices 工作表抽取 RSS3/TSR20 月度序列（长度受调用方窗口限制）。 */
export function extractMonthlyRubber(
  rows: readonly { rowNumber: number; cellValue: (column: string) => string | undefined }[],
): readonly MonthlyRubberValue[] {
  const columns = locateRubberColumns(rows);
  if (columns === null) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "Monthly Prices 表头缺少橡胶 RSS3/TSR20 列");
  }
  const values: MonthlyRubberValue[] = [];
  for (const row of rows) {
    const label = row.cellValue(columns.periodColumn);
    if (label === undefined || !/^\d{4}M\d{2}$/.test(label.trim())) continue;
    const rss3 = parseRubberCell(row.cellValue(columns.rss3Column), label);
    const tsr20 = parseRubberCell(row.cellValue(columns.tsr20Column), label);
    if (rss3 === null && tsr20 === null) continue;
    const period = monthPeriodFromLabel(label.trim());
    if (period === null) {
      throw new SourceCollectionError("SCHEMA_DRIFT", `World Bank 月度标签不可解析：${label}`);
    }
    values.push({
      label: label.trim(),
      periodStart: period.periodStart,
      observedAt: period.observedAt,
      rss3: rss3 ?? Number.NaN,
      tsr20: tsr20 ?? Number.NaN,
    });
  }
  if (values.length === 0) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "Monthly Prices 数据区没有可解析的月度行");
  }
  return values;
}

/** 生成 A..CZ 的候选列字母（Pink Sheet 橡胶列实测位于 BD/BE）。 */
export function pinkSheetColumnLetters(): readonly string[] {
  const letters: string[] = [];
  for (let code = 65; code < 91; code += 1) letters.push(String.fromCharCode(code));
  for (let first = 65; first < 68; first += 1) {
    for (let second = 65; second < 91; second += 1) {
      letters.push(`${String.fromCharCode(first)}${String.fromCharCode(second)}`);
    }
  }
  return letters;
}

function locateRubberColumns(rows: readonly { rowNumber: number; cellValue: (column: string) => string | undefined }[]): MonthlyRubberColumns | null {
  for (const row of rows) {
    let rss3: string | null = null;
    let tsr20: string | null = null;
    for (const column of pinkSheetColumnLetters()) {
      const text = row.cellValue(column)?.trim();
      if (text === undefined) continue;
      if (text === "Rubber, RSS3" && rss3 === null) rss3 = column;
      else if (text.startsWith("Rubber, TSR20") && tsr20 === null) tsr20 = column;
    }
    if (rss3 !== null && tsr20 !== null) {
      return { periodColumn: "A", rss3Column: rss3, tsr20Column: tsr20 };
    }
  }
  return null;
}

function parseRubberCell(raw: string | undefined, label: string): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "…" || trimmed === "--" || trimmed === "##") return null;
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new SourceCollectionError("SCHEMA_DRIFT", `World Bank 橡胶数值非数字（${label}）`);
  }
  return Number(trimmed);
}

/** "2026M08" → { periodStart: 2026-08-01, observedAt: 2026-08-31 }（全部 UTC）。 */
export function monthPeriodFromLabel(label: string): { periodStart: string; observedAt: string } | null {
  const match = /^(\d{4})M(\d{2})$/.exec(label);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const monthEnd = new Date(Date.UTC(year, month, 0));
  return {
    periodStart: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    observedAt: monthEnd.toISOString(),
  };
}

function toObservationInputs(values: readonly MonthlyRubberValue[], fetchedAt: string): ObservationInput[] {
  const estimateStart = Math.max(0, values.length - 2);
  const inputs: ObservationInput[] = [];
  values.forEach((entry, index) => {
    if (Number.isFinite(entry.rss3)) {
      inputs.push(buildObservationInput(
        WORLD_BANK_RSS3_INDICATOR_ID, entry.rss3, entry, index >= estimateStart, fetchedAt,
      ));
    }
    if (Number.isFinite(entry.tsr20)) {
      inputs.push(buildObservationInput(
        WORLD_BANK_TSR20_INDICATOR_ID, entry.tsr20, entry, index >= estimateStart, fetchedAt,
      ));
    }
  });
  return inputs;
}

function buildObservationInput(
  indicatorId: string,
  value: number,
  entry: MonthlyRubberValue,
  estimated: boolean,
  fetchedAt: string,
): ObservationInput {
  return {
    indicatorId,
    observedAt: entry.observedAt,
    periodStart: entry.periodStart,
    value,
    unit: "USD/kg",
    publishedAt: null,
    fetchedAt,
    quality: estimated ? "estimated" : "verified",
    citationUrl: WORLD_BANK_SOURCE_URL,
    metadata: {
      series: indicatorId === WORLD_BANK_RSS3_INDICATOR_ID ? "RSS3" : "TSR20",
      period: entry.label,
      datasetVersion: "CMO-Historical-Data-Monthly",
    },
  };
}
