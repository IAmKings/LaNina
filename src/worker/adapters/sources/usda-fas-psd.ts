import type {
  CollectContext,
  CollectResult,
  ObservationInput,
  SourceAdapter,
} from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import { parseCanonicalUtc } from "../../ingestion/time";
import { errorForResponse, readBodyWithinLimit, sha256Hex } from "./http";

export const USDA_FAS_PSD_ADAPTER_KEY = "usda-fas-psd-v1";
export const USDA_FAS_PSD_SOURCE_URL = "https://api.fas.usda.gov/api/psd";
export const USDA_FAS_PSD_MAX_BYTES = 64 * 1024;

const UNIT_ID = 8;
const UNIT = "1000 MT";
const SELECTED_ATTRIBUTES = [28, 88, 176] as const;

interface UsdaPsdSourceConfig {
  readonly sourceId: string;
  readonly commodityCode: string;
  readonly countryCode: string;
  readonly marketYearStartMonth: number;
  readonly indicators: Readonly<Record<(typeof SELECTED_ATTRIBUTES)[number], string>>;
}

export const USDA_FAS_PSD_SOURCE_CONFIGS = [
  {
    sourceId: "usda_psd_malaysia_palm_oil",
    commodityCode: "4243000",
    countryCode: "MY",
    marketYearStartMonth: 10,
    indicators: {
      28: "usda_psd_malaysia_palm_oil_production_1000mt",
      88: "usda_psd_malaysia_palm_oil_exports_1000mt",
      176: "usda_psd_malaysia_palm_oil_ending_stocks_1000mt",
    },
  },
  {
    sourceId: "usda_psd_south_africa_corn",
    commodityCode: "0440000",
    countryCode: "SF",
    marketYearStartMonth: 5,
    indicators: {
      28: "usda_psd_south_africa_corn_production_1000mt",
      88: "usda_psd_south_africa_corn_exports_1000mt",
      176: "usda_psd_south_africa_corn_ending_stocks_1000mt",
    },
  },
] as const satisfies readonly UsdaPsdSourceConfig[];

const ATTRIBUTE_NAMES: Record<(typeof SELECTED_ATTRIBUTES)[number], string> = {
  28: "Production",
  88: "Exports",
  176: "Ending Stocks",
};

interface ParsedPsdRow {
  commodityCode: string;
  countryCode: string;
  marketYear: number;
  releaseYear: number;
  releaseMonth: number;
  attributeId: number;
  unitId: number;
  value: number;
}

/**
 * The API key is deliberately captured by this factory. It is never added to
 * CollectContext, a source URL, a result, or persisted metadata.
 */
export function createUsdaFasPsdAdapter(apiKey?: string): SourceAdapter {
  return {
    key: USDA_FAS_PSD_ADAPTER_KEY,

    async collect(context: CollectContext): Promise<CollectResult> {
      const config = sourceConfig(context.sourceId);
      if (config === undefined || context.sourceUrl !== USDA_FAS_PSD_SOURCE_URL) {
        throw new SourceCollectionError(
          "VALIDATION",
          "USDA FAS PSD 来源 ID 或地址不在允许列表",
        );
      }
      if (apiKey === undefined || apiKey.trim().length === 0) {
        throw new SourceCollectionError("AUTH", "USDA FAS PSD API 密钥未配置");
      }

      const marketYear = marketYearAt(context.scheduledAt, config.marketYearStartMonth);
      const requestUrl = buildRequestUrl(config, marketYear);
      const headers = new Headers({
        Accept: "application/json",
        "X-Api-Key": apiKey,
      });
      if (context.previousEtag !== null) headers.set("If-None-Match", context.previousEtag);
      if (context.previousLastModified !== null) {
        headers.set("If-Modified-Since", context.previousLastModified);
      }

      let response: Response;
      try {
        response = await context.fetch(requestUrl, { headers, redirect: "error" });
      } catch {
        throw new SourceCollectionError("NETWORK", "无法连接 USDA FAS PSD", {
          retryable: true,
        });
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
      const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase();
      if (mediaType !== "application/json") {
        throw schemaDrift("USDA FAS PSD 响应不再是 JSON");
      }

      const rawBody = await readBodyWithinLimit(response, USDA_FAS_PSD_MAX_BYTES);
      const decoded = decodeUtf8(rawBody);
      if (decoded.includes(apiKey)) {
        throw schemaDrift("USDA FAS PSD 响应包含不应回显的认证信息");
      }
      const contentHash = await sha256Hex(rawBody);
      if (contentHash === context.previousContentHash) {
        return unchangedResult(context, { etag, lastModified, contentType, contentHash });
      }

      const rows = parseRows(decoded, config, marketYear);
      const { observations, warnings } = observationsForRows(
        rows,
        config,
        marketYear,
        context.fetchedAt,
        requestUrl,
      );
      if (observations.length === 0) {
        throw new SourceCollectionError("VALIDATION", "USDA FAS PSD 缺少全部选定属性");
      }

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
        warnings,
        status: warnings.length === 0 ? "changed" : "partial",
      };
    },
  };
}

