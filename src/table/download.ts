import type { ArchivePhoto, ArchiveShoot } from "../archive";

// Downloads for visitors: one photograph saves as its full-size JPEG, several
// arrive as one ZIP built in the browser. Photographs are already compressed,
// so the ZIP stores them as they are and costs nothing but a copy.

/** The largest JPEG of a photograph, or the MP4 of a clip. */
export function sourceOf(photo: ArchivePhoto) {
  return photo.kind === "video" ? photo.video?.mp4 || photo.video?.mp4_720 || "" : photo.formats.jpeg?.full || photo.full;
}

const slug = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "nolle-studios";

/** "the-next-inning-03.jpg": the shoot and the frame's place in it. */
export function fileName(shoot: ArchiveShoot, index: number) {
  const url = sourceOf(shoot.photos[index]);
  const ext = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? "jpg";
  return `${slug(shoot.title)}-${String(index + 1).padStart(2, "0")}.${ext}`;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP of stored (uncompressed) entries with UTF-8 names. */
export function zip(files: { name: string; data: Uint8Array }[], when = new Date()) {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const encoder = new TextEncoder(), parts: BlobPart[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), crc = crc32(file.data), size = file.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, file.data as Uint8Array<ArrayBuffer>);
    const entry = new DataView(new ArrayBuffer(46 + name.length));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, size, true);
    entry.setUint32(24, size, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    new Uint8Array(entry.buffer).set(name, 46);
    central.push(new Uint8Array(entry.buffer));
    offset += 30 + name.length + size;
  }
  const directory = central.reduce((total, entry) => total + entry.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directory, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central.map(entry => entry as Uint8Array<ArrayBuffer>), end.buffer], { type: "application/zip" });
}

/**
 * Save photographs from a shoot: a single file as itself, several as
 * "<shoot>.zip". Reports progress as files arrive.
 */
export async function download(shoot: ArchiveShoot, indexes: number[], onProgress: (done: number) => void = () => {}) {
  const sorted = [...indexes].sort((a, b) => a - b);
  const files: { name: string; data: Uint8Array }[] = [];
  for (const index of sorted) {
    const response = await fetch(sourceOf(shoot.photos[index]));
    if (!response.ok) throw new Error(`Couldn’t fetch ${fileName(shoot, index)}`);
    files.push({ name: fileName(shoot, index), data: new Uint8Array(await response.arrayBuffer()) });
    onProgress(files.length);
  }
  if (files.length === 1) save(new Blob([files[0].data as Uint8Array<ArrayBuffer>]), files[0].name);
  else if (files.length) save(zip(files), `${slug(shoot.title)}.zip`);
}
