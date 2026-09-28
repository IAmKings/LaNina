/**
 * 后台路径判定的唯一所有者：App.tsx 用它选页面，seo.ts 用它对齐元数据。
 * 新增后台路由时只改这里，两层不得各自实现同一判定（跨层一致性）。
 */

import { shanghaiToday } from "./admin-daily-view";

/** `/admin` 只是 Access 的保护前缀；进入后客户端改址到运行总览。 */
export const BARE_ADMIN_PATH = "/admin";
export const ADMIN_RUNS_PATH = "/admin/runs";

export function adminDraftThesisIdFromPath(pathname: string): string | null {
  const matched = /^\/admin\/theses\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/draft$/.exec(pathname);
  return matched?.[1] ?? null;
}

/** `/admin/daily` resolves to the current Asia/Shanghai brief date; an explicit date is preserved. */
export function adminDailyDateFromPath(pathname: string): string | null {
  if (pathname === "/admin/daily") return shanghaiToday();
  const matched = /^\/admin\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(pathname);
  return matched?.[1] ?? null;
}

/**
 * App.tsx 实际渲染后台界面的路径全集（/admin、/admin/runs、/admin/daily[/date]、
 * /admin/theses/<id>/draft）。其余 /admin/* 子路径会落入公开 NotFoundPage，
 * 因此 seo 元数据必须用这一判定而不是 `/admin` 前缀一刀切，否则会出现
 * 标题与页面内容不一致的软 404。
 */
export function isAdminScreenPath(pathname: string): boolean {
  return pathname === BARE_ADMIN_PATH
    || pathname === ADMIN_RUNS_PATH
    || adminDailyDateFromPath(pathname) !== null
    || adminDraftThesisIdFromPath(pathname) !== null;
}
