export const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * 解析毫秒精度 UTC ISO-8601 的 canonical 形态；形态不符或日历上不存在的时间
 * （如 2026-02-30）返回 null。stage-gate 与 evidence-selector 此前各有一份逐字相同的
 * 实现，收敛于此；需要抛错的调用方（daily-brief/thesis-draft）保留各自的消息口径。
 */
export function parseCanonicalUtc(value: string): number | null {
  if (!CANONICAL_UTC_PATTERN.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) || new Date(parsed).toISOString() !== value ? null : parsed;
}
