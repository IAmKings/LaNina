import type {
  CollectContext,
  ObservationInput,
  SourceAdapter,
} from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import { parseCanonicalUtc } from "../../ingestion/time";
import { createHttpSourceAdapter } from "./adapter-base";

export const EIA_EUROPE_BRENT_SOURCE_ID = "eia_europe_brent_spot";
export const EIA_EUROPE_BRENT_ADAPTER_KEY = "eia-petroleum-spot-v1";
export const EIA_EUROPE_BRENT_SOURCE_URL =
  "https://api.eia.gov/v2/petroleum/pri/spt/data/";
export const EIA_EUROPE_BRENT_INDICATOR_ID =
  "eia_europe_brent_spot_usd_per_bbl_daily";
export const EIA_EUROPE_BRENT_MAX_BYTES = 64 * 1024;
/** 54 天窗口最多约 41 个交易日（含假期余量取 62），响应行数仍受固定上限拒绝保护。 */
export const EIA_EUROPE_BRENT_MAX_ROWS = 62;
export const EIA_EUROPE_BRENT_WINDOW_DAYS = 54;
/** 末行新鲜度断言：最后一行必须落在窗口结束前 7 天内，否则视为上游静默截断。 */
export const EIA_EUROPE_BRENT_STALE_TAIL_DAYS = 7;

const WIRE_UNIT = "$/BBL";
const NORMALIZED_UNIT = "USD/bbl";
const SERIES = "RBRTE";
const PRODUCT = "EPCBRENT";
const PROCESS = "PF4";
const EXPECTED_ROW_KEYS = [
  "period",
  "duoarea",
  "area-name",
  "product",
  "product-name",
  "process",
  "process-name",
  "series",
  "series-description",
  "value",
  "units",
] as const;

interface ParsedBrentRow {
  period: string;
  value: number;
}

/**
 * EIA documents API keys as query parameters. The secret is captured by this
 * factory and exists in the request URL only for the duration of fetch.
 */
export function createEiaEuropeBrentSpotAdapter(apiKey?: string): SourceAdapter {
  return createHttpSourceAdapter({
    key: EIA_EUROPE_BRENT_ADAPTER_KEY,
    sourceKey: "EIA",
    maxBytes: EIA_EUROPE_BRENT_MAX_BYTES,
    accept: "application/json",
    redirect: "manual",
    mediaType: { kind: "equals", value: "application/json", driftMessage: "EIA 响应不再是 JSON" },
    body: { kind: "utf8", driftMessage: "EIA 响应不是有效 UTF-8" },
    secret: { value: apiKey ?? "", driftMessage: "EIA 响应包含不应回显的认证信息" },
    prepare(context) {
      return { url: resolveEiaRequestUrl(apiKey, context) };
    },
    parse(decoded, context) {
      const rows = parsePayload(decoded, requestWindow(context.scheduledAt));
      return { observations: rows.map((row) => observation(row, context.fetchedAt)) };
    },
  });
}

/** 允许列表与密钥校验保持在 fetch 之前；固定窗口请求 URL 在此统一推导。 */
function resolveEiaRequestUrl(apiKey: string | undefined, context: CollectContext): URL {
  if (
    context.sourceId !== EIA_EUROPE_BRENT_SOURCE_ID ||
    context.sourceUrl !== EIA_EUROPE_BRENT_SOURCE_URL
  ) {
    throw new SourceCollectionError("VALIDATION", "EIA Brent 来源 ID 或地址不在允许列表");
  }
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new SourceCollectionError("AUTH", "EIA API 密钥未配置");
  }
  return buildRequestUrl(apiKey, requestWindow(context.scheduledAt));
}

function requestWindow(scheduledAt: string): { start: string; end: string } {
  const end = parseCanonicalUtc(scheduledAt, "scheduledAt");
  const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - EIA_EUROPE_BRENT_WINDOW_DAYS);
  return { start: isoDate(startDate), end: isoDate(endDate) };
}

