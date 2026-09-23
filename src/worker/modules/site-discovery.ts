import { PUBLIC_SITEMAP_PATHS } from "../../domain/public-site";

const XML_CONTENT_TYPE = "application/xml; charset=utf-8";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

/** Builds static discovery files without reading any research or draft data. */
export function sitemapResponse(origin: string): Response {
  const canonicalOrigin = normalizeOrigin(origin);
  const urls = PUBLIC_SITEMAP_PATHS.map((pathname) => `  <url><loc>${escapeXml(`${canonicalOrigin}${pathname}`)}</loc></url>`);
  return new Response([
    '<?xml version="1.0" encoding="utf-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n"), {
    headers: discoveryHeaders(XML_CONTENT_TYPE),
  });
}

export function robotsResponse(origin: string): Response {
  const canonicalOrigin = normalizeOrigin(origin);
  return new Response([
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /admin/",
    `Sitemap: ${canonicalOrigin}/sitemap.xml`,
    "",
  ].join("\n"), {
    headers: discoveryHeaders(TEXT_CONTENT_TYPE),
  });
}

function discoveryHeaders(contentType: string): HeadersInit {
  return {
    "cache-control": "public, max-age=300, stale-while-revalidate=300",
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  };
}

function normalizeOrigin(value: string): string {
  const parsed = new URL(value);
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.origin !== value) {
    throw new Error("站点来源无效");
  }
  return parsed.origin;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
}
