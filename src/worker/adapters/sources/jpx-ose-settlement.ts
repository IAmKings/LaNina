import type {
  CollectContext,
  CollectResult,
  ObservationInput,
  SourceAdapter,
} from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import { errorForResponse, readBodyWithinLimit, sha256Hex } from "./http";

export const JPX_OSE_SOURCE_ID = "jpx_ose_rubber_settlement";
export const JPX_OSE_ADAPTER_KEY = "jpx-ose-settlement-v1";
export const JPX_OSE_SOURCE_URL =
  "https://www.jpx.co.jp/english/markets/derivatives/settlement-price/";
export const JPX_OSE_RSS3_INDICATOR_ID = "jpx_ose_rss3_settlement_daily";
export const JPX_OSE_TSR20_INDICATOR_ID = "jpx_ose_tsr20_settlement_daily";

/**
 * 实测（2026-09-18，开发者时间探查）：JPX 把全部衍生品结算价放进一个 CSV，
 * 3,730,649 字节 / 41,996 行。Spike §5 的"compact"结论按整单口径不准确；R2 的每日
 * 快照预算（≤100 MB/天）覆盖该量级，因此本适配器的读取上限放宽为 4 MiB 并在此注明，
 * 其余适配器仍保持 1 MiB。
 */
const MAX_RESPONSE_BYTES = 4_000_000;
const SETTLEMENT_PAGE_MAX_BYTES = 256_000;
/** v1 就近合约选择规则：只输出当日**最近到期**的合约月（不拼接连续序列）。 */
const NEARBY_SELECTION_WARNING = "NEARBY_SELECTION_V1_NEXT_EXPIRY";
const JSCC_REVISION_WARNING = "JPX_SETTLEMENT_MAY_BE_REVISED_BY_JSCC";

interface RubberSettlementRow {
  readonly issueName: string;
  readonly contractMonth: string;
  readonly settlement: number;
}

export const jpxOseSettlementAdapter: SourceAdapter = {
  key: JPX_OSE_ADAPTER_KEY,

  async collect(context: CollectContext): Promise<CollectResult> {
    if (context.sourceUrl !== JPX_OSE_SOURCE_URL) {
      throw new SourceCollectionError("VALIDATION", "JPX 结算页地址不在允许列表");
    }

    const pageHeaders = new Headers({ Accept: "text/html" });
    let page: Response;
    try {
      page = await context.fetch(context.sourceUrl, { headers: pageHeaders, redirect: "follow" });
    } catch {
      throw new SourceCollectionError("NETWORK", "无法连接 JPX 结算页", { retryable: true });
    }
    if (!page.ok) throw errorForResponse(page);
    const pageBody = await readBodyWithinLimit(page, SETTLEMENT_PAGE_MAX_BYTES);

    const csvHref = extractRubberCsvHref(new TextDecoder().decode(pageBody));
    const csvUrl = new URL(csvHref, context.sourceUrl).toString();

    const csvHeaders = new Headers({ Accept: "text/csv, text/plain" });
    if (context.previousContentHash !== null) {
      csvHeaders.set("If-None-Match", `"${context.previousContentHash}"`);
    }
    let csv: Response;
    try {
      csv = await context.fetch(csvUrl, { headers: csvHeaders, redirect: "follow" });
    } catch {
      throw new SourceCollectionError("NETWORK", "无法连接 JPX 结算 CSV", { retryable: true });
    }
    const lastModified = csv.headers.get("last-modified");
    const contentType = csv.headers.get("content-type");
    if (!csv.ok) throw errorForResponse(csv);

    const rawBody = await readBodyWithinLimit(csv, MAX_RESPONSE_BYTES);
    const contentHash = await sha256Hex(rawBody);

    const tradeDate = tradeDateFromCsvHref(csvHref);
    if (tradeDate === null) {
      throw new SourceCollectionError("SCHEMA_DRIFT", `JPX 结算 CSV 文件名不带业务日：${csvHref}`);
    }
    const rows = parseRubberSettlementRows(new TextDecoder().decode(rawBody));

    const rss3 = selectNearbyContract(
      rows.filter((row) => isRowKind(row, "RSS3")), tradeDate,
    );
    const tsr20 = selectNearbyContract(
      rows.filter((row) => isRowKind(row, "TSR20")), tradeDate,
    );

    const observations: ObservationInput[] = [];
    if (rss3 !== null) observations.push(toObservationInput(JPX_OSE_RSS3_INDICATOR_ID, rss3, tradeDate, context.fetchedAt));
    if (tsr20 !== null) observations.push(toObservationInput(JPX_OSE_TSR20_INDICATOR_ID, tsr20, tradeDate, context.fetchedAt));
    if (observations.length === 0) {
      throw new SourceCollectionError("SCHEMA_DRIFT", "JPX 结算 CSV 未找到 RSS3/TSR20 橡胶行");
    }

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
        NEARBY_SELECTION_WARNING,
        JSCC_REVISION_WARNING,
      ],
      status: "changed",
    };
  },
};

