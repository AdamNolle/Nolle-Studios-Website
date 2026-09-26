import type { ArchivePhoto, ArchiveShoot } from "../archive";

// Every photograph ships as AVIF, WebP and JPEG at several widths. Pictures
// list them as srcsets so the browser fetches only the width a frame needs
// on this screen, and AVIF where it can decode it.

type Format = "avif" | "webp" | "jpeg";

function widthsOf(photo: ArchivePhoto, format: Format): [string, number][] {
  const sizes = photo.formats[format];
  if (!sizes) return [];
  const listed = Object.entries(sizes).filter(([key]) => /^\d+$/.test(key)).map(([key, url]) => [url, Number(key)] as [string, number]);
  if (listed.length) return listed.sort((a, b) => a[1] - b[1]);
  // Curated manifest: thumb, mid and full are 640, 1440 and 3200 pixels on
  // the long side, so a portrait's files are narrower than those numbers.
  const w = photo.width || 3200, h = photo.height || w, long = Math.max(w, h);
  const across = (side: number) => Math.round(w * Math.min(1, side / long));
  return ([[sizes.thumb, across(640)], [sizes.mid, across(1440)], [sizes.full, across(3200)]] as [string | undefined, number][])
    .filter((entry): entry is [string, number] => !!entry[0])
    .filter((entry, index, all) => all.findIndex(other => other[1] === entry[1]) === index);
}

export const srcset = (photo: ArchivePhoto, format: Format) =>
  widthsOf(photo, format).map(([url, width]) => `${url} ${width}w`).join(", ");

export const thumb = (photo?: ArchivePhoto) => photo ? photo.formats.webp?.thumb || photo.thumb : "";
export const mid = (photo?: ArchivePhoto) => photo ? photo.formats.webp?.mid || photo.mid : "";

/** The mid-size image as a CSS background, AVIF first. */
export function background(photo?: ArchivePhoto) {
  if (!photo) return "none";
  const avif = photo.formats.avif?.mid, webp = mid(photo);
  return avif ? `image-set(url("${avif}") type("image/avif"), url("${webp}") type("image/webp"))` : `url("${webp}")`;
}

export function coverPhoto(shoot: ArchiveShoot): ArchivePhoto | undefined {
  const cover = shoot.coverUrl;
  const urls = (photo: ArchivePhoto) => [photo.thumb, photo.mid, photo.full, ...Object.values(photo.formats).flatMap(sizes => Object.values(sizes))];
  return (cover && shoot.photos.find(photo => urls(photo).includes(cover))) || shoot.photos[0];
}

export const aspect = (photo?: ArchivePhoto) => photo?.width && photo.height ? photo.width / photo.height : 1.5;
