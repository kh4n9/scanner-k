// Minimal "store" (no compression) ZIP writer. Bundles a list of files into a
// single .zip byte array that the browser can download — no external dependency
// and no compression, which is fine for JPEG/PNG that are already compressed.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

function le32(v: number): [number, number, number, number] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function le16(v: number): [number, number] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

// General-purpose bit 11 (the language-encoding / "EFST" flag) marks the entry
// name as UTF-8, per the ZIP spec (PKWARE APPNOTE 6.3.0 §4.4.4). Every name is
// encoded with TextEncoder, so setting it is what makes non-ASCII names — the
// normal case for a Vietnamese document, e.g. "hợp đồng" — round-trip into the
// archive instead of having to be rejected outright.
const FLAG_UTF8 = 0x0800;

/** Create a store-only ZIP archive. Entry names are written as UTF-8 and flagged
 *  as such, so any language works; the caller is responsible for making the names
 *  unique and free of characters the filesystem would reject. */
export function createZip(files: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const count = files.length;

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    local.set([0x50, 0x4b, 0x03, 0x04]); // local file header signature
    local.set(le16(20), 4); // version needed
    local.set(le16(FLAG_UTF8), 6); // flags
    local.set(le16(0), 8); // method (store)
    local.set(le16(0), 10); // mod time
    local.set(le16(0), 12); // mod date
    local.set(le32(crc), 14); // crc32
    local.set(le32(size), 18); // compressed size
    local.set(le32(size), 22); // uncompressed size
    local.set(le16(nameBytes.length), 26); // filename length
    local.set(le16(0), 28); // extra length
    local.set(nameBytes, 30);
    localParts.push(local, f.data);
    const headerOffset = offset;
    offset += local.length + f.data.length;

    const central = new Uint8Array(46 + nameBytes.length);
    central.set([0x50, 0x4b, 0x01, 0x02]); // central dir signature
    central.set(le16(20), 4); // version made by
    central.set(le16(20), 6); // version needed
    central.set(le16(FLAG_UTF8), 8); // flags
    central.set(le16(0), 10); // method
    central.set(le16(0), 12); // mod time
    central.set(le16(0), 14); // mod date
    central.set(le32(crc), 16); // crc32
    central.set(le32(size), 20); // compressed size
    central.set(le32(size), 24); // uncompressed size
    central.set(le16(nameBytes.length), 28); // filename length
    central.set(le16(0), 30); // extra length
    central.set(le16(0), 32); // comment length
    central.set(le16(0), 34); // disk number start
    central.set(le16(0), 36); // internal file attrs
    central.set(le32(0), 38); // external file attrs
    central.set(le32(headerOffset), 42); // local header offset
    central.set(nameBytes, 46);
    centralParts.push(central);
  }

  const centralDir = concat(centralParts);
  const endOfCentral = new Uint8Array(22);
  endOfCentral.set([0x50, 0x4b, 0x05, 0x06]); // end of central dir signature
  endOfCentral.set(le16(0), 4); // disk number
  endOfCentral.set(le16(0), 6); // disk with central dir
  endOfCentral.set(le16(count), 8); // entries on this disk
  endOfCentral.set(le16(count), 10); // total entries
  endOfCentral.set(le32(centralDir.length), 12); // central dir size
  endOfCentral.set(le32(offset), 16); // central dir offset
  endOfCentral.set(le16(0), 20); // comment length

  return concat([...localParts, centralDir, endOfCentral]);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
