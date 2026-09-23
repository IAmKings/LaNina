import type { AtomFeedModel } from "../../domain/atom-feed";

export interface AtomFeedRepository {
  feed(generatedAt: string): Promise<AtomFeedModel>;
}

export class AtomFeedModule {
  constructor(private readonly repository: AtomFeedRepository) {}

  async render(origin: string, generatedAt: string): Promise<string> {
    return renderAtomFeed(await this.repository.feed(generatedAt), origin, generatedAt);
  }
}

/** Renders text-only Atom entries so public database text cannot become XML markup. */
export function renderAtomFeed(feed: AtomFeedModel, origin: string, generatedAt: string): string {
  const canonicalOrigin = normalizeOrigin(origin);
  assertCanonicalUtc(generatedAt);
  const entries = [
    ...feed.changes.map((change) => ({
      id: `${canonicalOrigin}/feed.xml#change-${encodeURIComponent(change.id)}`,
      href: `${canonicalOrigin}/changes`,
      title: `重大变化：${change.thesisTitle ?? change.summary}`,
      content: `${change.summary}：${change.afterLabel}`,
      updatedAt: change.detectedAt,
    })),
    ...feed.dailyBriefs.map((brief) => ({
      id: `${canonicalOrigin}/feed.xml#daily-${brief.briefDate}`,
      href: `${canonicalOrigin}/`,
      title: `每日判定：${brief.headline}`,
      content: brief.summary,
      updatedAt: brief.publishedAt,
    })),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  const updatedAt = entries[0]?.updatedAt ?? generatedAt;

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(`${canonicalOrigin}/feed.xml`)}</id>`,
    '  <title>ENSO 市场影响监测</title>',
    `  <updated>${escapeXml(updatedAt)}</updated>`,
    `  <link rel="self" href="${escapeXml(`${canonicalOrigin}/feed.xml`)}"/>`,
    ...entries.map((entry) => [
      '  <entry>',
      `    <id>${escapeXml(entry.id)}</id>`,
      `    <title>${escapeXml(entry.title)}</title>`,
      `    <updated>${escapeXml(entry.updatedAt)}</updated>`,
      `    <published>${escapeXml(entry.updatedAt)}</published>`,
      `    <link href="${escapeXml(entry.href)}"/>`,
      `    <content type="text">${escapeXml(entry.content)}</content>`,
      '  </entry>',
    ].join("\n")),
    '</feed>',
    '',
  ].join("\n");
}

function normalizeOrigin(value: string): string {
  const parsed = new URL(value);
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.origin !== value) {
    throw new Error("Atom Feed origin 无效");
  }
  return parsed.origin;
}

function assertCanonicalUtc(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new Error("Atom Feed 时间无效");
  }
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
