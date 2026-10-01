import type { FetchDependency, ObservationInput } from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import {
  findRainfallRegionV1,
  RAINFALL_REGION_DEFINITION_ID,
  RAINFALL_REGION_DEFINITION_VERSION,
  type RainfallRegionV1,
  type RainfallRegionV1Id,
} from "../../../domain/rainfall-regions";
import { decodeUtf8 } from "./adapter-base";
import { errorForResponse, fetchWithinTimeout, readBodyWithinLimit, sha256Hex, SOURCE_FETCH_CACHE_BYPASS } from "./http";

/**
 * NASA POWER 月气候态采集变体（签字口径 2026-09-27：WMO 1991–2020）。
 *
 * 默认 `/api/temporal/climatology/point` 返回的是 2001–2020 预计算产品。签字基准期必须
 * 显式带 `start=1991&end=2020`，并用响应 header.range 核对，避免把另一段气候态写进
 * `*_rainfall_climatology_monthly`。气候态产品的 time_standard 是 LST；月键 JAN–DEC 是
 * 历月语义，observed_at 只用代表年 2020 各月 15 日作月序标签，不把它读成时间序列。
 *
 * 指标行的 source_id 仍是父降水来源。本变体不注册新来源，由 climatology-refresh 把
 * 观测写进父源的专用 source_run。
 */

export const NASA_POWER_CLIMATOLOGY_POINT_URL =
  "https://power.larc.nasa.gov/api/temporal/climatology/point";
export const NASA_POWER_CLIMATOLOGY_POINT_MAX_BYTES = 128 * 1024;
export const NASA_POWER_CLIMATOLOGY_BUNDLE_MAX_BYTES = 1024 * 1024;
export const CLIMATOLOGY_START_YEAR = 1991;
export const CLIMATOLOGY_END_YEAR = 2020;
export const CLIMATOLOGY_RANGE =
  "30-year Meteorological and Solar Monthly & Annual Climatologies (January 1991 - December 2020)";

const MINIMUM_COVERAGE = 0.75;
const BUNDLE_SCHEMA = "nasa-power-climatology-bundle/v1";
const PRECIPITATION_PARAMETER = "PRECTOTCORR";
const REPRESENTATIVE_YEAR = 2020;

const MONTHS = [
  { key: "JAN", month: 1 },
  { key: "FEB", month: 2 },
  { key: "MAR", month: 3 },
  { key: "APR", month: 4 },
  { key: "MAY", month: 5 },
  { key: "JUN", month: 6 },
  { key: "JUL", month: 7 },
  { key: "AUG", month: 8 },
  { key: "SEP", month: 9 },
  { key: "OCT", month: 10 },
  { key: "NOV", month: 11 },
  { key: "DEC", month: 12 },
] as const;

export interface ClimatologySourceConfig {
  readonly sourceId: string;
  readonly indicatorId: string;
  readonly regionId: RainfallRegionV1Id;
}

export const CLIMATOLOGY_SOURCE_CONFIGS = [
  {
    sourceId: "nasa_power_rainfall_southern_thailand_rubber_v1",
    indicatorId: "thai_rainfall_climatology_monthly",
    regionId: "southern_thailand_rubber_v1",
  },
  {
    sourceId: "nasa_power_rainfall_maritime_continent_palm_v1",
    indicatorId: "sea_rainfall_climatology_monthly",
    regionId: "maritime_continent_palm_v1",
  },
  {
    sourceId: "nasa_power_rainfall_southern_africa_maize_v1",
    indicatorId: "sa_maize_rainfall_climatology_monthly",
    regionId: "southern_africa_maize_v1",
  },
  {
    sourceId: "nasa_power_rainfall_panama_canal_catchment_v1",
    indicatorId: "panama_rainfall_climatology_monthly",
    regionId: "panama_canal_catchment_v1",
  },
] as const satisfies readonly ClimatologySourceConfig[];

export interface ClimatologyCollection {
  readonly sourceId: string;
  readonly indicatorId: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly contentType: "application/json; charset=UTF-8";
  readonly rawBody: Uint8Array;
  readonly citationUrl: string;
  readonly observations: readonly ObservationInput[];
}

interface ParsedMonth {
  readonly month: number;
  readonly value: number | null;
}

interface ParsedPoint {
  readonly values: readonly ParsedMonth[];
  readonly apiVersion: string;
  readonly sourceName: string;
}

interface CollectedPoint {
  readonly pointId: string;
  readonly requestUrl: string;
  readonly rawBody: string;
  readonly parsed: ParsedPoint;
}

export function climatologyMonthObservedAt(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new SourceCollectionError("VALIDATION", "气候态月份越界");
  }
  const monthText = String(month).padStart(2, "0");
  return `${REPRESENTATIVE_YEAR}-${monthText}-15T00:00:00.000Z`;
}

