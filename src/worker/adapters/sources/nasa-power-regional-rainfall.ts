import type {
  RainfallRegionV1,
  RainfallRegionV1Id,
} from "../../../domain/rainfall-regions";
import {
  findRainfallRegionV1,
  RAINFALL_REGION_DEFINITION_ID,
  RAINFALL_REGION_DEFINITION_VERSION,
} from "../../../domain/rainfall-regions";
import type {
  CollectContext,
  CollectResult,
  ObservationInput,
  SourceAdapter,
} from "../../../domain/ingestion";
import { SourceCollectionError } from "../../../domain/ingestion";
import { parseCanonicalUtc } from "../../ingestion/time";
import { errorForResponse, readBodyWithinLimit, sha256Hex } from "./http";

export const NASA_POWER_RAINFALL_ADAPTER_KEY = "nasa-power-regional-rainfall-v1";
export const NASA_POWER_DAILY_POINT_URL =
  "https://power.larc.nasa.gov/api/temporal/daily/point";
export const NASA_POWER_POINT_MAX_BYTES = 128 * 1024;
export const NASA_POWER_BUNDLE_MAX_BYTES = 1024 * 1024;

const WINDOW_DAYS = 14;
const LATENCY_DAYS = 3;
const MINIMUM_COVERAGE = 0.75;
const BUNDLE_SCHEMA = "nasa-power-regional-rainfall-bundle/v1";
const PRECIPITATION_PARAMETER = "PRECTOTCORR";

export interface RegionalRainfallSourceConfig {
  readonly sourceId: string;
  readonly indicatorId: string;
  readonly regionId: RainfallRegionV1Id;
}

export const REGIONAL_RAINFALL_SOURCE_CONFIGS = [
  {
    sourceId: "nasa_power_rainfall_southern_thailand_rubber_v1",
    indicatorId: "regional_rainfall_southern_thailand_rubber_v1",
    regionId: "southern_thailand_rubber_v1",
  },
  {
    sourceId: "nasa_power_rainfall_maritime_continent_palm_v1",
    indicatorId: "regional_rainfall_maritime_continent_palm_v1",
    regionId: "maritime_continent_palm_v1",
  },
  {
    sourceId: "nasa_power_rainfall_southern_africa_maize_v1",
    indicatorId: "regional_rainfall_southern_africa_maize_v1",
    regionId: "southern_africa_maize_v1",
  },
  {
    sourceId: "nasa_power_rainfall_panama_canal_catchment_v1",
    indicatorId: "regional_rainfall_panama_canal_catchment_v1",
    regionId: "panama_canal_catchment_v1",
  },
] as const satisfies readonly RegionalRainfallSourceConfig[];

interface ParsedPointResponse {
  values: ReadonlyMap<string, number | null>;
  apiVersion: string;
  sourceName: string;
}

interface CollectedPoint {
  pointId: string;
  requestUrl: string;
  rawBody: string;
  parsed: ParsedPointResponse;
}

