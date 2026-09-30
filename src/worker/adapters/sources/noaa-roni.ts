import type { ObservationInput, SourceAdapter } from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import { createHttpSourceAdapter } from "./adapter-base";

export const NOAA_RONI_URL = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/";
export const NOAA_RONI_SOURCE_ID = "noaa_cpc_roni";
export const NOAA_RONI_ADAPTER_KEY = "noaa-cpc-roni-v6";
export const NOAA_RONI_INDICATOR_ID = "enso_roni_ersstv6";
export const NOAA_RONI_AUTOMATED_WINDOW = 24;

const MAX_RESPONSE_BYTES = 1_000_000;
const SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"] as const;

interface ParsedRoniValue {
  year: number;
  season: (typeof SEASONS)[number];
  value: number;
  periodStart: string;
  observedAt: string;
}

export const noaaRoniAdapter: SourceAdapter = createHttpSourceAdapter({
  key: NOAA_RONI_ADAPTER_KEY,
  sourceKey: "NOAA CPC",
  maxBytes: MAX_RESPONSE_BYTES,
  accept: "text/html",
  redirect: "follow",
  mediaType: { kind: "includes", value: "text/html", driftMessage: "NOAA RONI 响应不再是 HTML" },
  body: { kind: "utf8", driftMessage: "NOAA RONI 响应不是有效 UTF-8" },
  networkError: () => new SourceCollectionError("NETWORK", "无法连接 NOAA CPC", { retryable: true }),
  prepare(context) {
    if (context.sourceUrl !== NOAA_RONI_URL) {
      throw new SourceCollectionError("VALIDATION", "NOAA RONI 来源地址不在允许列表");
    }
    // 缓存旁路：允许列表仍校验规范来源 URL，但实际抓取追加时间戳参数——
    // 2026-09 实测子请求路径会命中中间层缓存，拿到滞后数月的页面副本
    //（数据库因此入库了止于 NDJ 2025 的陈旧序列）。CPC 服务器忽略未知查询参数。
    return { url: `${context.sourceUrl}?refresh=${Date.parse(context.fetchedAt)}` };
  },
  parse(html, context) {
    const parsed = parseRoniHtml(html);
    const recent = parsed.slice(-NOAA_RONI_AUTOMATED_WINDOW);
    return {
      observations: toObservationInputs(recent, context.fetchedAt),
      warnings: [
        "SOURCE_PUBLISHED_AT_UNKNOWN",
        ...(parsed.length > recent.length ? ["AUTOMATED_WINDOW_TRUNCATED"] : []),
        ...contentStaleWarnings(parsed, context.fetchedAt),
      ],
    };
  },
});

