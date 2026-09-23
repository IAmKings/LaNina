/**
 * 供合成 XLSX fixture 使用的最小 ZIP 写入器（STORED 条目，无第三方数据行）。
 * 仅测试环境使用；生产适配器只负责读取（minimal-xlsx.ts）。
 */
export function storedZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of Object.entries(files)) {
    const nameBytes = encoder.encode(entry[0]);
    const data = encoder.encode(entry[1]);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, localParts.length / 2, true);
  eocdView.setUint16(10, localParts.length / 2, true);
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