function sourceConfig(sourceId: string): UsdaPsdSourceConfig | undefined {
  return USDA_FAS_PSD_SOURCE_CONFIGS.find((candidate) => candidate.sourceId === sourceId);
}

function marketYearAt(scheduledAt: string, startMonth: number): number {
  const scheduled = parseCanonicalUtc(scheduledAt, "scheduledAt");
  const calendarYear = scheduled.getUTCFullYear();
  const calendarMonth = scheduled.getUTCMonth() + 1;
  return calendarMonth >= startMonth ? calendarYear : calendarYear - 1;
}

function buildRequestUrl(config: UsdaPsdSourceConfig, marketYear: number): string {
  return `${USDA_FAS_PSD_SOURCE_URL}/commodity/${config.commodityCode}/country/${config.countryCode}/year/${marketYear}`;
}

function parseRows(
  text: string,
  config: UsdaPsdSourceConfig,
  expectedMarketYear: number,
): ParsedPsdRow[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw schemaDrift("USDA FAS PSD 响应不是有效 JSON");
  }
  if (!Array.isArray(payload)) throw schemaDrift("USDA FAS PSD 根结构不再是数组");

  const rows = payload.map((value, index) =>
    parseRow(value, index, config, expectedMarketYear),
  );
  const attributeIds = new Set<number>();
  for (const row of rows) {
    if (attributeIds.has(row.attributeId)) {
      throw schemaDrift("USDA FAS PSD 响应包含重复属性");
    }
    attributeIds.add(row.attributeId);
  }
  const first = rows[0];
  if (
    first !== undefined &&
    rows.some(
      (row) =>
        row.releaseYear !== first.releaseYear || row.releaseMonth !== first.releaseMonth,
    )
  ) {
    throw schemaDrift("USDA FAS PSD 发布年月在同一响应中不一致");
  }
  return rows;
}