export function buildRequestUrl(
  apiKey: string,
  window: { start: string; end: string },
): URL {
  const url = new URL(EIA_EUROPE_BRENT_SOURCE_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("frequency", "daily");
  url.searchParams.set("data[0]", "value");
  url.searchParams.set("facets[series][]", SERIES);
  url.searchParams.set("start", window.start);
  url.searchParams.set("end", window.end);
  url.searchParams.set("sort[0][column]", "period");
  url.searchParams.set("sort[0][direction]", "asc");
  url.searchParams.set("offset", "0");
  url.searchParams.set("length", String(EIA_EUROPE_BRENT_MAX_ROWS));
  return url;
}

function parsePayload(
  text: string,
  window: { start: string; end: string },
): ParsedBrentRow[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw schemaDrift("EIA 响应不是有效 JSON");
  }

  // 2026-09-20 实测：v2 信封还会带 `warnings`（可为 null）与 `ExcelAddInVersion`，
  // 之前的严格键集合比较使首采失败；显式纳入并保持 warnings=null 语义不变。
  // root 键集合并非恒定：`warnings`（null 或 ["incomplete return"]）与 `ExcelAddInVersion`
  // 时有时无。因此先取必需键（response/request/apiVersion），多余的键必须是白名单成员。
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw schemaDrift("EIA 根结构 结构变化");
  }
  const root = payload as Record<string, unknown>;
  for (const required of ["response", "request", "apiVersion"]) {
    if (!(required in root)) throw schemaDrift(`EIA 根结构 缺少 ${required}`);
  }
  for (const key of Object.keys(root)) {
    if (key !== "response" && key !== "request" && key !== "apiVersion"
      && key !== "warnings" && key !== "ExcelAddInVersion") {
      throw schemaDrift("EIA 根结构 字段集合变化或包含警告/截断信息");
    }
  }
  nonBlankString(root.apiVersion, "apiVersion");
  const request = exactRecordOptional(root.request, "EIA request", ["command"], ["params"]);
  if (exactString(request.command, "request.command") !== "/v2/petroleum/pri/spt/data/") {
    throw schemaDrift("EIA request command 与固定接口不一致");
  }

  const response = exactRecord(root.response, "EIA response", [
    "total",
    "dateFormat",
    "frequency",
    "data",
  ]);
  if (response.dateFormat !== "YYYY-MM-DD" || response.frequency !== "daily") {
    throw schemaDrift("EIA 时间频率或日期格式发生变化");
  }
  const totalText = exactString(response.total, "response.total");
  if (!/^(?:0|[1-9]\d*)$/.test(totalText)) {
    throw schemaDrift("EIA total 类型或格式发生变化");
  }
  const total = Number(totalText);
  // 2026-09-20 实测：EIA 的 `total` 是全库行数（本例 9978），不是本次窗口的行数；
  // 窗口大小由请求里的 start/end/length 控制（每日 ≤54 天），二者本就不同。
  if (total < 0) throw schemaDrift("EIA total 类型或格式发生变化");
  if (!Array.isArray(response.data)) throw schemaDrift("EIA data 不再是数组");
  if (response.data.length === 0) {
    throw new SourceCollectionError("VALIDATION", "EIA 固定窗口没有可用观测");
  }
  if (response.data.length > EIA_EUROPE_BRENT_MAX_ROWS) {
    throw new SourceCollectionError("VALIDATION", "EIA 响应超过固定行数上限");
  }

  const rows = response.data.map((value, index) => parseRow(value, index, window));
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].period === rows[index - 1].period) {
      throw new SourceCollectionError("VALIDATION", "EIA 响应包含重复观测日");
    }
    if (rows[index].period < rows[index - 1].period) {
      throw new SourceCollectionError("VALIDATION", "EIA 响应未按观测日升序排列");
    }
  }
  assertFreshTail(rows, window);
  return rows;
}

/**
 * 上游把请求窗口静默截断（如分页边界、历史重放）时，行数检查发现不了——这里断言
 * 最后一行必须贴近窗口末端，防止「最新行情丢失但运行仍显示成功」。
 */
