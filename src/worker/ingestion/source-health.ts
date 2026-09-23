import type { SourceHealth, SourceHealthInput } from "../../domain/ingestion";
import { SourceCollectionError } from "../../domain/ingestion";
import { parseCanonicalUtc } from "./time";

export function calculateSourceHealth(input: SourceHealthInput): SourceHealth {
  const checkedAt = parseCanonicalUtc(input.checkedAt, "checkedAt");
  if (
    !Number.isInteger(input.lateAfterMinutes) ||
    !Number.isInteger(input.staleAfterMinutes) ||
    input.lateAfterMinutes < 0 ||
    input.staleAfterMinutes < input.lateAfterMinutes ||
    !Number.isInteger(input.consecutiveFailures) ||
    input.consecutiveFailures < 0
  ) {
    throw new SourceCollectionError("VALIDATION", "来源健康阈值无效");
  }

  let status: SourceHealth["status"];
  if (input.lastErrorCode === "SCHEMA_DRIFT" || input.consecutiveFailures >= 3) {
    status = "broken";
  } else if (input.lastSuccessAt === null) {
    status = "stale";
  } else {
    const lastSuccessAt = parseCanonicalUtc(input.lastSuccessAt, "lastSuccessAt");
    const ageMinutes = Math.max(0, checkedAt.valueOf() - lastSuccessAt.valueOf()) / 60_000;
    status =
      ageMinutes <= input.lateAfterMinutes
        ? "healthy"
        : ageMinutes <= input.staleAfterMinutes
          ? "delayed"
          : "stale";
  }

  return {
    sourceId: input.sourceId,
    status,
    checkedAt: input.checkedAt,
    lastSuccessAt: input.lastSuccessAt,
    consecutiveFailures: input.consecutiveFailures,
  };
}