export async function collectNasaPowerClimatology(
  config: ClimatologySourceConfig,
  fetch: FetchDependency,
  fetchedAt: string,
): Promise<ClimatologyCollection> {
  const allowed = CLIMATOLOGY_SOURCE_CONFIGS.find(
    (candidate) =>
      candidate.sourceId === config.sourceId
      && candidate.indicatorId === config.indicatorId
      && candidate.regionId === config.regionId,
  );
  if (allowed === undefined) {
    throw new SourceCollectionError("VALIDATION", "NASA POWER 气候态来源不在允许列表");
  }
  const region = findRainfallRegionV1(config.regionId);
  if (region === undefined) {
    throw new SourceCollectionError("VALIDATION", "区域降水定义不存在");
  }

  const collected: CollectedPoint[] = [];
  for (const point of region.points) {
    const requestUrl = buildRequestUrl(point.latitude, point.longitude);
    let response: Response;
    try {
      response = await fetchWithinTimeout(fetch, requestUrl, {
        headers: { Accept: "application/json" },
        redirect: "manual",
        ...SOURCE_FETCH_CACHE_BYPASS,
      });
    } catch (error) {
      throw new SourceCollectionError("NETWORK", "无法连接 NASA POWER 气候态", {
        retryable: true,
        cause: error,
      });
    }
    if (!response.ok) throw errorForResponse(response);
    const contentType = response.headers.get("content-type");
    if (contentType === null || !contentType.toLowerCase().includes("application/json")) {
      throw new SourceCollectionError("SCHEMA_DRIFT", "NASA POWER 气候态响应不再是 JSON");
    }
    const rawBytes = await readBodyWithinLimit(response, NASA_POWER_CLIMATOLOGY_POINT_MAX_BYTES);
    const rawBody = decodeUtf8(rawBytes, "NASA POWER 气候态响应不是有效 UTF-8");
    collected.push({
      pointId: point.id,
      requestUrl,
      rawBody,
      parsed: parsePointResponse(rawBody, point.latitude, point.longitude),
    });
  }

  assertConsistentResponseMetadata(collected);
  const bundle = createBundle(region, collected);
  if (bundle.byteLength > NASA_POWER_CLIMATOLOGY_BUNDLE_MAX_BYTES) {
    throw new SourceCollectionError("VALIDATION", "NASA POWER 气候态响应包超过允许大小");
  }
  const observations = aggregate(config, region, fetchedAt, collected);
  if (observations.length !== MONTHS.length) {
    throw new SourceCollectionError("VALIDATION", "NASA POWER 气候态没有凑齐 12 个月");
  }
  return {
    sourceId: config.sourceId,
    indicatorId: config.indicatorId,
    fetchedAt,
    contentHash: await sha256Hex(bundle),
    contentType: "application/json; charset=UTF-8",
    rawBody: bundle,
    citationUrl: collected[0]!.requestUrl,
    observations,
  };
}

function buildRequestUrl(latitude: number, longitude: number): string {
  const url = new URL(NASA_POWER_CLIMATOLOGY_POINT_URL);
  url.searchParams.set("parameters", PRECIPITATION_PARAMETER);
  url.searchParams.set("community", "AG");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("start", String(CLIMATOLOGY_START_YEAR));
  url.searchParams.set("end", String(CLIMATOLOGY_END_YEAR));
  url.searchParams.set("format", "JSON");
  return url.toString();
}

