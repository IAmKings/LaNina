import type {
  CollectContext,
  CollectResult,
  ObservationInput,
  SourceAdapter,
} from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import { errorForResponse, readBodyWithinLimit, sha256Hex } from "./http";

export const USA_CENSUS_SOURCE_ID = "usa_census_intltrade_route_proxy";
export const USA_CENSUS_ADAPTER_KEY = "usa-census-intltrade-v1";
export const USA_CENSUS_SOURCE_URL =
  "https://api.census.gov/data/timeseries/intltrade/imports/porths";
export const USA_CENSUS_INDICATOR_ID = "usa_imports_east_coast_monthly";

/** 有界查询契约（2026-09-21 live 冻结）：六家 US East Coast 海关港口，月度集装箱船运输重量。
 * 每个 collect 发出 6 港 × 6 月 = 最多 36 个 GET（cadence 1440 分/日，远低于 api.data.gov 限时）。
 */
export const USA_CENSUS_PORT_CODES: readonly { code: string; name: string }[] = [
  { code: "1001", name: "NEW YORK, NY" },
  { code: "1101", name: "PHILADELPHIA, PA" },
  { code: "1303", name: "BALTIMORE, MD" },
  { code: "1401", name: "NORFOLK-NEWPORT NEWS, VA" },
  { code: "1601", name: "CHARLESTON, SC" },
  { code: "1703", name: "SAVANNAH, GA" },
] as const;

const UNIT = "lb"; // Census Shipping Weight 原生单位（磅），不做换算
const MONTHLY_WINDOW = 6;
const RELEASE_LAG_WARNING = "CENSUS_MONTHLY_RELEASE_LAG";

export function createUsaCensusIntlTradeAdapter(apiKey?: string): SourceAdapter {
  return {
    key: USA_CENSUS_ADAPTER_KEY,
    async collect(context: CollectContext): Promise<CollectResult> {
    if (context.sourceUrl !== USA_CENSUS_SOURCE_URL) {
      throw new SourceCollectionError("VALIDATION", "Census 来源地址不在允许列表");
    }
    // key 注入与 EIA/USDA 一致：factory closure 捕获，URL 内存在的时间即失效。
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new SourceCollectionError("AUTH", "缺少 Census API key，已按设计 fail-closed");
    }

    const months = recentMonths(context.scheduledAt, MONTHLY_WINDOW);
    if (months.length === 0) {
      throw new SourceCollectionError("SCHEMA_DRIFT", "Census 月窗口不可解析");
    }

    const observations: ObservationInput[] = [];
    for (const month of months) {
      const row = await fetchMonthlySumRow(context, apiKey as string, month);
      if (row === null) continue; // 该月尚未发布（Census 滞后 4-6 周，行为：
      observations.push(toObservationInput(row, month, context.fetchedAt));
    }
    if (observations.length === 0) {
      throw new SourceCollectionError("VALIDATION", "Census 窗口内没有任何已发布月度");
    }

    return {
      sourceId: context.sourceId,
      fetchedAt: context.fetchedAt,
      sourcePublishedAt: null,
      etag: null,
      lastModified: null,
      contentType: "application/json",
      contentHash: await sha256Hex(new TextEncoder().encode(
        observations.map((o) => `${o.observedAt}:${o.value}`).join("|"),
      )),
      rawBody: null,
      observations,
      warnings: [
        "SOURCE_PUBLISHED_AT_UNKNOWN",
        RELEASE_LAG_WARNING,
      ],
      status: "changed",
    };
    },
  };
};

