import { For, Show, createEffect, createSignal, on } from "solid-js";
import type { PhotoDto } from "../shared/api";
import { photoPath, saveAlt, setApproval, suggestAlt, toggleInCollection } from "./actions";
import { api } from "./api";
import { altConfigured, altDrafts, altStatus, change, content, notice, photoSrc, previewUrl, setDraft, shootOf, statusOf, videoSrc } from "./store";
import { pad2 } from "./util";

const STEPS = ["DRAFT", "APPROVED", "LIVE"] as const;

/** The local model's suggested alt text, offered beside the editor. */
function Suggestion(props: { photo: PhotoDto; onUse(text: string): void }) {
  const [busy, setBusy] = createSignal(false);
  async function ask(fresh: boolean) {
    setBusy(true);
    try { await suggestAlt(props.photo.id, fresh); }
    catch (error) { notice((error as Error).message, true); }
    finally { setBusy(false); }
  }
  return <Show when={altConfigured()}>
    <div class="suggestion" classList={{ "is-busy": busy() }}>
      <Show when={props.photo.altSuggestion} fallback={
        <button type="button" class="suggestion-ask" disabled={busy() || !altStatus().available} onClick={() => ask(false)}
          title={altStatus().available ? "" : "Start the model with npm run alt:model"}>
          {busy() ? "Describing…" : altStatus().available ? "✦ Draft alt text with the local model" : "✦ Local model offline"}
        </button>
      }>
        <span class="eyebrow">SUGGESTED{altStatus().model ? ` · ${altStatus().model.toUpperCase()}` : ""} · CHECK BEFORE SAVING</span>
        <p>{props.photo.altSuggestion}</p>
        <div>
          <button type="button" onClick={() => props.onUse(props.photo.altSuggestion ?? "")}>Use this</button>
          <button type="button" disabled={busy() || !altStatus().available} onClick={() => ask(true)}>{busy() ? "Describing…" : "Suggest again"}</button>
        </div>
      </Show>
    </div>
  </Show>;
}

