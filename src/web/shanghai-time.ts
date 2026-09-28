/**
 * Cached `Intl.DateTimeFormat` singletons for the product time zone.
 *
 * Formatter construction is the expensive part of Intl formatting, and public pages format dozens
 * of timestamps per render (thesis timelines, indicator tables, changes lists), so every call site
 * shares one module-level instance instead of rebuilding the formatter per call.
 */

/** Full public timestamp rendering, verbatim options previously built per call in overview-view. */
const shanghaiDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
});

/** Day/month-only rendering for chart axis labels, verbatim options previously built per call. */
const shanghaiDayMonthFormatter = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
});

/**
 * Renders a public timestamp in Asia/Shanghai. `null` stays an explicit "暂无" so a missing value
 * is never mistaken for a real time.
 */
export function formatShanghaiTime(value: string | null): string {
  if (value === null) {
    return "暂无";
  }

  return shanghaiDateTimeFormatter.format(new Date(value));
}

/** Day/month axis label; the chart keeps its own invalid-date guard around this. */
export function formatShanghaiDayMonth(value: Date): string {
  return shanghaiDayMonthFormatter.format(value);
}