/** 从 settlement 页 HTML 提取英文橡胶结算 CSV 的站内路径。 */
export function extractRubberCsvHref(pageHtml: string): string {
  const pattern = /href="([^"]*settlement-price\/[^"]*rb_e\d{8}\.csv[^"]*)"/g;
  for (const match of pageHtml.matchAll(pattern)) {
    const href = match[1];
    if (href !== undefined) return href;
  }
  throw new SourceCollectionError("SCHEMA_DRIFT", "JPX settlement 页未找到橡胶结算 CSV 链接");
}

/** `…/rb_e20260918.csv` → "2026-09-18"。 */
export function tradeDateFromCsvHref(href: string): string | null {
  const match = /rb_e(\d{8})\.csv/.exec(href);
  const stamp = match?.[1];
  if (stamp === undefined) return null;
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return `${iso}T00:00:00.000Z`;
}

export function parseRubberSettlementRows(csvText: string): readonly RubberSettlementRow[] {
  const lines = csvText.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith("Issue Code,Issue Name"));
  if (headerIndex < 0) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "JPX 结算 CSV 缺少 Issue Code 表头");
  }
  const rows: RubberSettlementRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.trim() === "") continue;
    const fields = line.split(",");
    const issueName = fields[1] ?? "";
    const contractMonth = fields[3] ?? "";
    const settlementRaw = fields[5] ?? "";
    if (!/^FUT_(RSS3|TSR2)_/.test(issueName)) continue;
    if (!/^\d{6}$/.test(contractMonth)) continue;
    if (!/^\d+(?:\.\d+)?$/.test(settlementRaw)) continue;
    rows.push({ issueName, contractMonth, settlement: Number(settlementRaw) });
  }
  if (rows.length === 0) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "JPX 结算 CSV 没有 RSS3/TSR20 行");
  }
  return rows;
}

function isRowKind(row: RubberSettlementRow, kind: "RSS3" | "TSR20"): boolean {
  return row.issueName.startsWith(`FUT_${kind === "RSS3" ? "RSS3" : "TSR2"}_`);
}

/** 就近合约 = 合约月末（YYYYMM 的最后一天）在业务日当天或之后的最近一个。 */
export function selectNearbyContract(
  rows: readonly RubberSettlementRow[],
  tradeDate: string,
): RubberSettlementRow | null {
  const tradeTime = Date.parse(tradeDate);
  if (!Number.isFinite(tradeTime)) return null;
  let best: RubberSettlementRow | null = null;
  let bestTime = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const monthEnd = contractMonthEnd(row.contractMonth);
    if (monthEnd < tradeTime) continue;
    if (monthEnd < bestTime) {
      bestTime = monthEnd;
      best = row;
    }
  }
  if (best !== null) return best;
  // 月末先于业务日（结算日跨越换月）时，退而取最晚到期的合约月，保持当日有值可审计。
  for (const row of rows) {
    const monthEnd = contractMonthEnd(row.contractMonth);
    if (best === null || monthEnd > contractMonthEnd(best.contractMonth)) best = row;
  }
  return best;
}

function contractMonthEnd(contractMonth: string): number {
  const year = Number(contractMonth.slice(0, 4));
  const month = Number(contractMonth.slice(4, 6));
  return Date.UTC(year, month, 0);
}

function toObservationInput(
  indicatorId: string,
  row: RubberSettlementRow,
  tradeDate: string,
  fetchedAt: string,
): ObservationInput {
  return {
    indicatorId,
    observedAt: `${tradeDate.slice(0, 10)}T00:00:00.000Z`,
    periodStart: null,
    value: row.settlement,
    unit: "JPY/kg",
    publishedAt: null,
    fetchedAt,
    quality: "provisional",
    citationUrl: JPX_OSE_SOURCE_URL,
    metadata: {
      issueCode: row.issueName,
      issueName: row.issueName,
      contractMonth: row.contractMonth,
      nearbySelection: "next-expiring-contract-month",
    },
  };
}
