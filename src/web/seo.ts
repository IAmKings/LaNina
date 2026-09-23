import { publicPageMetadata } from "../domain/public-site";

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
    return {
      canonical,
      title: "研究后台 | ENSO 市场影响监测",
      description: "仅供已授权研究编辑使用。",
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