export const nasaPowerRegionalRainfallAdapter: SourceAdapter = {
  key: NASA_POWER_RAINFALL_ADAPTER_KEY,

  async collect(context: CollectContext): Promise<CollectResult> {
    const configured = sourceConfig(context.sourceId);
    if (configured === undefined || context.sourceUrl !== NASA_POWER_DAILY_POINT_URL) {
      throw new SourceCollectionError(
        "VALIDATION",
        "NASA POWER 区域降水来源 ID 或地址不在允许列表",
      );
    }

    const region = findRainfallRegionV1(configured.regionId);
    if (region === undefined) {
      throw new SourceCollectionError("VALIDATION", "区域降水定义不存在");
    }
    const dates = requestedDates(context.fetchedAt);
    const collected: CollectedPoint[] = [];

    for (const point of region.points) {
      const requestUrl = buildRequestUrl(point.latitude, point.longitude, dates[0], dates.at(-1)!);
      let response: Response;
      try {
        response = await context.fetch(requestUrl, {
          headers: { Accept: "application/json" },
          redirect: "error",
        });
      } catch {
        throw new SourceCollectionError("NETWORK", "无法连接 NASA POWER", { retryable: true });
      }
      if (!response.ok) throw errorForResponse(response);
      const contentType = response.headers.get("content-type");
      if (contentType === null || !contentType.toLowerCase().includes("application/json")) {
        throw new SourceCollectionError("SCHEMA_DRIFT", "NASA POWER 响应不再是 JSON");
      }

      const rawBytes = await readBodyWithinLimit(response, NASA_POWER_POINT_MAX_BYTES);
      const rawBody = decodeUtf8(rawBytes);
      collected.push({
        pointId: point.id,
        requestUrl,
        rawBody,
        parsed: parsePointResponse(rawBody, point.latitude, point.longitude, dates),
      });
    }

    assertConsistentResponseMetadata(collected);
    const bundle = createBundle(region, collected);
    if (bundle.byteLength > NASA_POWER_BUNDLE_MAX_BYTES) {
      throw new SourceCollectionError("VALIDATION", "NASA POWER 区域响应包超过允许大小");
    }
    const contentHash = await sha256Hex(bundle);
    if (contentHash === context.previousContentHash) {
      return unchangedResult(context, contentHash);
    }

    const { observations, warnings } = aggregate(
      context,
      configured,
      region,
      dates,
      collected,
    );
    if (observations.length === 0) {
      throw new SourceCollectionError("VALIDATION", "NASA POWER 请求窗口内没有足够覆盖的日期");
    }

    return {
      sourceId: context.sourceId,
      fetchedAt: context.fetchedAt,
      sourcePublishedAt: null,
      etag: null,
      lastModified: null,
      contentType: "application/json; charset=UTF-8",
      contentHash,
      rawBody: bundle,
      observations,
      warnings,
      status: warnings.length === 0 ? "changed" : "partial",
    };
  },
};

function sourceConfig(sourceId: string): RegionalRainfallSourceConfig | undefined {
  return REGIONAL_RAINFALL_SOURCE_CONFIGS.find((candidate) => candidate.sourceId === sourceId);
}

function requestedDates(fetchedAt: string): string[] {
  const fetched = parseCanonicalUtc(fetchedAt, "fetchedAt");
  const end = new Date(Date.UTC(fetched.getUTCFullYear(), fetched.getUTCMonth(), fetched.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - LATENCY_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1));
  return Array.from({ length: WINDOW_DAYS }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return compactDate(date);
  });
}

function compactDate(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function buildRequestUrl(
  latitude: number,
  longitude: number,
  start: string,
  end: string,
): string {
  const url = new URL(NASA_POWER_DAILY_POINT_URL);
  url.searchParams.set("parameters", PRECIPITATION_PARAMETER);
  url.searchParams.set("community", "AG");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("format", "JSON");
  url.searchParams.set("time-standard", "UTC");
  return url.toString();
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SourceCollectionError("SCHEMA_DRIFT", "NASA POWER 响应不是有效 UTF-8");
  }
}

function parsePointResponse(
  rawBody: string,
  expectedLatitude: number,
  expectedLongitude: number,
  expectedDates: readonly string[],
): ParsedPointResponse {
  let value: unknown;
  try {
    value = JSON.parse(rawBody) as unknown;
  } catch {
    throw schemaDrift("NASA POWER 响应不是有效 JSON");
  }
  const root = record(value, "NASA POWER 根对象");
  if (root.type !== "Feature") {
    throw schemaDrift("NASA POWER 根对象不再是 Feature");
  }
  const geometry = record(root.geometry, "NASA POWER geometry");
  if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) {
    throw schemaDrift("NASA POWER point geometry 结构变化");
  }
  const coordinates = geometry.coordinates;
  if (
    coordinates.length !== 3 ||
    !coordinates.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)) ||
    coordinates[0] !== expectedLongitude ||
    coordinates[1] !== expectedLatitude
  ) {
    throw schemaDrift("NASA POWER point 坐标与请求不一致");
  }

  const header = record(root.header, "NASA POWER header");
  const fillValue = finiteNumber(header.fill_value, "NASA POWER fill_value");
  if (header.time_standard !== "UTC") {
    throw schemaDrift("NASA POWER time_standard 不再是 UTC");
  }
  const api = record(header.api, "NASA POWER header.api");
  const apiVersion = nonBlankString(api.version, "NASA POWER API version");
  if (!Array.isArray(header.sources) || header.sources.length === 0) {
    throw schemaDrift("NASA POWER sources 缺失");
  }
  const sourceNames = header.sources.map((source) => nonBlankString(source, "NASA POWER source"));
  const sourceName = sourceNames.join(",");

  const parameters = record(root.parameters, "NASA POWER parameters");
  const parameterDefinition = record(
    parameters[PRECIPITATION_PARAMETER],
    "NASA POWER PRECTOTCORR parameter",
  );
  if (parameterDefinition.units !== "mm/day") {
    throw schemaDrift("NASA POWER PRECTOTCORR 单位不再是 mm/day");
  }

  const properties = record(root.properties, "NASA POWER properties");
  const parameterValues = record(properties.parameter, "NASA POWER properties.parameter");
  const precipitation = record(
    parameterValues[PRECIPITATION_PARAMETER],
    "NASA POWER PRECTOTCORR values",
  );
  const actualDates = Object.keys(precipitation).sort();
  const requiredDates = [...expectedDates].sort();
  if (
    actualDates.length !== requiredDates.length ||
    actualDates.some((date, index) => date !== requiredDates[index])
  ) {
    throw schemaDrift("NASA POWER 日期集合与请求窗口不一致");
  }

  const values = new Map<string, number | null>();
  for (const date of expectedDates) {
    if (!/^\d{8}$/.test(date) || !isCalendarDate(date)) {
      throw schemaDrift("NASA POWER 日期键无效");
    }
    const precipitationValue = finiteNumber(precipitation[date], "NASA POWER PRECTOTCORR value");
    values.set(date, precipitationValue === fillValue || precipitationValue < 0 ? null : precipitationValue);
  }
  return { values, apiVersion, sourceName };
}

