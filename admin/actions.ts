import { ApiError, api } from "./api";
import { altDrafts, change, content, load, notice, photoOf, photosIn, setAltStatus, setDraft } from "./store";
import { photoCount } from "./util";

export const photoPath = (id: string) => `/photos/${encodeURIComponent(id)}`;

/** Approve or return photographs to draft; ones without alt text are reported, not sent. */
export async function setApproval(ids: string[], approved: boolean) {
  const targets = ids.map(photoOf).filter(photo => photo && photo.approved !== approved);
  if (!targets.length) { notice("Nothing to change"); return { missing: [] as string[] }; }
  const missing = approved ? targets.filter(photo => !(altDrafts().get(photo!.id) ?? photo!.alt).trim()) : [];
  const ready = targets.filter(photo => !missing.includes(photo));
  const leaving = approved ? 0 : ready.filter(photo => photo!.published).length;
  if (ready.length) {
    await change(async () => {
      for (const photo of ready) {
        const draft = altDrafts().get(photo!.id);
        await api(photoPath(photo!.id), { method: "PATCH", body: draft === undefined ? { approved } : { approved, alt: draft.trim() } });
        if (draft !== undefined) setDraft(photo!.id, null);
      }
    }, () => photoCount(ready.length) + (approved ? " approved · live after you publish" : " back to draft") +
      (leaving ? ` · ${leaving} will come off the site` : "") + (missing.length ? ` · ${missing.length} need alt text first` : ""));
  } else notice(`${photoCount(missing.length)} need alt text before approval`, true);
  return { missing: missing.map(photo => photo!.id) };
}

export async function saveAlt(id: string, text: string) {
  const photo = photoOf(id);
  if (!photo) return false;
  const alt = text.trim();
  if (alt === photo.alt) { setDraft(id, null); return true; }
  const saved = await change(() => api(photoPath(id), { method: "PATCH", body: { alt } }), "Alt text saved");
  if (saved) setDraft(id, null);
  return saved;
}

export const toggleInCollection = (collectionId: string, photoId: string) => {
  const collection = content.collections.find(c => c.id === collectionId);
  const inIt = !!collection?.photoIds.includes(photoId);
  return change(() => api(`/collections/${encodeURIComponent(collectionId)}/photos/${encodeURIComponent(photoId)}`,
    inIt ? { method: "DELETE" } : { method: "PUT", body: { sortOrder: collection?.photoIds.length ?? 0 } }),
  inIt ? `Removed from ${collection?.title}` : `Added to ${collection?.title}`);
};

export async function addToCollection(collectionId: string, ids: string[]) {
  const collection = content.collections.find(c => c.id === collectionId);
  if (!collection) return;
  const add = ids.filter(id => !collection.photoIds.includes(id));
  await change(async () => {
    let order = collection.photoIds.length;
    for (const id of add) await api(`/collections/${encodeURIComponent(collectionId)}/photos/${encodeURIComponent(id)}`, { method: "PUT", body: { sortOrder: order++ } });
  }, add.length ? `${photoCount(add.length)} added to ${collection.title}` : `Already in ${collection.title}`);
}

const move = (ids: string[], from: string, to: string) => {
  const next = [...ids], a = next.indexOf(from), b = next.indexOf(to);
  if (a < 0 || b < 0 || a === b) return null;
  next.splice(a, 1);
  next.splice(b, 0, from);
  return next;
};

export function reorderShoot(shootId: string, from: string, to: string) {
  const ids = move(photosIn(shootId).map(photo => photo.id), from, to);
  if (ids) return change(() => api(`/shoots/${encodeURIComponent(shootId)}/order`, { method: "PUT", body: { photoIds: ids } }), "Sequence updated · live after you publish");
}

export function reorderCollection(collectionId: string, from: string, to: string) {
  const collection = content.collections.find(c => c.id === collectionId);
  const ids = collection && move([...collection.photoIds], from, to);
  if (ids) return change(() => api(`/collections/${encodeURIComponent(collectionId)}/order`, { method: "PUT", body: { photoIds: ids } }), "Collection order updated");
}

/**
 * Ask the local vision model for a draft description. The draft is stored
 * as a suggestion only; nothing becomes alt text until the editor saves it.
 */
export async function suggestAlt(id: string, fresh = false) {
  try {
    const { suggestion } = await api<{ suggestion: string }>(`${photoPath(id)}/alt-suggestion`, { method: "POST", body: { fresh } });
    await load();
    return suggestion;
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) setAltStatus(status => ({ ...status, available: false }));
    throw error;
  }
}

export async function refreshAltStatus() {
  try { setAltStatus(await api("/alt-text")); } catch { setAltStatus({ available: false, model: "" }); }
}
