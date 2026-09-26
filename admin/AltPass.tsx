import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { saveAlt, suggestAlt } from "./actions";
import { altConfigured, altDrafts, altStatus, notice, photoOf, photoSrc, photosIn, setDraft, shootOf, videoSrc } from "./store";
import { pad2 } from "./util";

/**
 * Write alt text one photograph at a time. When the local model is running,
 * each photograph opens with its drafted description already in the field;
 * the editor corrects it and saves, or skips.
 */
export default function AltPass(props: { ids: string[]; onClose(): void }) {
  let field: HTMLTextAreaElement | undefined, strip: HTMLDivElement | undefined;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ids = props.ids.filter(id => photoOf(id));
  const [index, setIndex] = createSignal(0);
  const [finished, setFinished] = createSignal(false);
  const [done, setDone] = createSignal<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = createSignal<ReadonlySet<string>>(new Set());
  const photo = createMemo(() => photoOf(ids[index()]));
  const suggested = () => !!photo() && !photo()!.alt && !altDrafts().has(photo()!.id) && !!photo()!.altSuggestion;
  const text = () => {
    const p = photo();
    return p ? altDrafts().get(p.id) ?? (p.alt || p.altSuggestion || "") : "";
  };
  const previous = () => {
    const p = photo();
    if (!p?.shootId) return undefined;
    const siblings = photosIn(p.shootId), prior = siblings[siblings.indexOf(p) - 1];
    return prior?.alt ? prior : undefined;
  };

  // Ask the model for this photograph and the next, so the pass rarely waits.
  async function draft(id: string | undefined, fresh = false) {
    const p = id ? photoOf(id) : undefined;
    if (!p || !altConfigured() || !altStatus().available || asking().has(p.id)) return;
    if (!fresh && (p.alt || p.altSuggestion)) return;
    setAsking(new Set([...asking(), p.id]));
    try {
      const suggestion = await suggestAlt(p.id, fresh);
      if (fresh && photo()?.id === p.id) setDraft(p.id, suggestion);
    } catch (error) { if (photo()?.id === p.id) notice((error as Error).message, true); }
    finally { const next = new Set(asking()); next.delete(p.id); setAsking(next); }
  }
  createEffect(on(index, i => {
    void draft(ids[i]).then(() => draft(ids[i + 1]));
    queueMicrotask(() => {
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
      strip?.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "center" });
    });
  }));

  function go(i: number) {
    if (i < 0) return;
    if (i >= ids.length) { setFinished(true); return; }
    setFinished(false);
    setIndex(i);
  }
  async function save() {
    const p = photo();
    if (!p || finished()) return;
    const value = text().trim();
    if (value && value !== p.alt && !(await saveAlt(p.id, value))) return;
    if (value) setDone(new Set([...done(), p.id]));
    go(index() + 1);
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); props.onClose(); }
    else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); }
    else if (event.altKey && event.key === "ArrowRight") { event.preventDefault(); go(index() + 1); }
    else if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); go(index() - 1); }
  };
  onMount(() => { window.addEventListener("keydown", onKey, true); document.body.classList.add("pass-open"); });
  onCleanup(() => {
    window.removeEventListener("keydown", onKey, true);
    document.body.classList.remove("pass-open");
    if (opener?.isConnected) opener.focus();
  });

  return <div class="pass" role="dialog" aria-modal="true" aria-labelledby="pass-title">
    <div class="pass-head">
      <h2 id="pass-title">Alt-text pass</h2>
      <span class="pass-label">{finished() ? ids.length : index() + 1} OF {ids.length} · {done().size} WRITTEN</span>
      <div class="pass-progress" aria-hidden="true"><i style={{ width: `${Math.round(done().size / Math.max(1, ids.length) * 100)}%` }} /></div>
      <button type="button" class="pass-done" onClick={() => props.onClose()}>Done · Esc</button>
    </div>
    <Show when={!finished() && photo()} fallback={
      <div class="pass-finished"><div>
        <h3>All written.</h3>
        <p>{done().size} description{done().size === 1 ? "" : "s"} saved. They go live with the next publish.</p>
        <button type="button" class="primary" ref={el => queueMicrotask(() => el.focus())} onClick={() => props.onClose()}>Back to the library</button>
      </div></div>
    }>{p => <div class="pass-body">
      <div class="pass-stage">
        <Show when={p().kind === "video"} fallback={<img src={photoSrc(p(), 1600)} alt="" decoding="async" />}>
          <video controls muted playsinline preload="metadata" poster={photoSrc(p())} src={videoSrc(p())} />
        </Show>
      </div>
      <div class="pass-side">
        <div class="eyebrow">{(shootOf(p())?.title ?? "Archive").toUpperCase()} · FRAME {pad2(photosIn(p().shootId ?? "").indexOf(p()) + 1)} · {p().approved ? "APPROVED" : "DRAFT"}</div>
        <label class="pass-field">
          <span>{p().kind === "video" ? "Describe this clip" : "Describe this photograph"}<b classList={{ over: text().length > 125 }}>{text().length} / 125</b></span>
          <textarea ref={field} rows="5" maxlength="400" value={text()} placeholder={asking().has(p().id) ? "The local model is describing this photograph…" : "What is in the frame? Who, doing what, where."}
            onInput={event => setDraft(p().id, event.currentTarget.value)} />
        </label>
        <Show when={suggested() || asking().has(p().id)}>
          <p class="pass-suggested">{asking().has(p().id) ? "✦ Describing with the local model…" : `✦ Drafted by ${altStatus().model || "the local model"}. Check it against the photograph before saving.`}</p>
        </Show>
        <div class="pass-actions">
          <button type="button" class="primary" onClick={() => void save()}>{suggested() ? "Accept and next" : "Save and next"} <kbd>⌘↵</kbd></button>
          <button type="button" onClick={() => go(index() + 1)}>Skip <kbd>⌥→</kbd></button>
          <Show when={altConfigured()}>
            <button type="button" disabled={!altStatus().available || asking().has(p().id)} onClick={() => void draft(p().id, true)}>✦ Suggest again</button>
          </Show>
        </div>
        <Show when={previous()}>{prior =>
          <div class="pass-prev">
            <span class="eyebrow">PREVIOUS FRAME IN THIS SHOOT</span>
            <p>{prior().alt}</p>
            <button type="button" onClick={() => { setDraft(p().id, prior().alt); field?.focus(); }}>Start from this</button>
          </div>}</Show>
        <Show when={altConfigured() && !altStatus().available}>
          <p class="pass-note">The local alt-text model is offline. Start it with <kbd>npm run alt:model</kbd> to get drafted descriptions.</p>
        </Show>
        <p class="pass-note">Screen readers read this aloud. It is never shown as a caption. Skip “photo of”; name the subject and what is happening.</p>
      </div>
    </div>}</Show>
    <div class="pass-strip" ref={strip} aria-label="Photographs in this pass">
      <For each={ids}>{(id, i) => {
        const item = photoOf(id);
        return <Show when={item}>{it =>
          <button type="button" classList={{ on: i() === index() && !finished() }} aria-current={i() === index() && !finished() ? "true" : undefined}
            aria-label={`Photograph ${i() + 1}${done().has(id) ? ", written" : ""}`} onClick={() => go(i())}>
            <img src={photoSrc(it())} alt="" loading="lazy" /><Show when={done().has(id)}><span aria-hidden="true">✓</span></Show>
          </button>}</Show>;
      }}</For>
    </div>
  </div>;
}
