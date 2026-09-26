import { For, Show, createMemo, createSignal } from "solid-js";
import type { PhotoDto } from "../shared/api";
import { api } from "./api";
import { reorderCollection, toggleInCollection } from "./actions";
import { change, content, openScope, photoOf, photoSrc, scope, setScopeSignal, shootOf } from "./store";
import { ordered, pad2, photoCount, runtime } from "./util";

export default function Collections(props: { onCreate(): void }) {
  const [addShoot, setAddShoot] = createSignal("all");
  const [addQuery, setAddQuery] = createSignal("");
  const [dragging, setDragging] = createSignal("");
  const current = createMemo(() => {
    const s = scope();
    return (s.type === "collection" && content.collections.find(c => c.id === s.id)) || content.collections[0];
  });
  const members = () => (current()?.photoIds ?? []).map(photoOf).filter((photo): photo is PhotoDto => !!photo);
  const pool = createMemo(() => {
    const text = addQuery().trim().toLowerCase();
    return content.photos.filter(photo => (addShoot() === "all" || photo.shootId === addShoot()) &&
      (!text || `${photo.alt} ${shootOf(photo)?.title ?? ""}`.toLowerCase().includes(text))).slice(0, 150);
  });
  const edit = (field: "title" | "description", value: string) => {
    const collection = current();
    if (!collection || value === collection[field] || (field === "title" && !value)) return;
    void change(() => api(`/collections/${encodeURIComponent(collection.id)}`, { method: "PATCH", body: { [field]: value } }),
      `Collection ${field === "title" ? "title" : "description"} saved`);
  };
  const move = (id: string, delta: number) => {
    const ids = current()?.photoIds ?? [], index = ids.indexOf(id), target = ids[index + delta];
    if (current() && target) void reorderCollection(current()!.id, id, target)?.then(() =>
      document.querySelector<HTMLElement>(`[data-member="${CSS.escape(id)}"]`)?.focus());
  };

  return <div class="collections-page">
    <aside class="collection-list">
      <div class="collection-list-head"><h2>Collections</h2><button type="button" onClick={() => props.onCreate()}>+ New</button></div>
      <For each={content.collections} fallback={<p class="empty-copy">No collections yet.</p>}>{collection =>
        <button type="button" classList={{ active: current()?.id === collection.id }} onClick={() => setScopeSignal({ type: "collection", id: collection.id })}>
          <span class="mosaic"><For each={collection.photoIds.slice(0, 4).map(photoOf).filter((p): p is PhotoDto => !!p)}>{photo => <img src={photoSrc(photo)} alt="" loading="lazy" />}</For></span>
          <span><strong>{collection.title}</strong><small>{collection.photoIds.length} PHOTOS · {collection.approved ? "PUBLISHED" : "DRAFT"}</small></span>
        </button>}</For>
    </aside>
    <Show when={current()} fallback={<main class="collection-editor"><p class="empty-copy">Create a collection to group photographs from any shoot.</p></main>}>
      {collection => <>
        <main class="collection-editor">
          <div class="collection-editor-head">
            <div class="collection-fields">
              <div class="eyebrow">COLLECTION · {photoCount(members().length).toUpperCase()} · ACROSS {new Set(members().map(p => p.shootId)).size} SHOOTS{collection().approved !== collection().published ? " · CHANGE QUEUED" : ""}</div>
              <input class="collection-title" value={collection().title} maxlength="140" aria-label="Collection title"
                onChange={event => edit("title", event.currentTarget.value.trim())}
                onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
              <input class="collection-desc" value={collection().description} maxlength="3000" placeholder="Add a short description" aria-label="Collection description"
                onChange={event => edit("description", event.currentTarget.value.trim())}
                onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            </div>
            <div class="collection-actions">
              <div class="seg" role="group" aria-label="Collection visibility">
                <For each={[true, false]}>{on =>
                  <button type="button" classList={{ on: collection().approved === on }} aria-pressed={collection().approved === on}
                    onClick={() => change(() => api(`/collections/${encodeURIComponent(collection().id)}`, { method: "PATCH", body: { approved: on } }), on ? "Collection will publish" : "Collection moved to draft")}>
                    {on ? "Published" : "Draft"}</button>}</For>
              </div>
              <button type="button" onClick={() => openScope({ type: "collection", id: collection().id })}>Open in library</button>
              <Show when={!collection().published}>
                <button type="button" class="danger-link" onClick={() => { if (confirm(`Delete ${collection().title}?`)) void change(() => api(`/collections/${encodeURIComponent(collection().id)}`, { method: "DELETE" }), "Collection deleted"); }}>Delete</button>
              </Show>
            </div>
          </div>
          <div class="eyebrow collection-hint">DRAG OR ALT + ← → TO SET THE ORDER · DRAFT PHOTOS STAY HIDDEN UNTIL PUBLISHED</div>
          <div class="collection-members">
            <For each={members()} fallback={<p class="empty-copy">No photos yet. Add some from the panel on the right.</p>}>{(photo, index) =>
              <div class="member" classList={{ dragging: dragging() === photo.id }} draggable={true} tabIndex={0} data-member={photo.id}
                aria-label={`${photo.alt || "Untitled frame"}, position ${index() + 1}. Alt plus arrow keys reorder.`}
                onDragStart={() => setDragging(photo.id)} onDragEnd={() => setDragging("")}
                onDragOver={event => { if (dragging() && dragging() !== photo.id) event.preventDefault(); }}
                onDrop={event => { event.preventDefault(); const from = dragging(); setDragging(""); if (from && from !== photo.id) void reorderCollection(collection().id, from, photo.id); }}
                onKeyDown={event => { if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); move(photo.id, event.key === "ArrowLeft" ? -1 : 1); } }}>
                <span class="member-image">
                  <img src={photoSrc(photo)} alt="" loading="lazy" classList={{ dim: !photo.approved }} draggable={false} />
                  <Show when={photo.kind === "video"}><span class="video-tag">▶ {runtime(photo.duration)}</span></Show>
                </span>
                <button type="button" class="member-remove" aria-label="Remove from collection" onClick={() => toggleInCollection(collection().id, photo.id)}>×</button>
                <span class="member-meta"><span>{pad2(index() + 1)}</span><span>{shootOf(photo)?.title ?? ""}</span><Show when={!photo.approved}><b>DRAFT</b></Show></span>
              </div>}</For>
          </div>
        </main>
        <aside class="collection-add">
          <h3>Add photos</h3>
          <select aria-label="Filter by shoot" value={addShoot()} onChange={event => setAddShoot(event.currentTarget.value)}>
            <option value="all">All shoots</option>
            <For each={ordered(content.shoots)}>{shoot => <option value={shoot.id}>{shoot.title}</option>}</For>
          </select>
          <input type="search" placeholder="Search alt text" aria-label="Search photographs to add" value={addQuery()} onInput={event => setAddQuery(event.currentTarget.value)} />
          <div class="add-grid">
            <For each={pool()} fallback={<p class="empty-copy">No photographs match.</p>}>{photo => {
              const on = () => collection().photoIds.includes(photo.id);
              return <button type="button" classList={{ on: on() }} aria-pressed={on()} aria-label={`${on() ? "Remove" : "Add"} ${photo.alt || "untitled frame"}`}
                onClick={() => toggleInCollection(collection().id, photo.id)}>
                <img src={photoSrc(photo)} alt="" loading="lazy" /><span aria-hidden="true">{on() ? "✓" : "+"}</span>
              </button>;
            }}</For>
          </div>
        </aside>
      </>}
    </Show>
  </div>;
}
