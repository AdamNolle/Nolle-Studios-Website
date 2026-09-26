import { For, Match, Show, Switch, batch, createEffect, createSignal, lazy, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { AdminConfig, ShootDto } from "../shared/api";
import { addToCollection, refreshAltStatus, setApproval } from "./actions";
import { api, endSession, setSignInNote, signInNote, signedIn, startSession } from "./api";
import Library from "./Library";
import Overview from "./Overview";
import Uploads, { uploading } from "./Uploads";
import {
  altAuto, altDrafts, altStatus, change, content, counts, load, notice, openScope, photoOf, selected,
  setAltAuto, setAltConfigured, setAltDrafts, setScopeSignal, setSelected, setSiteBase, setView, setWidth, siteUrl, toast, view,
} from "./store";
import type { View } from "./store";
import { isTyping } from "./util";

// Screens used less often load on first visit.
const Collections = lazy(() => import("./Collections"));
const Publish = lazy(() => import("./Publish"));
const AltPass = lazy(() => import("./AltPass"));

const NAV: [View, string][] = [["overview", "Overview"], ["library", "Library"], ["collections", "Collections"], ["uploads", "Uploads"], ["publish", "Publish"]];
const SHORTCUTS: [string[], string][] = [
  [["←", "→", "J", "K"], "Move between photos"], [["X"], "Select or deselect"], [["Shift-click"], "Select a range"],
  [["⌘A"], "Select all in view"], [["P"], "Approve for site"], [["D"], "Back to draft"], [["A"], "Alt-text pass"],
  [["T"], "Preview shoot on the table"], [["/"], "Search"], [["1", "2", "3"], "Grid, Sheets, Ledger"],
  [["⌘↵"], "Save alt text and go to the next photo"], [["Esc"], "Close or clear"],
];
const CONTACT = ["september-20/full-swing", "september-19/white-rose", "first-frames/portrait-in-grass", "september-20/team-walk"];

/** A native modal dialog that opens on mount and reports every way it closes. */
function Modal(props: { class?: string; labelledby: string; onClose(): void; children: JSX.Element }) {
  let dialog!: HTMLDialogElement;
  onMount(() => dialog.showModal());
  return <dialog ref={dialog} class={`edit-dialog ${props.class ?? ""}`} aria-labelledby={props.labelledby} onClose={() => props.onClose()}>
    {props.children}
  </dialog>;
}

function SignIn() {
  const [busy, setBusy] = createSignal(false);
  async function submit(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault();
    const form = event.currentTarget, password = (form.elements.namedItem("password") as HTMLInputElement).value;
    setBusy(true);
    setSignInNote("Signing in…");
    try {
      const { csrfToken } = await api<{ csrfToken: string }>("/login", { method: "POST", body: { password } });
      form.reset();
      await start(csrfToken);
    } catch (error) { setSignInNote((error as Error).message); }
    finally { setBusy(false); }
  }
  return <main class="login">
    <div class="login-card">
      <div class="login-content">
        <img class="login-logo" src="/nolle-studios-mark.svg" alt="Nolle Studios" width="96" height="96" />
        <div class="eyebrow">CONTENT ROOM / PRIVATE</div>
        <h1>Content room</h1>
        <p>Manage shoots, photos, and collections.</p>
        <form onSubmit={submit}>
          <label for="password">Password</label>
          <input id="password" type="password" name="password" autocomplete="current-password" required autofocus />
          <button class="primary" type="submit" disabled={busy()}>Sign in</button>
        </form>
        <p class="message" role="status" aria-live="polite">{signInNote()}</p>
      </div>
      <div class="login-contact" aria-hidden="true">
        <For each={CONTACT}>{name => <img src={`/media/${name}-640.webp`} alt="" decoding="async" />}</For>
      </div>
    </div>
  </main>;
}

async function start(token: string) {
  startSession(token);
  const [config] = await Promise.all([api<AdminConfig>("/config").catch(() => null), load()]);
  if (config) batch(() => {
    setSiteBase(config.siteUrl || "/");
    setAltConfigured(config.altText.configured);
    setAltAuto(config.altText.auto);
  });
  if (config?.altText.configured) void refreshAltStatus();
}

function CreateDialog(props: { kind: "shoot" | "collection"; onClose(): void }) {
  const [error, setError] = createSignal("");
  let form!: HTMLFormElement;
  const close = () => (form.closest("dialog") as HTMLDialogElement).close();
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const title = (form.elements.namedItem("title") as HTMLInputElement).value.trim();
    if (!title) return;
    try {
      const { id } = await api<{ id: string }>(props.kind === "shoot" ? "/shoots" : "/collections", { method: "POST", body: { title } });
      await load();
      if (props.kind === "shoot") openScope({ type: "shoot", id });
      else { setScopeSignal({ type: "collection", id }); setView("collections"); }
      notice(`${props.kind === "shoot" ? "Shoot" : "Collection"} created`);
      close();
    } catch (failure) { setError((failure as Error).message); }
  }
  return <Modal labelledby="create-title" onClose={props.onClose}>
    <form ref={form} onSubmit={submit}>
      <div class="eyebrow">NEW ARCHIVE ITEM</div>
      <h2 id="create-title">{props.kind === "shoot" ? "New shoot" : "New collection"}</h2>
      <p>{props.kind === "shoot" ? "A shoot holds the photographs from one day. It stays private until you publish it." : "A collection groups photographs from any shoot."}</p>
      <label for="create-name">Name</label>
      <input id="create-name" name="title" maxlength="140" required autocomplete="off" autofocus />
      <p class="message" role="status">{error()}</p>
      <div class="dialog-actions"><button type="button" onClick={close}>Cancel</button><button class="primary" type="submit">Create</button></div>
    </form>
  </Modal>;
}