/** 求一个月= 6 港口 weight 合计。仅返回已发布月份（空行集合视为月未发布）。 */
export function recentMonths(scheduledAt: string, count: number): readonly string[] {
  const when = parseUtc(scheduledAt);
  if (when === null) throw new SourceCollectionError("SCHEMA_DRIFT", "scheduledAt 不是可解析 UTC 时间");
  const base = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1));
  const out: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const monthDate = new Date(base);
    monthDate.setUTCMonth(base.getUTCMonth() - i);
    out.push(`${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** 月度单值：6 港 CNT_WGT_MO 合计（阻塞契约到有界查询契约）。 */
async function fetchMonthlySumRow(
  context: CollectContext,
  apiKey: string,
  month: string,
): Promise<{ sum: number; portsCovered: number } | null> {
  const urlTemplate = new URL(context.sourceUrl);
  let sum = 0;
  let portsCovered = 0;
  for (const port of USA_CENSUS_PORT_CODES) {
    const url = new URL(urlTemplate);
    url.searchParams.set("get", "CNT_WGT_MO");
    url.searchParams.set("time", month);
    url.searchParams.set("PORT", port.code);
    url.searchParams.set("key", apiKey);
    let response: Response;
    try {
      response = await context.fetch(url, { headers: new Headers({ Accept: "application/json" }) });
    } catch {
      throw new SourceCollectionError("NETWORK", "无法连接 Census API", { retryable: true });
    }
    if (!response.ok) {
      throw errorForResponse(response);
    }
    const cells = extractWeightCells(
      new TextDecoder().decode(await readBodyWithinLimit(response, 256_000)),
    );
    portsCovered += 1;
    sum += cells.reduce((acc, value) => acc + value, 0);
  }
  if (portsCovered !== USA_CENSUS_PORT_CODES.length) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "Census 港口行数不足");
  }
  if (sum === 0) return null; // 月度尚未发布或该整月无已发布值
  return { sum, portsCovered };
}

/** Census 返回 2D 数组；首行为表头，其余行为数据行。 */
export function extractWeightCells(text: string): readonly number[] {
  if (text.length === 0) throw new SourceCollectionError("VALIDATION", "Census 响应为空");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SourceCollectionError("SCHEMA_DRIFT", "Census 返回不是有效 JSON");
  }
  if (!Array.isArray(parsed) || parsed.length < 2) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "Census 数据行缺失");
  }
  const header = parsed[0];
  if (!Array.isArray(header)) throw new SourceCollectionError("SCHEMA_DRIFT", "Census 表头不是数组");
  const weightIndex = header.indexOf("CNT_WGT_MO");
  if (weightIndex < 0) throw new SourceCollectionError("SCHEMA_DRIFT", "Census 表头缺少 CNT_WGT_MO");
  const cells: number[] = [];
  for (const row of parsed.slice(1)) {
    if (!Array.isArray(row) || typeof row[weightIndex] !== "string" || row[weightIndex] === "") {
      throw new SourceCollectionError("SCHEMA_DRIFT", "Census 重量行格式漂移");
    }
    const cell = Number(row[weightIndex]);
    if (!Number.isFinite(cell) || cell < 0) {
      throw new SourceCollectionError("SCHEMA_DRIFT", "Census 重量数值被破坏");
    }
    cells.push(cell);
  }
  return cells;
}

function parseUtc(value: string): Date | null {
  const year = /^(\d{4})-(\d{2})$/.exec(value) || null;
  if (year !== null) {
    return new Date(Date.UTC(Number(year[1]), Number(year[2]) - 1, 1));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function toObservationInput(
  row: { sum: number; portsCovered: number },
  month: string,
  fetchedAt: string,
): ObservationInput {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const monthEnd = new Date(Date.UTC(year, monthIndex, 0));
  return {
    indicatorId: USA_CENSUS_INDICATOR_ID,
    observedAt: monthEnd.toISOString(),
    periodStart: new Date(Date.UTC(year, monthIndex - 1, 1)).toISOString(),
    value: row.sum,
    unit: UNIT,
    publishedAt: null,
    fetchedAt,
    quality: "provisional",
    citationUrl: "https://www.census.gov/foreign-trade/data/index.html",
    metadata: {
      portsCovered: row.portsCovered,
      weightUnitDeclaredBySource: "shipping weight (lbs)",
      dataset: "intltrade/imports/porths",
    },
  };
}
