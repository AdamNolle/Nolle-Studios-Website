import { batch, createMemo, createRoot, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { AdminContent, AltTextStatus, CollectionDto, PhotoDto, ShootDto } from "../shared/api";
import { api } from "./api";

// One reactive copy of the Content Room's catalog. Reloads reconcile by id,
// so an edit only touches the rows that changed instead of rebuilding screens.

export type View = "overview" | "library" | "collections" | "uploads" | "publish";
export type Scope = { type: "all" } | { type: "shoot"; id: string } | { type: "collection"; id: string };
export type Status = "draft" | "approved" | "live" | "leaving";
export type Layout = "grid" | "sheets" | "ledger";
export type Filter = "all" | Status | "videos" | "noalt";

export const [content, setContent] = createStore<AdminContent>({ shoots: [], photos: [], collections: [], history: [] });

export const [view, setViewSignal] = createSignal<View>("overview");
export const [scope, setScopeSignal] = createSignal<Scope>({ type: "all" });
export const [focusId, setFocusId] = createSignal("");
export const [filter, setFilter] = createSignal<Filter>("all");
export const [query, setQuery] = createSignal("");
export const [layout, setLayout] = createSignal<Layout>("grid");
export const [thumb, setThumb] = createSignal(180);
export const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
export const [siteBase, setSiteBase] = createSignal("/");
export const [altStatus, setAltStatus] = createSignal<AltTextStatus>({ available: false, model: "" });
export const [altConfigured, setAltConfigured] = createSignal(false);
export const [altAuto, setAltAuto] = createSignal(false);
/** Unsaved alt text by photo id, kept while the editor moves around. */
export const [altDrafts, setAltDrafts] = createSignal<ReadonlyMap<string, string>>(new Map());
export const [toast, setToast] = createSignal<{ text: string; error: boolean } | null>(null);
export const [width, setWidth] = createSignal(window.innerWidth);

export const siteUrl = (path: string) => new URL(path, new URL(siteBase(), location.href)).href;
export const previewUrl = (shootId: string) => siteUrl(`?preview=1&shoot=${encodeURIComponent(shootId)}`);

let toastTimer = 0;
export function notice(text: string, error = false) {
  clearTimeout(toastTimer);
  setToast({ text, error });
  toastTimer = window.setTimeout(() => setToast(null), error ? 7000 : 4000);
}

export function setDraft(id: string, value: string | null) {
  const next = new Map(altDrafts());
  if (value === null) next.delete(id); else next.set(id, value);
  setAltDrafts(next);
}

export function toggleSelected(ids: string[], on?: boolean) {
  const next = new Set(selected());
  for (const id of ids) {
    if (on ?? !next.has(id)) next.add(id); else next.delete(id);
  }
  setSelected(next);
}

const derived = createRoot(() => {
  const photoById = createMemo(() => new Map(content.photos.map(photo => [photo.id, photo])));
  const shootById = createMemo(() => new Map(content.shoots.map(shoot => [shoot.id, shoot])));
  const photosByShoot = createMemo(() => {
    const groups = new Map<string, PhotoDto[]>();
    for (const photo of content.photos) {
      if (!photo.shootId) continue;
      const list = groups.get(photo.shootId);
      if (list) list.push(photo); else groups.set(photo.shootId, [photo]);
    }
    for (const list of groups.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    return groups;
  });
  // Shoots whose chosen cover is still private keep their live cover.
  const waitingCovers = createMemo(() => new Set(content.photos.filter(photo => photo.isCover && !photo.approved).map(photo => photo.shootId)));
  return { photoById, shootById, photosByShoot, waitingCovers };
});

export const photoOf = (id: string) => derived.photoById().get(id);
export const shootOf = (photo: Pick<PhotoDto, "shootId">) => photo.shootId ? derived.shootById().get(photo.shootId) : undefined;
export const photosIn = (shootId: string) => derived.photosByShoot().get(shootId) ?? [];

/** Private photographs load through the session; curated ones are public files. */
export const photoSrc = (photo: PhotoDto, width = 640) => photo.curated
  ? (width > 640 ? photo.mid : photo.thumb)
  : `/api/admin/photos/${encodeURIComponent(photo.id)}/preview${width > 640 ? `?width=${width}` : ""}`;
export const videoSrc = (photo: PhotoDto) => photo.published && photo.video.mp4 ? photo.video.mp4 : `/api/admin/videos/${encodeURIComponent(photo.id)}/preview`;

export function statusOf(photo: PhotoDto): Status {
  if (photo.published && !photo.approved) return "leaving";
  if (photo.published && shootOf(photo)?.published) return "live";
  return photo.approved ? "approved" : "draft";
}

export const shootPending = (shoot: ShootDto) => shoot.approved !== shoot.published ||
  (shoot.published && (shoot.title !== shoot.liveTitle || shoot.slug !== shoot.liveSlug || shoot.description !== shoot.liveDescription ||
    shoot.date !== shoot.liveDate || shoot.location !== shoot.liveLocation || shoot.sortOrder !== shoot.liveSortOrder));

export const collectionPending = (collection: CollectionDto) => collection.approved !== collection.published ||
  (collection.published && (collection.title !== collection.liveTitle || collection.slug !== collection.liveSlug ||
    collection.description !== collection.liveDescription || collection.sortOrder !== collection.liveSortOrder ||
    JSON.stringify(collection.photoIds) !== JSON.stringify(collection.livePhotoIds)));

export const photoPending = (photo: PhotoDto) => photo.approved !== photo.published ||
  (photo.published && (photo.alt !== photo.liveAlt || photo.shootId !== photo.liveShootId || photo.sortOrder !== photo.liveSortOrder ||
    (photo.isCover !== photo.liveIsCover && !derived.waitingCovers().has(photo.shootId))));

export const counts = createRoot(() => createMemo(() => {
  const tally = { draft: 0, approved: 0, leaving: 0, live: 0, missing: 0, pending: 0 };
  for (const photo of content.photos) {
    tally[statusOf(photo)]++;
    if (!photo.alt.trim()) tally.missing++;
    if (photoPending(photo)) tally.pending++;
  }
  tally.pending += content.shoots.filter(shootPending).length + content.collections.filter(collectionPending).length;
  return tally;
}));

export function shootStats(shoot: ShootDto) {
  const rows = photosIn(shoot.id);
  return {
    total: rows.length,
    live: rows.filter(photo => statusOf(photo) === "live").length,
    approved: rows.filter(photo => photo.approved).length,
    missing: rows.filter(photo => !photo.alt.trim()).length,
  };
}

export function coverOf(shoot: ShootDto) {
  const rows = photosIn(shoot.id);
  const cover = rows.find(photo => photo.isCover) ?? rows[0];
  return cover ? photoSrc(cover) : shoot.coverUrl;
}

/** The photographs in the library's current scope, before filters. */
export const scoped = createRoot(() => createMemo(() => {
  const current = scope();
  if (current.type === "shoot") return photosIn(current.id);
  if (current.type === "collection") {
    const collection = content.collections.find(c => c.id === current.id);
    return (collection?.photoIds ?? []).map(photoOf).filter((photo): photo is PhotoDto => !!photo);
  }
  return [...content.photos].sort((a, b) =>
    (Date.parse(shootOf(b)?.date ?? "") || 0) - (Date.parse(shootOf(a)?.date ?? "") || 0) || a.sortOrder - b.sortOrder);
}));

/** The photographs the library shows after filters and search. */
export const visible = createRoot(() => createMemo(() => {
  const kind = filter(), text = query().trim().toLowerCase();
  return scoped().filter(photo =>
    (kind === "all" || (kind === "noalt" ? !photo.alt.trim() : kind === "videos" ? photo.kind === "video" : statusOf(photo) === kind)) &&
    (!text || `${photo.alt} ${photo.title} ${photo.fileName ?? ""} ${shootOf(photo)?.title ?? ""}`.toLowerCase().includes(text)));
}));

export async function load() {
  const next = await api<AdminContent>("/content");
  batch(() => {
    setContent(reconcile(next, { key: "id", merge: false }));
    const current = scope();
    if (current.type === "shoot" && !next.shoots.some(shoot => shoot.id === current.id)) setScopeSignal({ type: "all" });
    if (current.type === "collection" && !next.collections.some(collection => collection.id === current.id)) setScopeSignal({ type: "all" });
    if (focusId() && !next.photos.some(photo => photo.id === focusId())) setFocusId("");
    setSelected(new Set([...selected()].filter(id => next.photos.some(photo => photo.id === id))));
  });
}

/** Run an edit, reload the catalog, and report the outcome. */
export async function change(action: () => Promise<unknown>, message: string | (() => string) = "Saved") {
  try {
    await action();
    await load();
    notice(typeof message === "function" ? message() : message);
    return true;
  } catch (error) {
    await load().catch(() => undefined);
    notice((error as Error).message, true);
    return false;
  }
}

export function setView(next: View) {
  setViewSignal(next);
  window.scrollTo(0, 0);
}

export function openScope(next: Scope) {
  batch(() => {
    setScopeSignal(next);
    setFocusId("");
    setSelected(new Set<string>());
    setFilter("all");
    setQuery("");
    setViewSignal("library");
  });
  window.scrollTo(0, 0);
}
