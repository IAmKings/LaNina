export const RAINFALL_REGION_DEFINITION_ID = "rainfall-regions-v1";
export const RAINFALL_REGION_DEFINITION_VERSION = 1;

export interface RainfallRegionPoint {
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly proxy: string;
}

export interface RainfallRegionDefinition {
  readonly id: string;
  readonly label: string;
  readonly points: readonly RainfallRegionPoint[];
}

/**
 * Immutable proxy samples used by the v1 regional-rainfall series. Changing a
 * point requires a new definition ID/version and new indicator IDs.
 */
export const RAINFALL_REGIONS_V1 = [
  {
    id: "southern_thailand_rubber_v1",
    label: "Southern Thailand rubber belt proxy",
    points: [
      { id: "st01", latitude: 9.14, longitude: 99.33, proxy: "Surat Thani rubber belt" },
      { id: "st02", latitude: 8.43, longitude: 99.96, proxy: "Nakhon Si Thammarat" },
      { id: "st03", latitude: 7.19, longitude: 100.6, proxy: "Songkhla" },
      { id: "st04", latitude: 6.43, longitude: 101.82, proxy: "Narathiwat" },
    ],
  },
  {
    id: "maritime_continent_palm_v1",
    label: "Maritime Continent oil-palm exposure proxy",
    points: [
      { id: "mc01", latitude: 3.14, longitude: 101.69, proxy: "Peninsular Malaysia" },
      { id: "mc02", latitude: 0.51, longitude: 101.45, proxy: "Riau/Sumatra" },
      { id: "mc03", latitude: -2.21, longitude: 113.92, proxy: "Central Kalimantan" },
      { id: "mc04", latitude: 0.13, longitude: 109.33, proxy: "West Kalimantan" },
      { id: "mc05", latitude: 5.98, longitude: 116.07, proxy: "Sabah" },
    ],
  },
  {
    id: "southern_africa_maize_v1",
    label: "Southern Africa maize-zone proxy",
    points: [
      { id: "sa01", latitude: -28.45, longitude: 26.8, proxy: "South Africa Free State" },
      { id: "sa02", latitude: -26, longitude: 29.5, proxy: "South Africa Mpumalanga" },
      { id: "sa03", latitude: -17.82, longitude: 31.05, proxy: "Zimbabwe maize zone proxy" },
      { id: "sa04", latitude: -15.42, longitude: 28.28, proxy: "Zambia maize zone proxy" },
      { id: "sa05", latitude: -13.96, longitude: 33.77, proxy: "Malawi maize zone proxy" },
    ],
  },
  {
    id: "panama_canal_catchment_v1",
    label: "Panama Canal catchment proxy",
    points: [
      { id: "pc01", latitude: 9.26, longitude: -79.92, proxy: "Gatun catchment proxy" },
      { id: "pc02", latitude: 9.21, longitude: -79.58, proxy: "Alhajuela/Madden catchment proxy" },
      { id: "pc03", latitude: 9, longitude: -79.65, proxy: "Pacific-side corridor proxy" },
    ],
  },
] as const satisfies readonly RainfallRegionDefinition[];

export type RainfallRegionV1 = (typeof RAINFALL_REGIONS_V1)[number];
export type RainfallRegionV1Id = RainfallRegionV1["id"];

export function findRainfallRegionV1(id: string): RainfallRegionV1 | undefined {
  return RAINFALL_REGIONS_V1.find((region) => region.id === id);
}
