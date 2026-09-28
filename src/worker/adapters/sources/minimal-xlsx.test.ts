import { describe, expect, it } from "vitest";

import { MAX_DECOMPRESSED_BYTES, readXlsxEntities } from "./minimal-xlsx";
import { storedZip } from "./testing/stored-zip";

/** 测试专用 deflate-raw 压缩（与生产读取端对称）。 */
async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** method-8（deflate）ZIP 写入器：读取端不校验 CRC，置 0 即可。 */
async function deflateZip(
  entries: readonly { name: string; data: Uint8Array<ArrayBuffer> }[],
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const compressed = await deflateRaw(entry.data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(16, compressed.length, true);
    localView.setUint32(20, entry.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, compressed);
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  const all = [...localParts, ...centralParts, eocd];
  const total = all.reduce((sum, piece) => sum + piece.length, 0);
  const bytes = new Uint8Array(total);
  let cursor = 0;
  for (const piece of all) {
    bytes.set(piece, cursor);
    cursor += piece.length;
  }
  return bytes;
}

describe("minimal-xlsx 解压护栏", () => {
  it("正常工作簿：目标条目原样解出，非目标条目跳过", async () => {
    const bytes = storedZip({
      "xl/workbook.xml": "<workbook/>",
      "xl/_rels/workbook.xml.rels": "<Relationships/>",
      "xl/sharedStrings.xml": "<sst/>",
      "xl/worksheets/sheet2.xml": "<worksheet/>",
      "docProps/core.xml": "<core/>",
    });

    const entries = await readXlsxEntities(bytes);

    expect([...entries.keys()].sort()).toEqual([
      "xl/_rels/workbook.xml.rels",
      "xl/sharedStrings.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(new TextDecoder().decode(entries.get("xl/workbook.xml")!)).toBe("<workbook/>");
    expect(new TextDecoder().decode(entries.get("xl/worksheets/sheet2.xml")!)).toBe("<worksheet/>");
  });

  it("zip 炸弹（全零字节高压缩比 deflate 条目）以 SCHEMA_DRIFT 快速中止，不物化 32MB 输出", async () => {
    const bomb = await deflateZip([
      { name: "xl/worksheets/sheet1.xml", data: new Uint8Array(2 * MAX_DECOMPRESSED_BYTES) },
    ]);
    // 压缩后仅 ~30KB：仓库内体积可忽略，解压输出却远超 16MB 上限。
    expect(bomb.byteLength).toBeLessThan(100_000);

    await expect(readXlsxEntities(bomb)).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
  });

  it("只解压目标条目：无关条目里的 deflate 炸弹不被 inflate，也不进入结果", async () => {
    const bytes = await deflateZip([
      { name: "xl/worksheets/sheet1.xml", data: new TextEncoder().encode("<worksheet/>") },
      { name: "media/bomb.bin", data: new Uint8Array(2 * MAX_DECOMPRESSED_BYTES) },
    ]);

    const entries = await readXlsxEntities(bytes);

    expect([...entries.keys()]).toEqual(["xl/worksheets/sheet1.xml"]);
    expect(new TextDecoder().decode(entries.get("xl/worksheets/sheet1.xml")!)).toBe("<worksheet/>");
  });

  it("解压预算按工作簿累计：两个未超限的条目加起来超过 16MB 也中止", async () => {
    const half = Math.floor(MAX_DECOMPRESSED_BYTES * 0.6);
    const bytes = await deflateZip([
      { name: "xl/sharedStrings.xml", data: new Uint8Array(half) },
      { name: "xl/worksheets/sheet1.xml", data: new Uint8Array(half) },
    ]);

    await expect(readXlsxEntities(bytes)).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
  });
});