function ShootDialog(props: { shoot: ShootDto; onClose(): void }) {
  let form!: HTMLFormElement;
  const close = () => (form.closest("dialog") as HTMLDialogElement).close();
  const path = () => `/shoots/${encodeURIComponent(props.shoot.id)}`;
  function submit(event: SubmitEvent) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const body = { ...values, sortOrder: Number(values.sortOrder) || 0 };
    void change(() => api(path(), { method: "PATCH", body }), "Shoot details saved").then(saved => { if (saved) close(); });
  }
  function remove() {
    if (!confirm(`Permanently delete ${props.shoot.title}? It has no photographs.`)) return;
    void change(async () => {
      await api(path(), { method: "DELETE" });
      openScope({ type: "all" });
      close();
    }, "Shoot deleted");
  }
  return <Modal labelledby="item-title" onClose={props.onClose}>
    <form ref={form} onSubmit={submit}>
      <div class="eyebrow">SHOOT DETAILS</div>
      <h2 id="item-title">{props.shoot.title}</h2>
      <label>Title<input name="title" value={props.shoot.title} required maxlength="140" /></label>
      <label>Shot date<input name="date" type="date" value={props.shoot.date} /></label>
      <label>Location<input name="location" value={props.shoot.location} maxlength="140" /></label>
      <label>Archive notes<textarea name="description" maxlength="3000" rows="4" value={props.shoot.description} /></label>
      <label>Display order<input name="sortOrder" type="number" value={props.shoot.sortOrder} /></label>
      <Show when={props.shoot.curated || props.shoot.published}>
        <p class="muted">{props.shoot.curated ? "This shoot’s visibility is set in the site files." : "Hide and publish this shoot before deleting it."}</p>
      </Show>
      <div class="dialog-actions">
        <Show when={!props.shoot.curated && !props.shoot.published}><button type="button" class="danger-link" onClick={remove}>Delete shoot</button></Show>
        <button type="button" onClick={close}>Cancel</button>
        <button class="primary" type="submit">Save changes</button>
      </div>
    </form>
  </Modal>;
}

function Batch(props: { onAltPass(ids: string[]): void }) {
  const ids = () => [...selected()].filter(id => photoOf(id));
  async function approve(on: boolean) {
    const targets = ids(), pending = targets.filter(id => photoOf(id)!.approved !== on);
    const { missing } = await setApproval(targets, on);
    setSelected(new Set<string>());
    // When nothing could be approved, go straight to writing the missing descriptions.
    if (missing.length && missing.length === pending.length) props.onAltPass(missing);
  }
  return <div class="batch" role="region" aria-label="Selected photographs">
    <span class="batch-count">{ids().length} SELECTED</span>
    <button type="button" class="batch-primary" onClick={() => void approve(true)}>Approve for site</button>
    <button type="button" onClick={() => void approve(false)}>Back to draft</button>
    <button type="button" onClick={() => props.onAltPass(ids())}>Write alt text</button>
    <select aria-label="Add selected photographs to a collection" value="" onChange={event => {
      const id = event.currentTarget.value;
      event.currentTarget.value = "";
      if (id) void addToCollection(id, ids());
    }}>
      <option value="">Add to collection…</option>
      <For each={content.collections}>{collection => <option value={collection.id}>{collection.title}</option>}</For>
    </select>
    <button type="button" class="batch-close" aria-label="Clear selection" onClick={() => setSelected(new Set<string>())}>×</button>
  </div>;
}