function parseRow(
  value: unknown,
  index: number,
  config: UsdaPsdSourceConfig,
  expectedMarketYear: number,
): ParsedPsdRow {
  const row = record(value, `USDA FAS PSD row ${index}`);
  const commodityCode = exactString(row.commodityCode, "commodityCode");
  const countryCode = exactString(row.countryCode, "countryCode");
  const marketYearText = exactString(row.marketYear, "marketYear");
  const calendarYearText = exactString(row.calendarYear, "calendarYear");
  const monthText = exactString(row.month, "month");
  const attributeId = integer(row.attributeId, "attributeId");
  const unitId = integer(row.unitId, "unitId");

  if (
    commodityCode !== config.commodityCode ||
    countryCode !== config.countryCode ||
    marketYearText !== String(expectedMarketYear)
  ) {
    throw schemaDrift("USDA FAS PSD 行身份与固定请求不一致");
  }
  if (!/^\d{4}$/.test(calendarYearText)) {
    throw schemaDrift("USDA FAS PSD calendarYear 格式变化");
  }
  if (!/^(0[1-9]|1[0-2])$/.test(monthText)) {
    throw schemaDrift("USDA FAS PSD month 格式变化");
  }

  const selectedAttribute = isSelectedAttribute(attributeId);
  if (selectedAttribute && unitId !== UNIT_ID) {
    throw schemaDrift("USDA FAS PSD 选定属性单位发生变化");
  }
  if (typeof row.value !== "number") {
    throw schemaDrift("USDA FAS PSD value 类型变化");
  }
  if (!Number.isFinite(row.value) || row.value < 0) {
    throw new SourceCollectionError("VALIDATION", "USDA FAS PSD value 不是有效非负数值");
  }

  return {
    commodityCode,
    countryCode,
    marketYear: expectedMarketYear,
    releaseYear: Number(calendarYearText),
    releaseMonth: Number(monthText),
    attributeId,
    unitId,
    value: row.value,
  };
}

function observationsForRows(
  rows: readonly ParsedPsdRow[],
  config: UsdaPsdSourceConfig,
  marketYear: number,
  fetchedAt: string,
  citationUrl: string,
): { observations: ObservationInput[]; warnings: string[] } {
  const selected = new Map(
    rows
      .filter((row): row is ParsedPsdRow & { attributeId: (typeof SELECTED_ATTRIBUTES)[number] } =>
        isSelectedAttribute(row.attributeId),
      )
      .map((row) => [row.attributeId, row]),
  );
  const period = marketYearPeriod(marketYear, config.marketYearStartMonth);
  const observations = SELECTED_ATTRIBUTES.flatMap((attributeId) => {
    const row = selected.get(attributeId);
    if (row === undefined) return [];
    return [{
      indicatorId: config.indicators[attributeId],
      observedAt: period.observedAt,
      periodStart: period.periodStart,
      value: row.value,
      unit: UNIT,
      publishedAt: null,
      fetchedAt,
      quality: "estimated" as const,
      citationUrl,
      metadata: {
        releaseYear: row.releaseYear,
        releaseMonth: row.releaseMonth,
        marketYear: row.marketYear,
        commodityCode: row.commodityCode,
        countryCode: row.countryCode,
        attributeId,
        attributeName: ATTRIBUTE_NAMES[attributeId],
        unitId: UNIT_ID,
      },
    }];
  });
  const warnings = SELECTED_ATTRIBUTES.flatMap((attributeId) =>
    selected.has(attributeId) ? [] : [`MISSING_ATTRIBUTE:${attributeId}`],
  );
  return { observations, warnings };
}

function marketYearPeriod(
  marketYear: number,
  startMonth: number,
): { periodStart: string; observedAt: string } {
  const periodStart = new Date(Date.UTC(marketYear, startMonth - 1, 1));
  const periodEnd = new Date(Date.UTC(marketYear + 1, startMonth - 1, 0));
  return { periodStart: periodStart.toISOString(), observedAt: periodEnd.toISOString() };
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw schemaDrift("USDA FAS PSD 响应不是有效 UTF-8");
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw schemaDrift(`${field} 结构变化`);
  }
  return value as Record<string, unknown>;
}

function exactString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw schemaDrift(`USDA FAS PSD ${field} 类型或格式变化`);
  }
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw schemaDrift(`USDA FAS PSD ${field} 类型变化`);
  }
  return value;
}

function isSelectedAttribute(
  attributeId: number,
): attributeId is (typeof SELECTED_ATTRIBUTES)[number] {
  return SELECTED_ATTRIBUTES.some((selected) => selected === attributeId);
}

function schemaDrift(message: string): SourceCollectionError {
  return new SourceCollectionError("SCHEMA_DRIFT", message);
}

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
