import { describe, expect, it, vi } from "vitest";

import { SourceCollectionError } from "../../../domain/ingestion";
import { findRainfallRegionV1 } from "../../../domain/rainfall-regions";
import {
  CLIMATOLOGY_RANGE,
  CLIMATOLOGY_SOURCE_CONFIGS,
  NASA_POWER_CLIMATOLOGY_POINT_URL,
  climatologyMonthObservedAt,
  collectNasaPowerClimatology,
} from "./nasa-power-climatology";

const PANAMA = CLIMATOLOGY_SOURCE_CONFIGS[3]!;
const FETCHED_AT = "2026-09-26T22:30:00.000Z";

describe("NASA POWER climatology collect variant", () => {
  it("requests the signed 1991-2020 product and stores twelve month-order observations", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return jsonResponse(pointBody(
        Number(url.searchParams.get("latitude")),
        Number(url.searchParams.get("longitude")),
        4,
      ));
    });

    const result = await collectNasaPowerClimatology(PANAMA, fetch, FETCHED_AT);
    const region = findRainfallRegionV1(PANAMA.regionId);
    expect(fetch).toHaveBeenCalledTimes(region!.points.length);
    for (const call of fetch.mock.calls) {
      const url = new URL(String(call[0]));
      expect(`${url.origin}${url.pathname}`).toBe(NASA_POWER_CLIMATOLOGY_POINT_URL);
      expect(url.searchParams.get("start")).toBe("1991");
      expect(url.searchParams.get("end")).toBe("2020");
      expect(url.searchParams.get("parameters")).toBe("PRECTOTCORR");
    }
    expect(result.observations).toHaveLength(12);
    expect(result.observations.map((observation) => observation.observedAt)).toEqual(
      Array.from({ length: 12 }, (_, index) => climatologyMonthObservedAt(index + 1)),
    );
    expect(result.observations.every((observation) =>
      observation.indicatorId === PANAMA.indicatorId
      && observation.unit === "mm/day"
      && observation.quality === "verified"
      && observation.value === 4
      && observation.periodStart === observation.observedAt
    )).toBe(true);
  });

  it("rejects the default 2001-2020 climatology product before accepting it as the signed basis", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const body = pointBody(
        Number(url.searchParams.get("latitude")),
        Number(url.searchParams.get("longitude")),
        4,
      );
      body.header.range = "20-year Meteorological and Solar Monthly & Annual Climatologies (January 2001 - December 2020)";
      return jsonResponse(body);
    });

    await expect(collectNasaPowerClimatology(PANAMA, fetch, FETCHED_AT)).rejects.toMatchObject({
      name: "SourceCollectionError",
      code: "SCHEMA_DRIFT",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a month does not have 75% point coverage", async () => {
    let calls = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls += 1;
      const body = pointBody(
        Number(url.searchParams.get("latitude")),
        Number(url.searchParams.get("longitude")),
        4,
      );
      if (calls > 1) body.properties.parameter.PRECTOTCORR.JAN = -999;
      return jsonResponse(body);
    });

    await expect(collectNasaPowerClimatology(PANAMA, fetch, FETCHED_AT)).rejects.toBeInstanceOf(
      SourceCollectionError,
    );
  });

  it("does not fetch when the source is outside the allowlist", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    await expect(collectNasaPowerClimatology({
      sourceId: "database-provided-source",
      indicatorId: PANAMA.indicatorId,
      regionId: PANAMA.regionId,
    }, fetch, FETCHED_AT)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function pointBody(latitude: number, longitude: number, value: number) {
  const precipitation: Record<string, number> = { ANN: value };
  for (const key of ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]) {
    precipitation[key] = value;
  }
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [longitude, latitude, 10] },
    properties: { parameter: { PRECTOTCORR: precipitation } },
    header: {
      title: "climatology",
      api: { version: "v2.10.0", name: "POWER Climatology API" },
      sources: ["MERRA2"],
      fill_value: -999,
      time_standard: "LST",
      range: CLIMATOLOGY_RANGE,
    },
    parameters: { PRECTOTCORR: { units: "mm/day", longname: "Precipitation Corrected" } },
  };
}