function isCalendarDate(value: string): boolean {
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`;
  const parsed = new Date(iso);
  return !Number.isNaN(parsed.valueOf()) && compactDate(parsed) === value;
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

function assertConsistentResponseMetadata(points: readonly CollectedPoint[]): void {
  const first = points[0]?.parsed;
  if (
    first === undefined ||
    points.some(
      ({ parsed }) =>
        parsed.apiVersion !== first.apiVersion || parsed.sourceName !== first.sourceName,
    )
  ) {
    throw schemaDrift("NASA POWER point 响应元数据不一致");
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

function aggregate(
  context: CollectContext,
  configured: RegionalRainfallSourceConfig,
  region: RainfallRegionV1,
  dates: readonly string[],
  points: readonly CollectedPoint[],
): { observations: ObservationInput[]; warnings: string[] } {
  const observations: ObservationInput[] = [];
  const warnings: string[] = [];
  const totalPointCount = region.points.length;
  const apiVersion = points[0].parsed.apiVersion;
  const sourceName = points[0].parsed.sourceName;
  const citationUrl = points[0].requestUrl;

  for (const date of dates) {
    const validValues = points.flatMap(({ parsed }) => {
      const value = parsed.values.get(date);
      return value === null || value === undefined ? [] : [value];
    });
    const coverageRatio = validValues.length / totalPointCount;
    if (coverageRatio < MINIMUM_COVERAGE) {
      warnings.push(`LOW_POINT_COVERAGE:${displayDate(date)}`);
      continue;
    }
    const value = roundFour(
      validValues.reduce((sum, precipitation) => sum + precipitation, 0) / validValues.length,
    );
    const observedAt = `${displayDate(date)}T00:00:00.000Z`;
    observations.push({
      indicatorId: configured.indicatorId,
      observedAt,
      periodStart: observedAt,
      value,
      unit: "mm/day",
      publishedAt: null,
      fetchedAt: context.fetchedAt,
      quality: "provisional",
      citationUrl,
      metadata: {
        regionDefinitionId: RAINFALL_REGION_DEFINITION_ID,
        regionDefinitionVersion: RAINFALL_REGION_DEFINITION_VERSION,
        regionId: region.id,
        method: "equal_weight_mean",
        validPointCount: validValues.length,
        totalPointCount,
        coverageRatio,
        apiVersion,
        sourceName,
        citationScope: "first_request;all_requests_in_private_bundle",
      },
    });
  }
  return { observations, warnings };
}

function displayDate(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function roundFour(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function unchangedResult(context: CollectContext, contentHash: string): CollectResult {
  return {
    sourceId: context.sourceId,
    fetchedAt: context.fetchedAt,
    sourcePublishedAt: null,
    etag: null,
    lastModified: null,
    contentType: "application/json; charset=UTF-8",
    contentHash,
    rawBody: null,
    observations: [],
    warnings: [],
    status: "unchanged",
  };
}
