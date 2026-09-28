import { publicPageMetadata } from "../domain/public-site";
import { isAdminScreenPath } from "./paths";

export interface BrowserLocation {
  readonly origin: string;
  readonly pathname: string;
}

export interface PageMetadata {
  readonly canonical: string;
  readonly title: string;
  readonly description: string;
  readonly robots: "index, follow" | "noindex, nofollow";
}

export function pageMetadata(location: BrowserLocation): PageMetadata {
  const metadata = publicPageMetadata(location.pathname);
  const canonical = new URL(location.pathname, location.origin).toString();

  if (metadata === null) {
    if (isAdminScreenPath(location.pathname)) {
      return {
        canonical,
        title: "研究后台 | ENSO 市场影响监测",
        description: "仅供已授权研究编辑使用。",
        robots: "noindex, nofollow",
      };
    }

    // 未知路径渲染 NotFoundPage（见 App.tsx），元数据必须与其内容一致；SPA 回退无法返回真 404
    // 状态码，noindex 防止软 404 进入搜索索引。注意 /admin/* 下的未知子路径同样渲染
    // NotFoundPage，因此这里用与 App.tsx 同源的 isAdminScreenPath 判定而不是前缀匹配。
    return {
      canonical,
      title: "页面不存在 | ENSO 市场影响监测",
      description: "该地址没有对应的公开页面；已发布的研究内容可从首页进入。",
      robots: "noindex, nofollow",
    };
  }

  return { canonical, ...metadata, robots: "index, follow" };
}

export function applyPageMetadata(document: Document, location: BrowserLocation): void {
  const metadata = pageMetadata(location);
  const description = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
  const canonicalLink = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    ?? createCanonicalLink(document);
  const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');

  document.title = metadata.title;
  if (description) description.content = metadata.description;
  if (robots) robots.content = metadata.robots;
  canonicalLink.href = metadata.canonical;
}

function createCanonicalLink(document: Document): HTMLLinkElement {
  const link = document.createElement("link");
  link.rel = "canonical";
  document.head.appendChild(link);
  return link;
}