function assertFreshTail(
  rows: readonly ParsedBrentRow[],
  window: { start: string; end: string },
): void {
  const endDate = parseCanonicalUtc(`${window.end}T00:00:00.000Z`, "window.end");
  endDate.setUTCDate(endDate.getUTCDate() - EIA_EUROPE_BRENT_STALE_TAIL_DAYS);
  const minimumTailPeriod = isoDate(endDate);
  const lastPeriod = rows[rows.length - 1]?.period ?? "";
  if (lastPeriod < minimumTailPeriod) {
    throw schemaDrift(
      `EIA 末行观测 ${lastPeriod} 早于窗口末端 ${minimumTailPeriod}（上游疑似静默截断）`,
    );
  }
}

function parseRow(
  value: unknown,
  index: number,
  window: { start: string; end: string },
): ParsedBrentRow {
  const row = exactRecord(value, `EIA row ${index}`, EXPECTED_ROW_KEYS);
  const period = exactString(row.period, "period");
  if (!isCalendarDate(period) || period < window.start || period > window.end) {
    throw new SourceCollectionError("VALIDATION", "EIA period 不在固定请求窗口内");
  }
  if (
    row.duoarea !== "ZEU" ||
    row["area-name"] !== "NA" ||
    row.product !== PRODUCT ||
    row["product-name"] !== "UK Brent Crude Oil" ||
    row.process !== PROCESS ||
    row["process-name"] !== "Spot Price FOB" ||
    row.series !== SERIES ||
    row["series-description"] !==
      "Europe Brent Spot Price FOB (Dollars per Barrel)" ||
    row.units !== WIRE_UNIT
  ) {
    throw schemaDrift("EIA 行身份、维度或单位与 RBRTE 固定契约不一致");
  }

  const valueText = exactString(row.value, "value");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(valueText)) {
    throw schemaDrift("EIA value 不再是正十进制字符串");
  }
  const numericValue = Number(valueText);
  if (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue >= 1000) {
    throw new SourceCollectionError("VALIDATION", "EIA value 超出允许范围");
  }
  return { period, value: numericValue };
}

function observation(row: ParsedBrentRow, fetchedAt: string): ObservationInput {
  const observedAt = `${row.period}T00:00:00.000Z`;
  return {
    indicatorId: EIA_EUROPE_BRENT_INDICATOR_ID,
    observedAt,
    periodStart: observedAt,
    value: row.value,
    unit: NORMALIZED_UNIT,
    publishedAt: null,
    fetchedAt,
    quality: "verified",
    citationUrl: EIA_EUROPE_BRENT_SOURCE_URL,
    metadata: {
      series: SERIES,
      product: PRODUCT,
      process: PROCESS,
      wireUnit: WIRE_UNIT,
      sourceDateHasNoTimezone: true,
    },
  };
}

function exactRecordOptional(
  value: unknown,
  field: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw schemaDrift(`${field} 结构变化`);
  }
  const result = value as Record<string, unknown>;
  for (const required of requiredKeys) {
    if (!(required in result)) throw schemaDrift(`${field} 缺少 ${required}`);
  }
  for (const key of Object.keys(result)) {
    if (!requiredKeys.includes(key) && !optionalKeys.includes(key)) {
      throw schemaDrift(`${field} 字段集合变化或包含警告/截断信息`);
    }
  }
  return result;
}

function exactRecord(
  value: unknown,
  field: string,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw schemaDrift(`${field} 结构变化`);
  }
  const result = value as Record<string, unknown>;
  const actualKeys = Object.keys(result).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw schemaDrift(`${field} 字段集合变化或包含警告/截断信息`);
  }
  return result;
}

function exactString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw schemaDrift(`EIA ${field} 类型或格式变化`);
  }
  return value;
}

function nonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw schemaDrift(`EIA ${field} 类型或格式变化`);
  }
  return value;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && isoDate(parsed) === value;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function schemaDrift(message: string): SourceCollectionError {
  return new SourceCollectionError("SCHEMA_DRIFT", message);
}

export const buildEiaUrl = buildRequestUrl;