export default function Inspector(props: { photo: PhotoDto | undefined; rows: PhotoDto[]; narrow: boolean; onStep(step: number): void; onClose(): void }) {
  let field: HTMLTextAreaElement | undefined;
  const text = () => props.photo ? altDrafts().get(props.photo.id) ?? props.photo.alt : "";
  // Keep keyboard focus in the editor as the inspector moves between photos.
  createEffect(on(() => props.photo?.id, (id, previous) => { if (id && previous && document.activeElement === field) field?.focus(); }));

  return <Show when={props.photo} fallback={<aside class="inspector is-empty"><p class="empty-copy">Select a photograph to edit its alt text, status, and collections.</p></aside>}>
    {photo => {
      const status = () => statusOf(photo());
      const index = () => props.rows.findIndex(row => row.id === photo().id);
      const step = () => ({ draft: 0, approved: 1, live: 2, leaving: 2 })[status()];
      const note = () => status() === "draft" ? (photo().curated ? "Hidden from the table." : "Private. Approve it when it belongs on the table.") :
        status() === "approved" ? (shootOf(photo())?.approved ? "Approved. It goes live the next time you publish." : "Approved, but this shoot is hidden, so nothing from it is on the site yet.") :
          status() === "leaving" ? "Still on the site. It comes off the next time you publish." : "On the site now.";
      return <aside class="inspector" classList={{ "is-sheet": props.narrow }} aria-label="Photograph details">
        <div class="inspector-inner">
          <div class="inspector-top">
            <span>FRAME {pad2(Math.max(0, index()) + 1)} / {props.rows.length} · {shootOf(photo())?.title ?? "ARCHIVE"}</span>
            <div>
              <button type="button" aria-label="Previous photograph" onClick={() => props.onStep(-1)}>←</button>
              <button type="button" aria-label="Next photograph" onClick={() => props.onStep(1)}>→</button>
              <button type="button" class="inspector-close" aria-label="Close photograph details" onClick={() => props.onClose()}>×</button>
            </div>
          </div>
          <div class="inspector-preview">
            <Show when={photo().kind === "video"} fallback={<img src={photoSrc(photo(), 1600)} alt={photo().alt || "Undescribed photograph"} decoding="async" />}>
              <video controls playsinline preload="metadata" poster={photoSrc(photo())} src={videoSrc(photo())} />
            </Show>
          </div>
          <div class="status-box">
            <div class="status-steps">
              <For each={STEPS}>{(label, i) =>
                <span classList={{ on: i() === step(), done: i() < step(), leaving: status() === "leaving" && i() === 2 }}>
                  {status() === "leaving" && i() === 2 ? "LEAVING" : label}
                </span>}</For>
            </div>
            <p>{photo().curated && status() === "draft" ? "Hidden from the table. The file stays in the static site until its next deployment." : note()}</p>
            <div class="status-actions">
              <button type="button" class="primary" onClick={() => setApproval([photo().id], !photo().approved)}>
                {photo().curated ? (photo().approved ? "Hide from table" : "Show on table") : status() === "leaving" ? "Keep on site" : photo().approved ? "Back to draft" : "Approve for site"}
              </button>
            </div>
          </div>
          <form class="alt-form" onSubmit={event => { event.preventDefault(); void saveAlt(photo().id, text()); }}>
            <label for="alt-field">{photo().kind === "video" ? "Description" : "Alt text"} <span classList={{ over: text().length > 125 }}>{text().length} / 125</span></label>
            <textarea id="alt-field" ref={field} rows="4" maxlength="400" value={text()}
              placeholder={photo().kind === "video" ? "Describe what happens in the clip for someone who can’t see it." : "Describe what is in the frame for someone who can’t see it."}
              onInput={event => setDraft(photo().id, event.currentTarget.value)}
              onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void saveAlt(photo().id, text()); } }} />
            <small classList={{ warning: !text() }}>{text() ? "Read by screen readers. Never shown as a caption." : "Missing. Screen readers will only hear the shoot title and frame number."}</small>
            <Show when={!photo().alt || photo().altSuggestion}>
              <Suggestion photo={photo()} onUse={value => { setDraft(photo().id, value); field?.focus(); }} />
            </Show>
            <button class="primary" type="submit" disabled={text() === photo().alt}>Save alt text</button>
          </form>
          <div class="inspector-collections">
            <strong>Collections</strong>
            <div>
              <For each={content.collections}>{collection => {
                const on = () => collection.photoIds.includes(photo().id);
                return <button type="button" classList={{ added: on() }} onClick={() => toggleInCollection(collection.id, photo().id)}>{on() ? "✓ " : "+ "}{collection.title}</button>;
              }}</For>
            </div>
          </div>
          <div class="inspector-buttons">
            <button type="button" disabled={photo().isCover} onClick={() => change(() => api(photoPath(photo().id), { method: "PATCH", body: { isCover: true } }), `Cover set for ${shootOf(photo())?.title}`)}>
              {photo().isCover ? "Shoot cover" : "Set as shoot cover"}
            </button>
            <a href={previewUrl(photo().shootId ?? "")} target="_blank" rel="noopener">Preview on table</a>
          </div>
          <Show when={photo().isCover && !photo().approved}><p class="muted">This cover reaches the site when you approve and publish this photograph.</p></Show>
          <dl class="photo-facts">
            <dt>File</dt><dd class="mono">{photo().fileName || "—"}</dd>
            <dt>Size</dt><dd>{photo().width} × {photo().height}</dd>
            <dt>Variants</dt><dd>{photo().kind === "video" ? "720p and 1080p MP4, WebM, poster" : "640–3200 px · AVIF, WebP, JPEG"}</dd>
            <dt>Metadata</dt><dd>{photo().kind === "video" ? "Location and device data removed" : "EXIF, GPS, XMP stripped"}</dd>
            <dt>Source</dt><dd>{photo().curated ? "Curated manifest" : "CMS upload"}</dd>
          </dl>
          <Show when={!photo().curated}>
            <Show when={!photo().published} fallback={<p class="muted">Move to draft and publish its withdrawal before deleting this upload.</p>}>
              <button type="button" class="danger-link" onClick={() => {
                if (confirm("Permanently delete this upload and its private copies?")) void change(() => api(photoPath(photo().id), { method: "DELETE" }), "Upload deleted");
              }}>Delete upload</button>
            </Show>
          </Show>
        </div>
      </aside>;
    }}
  </Show>;
}
