import { normalizeCameraMetadata } from "../shared/camera.ts";

const BASE = import.meta.env?.BASE_URL ?? "/";

export type PhotoFormats = Record<string, Record<string, string>>;

export interface ArchivePhoto {
  id: string;
  alt: string;
  caption: string;
  thumb: string;
  mid: string;
  full: string;
  formats: PhotoFormats;
  kind?: "image" | "video";
  duration?: number;
  video?: { mp4?: string; mp4_720?: string; webm?: string };
  width?: number;
  height?: number;
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  capturedAt?: string;
}

export interface ArchiveShoot {
  id: string;
  title: string;
  date: string;
  endDate: string;
  displayDate: string;
  description: string;
  coverUrl: string;
  photos: ArchivePhoto[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatValue(photo: Record<string, unknown>, format: string, size: string): string {
  if (!isRecord(photo.formats)) return "";
  const sizes = photo.formats[format];
  return isRecord(sizes) ? stringValue(sizes[size]) : "";
}

function mediaUrl(value: unknown): string {
  const url = stringValue(value);
  if (!url) return "";
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:")) return url;
  if (url.startsWith("/")) return url;
  return BASE + url.replace(/^\.\//, "");
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "2026-09-20" → "20 SEP 2026", the form printed on the contact sheets. */
export function displayDate(value: unknown, endValue?: unknown): string {
  const dateString = stringValue(value);
  if (!dateString) return "DATE UNKNOWN";
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return dateString.toUpperCase();
  const start = `${match[3]} ${month} ${match[1]}`;
  const endDateString = stringValue(endValue);
  if (!endDateString || endDateString === dateString) return start;
  const end = endDateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const endMonth = end ? MONTHS[Number(end[2]) - 1] : undefined;
  return end && endMonth ? `${start} – ${end[3]} ${endMonth} ${end[1]}` : `${start} – ${endDateString.toUpperCase()}`;
}

function normalizeFormats(value: unknown): PhotoFormats {
  if (!isRecord(value)) return {};
  const formats: PhotoFormats = {};
  for (const [format, rawSizes] of Object.entries(value)) {
    if (!isRecord(rawSizes)) continue;
    const sizes: Record<string, string> = {};
    for (const [size, rawUrl] of Object.entries(rawSizes)) {
      // CMS uploads also list every width: { widths: { "640": url, … } }.
      const entries = size === "widths" && isRecord(rawUrl) ? Object.entries(rawUrl) : [[size, rawUrl] as const];
      for (const [key, value] of entries) {
        const url = mediaUrl(value);
        if (url) sizes[key] = url;
      }
    }
    formats[format] = sizes;
  }
  return formats;
}

export function normalizeArchive(data: unknown): ArchiveShoot[] | null {
  if (!isRecord(data) || !Array.isArray(data.shoots)) return null;
  const shoots = data.shoots.flatMap((rawShoot: unknown, index: number): ArchiveShoot[] => {
    if (!isRecord(rawShoot)) return [];
    const rawPhotos = Array.isArray(rawShoot.photos) ? rawShoot.photos : [];
    const photos = rawPhotos.flatMap((rawPhoto: unknown, photoIndex: number): ArchivePhoto[] => {
      if (!isRecord(rawPhoto)) return [];
      const rawThumb = stringValue(rawPhoto.thumb);
      const rawMid = stringValue(rawPhoto.mid);
      const rawFull = stringValue(rawPhoto.full);
      const jpegThumb = formatValue(rawPhoto, "jpeg", "thumb");
      if (!rawThumb && !rawMid && !rawFull && !jpegThumb) return [];
      const camera = normalizeCameraMetadata(
        stringValue(rawPhoto.cameraMake),
        stringValue(rawPhoto.cameraModel),
      );
      const photo: ArchivePhoto = {
        id: stringValue(rawPhoto.id) || `${stringValue(rawShoot.id) || index}-${photoIndex}`,
        alt: stringValue(rawPhoto.alt) || stringValue(rawPhoto.caption) ||
          `${stringValue(rawShoot.title) || "Photograph"}, image ${photoIndex + 1}`,
        caption: stringValue(rawPhoto.caption),
        thumb: mediaUrl(rawThumb || jpegThumb || rawMid || rawFull),
        mid: mediaUrl(rawMid || formatValue(rawPhoto, "jpeg", "mid") || rawFull || rawThumb),
        full: mediaUrl(rawFull || formatValue(rawPhoto, "jpeg", "full") || rawMid || rawThumb),
        formats: normalizeFormats(rawPhoto.formats),
        kind: rawPhoto.kind === "video" ? "video" : "image",
        duration: typeof rawPhoto.duration === "number" ? rawPhoto.duration : 0,
        video: isRecord(rawPhoto.video) ? {
          mp4: mediaUrl(rawPhoto.video.mp4),
          mp4_720: mediaUrl(rawPhoto.video.mp4_720),
          webm: mediaUrl(rawPhoto.video.webm),
        } : undefined,
        ...camera,
        lensModel: stringValue(rawPhoto.lensModel),
        capturedAt: stringValue(rawPhoto.capturedAt),
      };
      if (typeof rawPhoto.width === "number" && Number.isFinite(rawPhoto.width)) photo.width = rawPhoto.width;
      if (typeof rawPhoto.height === "number" && Number.isFinite(rawPhoto.height)) photo.height = rawPhoto.height;
      return [photo];
    });
    if (!photos.length) return [];
    return [{
      id: stringValue(rawShoot.id) || `shoot-${index}`,
      title: stringValue(rawShoot.title) || `Shoot ${index + 1}`,
      date: stringValue(rawShoot.date),
      endDate: stringValue(rawShoot.endDate),
      displayDate: displayDate(rawShoot.date, rawShoot.endDate),
      description: stringValue(rawShoot.description),
      coverUrl: mediaUrl(stringValue(rawShoot.coverUrl) || photos[0].mid),
      photos,
    }];
  });
  // The light table opens on the latest dated shoot. Keep the editor's
  // sequence within each shoot, and retain source order when dates tie.
  const dated = shoots.map((shoot, index) => ({
    shoot,
    index,
    time: /^\d{4}-\d{2}-\d{2}/.test(shoot.endDate || shoot.date) ? Date.parse(shoot.endDate || shoot.date) : Number.NaN,
  }));
  dated.sort((a, b) => {
    const aTime = Number.isFinite(a.time) ? a.time : Number.NEGATIVE_INFINITY;
    const bTime = Number.isFinite(b.time) ? b.time : Number.NEGATIVE_INFINITY;
    return bTime - aTime || a.index - b.index;
  });
  return dated.map(({ shoot }) => shoot);
}

async function readJson(url: string, timeout = 4000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Archive request failed: ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadArchive(privatePreview = false): Promise<ArchiveShoot[]> {
  if (privatePreview) {
    const shoots = normalizeArchive(await readJson(`${BASE}api/admin/preview`));
    if (!shoots) throw new Error("Private preview is unavailable");
    return shoots;
  }
  if (import.meta.env.MODE !== "static") {
    const shoots = normalizeArchive(await readJson(`${BASE}api/site`, 2500));
    if (!shoots) throw new Error("Site catalog is unavailable");
    return shoots;
  }
  const shoots = normalizeArchive(await readJson(`${BASE}media/archive.json`));
  if (!shoots) throw new Error("Static archive is unavailable");
  return shoots;
}
