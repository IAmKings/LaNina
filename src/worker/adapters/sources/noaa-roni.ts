import type {
  CollectContext,
  CollectResult,
  ObservationInput,
  SourceAdapter,
} from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import { errorForResponse, readBodyWithinLimit, sha256Hex } from "./http";

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

export const noaaRoniAdapter: SourceAdapter = {
  key: NOAA_RONI_ADAPTER_KEY,

  async collect(context: CollectContext): Promise<CollectResult> {
    if (context.sourceUrl !== NOAA_RONI_URL) {
      throw new SourceCollectionError("VALIDATION", "NOAA RONI 来源地址不在允许列表");
    }

    const headers = new Headers({ Accept: "text/html" });
    if (context.previousEtag !== null) headers.set("If-None-Match", context.previousEtag);
    if (context.previousLastModified !== null) {
      headers.set("If-Modified-Since", context.previousLastModified);
    }

    let response: Response;
    try {
      response = await context.fetch(context.sourceUrl, { headers, redirect: "follow" });
    } catch {
      throw new SourceCollectionError("NETWORK", "无法连接 NOAA CPC", { retryable: true });
    }

    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    const contentType = response.headers.get("content-type");

    if (response.status === 304) {
      return unchangedResult(context, {
        etag: etag ?? context.previousEtag,
        lastModified: lastModified ?? context.previousLastModified,
        contentType,
        contentHash: context.previousContentHash,
      });
    }
    if (!response.ok) throw errorForResponse(response);
    if (contentType === null || !contentType.toLowerCase().includes("text/html")) {
      throw new SourceCollectionError("SCHEMA_DRIFT", "NOAA RONI 响应不再是 HTML");
    }

    const rawBody = await readBodyWithinLimit(response, MAX_RESPONSE_BYTES);
    const contentHash = await sha256Hex(rawBody);
    if (contentHash === context.previousContentHash) {
      return unchangedResult(context, { etag, lastModified, contentType, contentHash });
    }

    const html = new TextDecoder().decode(rawBody);
    const parsed = parseRoniHtml(html);
    const recent = parsed.slice(-NOAA_RONI_AUTOMATED_WINDOW);
    const observations = toObservationInputs(recent, context.fetchedAt);

    return {
      sourceId: context.sourceId,
      fetchedAt: context.fetchedAt,
      sourcePublishedAt: null,
      etag,
      lastModified,
      contentType,
      contentHash,
      rawBody,
      observations,
      warnings: [
        "SOURCE_PUBLISHED_AT_UNKNOWN",
        ...(parsed.length > recent.length ? ["AUTOMATED_WINDOW_TRUNCATED"] : []),
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
  for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(
      rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi),
      (match) => textContent(match[1]),
    );
    if (cells.length === 0 || !/^\d{4}$/.test(cells[0])) continue;
    if (cells.length > SEASONS.length + 1) {
      throw new SourceCollectionError("SCHEMA_DRIFT", "NOAA RONI 数据列数量异常");
    }

    const year = Number(cells[0]);
    for (let index = 1; index < cells.length; index += 1) {
      const rawValue = cells[index];
      if (rawValue === "" || rawValue === "--") continue;
      if (!/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
        throw new SourceCollectionError("SCHEMA_DRIFT", "NOAA RONI 数据包含非数值单元格");
      }

      const season = SEASONS[index - 1];
      const period = seasonPeriod(year, index - 1);
      values.push({ year, season, value: Number(rawValue), ...period });
    }
  }

  if (values.length === 0) throw new SourceCollectionError("SCHEMA_DRIFT", "NOAA RONI 数据表没有观测值");
  return values;
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
