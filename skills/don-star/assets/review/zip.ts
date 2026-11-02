// Minimal ZIP writer for the board's PNG export (export-png.ts).
//
// Store-only (method 0, no DEFLATE): every entry is a PNG, which is already
// a compressed stream — running it through deflate costs CPU and a library
// dependency to save a percent or two. So the whole format reduces to three
// records we can write by hand, and the harness keeps its "no icon/zip/util
// dependencies" rule.
//
// No zip64: an export is tens of files and tens of megabytes, both orders of
// magnitude under the 4GB / 65535-entry ceilings.

/** `data` is pinned to a plain ArrayBuffer: TS 6 makes Uint8Array generic over
 *  its buffer, and a SharedArrayBuffer-backed view is not a BlobPart. */
export type ZipEntry = { name: string; data: Uint8Array<ArrayBuffer> };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array<ArrayBuffer>): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time, the only timestamp the base format carries. */
function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Builds the archive in one pass: local headers + data, then the central
 *  directory that indexes them, then the end record that points at it. */
export function makeZip(entries: ZipEntry[], at: Date = new Date()): Blob {
  const { time, date } = dosStamp(at);
  const enc = new TextEncoder();
  const local: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const head = new Uint8Array(30 + name.length);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x04034b50, true); // local file header
    hv.setUint16(4, 20, true); // version needed
    hv.setUint16(6, 0x0800, true); // flags: UTF-8 names
    hv.setUint16(8, 0, true); // method: store
    hv.setUint16(10, time, true);
    hv.setUint16(12, date, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, size, true);
    hv.setUint32(22, size, true);
    hv.setUint16(26, name.length, true);
    head.set(name, 30);
    local.push(head, entry.data);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); // central directory header
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, time, true);
    dv.setUint16(14, date, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, size, true);
    dv.setUint32(24, size, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true); // where its local header sits
    dir.set(name, 46);
    central.push(dir);

    offset += head.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...local, ...central, end], { type: "application/zip" });
}

/** Filename-safe slug for zip paths: ASCII, lowercase, no separators that a
 *  file manager would read as a directory. */
export function slugify(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // combining marks left by NFKD
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "screen"
  );
}

/** Hands a blob to the browser's downloader under `filename`. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late: Safari reads the object URL after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