function Room() {
  const [help, setHelp] = createSignal(false);
  const [creating, setCreating] = createSignal<"shoot" | "collection" | null>(null);
  const [editing, setEditing] = createSignal("");
  const [pass, setPass] = createSignal<string[] | null>(null);
  const pending = () => counts().pending;
  const batchOn = () => view() === "library" && [...selected()].some(id => photoOf(id));
  const editingShoot = () => content.shoots.find(shoot => shoot.id === editing());

  function openPass(ids: string[]) {
    const present = ids.filter(id => photoOf(id));
    if (present.length) setPass(present);
    else notice("Every photograph here has alt text");
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "?" && !isTyping(event.target) && !pass() && !document.querySelector("dialog[open]")) { event.preventDefault(); setHelp(true); }
  };
  const onResize = () => setWidth(window.innerWidth);
  const guard = (event: BeforeUnloadEvent) => { if (altDrafts().size) event.preventDefault(); };
  onMount(() => {
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("beforeunload", guard);
  });
  onCleanup(() => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("beforeunload", guard);
  });
  createEffect(() => document.body.classList.toggle("has-batch", batchOn()));

  // The CMS drafts alt text in the background after uploads. While drafts
  // are due, check back every few seconds so they appear without a reload.
  const awaitingDrafts = () => {
    if (!altAuto() || !altStatus().available) return false;
    const since = Date.now() - 10 * 60_000;
    return content.photos.some(photo => !photo.curated && !photo.alt && !photo.altSuggestion && Date.parse(photo.createdAt) > since);
  };
  createEffect(() => {
    if (!awaitingDrafts() || uploading() || pass()) return;
    const timer = window.setInterval(() => void load().catch(() => undefined), 4000);
    onCleanup(() => clearInterval(timer));
  });

  async function signOut() {
    if (altDrafts().size && !confirm("Discard unsaved alt text edits and sign out?")) return;
    if (uploading() && !confirm("Uploads are still running. Sign out anyway?")) return;
    try {
      await api("/logout", { method: "POST" });
      setAltDrafts(new Map());
      endSession();
    } catch (error) { notice((error as Error).message, true); }
  }

  return <>
    <div class="app">
      <header class="topbar">
        <button class="brand" type="button" aria-label="Nolle Studios overview" onClick={() => setView("overview")}>
          <img src="/nolle-studios-mark.svg" alt="" width="32" height="32" /><span class="brand-name">Nolle Studios</span><span class="brand-room">CONTENT ROOM</span>
        </button>
        <nav class="primary-nav" aria-label="Content room">
          <For each={NAV}>{([key, label]) =>
            <button type="button" classList={{ active: view() === key }} aria-current={view() === key ? "page" : undefined} onClick={() => setView(key)}>
              {label}
              <Show when={key === "publish" && pending()}><span class="nav-badge">{pending()}</span></Show>
              <Show when={key === "uploads" && uploading()}><span class="nav-badge busy" aria-label="uploading" /></Show>
            </button>}</For>
        </nav>
        <div class="top-actions">
          <button type="button" class="publish-chip" classList={{ pending: !!pending() }} onClick={() => setView("publish")}>
            <span class="status-dot" />
            <span class="chip-long">{pending() ? `PUBLISH ${pending()} CHANGE${pending() === 1 ? "" : "S"}` : "ALL CHANGES LIVE"}</span>
            <span class="chip-short">{pending() ? `${pending()} PENDING` : "UP TO DATE"}</span>
          </button>
          <a href={siteUrl("")} target="_blank" rel="noopener">View site ↗</a>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>
      <Switch>
        <Match when={view() === "overview"}><Overview onAltPass={openPass} /></Match>
        <Match when={view() === "library"}>
          <Library onAltPass={openPass} onCreate={setCreating} onEditShoot={setEditing} onHelp={() => setHelp(true)} />
        </Match>
        <Match when={view() === "collections"}><Collections onCreate={() => setCreating("collection")} /></Match>
        <Match when={view() === "uploads"}><Uploads onAltPass={openPass} onCreateShoot={() => setCreating("shoot")} /></Match>
        <Match when={view() === "publish"}><Publish /></Match>
      </Switch>
      <Show when={batchOn()}><Batch onAltPass={openPass} /></Show>
    </div>
    <Show when={pass()}>{ids => <AltPass ids={ids()} onClose={() => setPass(null)} />}</Show>
    <Show when={help()}>
      <Modal class="help-dialog" labelledby="help-title" onClose={() => setHelp(false)}>
        <h2 id="help-title">Keyboard</h2>
        <dl class="shortcuts">
          <For each={SHORTCUTS}>{([keys, label]) => <>
            <dt><For each={keys}>{(key, i) => <>{i() ? " " : ""}{key === "Shift-click" ? <><kbd>Shift</kbd>-click</> : <kbd>{key}</kbd>}</>}</For></dt>
            <dd>{label}</dd>
          </>}</For>
        </dl>
        <form method="dialog" class="dialog-actions"><button autofocus>Close</button></form>
      </Modal>
    </Show>
    <Show when={creating()}>{kind => <CreateDialog kind={kind()} onClose={() => setCreating(null)} />}</Show>
    <Show when={editingShoot()}>{shoot => <ShootDialog shoot={shoot()} onClose={() => setEditing("")} />}</Show>
  </>;
}

export default function App() {
  onMount(async () => {
    try {
      const session = await api<{ authenticated: boolean; csrfToken?: string }>("/session");
      if (session.authenticated && session.csrfToken) await start(session.csrfToken);
      else endSession();
    } catch (error) { endSession((error as Error).message); }
  });
  return <>
    <Switch fallback={<div class="booting" aria-busy="true" />}>
      <Match when={signedIn() === true}><Room /></Match>
      <Match when={signedIn() === false}><SignIn /></Match>
    </Switch>
    <div class="save-state" classList={{ visible: !!toast(), error: !!toast()?.error }} role="status" aria-live="polite">{toast()?.text}</div>
  </>;
}