export function parseRoniHtml(html: string): ParsedRoniValue[] {
  const tableOpen = /<table\b[^>]*\bid=["']roni-v5-table2["'][^>]*>/i.exec(html);
  if (tableOpen === null || tableOpen.index === undefined) {
    throw new SourceCollectionError("SCHEMA_DRIFT", "未找到 NOAA RONI 数据表");
  }

  const tableStart = tableOpen.index + tableOpen[0].length;
  const tableEnd = html.toLowerCase().indexOf("</table>", tableStart);
  if (tableEnd < 0) throw new SourceCollectionError("SCHEMA_DRIFT", "NOAA RONI 数据表未闭合");

  const table = html.slice(tableStart, tableEnd);
  for (const season of SEASONS) {
    if (!new RegExp(`<abbr[^>]*>\\s*${season}\\b`, "i").test(table)) {
      throw new SourceCollectionError("SCHEMA_DRIFT", `NOAA RONI 数据表缺少 ${season} 列`);
    }
  }

  const values: ParsedRoniValue[] = [];
  // 行切分按 <tr> 开标签边界进行，而不是要求 <tr>…</tr> 完整配对——CPC 实时页面的
  // 最新一年行（id="latest-data"）缺少闭合 </tr>（2026-09 实测），按配对匹配会
  // 静默丢弃最新一整年数据且无 SCHEMA_DRIFT。单元格提取对两种形态一致。
  const rowOpens = [...table.matchAll(/<tr\b[^>]*>/gi)];
  for (let index = 0; index < rowOpens.length; index += 1) {
    const bodyStart = rowOpens[index].index + rowOpens[index][0].length;
    const bodyEnd = index + 1 < rowOpens.length ? rowOpens[index + 1].index : table.length;
    const rowBody = table.slice(bodyStart, bodyEnd);
    const cells = Array.from(
      rowBody.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi),
      (match) => textContent(match[1]),
    );
    if (cells.length === 0 || !/^\d{4}$/.test(cells[0])) continue;
    if (cells.length > SEASONS.length + 1) {
      throw new SourceCollectionError("SCHEMA_DRIFT", "NOAA RONI 数据列数量异常");
    }

    const year = Number(cells[0]);
    for (let cellIndex = 1; cellIndex < cells.length; cellIndex += 1) {
      const rawValue = cells[cellIndex];
      if (rawValue === "" || rawValue === "--") continue;
      if (!/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
        throw new SourceCollectionError("SCHEMA_DRIFT", "NOAA RONI 数据包含非数值单元格");
      }

      const season = SEASONS[cellIndex - 1];
      const period = seasonPeriod(year, cellIndex - 1);
      values.push({ year, season, value: Number(rawValue), ...period });
    }
  }

  if (values.length === 0) throw new SourceCollectionError("SCHEMA_DRIFT", "NOAA RONI 数据表没有观测值");
  return values;
}

/**
 * 陈旧内容告警：RONI 为月度序列，若解析出的最新季节期末日落后于采集时间超过
 * RONI_STALE_LAG_DAYS，说明上游页面未按「每月 5 日前更新」的承诺刷新（2026-09 实测：
 * 页面冻结在 NDJ 2025 达 7 个月）。告警让数据健康面可见，而不是静默 success。
 */
export const RONI_STALE_LAG_DAYS = 120;

function contentStaleWarnings(
  parsed: readonly ParsedRoniValue[],
  fetchedAt: string,
): readonly string[] {
  const latest = parsed.reduce<string | null>(
    (latest, entry) => (latest === null || entry.observedAt > latest ? entry.observedAt : latest),
    null,
  );
  if (latest === null) return [];
  const lagDays = Math.round((Date.parse(fetchedAt) - Date.parse(latest)) / 86_400_000);
  if (!Number.isFinite(lagDays) || lagDays <= RONI_STALE_LAG_DAYS) return [];
  return [`SOURCE_CONTENT_STALE:${Math.round(lagDays)}d`];
}

function textContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&minus;|&#8722;/gi, "-")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function seasonPeriod(year: number, seasonIndex: number): { periodStart: string; observedAt: string } {
  const startMonth = seasonIndex - 1;
  const startYear = startMonth < 0 ? year - 1 : year;
  const normalizedStartMonth = startMonth < 0 ? 11 : startMonth;
  const endMonth = (seasonIndex + 1) % 12;
  const endYear = seasonIndex === 11 ? year + 1 : year;
  const endDay = new Date(Date.UTC(endYear, endMonth + 1, 0)).getUTCDate();

  return {
    periodStart: new Date(Date.UTC(startYear, normalizedStartMonth, 1)).toISOString(),
    observedAt: new Date(Date.UTC(endYear, endMonth, endDay)).toISOString(),
  };
}

function toObservationInputs(values: ParsedRoniValue[], fetchedAt: string): ObservationInput[] {
  const estimateStart = Math.max(0, values.length - 2);
  return values.map((entry, index) => ({
    indicatorId: NOAA_RONI_INDICATOR_ID,
    observedAt: entry.observedAt,
    periodStart: entry.periodStart,
    value: entry.value,
    unit: "°C",
    publishedAt: null,
    fetchedAt,
    quality: index >= estimateStart ? "estimated" : "verified",
    citationUrl: NOAA_RONI_URL,
    metadata: {
      season: entry.season,
      year: entry.year,
      datasetVersion: "ERSSTv6",
    },
  }));
}