function parsePointResponse(
  rawBody: string,
  expectedLatitude: number,
  expectedLongitude: number,
): ParsedPoint {
  let value: unknown;
  try {
    value = JSON.parse(rawBody) as unknown;
  } catch {
    throw schemaDrift("NASA POWER 气候态响应不是有效 JSON");
  }
  const root = record(value, "NASA POWER 气候态根对象");
  if (root.type !== "Feature") throw schemaDrift("NASA POWER 气候态根对象不再是 Feature");
  const geometry = record(root.geometry, "NASA POWER 气候态 geometry");
  if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) {
    throw schemaDrift("NASA POWER 气候态 point geometry 结构变化");
  }
  const coordinates = geometry.coordinates;
  if (
    coordinates.length !== 3
    || !coordinates.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    || coordinates[0] !== expectedLongitude
    || coordinates[1] !== expectedLatitude
  ) {
    throw schemaDrift("NASA POWER 气候态 point 坐标与请求不一致");
  }

  const header = record(root.header, "NASA POWER 气候态 header");
  if (header.range !== CLIMATOLOGY_RANGE) {
    throw schemaDrift("NASA POWER 气候态基准期不是 1991–2020");
  }
  if (header.time_standard !== "LST") {
    throw schemaDrift("NASA POWER 气候态 time_standard 不再是 LST");
  }
  const fillValue = finiteNumber(header.fill_value, "NASA POWER 气候态 fill_value");
  const api = record(header.api, "NASA POWER 气候态 header.api");
  const apiVersion = nonBlankString(api.version, "NASA POWER 气候态 API version");
  if (!Array.isArray(header.sources) || header.sources.length === 0) {
    throw schemaDrift("NASA POWER 气候态 sources 缺失");
  }
  const sourceName = header.sources
    .map((source) => nonBlankString(source, "NASA POWER 气候态 source"))
    .join(",");

  const parameters = record(root.parameters, "NASA POWER 气候态 parameters");
  const parameterDefinition = record(
    parameters[PRECIPITATION_PARAMETER],
    "NASA POWER 气候态 PRECTOTCORR parameter",
  );
  if (parameterDefinition.units !== "mm/day") {
    throw schemaDrift("NASA POWER 气候态 PRECTOTCORR 单位不再是 mm/day");
  }
  const properties = record(root.properties, "NASA POWER 气候态 properties");
  const parameterValues = record(properties.parameter, "NASA POWER 气候态 properties.parameter");
  const precipitation = record(
    parameterValues[PRECIPITATION_PARAMETER],
    "NASA POWER 气候态 PRECTOTCORR values",
  );

  const values = MONTHS.map(({ key, month }) => {
    if (!Object.hasOwn(precipitation, key)) {
      throw schemaDrift(`NASA POWER 气候态缺少 ${key}`);
    }
    const precipitationValue = finiteNumber(
      precipitation[key],
      `NASA POWER 气候态 ${key}`,
    );
    return {
      month,
      value: precipitationValue === fillValue || precipitationValue < 0 ? null : precipitationValue,
    };
  });
  return { values, apiVersion, sourceName };
}

function aggregate(
  config: ClimatologySourceConfig,
  region: RainfallRegionV1,
  fetchedAt: string,
  points: readonly CollectedPoint[],
): ObservationInput[] {
  const apiVersion = points[0]!.parsed.apiVersion;
  const sourceName = points[0]!.parsed.sourceName;
  const citationUrl = points[0]!.requestUrl;
  const totalPointCount = region.points.length;
  const observations: ObservationInput[] = [];

  for (const { month } of MONTHS) {
    const validValues = points.flatMap(({ parsed }) => {
      const value = parsed.values.find((item) => item.month === month)?.value;
      return value === null || value === undefined ? [] : [value];
    });
    if (validValues.length / totalPointCount < MINIMUM_COVERAGE) {
      throw new SourceCollectionError(
        "VALIDATION",
        `NASA POWER 气候态 ${month} 月点位覆盖不足`,
      );
    }
    const mean = roundFour(
      validValues.reduce((sum, precipitation) => sum + precipitation, 0) / validValues.length,
    );
    const observedAt = climatologyMonthObservedAt(month);
    observations.push({
      indicatorId: config.indicatorId,
      observedAt,
      periodStart: observedAt,
      value: mean,
      unit: "mm/day",
      publishedAt: null,
      fetchedAt,
      quality: "verified",
      citationUrl,
      metadata: {
        regionDefinitionId: RAINFALL_REGION_DEFINITION_ID,
        regionDefinitionVersion: RAINFALL_REGION_DEFINITION_VERSION,
        regionId: region.id,
        method: "equal_weight_mean",
        validPointCount: validValues.length,
        totalPointCount,
        coverageRatio: validValues.length / totalPointCount,
        apiVersion,
        sourceName,
        climatologyStart: CLIMATOLOGY_START_YEAR,
        climatologyEnd: CLIMATOLOGY_END_YEAR,
        timeStandard: "LST",
        month,
        citationScope: "first_request;all_requests_in_private_bundle",
      },
    });
  }
  return observations;
}

function assertConsistentResponseMetadata(points: readonly CollectedPoint[]): void {
  const first = points[0]?.parsed;
  if (
    first === undefined
    || points.some(
      ({ parsed }) => parsed.apiVersion !== first.apiVersion || parsed.sourceName !== first.sourceName,
    )
  ) {
    throw schemaDrift("NASA POWER 气候态 point 响应元数据不一致");
  }
}

function createBundle(region: RainfallRegionV1, points: readonly CollectedPoint[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schema: BUNDLE_SCHEMA,
      definition: {
        id: RAINFALL_REGION_DEFINITION_ID,
        version: RAINFALL_REGION_DEFINITION_VERSION,
        region,
      },
      responses: points.map(({ pointId, requestUrl, rawBody }) => ({
        pointId,
        requestUrl,
        rawBody,
      })),
    }),
  );
}

function roundFour(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw schemaDrift(`${field} 结构变化`);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw schemaDrift(`${field} 必须是有限数值`);
  }
  return value;
}

function nonBlankString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw schemaDrift(`${field} 必须是非空字符串`);
  }
  return value;
}

function schemaDrift(message: string): SourceCollectionError {
  return new SourceCollectionError("SCHEMA_DRIFT", message);
}
