import { For, Match, Show, Switch, batch, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { PhotoDto } from "../shared/api";
import { api } from "./api";
import { reorderCollection, reorderShoot, saveAlt, setApproval } from "./actions";
import Inspector from "./Inspector";
import {
  altDrafts, change, content, coverOf, filter, focusId, layout, openScope, photoSrc, photosIn, previewUrl,
  query, scope, scoped, selected, setDraft, setFilter, setFocusId, setLayout, setQuery, setSelected, setThumb, setView,
  shootOf, shootStats, statusOf, thumb, toggleSelected, visible, width,
} from "./store";
import type { Filter, Layout } from "./store";
import { dateLabel, frameCount, isTyping, ordered, pad2, runtime } from "./util";

const FILTERS: [Filter, string][] = [["all", "All"], ["draft", "Drafts"], ["approved", "Approved"], ["live", "Live"], ["leaving", "Leaving"], ["videos", "Videos"], ["noalt", "No alt text"]];
const LAYOUTS: Layout[] = ["grid", "sheets", "ledger"];

interface LibraryProps {
  onAltPass(ids: string[]): void;
  onCreate(kind: "shoot" | "collection"): void;
  onEditShoot(id: string): void;
  onHelp(): void;
}

export default function Library(props: LibraryProps) {
  let search: HTMLInputElement | undefined;
  const narrow = () => width() < 900;
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const [dragging, setDragging] = createSignal("");
  const [over, setOver] = createSignal("");
  let lastClicked = "";

  const shoot = createMemo(() => { const s = scope(); return s.type === "shoot" ? content.shoots.find(x => x.id === s.id) : undefined; });
  const collection = createMemo(() => { const s = scope(); return s.type === "collection" ? content.collections.find(x => x.id === s.id) : undefined; });
  // The inspector follows a focused photograph; on wide screens it starts on the first.
  const focused = createMemo(() => {
    const rows = visible(), id = focusId();
    return rows.find(photo => photo.id === id) ?? (narrow() ? undefined : rows[0]);
  });
  const columns = () => narrow() ? (thumb() < 155 ? 3 : 2) : width() >= 1450 ? (thumb() < 155 ? 4 : thumb() > 230 ? 2 : 3) : (thumb() < 155 ? 3 : thumb() > 230 ? 1 : 2);
  const tally = (key: Filter) => key === "all" ? scoped().length : key === "noalt" ? scoped().filter(p => !p.alt.trim()).length :
    key === "videos" ? scoped().filter(p => p.kind === "video").length : scoped().filter(p => statusOf(p) === key).length;

  function focus(id: string, openSheet = true) {
    setFocusId(id);
    lastClicked = id;
    if (narrow() && openSheet) setSheetOpen(true);
  }
  function step(delta: number) {
    const rows = visible();
    if (!rows.length) return;
    const index = rows.findIndex(photo => photo.id === focused()?.id);
    const next = rows[Math.max(0, Math.min(rows.length - 1, index < 0 ? 0 : index + delta))];
    setFocusId(next.id);
    lastClicked = next.id;
    queueMicrotask(() => document.querySelector(`[data-photo-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: "nearest" }));
  }
  function clickTile(photo: PhotoDto, event: MouseEvent) {
    if (event.shiftKey && lastClicked) {
      const ids = visible().map(p => p.id), a = ids.indexOf(lastClicked), b = ids.indexOf(photo.id);
      if (a > -1 && b > -1) { toggleSelected(ids.slice(Math.min(a, b), Math.max(a, b) + 1), true); setFocusId(photo.id); return; }
    }
    if (event.metaKey || event.ctrlKey) { toggleSelected([photo.id]); lastClicked = photo.id; return; }
    focus(photo.id);
  }

  // ---- Drag to set a shoot's sequence or a collection's order ------------------
  const canDrag = () => scope().type !== "all";
  function drop(targetId: string) {
    const from = dragging();
    batch(() => { setDragging(""); setOver(""); });
    if (!from || from === targetId) return;
    const s = scope();
    if (s.type === "collection") void reorderCollection(s.id, from, targetId);
    else if (s.type === "shoot") void reorderShoot(s.id, from, targetId);
  }
  const dragProps = (photo: PhotoDto) => ({
    draggable: canDrag(),
    onDragStart: (event: DragEvent) => { event.dataTransfer?.setData("text/plain", photo.id); setDragging(photo.id); },
    onDragOver: (event: DragEvent) => { if (dragging() && dragging() !== photo.id) { event.preventDefault(); setOver(photo.id); } },
    onDragLeave: () => { if (over() === photo.id) setOver(""); },
    onDrop: (event: DragEvent) => { event.preventDefault(); drop(photo.id); },
    onDragEnd: () => batch(() => { setDragging(""); setOver(""); }),
  });

  // ---- Keyboard ------------------------------------------------------------------
  function onKey(event: KeyboardEvent) {
    if (document.querySelector("dialog[open], .pass")) return;
    if (event.key === "Escape") {
      if (isTyping(event.target)) { (event.target as HTMLElement).blur(); return; }
      if (sheetOpen()) { setSheetOpen(false); return; }
      if (selected().size) { setSelected(new Set<string>()); return; }
      return;
    }
    if (isTyping(event.target) || event.altKey) return;
    const key = event.key.toLowerCase();
    const targets = selected().size ? [...selected()] : focused() ? [focused()!.id] : [];
    if ((event.metaKey || event.ctrlKey) && key === "a") { event.preventDefault(); toggleSelected(visible().map(p => p.id), true); return; }
    if (event.metaKey || event.ctrlKey) return;
    if (["arrowright", "arrowdown", "j"].includes(key)) { event.preventDefault(); step(1); }
    else if (["arrowleft", "arrowup", "k"].includes(key)) { event.preventDefault(); step(-1); }
    else if (key === "x" && focused()) toggleSelected([focused()!.id]);
    else if (key === "p" && targets.length) void setApproval(targets, true);
    else if (key === "d" && targets.length) void setApproval(targets, false);
    else if (key === "a") props.onAltPass(selected().size ? [...selected()] : visible().filter(p => !p.alt.trim()).map(p => p.id));
    else if (key === "t") { const id = shoot()?.id ?? focused()?.shootId; if (id) window.open(previewUrl(id), "_blank", "noopener"); }
    else if (key === "/") { event.preventDefault(); search?.focus(); }
    else if (key === "1" || key === "2" || key === "3") setLayout(LAYOUTS[Number(key) - 1]);
    else if (key === "enter" && focused()) setSheetOpen(true);
  }
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  const frameOf = (photo: PhotoDto, index: number) => pad2(scope().type === "collection" ? index + 1 : photosIn(photo.shootId ?? "").indexOf(photo) + 1);

  const Tile = (p: { photo: PhotoDto; index: number }) => {
    const status = () => statusOf(p.photo);
    const isSelected = () => selected().has(p.photo.id);
    return <article class="photo-tile" classList={{ focused: focused()?.id === p.photo.id, selected: isSelected(), dragging: dragging() === p.photo.id, over: over() === p.photo.id }}
      data-photo-id={p.photo.id} tabIndex={0} aria-label={`Edit ${p.photo.alt || "photograph"}`}
      onClick={event => clickTile(p.photo, event)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focus(p.photo.id); } }}
      {...dragProps(p.photo)}>
      <div class="tile-image">
        <img src={photoSrc(p.photo)} alt={p.photo.alt || "Undescribed photograph"} loading="lazy" decoding="async" draggable={false} />
        <button type="button" class="tile-select" classList={{ checked: isSelected() }} aria-label="Select photograph" aria-pressed={isSelected()}
          onClick={event => { event.stopPropagation(); toggleSelected([p.photo.id]); lastClicked = p.photo.id; }}>{isSelected() ? "✓" : ""}</button>
        <Show when={p.photo.isCover}><span class="cover-tag">COVER</span></Show>
        <Show when={p.photo.kind === "video"}><span class="video-tag">▶ {runtime(p.photo.duration)}</span></Show>
      </div>
      <div class="tile-meta">
        <span>{frameOf(p.photo, p.index)}</span>
        <span class={`state ${status()}`}><i />{status().toUpperCase()}</span>
        <Show when={!p.photo.alt.trim()}><span class="no-alt">{p.photo.altSuggestion ? "SUGGESTED" : "NO ALT"}</span></Show>
      </div>
    </article>;
  };

  const Ledger = () => <>
    <div class="ledger-head"><span /><span>FRAME</span><span>ALT TEXT</span><span>SHOOT</span><span>STATUS</span></div>
    <For each={visible()}>{(photo, index) => {
      const isSelected = () => selected().has(photo.id);
      return <div class="ledger-row" classList={{ focused: focused()?.id === photo.id, selected: isSelected(), over: over() === photo.id }}
        data-photo-id={photo.id} onClick={event => { if (!(event.target as Element).closest("input, button")) clickTile(photo, event); }} {...dragProps(photo)}>
        <button type="button" class="ledger-check" classList={{ checked: isSelected() }} aria-label="Select photograph" aria-pressed={isSelected()}
          onClick={() => toggleSelected([photo.id])}>{isSelected() ? "✓" : ""}</button>
        <span class="ledger-frame"><img src={photoSrc(photo)} alt="" loading="lazy" decoding="async" draggable={false} />
          <span>{frameOf(photo, index())}<Show when={photo.kind === "video"}><b>▶ {runtime(photo.duration)}</b></Show></span></span>
        <input class="ledger-alt" classList={{ missing: !photo.alt.trim() }} value={altDrafts().get(photo.id) ?? photo.alt} maxlength="400"
          placeholder={photo.altSuggestion ? `Suggested: ${photo.altSuggestion}` : photo.kind === "video" ? "Describe what happens in the clip…" : "Describe what is in the frame…"}
          aria-label={`Alt text for frame ${index() + 1}`}
          onInput={event => setDraft(photo.id, event.currentTarget.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
          onChange={event => void saveAlt(photo.id, event.currentTarget.value)} />
        <span class="ledger-shoot">{shootOf(photo)?.title ?? ""}</span>
        <span class={`state ${statusOf(photo)}`}><i />{statusOf(photo).toUpperCase()}</span>
      </div>;
    }}</For>
  </>;

  const Sheets = () => {
    const groups = () => {
      const map = new Map<string, PhotoDto[]>();
      for (const photo of visible()) { const key = photo.shootId ?? ""; const list = map.get(key); if (list) list.push(photo); else map.set(key, [photo]); }
      return [...map.entries()];
    };
    return <For each={groups()}>{([id, list]) => {
      const sh = content.shoots.find(s => s.id === id);
      return <section class="contact-sheet">
        <header><button type="button" onClick={() => openScope({ type: "shoot", id })}>{sh?.title ?? "Archive"}</button><span>{dateLabel(sh?.date)} · {frameCount(list.length)}</span></header>
        <div class="contact-grid"><For each={list}>{(photo, index) => <Tile photo={photo} index={index()} />}</For></div>
      </section>;
    }}</For>;
  };

  return <div class="library">
    <Show when={!narrow()}>
      <aside class="library-rail">
        <button type="button" class="rail-all" classList={{ active: scope().type === "all" }} onClick={() => openScope({ type: "all" })}>All photographs <span>{content.photos.length}</span></button>
        <div class="rail-heading"><span>SHOOTS</span><button type="button" onClick={() => props.onCreate("shoot")}>+ New</button></div>
        <For each={ordered(content.shoots)}>{sh => {
          const stats = () => shootStats(sh);
          return <button type="button" class="rail-item" classList={{ active: scope().type === "shoot" && shoot()?.id === sh.id }} onClick={() => openScope({ type: "shoot", id: sh.id })}>
            <img src={coverOf(sh)} alt="" loading="lazy" decoding="async" />
            <span><strong>{sh.title}</strong><small>{dateLabel(sh.date).slice(0, 6)}　{stats().live}/{stats().total}
              <Show when={stats().missing}>　<em>{stats().missing} alt</em></Show><Show when={!sh.approved}>　HIDDEN</Show></small></span>
          </button>;
        }}</For>
        <div class="rail-heading"><span>COLLECTIONS</span><button type="button" onClick={() => setView("collections")}>Edit</button></div>
        <For each={content.collections}>{col =>
          <button type="button" class="rail-collection" classList={{ active: collection()?.id === col.id }} onClick={() => openScope({ type: "collection", id: col.id })}>
            {col.title}<span>{col.photoIds.length}</span></button>}</For>
        <button type="button" class="rail-help" onClick={() => props.onHelp()}>? KEYBOARD SHORTCUTS</button>
      </aside>
    </Show>
    <main class="library-main">
      <Show when={narrow()}>
        <div class="scope-chips">
          <button type="button" classList={{ on: scope().type === "all" }} onClick={() => openScope({ type: "all" })}>All</button>
          <For each={ordered(content.shoots)}>{sh => <button type="button" classList={{ on: shoot()?.id === sh.id }} onClick={() => openScope({ type: "shoot", id: sh.id })}>{sh.title}</button>}</For>
        </div>
      </Show>
      <div class="library-head">
        <div class="library-identity">
          <Show when={shoot()}><img class="library-cover" src={coverOf(shoot()!)} alt="" /></Show>
          <div>
            <div class="eyebrow">{shoot() ? `SHOOT · ${dateLabel(shoot()!.date)} · ${frameCount(photosIn(shoot()!.id).length)} · ${shoot()!.published ? "ON THE TABLE" : "NOT ON THE TABLE"}${shoot()!.approved !== shoot()!.published ? " · CHANGE QUEUED" : ""}`
              : collection() ? `COLLECTION · ${frameCount(collection()!.photoIds.length)}` : `LIBRARY · ${frameCount(content.photos.length)} · ${content.shoots.length} SHOOTS`}</div>
            <h1>{shoot()?.title ?? collection()?.title ?? "All photographs"}</h1>
            <Show when={shoot()?.description || collection()?.description}><p>{shoot()?.description || collection()?.description}</p></Show>
          </div>
        </div>
        <div class="library-head-actions">
          <Show when={shoot()}>{sh => <>
            <Show when={sh().curated}><span class="curated-tag">CURATED · ARCHIVE.JSON</span></Show>
            <div class="seg" role="group" aria-label="Shoot visibility">
              <button type="button" classList={{ on: sh().approved }} aria-pressed={sh().approved} onClick={() => change(() => api(`/shoots/${encodeURIComponent(sh().id)}`, { method: "PATCH", body: { approved: true } }), `${sh().title} will appear on the table after you publish`)}>On site</button>
              <button type="button" classList={{ on: !sh().approved }} aria-pressed={!sh().approved} onClick={() => change(() => api(`/shoots/${encodeURIComponent(sh().id)}`, { method: "PATCH", body: { approved: false } }), `${sh().title} will be hidden after you publish`)}>Hidden</button>
            </div>
            <button type="button" onClick={() => props.onEditShoot(sh().id)}>Edit details</button>
            <a href={previewUrl(sh().id)} target="_blank" rel="noopener">Preview on table</a>
          </>}</Show>
          <button type="button" classList={{ "pass-button": true, warn: scoped().some(p => !p.alt.trim()) }}
            onClick={() => props.onAltPass(scoped().filter(p => !p.alt.trim()).map(p => p.id))}>Alt-text pass · {scoped().filter(p => !p.alt.trim()).length}</button>
          <Show when={shoot() && !shoot()!.curated}><button type="button" class="primary" onClick={() => setView("uploads")}>Upload</button></Show>
        </div>
      </div>
      <Show when={shoot() && !shoot()!.approved}>
        <div class="hidden-banner">{shoot()!.published ? "This shoot will leave the table after you publish." : "This shoot is hidden from the site. Approve the photos you want, then show the shoot."}
          <button type="button" onClick={() => change(() => api(`/shoots/${encodeURIComponent(shoot()!.id)}`, { method: "PATCH", body: { approved: true } }), "Shoot will appear after you publish")}>
            {shoot()!.published ? "Keep shoot on site" : "Show shoot on site"}</button>
        </div>
      </Show>
      <Show when={shoot()?.approved && scoped().some(p => statusOf(p) === "approved")}>
        <div class="hidden-banner waiting">{scoped().filter(p => statusOf(p) === "approved").length} approved {scoped().filter(p => statusOf(p) === "approved").length === 1 ? "photo is" : "photos are"} waiting for the next publish.
          <button type="button" onClick={() => setView("publish")}>Review and publish</button></div>
      </Show>
      <div class="library-toolbar">
        <div class="filters">
          <For each={FILTERS.filter(([key]) => (key !== "leaving" && key !== "videos") || tally(key))}>{([key, label]) =>
            <button type="button" classList={{ active: filter() === key, warn: (key === "noalt" || key === "leaving") && !!tally(key) }}
              onClick={() => { setFilter(key); setSelected(new Set<string>()); }}>{label} <span>{tally(key)}</span></button>}</For>
        </div>
        <input ref={search} id="library-search" type="search" placeholder="Search alt text or file  /" value={query()} aria-label="Search photographs"
          onInput={event => setQuery(event.currentTarget.value)} />
        <div class="layout-actions">
          <Show when={layout() === "grid"}>
            <label class="thumb-range">Size <input type="range" min="120" max="280" value={thumb()} onInput={event => setThumb(Number(event.currentTarget.value))} /></label>
          </Show>
          <For each={LAYOUTS}>{key => <button type="button" classList={{ active: layout() === key }} onClick={() => setLayout(key)}>{key[0].toUpperCase() + key.slice(1)}</button>}</For>
          <button type="button" class="select-all" onClick={() => selected().size ? setSelected(new Set<string>()) : toggleSelected(visible().map(p => p.id), true)}>
            {selected().size ? "Clear selection" : "Select all"}</button>
        </div>
      </div>
      <div class="library-instructions">{scope().type === "collection"
        ? "DRAG TO REORDER THE COLLECTION · CLICK TO EDIT · SHIFT-CLICK TO SELECT A RANGE · ? FOR SHORTCUTS"
        : `DRAFT → APPROVED → LIVE · ${scope().type === "shoot" ? "DRAG TO SET THE SEQUENCE · " : ""}SHIFT-CLICK FOR A RANGE · P APPROVE · D DRAFT · A ALT-TEXT PASS · ? FOR ALL`}</div>
      <div class={`gallery ${layout()}`} data-columns={columns()}>
        <Show when={visible().length} fallback={<p class="empty-copy">{filter() === "noalt" ? "Every photo here has alt text." : query() ? `No photos match “${query()}”.` : "No photos here yet. Upload some or add them from the library."}</p>}>
          <Switch>
            <Match when={layout() === "grid"}><For each={visible()}>{(photo, index) => <Tile photo={photo} index={index()} />}</For></Match>
            <Match when={layout() === "sheets"}><Sheets /></Match>
            <Match when={layout() === "ledger"}><Ledger /></Match>
          </Switch>
        </Show>
      </div>
    </main>
    <Show when={!narrow() || sheetOpen()}>
      <Show when={narrow()}><div class="sheet-scrim" onClick={() => setSheetOpen(false)} /></Show>
      <Inspector photo={focused()} rows={visible()} narrow={narrow()} onStep={step}
        onClose={() => { setSheetOpen(false); const id = focused()?.id; if (id) queueMicrotask(() => document.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(id)}"]`)?.focus()); }} />
    </Show>
  </div>;
}

