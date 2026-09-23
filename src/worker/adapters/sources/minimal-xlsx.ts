/**
 * Minimal XLSX reader for single-sheet extraction inside a Worker.
 *
 * Scope is deliberately narrow: World Bank's Pink Sheet monthly workbook is ~587 KiB ZIP with
 * deflate; this module reads the ZIP central directory, decompresses only the needed entries
 * (`DecompressionStream('deflate-raw')`) and exposes worksheet rows as cell maps. Stored
 * (method 0) entries are also supported so tests can build deterministic in-repo fixtures
 * without committing any third-party bytes.
 *
 * Out of scope: styles, merges, formulas, charts. Anything unexpected throws so the adapter
 * surfaces SCHEMA_DRIFT instead of silently mis-reading.
 */

const EOCD = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export interface ParsedSheetRow {
  readonly rowNumber: number;
  /** Column letters (A, B, …, BE) → resolved value; absent cells are undefined. */
  readonly cellValue: (column: string) => string | undefined;
}

function matchesSignature(bytes: Uint8Array, offset: number, signature: Uint8Array): boolean {
  if (offset < 0 || offset + signature.length > bytes.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const bytes = new Uint8Array(compressed.byteLength);
  bytes.set(compressed);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** 解包并解压 XLSX（ZIP）全部条目。 */
export async function readXlsxEntities(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const searchStart = Math.max(0, bytes.length - 66);
  let eocd: number = -1;
  for (let i = bytes.length - EOCD.length; i >= searchStart; i -= 1) {
    if (matchesSignature(bytes, i, EOCD)) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("XLSX 未找到 ZIP central directory 结束标记");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL) throw new Error("XLSX central directory 签名不符");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder("latin1").decode(nameBytes);
    const localFixed = view.getUint32(localHeaderOffset, true);
    if (localFixed !== LOCAL) throw new Error("XLSX local header 签名不符");
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 8) {
      entries.set(name, await inflateRaw(compressed));
    } else if (method === 0) {
      entries.set(name, compressed.slice());
    } else {
      throw new Error(`不支持的 ZIP 压缩方式 ${method}（条目 ${name}）`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 解析 sharedStrings.xml：<si> 里可能有多段 <t>，逐个 join。 */
export function parseSharedStrings(xml: string): readonly string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts: string[] = [];
    for (const t of (match[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) parts.push(t[1] ?? "");
    out.push(parts.join(""));
  }
  return out;
}

/** 解析一个 worksheet XML 为行列表；`t="s"` 的单元格按 sharedStrings 还原。 */
export function parseWorksheetRows(xml: string, shared: readonly string[]): readonly ParsedSheetRow[] {
  const rows: ParsedSheetRow[] = [];
  for (const rowMatch of xml.matchAll(/<row\s+[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1] ?? "0");
    const cells = new Map<string, string>();
    for (const cellMatch of rowMatch[2].matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = cellMatch[1] ?? "";
      const attrs = cellMatch[2] ?? "";
      const inner = cellMatch[3] ?? "";
      const value = resolveCell(attrs, inner, shared);
      if (value !== undefined) cells.set(column, value);
    }
    rows.push({ rowNumber, cellValue: (column) => cells.get(column) });
  }
  return rows;
}

function resolveCell(attrs: string, inner: string, shared: readonly string[]): string | undefined {
  const value = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
  const inline = /<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(inner)?.[1];
  // 属性值必须整体解析：`\b` 在引号旁不构成词边界（实测置 false）。
  const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
  if (type === "s" && value !== undefined) return shared[Number(value)];
  if (type === "inlineStr") return inline;
  if (value === undefined) return undefined;
  return decodeEntities(value);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
