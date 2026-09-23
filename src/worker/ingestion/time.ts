import { SourceCollectionError } from "../../domain/ingestion";

export function parseCanonicalUtc(value: string, field: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})Z$/.exec(value);
  if (match === null) {
    throw new SourceCollectionError("VALIDATION", `${field} 必须是毫秒精度 UTC ISO-8601`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new SourceCollectionError("VALIDATION", `${field} 必须是有效 UTC 时间`);
  }
  return parsed;
}

export function addMinutes(value: string, minutes: number): string {
  const parsed = parseCanonicalUtc(value, "时间");
  return new Date(parsed.valueOf() + minutes * 60_000).toISOString();
}

export function advanceDuePastCutoff(
  currentDueAt: string,
  cutoff: string,
  cadenceMinutes: number,
): string {
  const due = parseCanonicalUtc(currentDueAt, "next_due_at");
  const boundary = parseCanonicalUtc(cutoff, "dispatch cutoff");
  if (!Number.isInteger(cadenceMinutes) || cadenceMinutes <= 0) {
    throw new SourceCollectionError("VALIDATION", "来源 cadence_minutes 必须是正整数");
  }
  const cadenceMs = cadenceMinutes * 60_000;
  const steps = Math.max(1, Math.floor((boundary.valueOf() - due.valueOf()) / cadenceMs) + 1);
  return new Date(due.valueOf() + steps * cadenceMs).toISOString();
}
