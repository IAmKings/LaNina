export interface PublicPageMetadata {
  readonly title: string;
  readonly description: string;
}

export const PUBLIC_SITEMAP_PATHS = [
  "/",
  "/rubber",
  "/agriculture",
  "/shipping",
  "/changes",
  "/data-health",
  "/methodology",
] as const;

const PUBLIC_PAGE_METADATA: Readonly<Record<(typeof PUBLIC_SITEMAP_PATHS)[number], PublicPageMetadata>> = {
  "/": {
    title: "ENSO 市场影响监测",
    description: "追踪 ENSO、区域天气、实物供需与市场表现之间的可审计影响链。",
  },
  "/rubber": {
    title: "天然橡胶影响路径 | ENSO 市场影响监测",
    description: "查看 ENSO 与区域天气如何通过割胶、原料与市场指标影响天然橡胶的已发布研究判断。",
  },
  "/agriculture": {
    title: "农产品影响路径 | ENSO 市场影响监测",
    description: "查看 ENSO 与区域天气如何通过产量、收获和供需指标影响农产品的已发布研究判断。",
  },
  "/shipping": {
    title: "航运影响路径 | ENSO 市场影响监测",
    description: "查看 ENSO 与区域天气如何通过运河通行、等待时间和运力影响航运市场的已发布研究判断。",
  },
  "/changes": {
    title: "最新变化 | ENSO 市场影响监测",
    description: "查看足以改变已发布 ENSO 市场影响判断的公开重大变化及其可追溯时间。",
  },
  "/data-health": {
    title: "数据健康 | ENSO 市场影响监测",
    description: "查看公开研究数据来源的更新节奏、成功率与新鲜度状态。",
  },
  "/methodology": {
    title: "方法论 | ENSO 市场影响监测",
    description: "了解 ENSO 市场影响监测如何冻结、发布和解释可审计的研究判断。",
  },
};

export function publicPageMetadata(pathname: string): PublicPageMetadata | null {
  if (isPublicSitemapPath(pathname)) return PUBLIC_PAGE_METADATA[pathname];
  const thesisSlug = /^\/theses\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname)?.[1];
  if (thesisSlug === undefined) return null;

  const displaySlug = thesisSlug.replaceAll("-", " ");
  return {
    title: `${displaySlug} 影响论点详情 | ENSO 市场影响监测`,
    description: `查看已发布论点 ${displaySlug} 的证据、反向证据、传导链、指标与版本时间线。`,
  };
}

export function isPublicSitemapPath(pathname: string): pathname is (typeof PUBLIC_SITEMAP_PATHS)[number] {
  return (PUBLIC_SITEMAP_PATHS as readonly string[]).includes(pathname);
}
