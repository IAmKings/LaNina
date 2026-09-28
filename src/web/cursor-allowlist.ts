/**
 * URL 提供的分页 cursor 白名单，口径对齐 public-information-view.ts 的筛选参数：
 * 缺失或畸形（超长/特殊字符/形态不符）一律忽略，不进入请求 URL。
 *
 * API 签发的 runs cursor 是 `JSON.stringify({ scheduledAt, id })`（worker 侧 encodeCursor）：
 * canonical UTC 时间戳 + 至多 256 字符的 id。这里按同一序列化形态做字符集/长度校验，
 * 非法值回退列表首页而不是转发给 API（服务端会以 400 兜底，此处只是防御深度对齐）。
 */
const ADMIN_RUNS_CURSOR_PATTERN =
  /^\{"scheduledAt":"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)","id":"([A-Za-z0-9][A-Za-z0-9_-]{0,255})"\}$/;

/** canonical UTC 判定与 public 侧 isCalendarDate 同构：形态匹配后仍要求真实日期。 */
function isCanonicalUtcTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

/** Missing or malformed cursors yield null so callers fall back to the first page. */
export function adminRunsCursorFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get("cursor");
  if (raw === null) return null;
  const matched = ADMIN_RUNS_CURSOR_PATTERN.exec(raw);
  if (matched === null) return null;
  return isCanonicalUtcTimestamp(matched[1]) ? raw : null;
}

/** Request endpoint for the admin runs page; an invalid cursor degrades to the unpaginated first page. */
export function adminRunsEndpoint(search: string): string {
  const cursor = adminRunsCursorFromSearch(search);
  return cursor === null
    ? "/api/admin/runs"
    : `/api/admin/runs?cursor=${encodeURIComponent(cursor)}`;
}
