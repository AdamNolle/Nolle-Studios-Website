import { For, Show, createMemo, createSignal } from "solid-js";
import { api } from "./api";
import { Pipeline } from "./Overview";
import { change, collectionPending, content, photoOf, photoPending, photoSrc, shootOf, shootPending, siteUrl, statusOf, coverOf } from "./store";
import { localPreview, photoCount, siteLabel, when } from "./util";

export default function Publish() {
  const [busy, setBusy] = createSignal(false);
  const pending = createMemo(() => {
    const photos = content.photos.filter(photoPending);
    const shoots = content.shoots.filter(shootPending);
    const collections = content.collections.filter(collectionPending);
    return { photos, shoots, collections, total: photos.length + shoots.length + collections.length };
  });
  const groups = () => {
    const p = pending().photos;
    return ([
      ["Photos going live", p.filter(photo => photo.approved && !photo.published).length],
      ["Photos coming off the site", p.filter(photo => !photo.approved && photo.published).length],
      ["Alt text updates", p.filter(photo => photo.approved && photo.published && photo.alt !== photo.liveAlt).length],
      ["Sequences reordered", new Set(p.filter(photo => photo.approved && photo.published && photo.sortOrder !== photo.liveSortOrder).map(photo => photo.shootId)).size],
      ["Shoot changes", pending().shoots.length],
      ["Collection changes", pending().collections.length],
    ] as [string, number][]).filter(([, count]) => count);
  };
  const rows = () => [
    ...pending().photos.map(photo => ({
      title: photo.alt || "Untitled photograph", sub: shootOf(photo)?.title ?? "Archive", image: photoSrc(photo),
      action: photo.approved !== photo.published ? (photo.approved ? "ADDING" : "REMOVING") :
        [photo.alt !== photo.liveAlt && "ALT TEXT", photo.shootId !== photo.liveShootId && "SHOOT",
          photo.sortOrder !== photo.liveSortOrder && "ORDER", photo.isCover !== photo.liveIsCover && "COVER"].filter(Boolean).join(" · "),
    })),
    ...pending().shoots.map(shoot => ({ title: shoot.title, sub: "Shoot", image: coverOf(shoot), action: shoot.approved !== shoot.published ? (shoot.approved ? "SHOWING" : "HIDING") : "DETAILS" })),
    ...pending().collections.map(collection => {
      const first = photoOf(collection.photoIds[0] ?? "");
      return { title: collection.title, sub: "Collection", image: first ? photoSrc(first) : "",
        action: collection.approved !== collection.published ? (collection.approved ? "SHOWING" : "HIDING") :
          JSON.stringify(collection.photoIds) !== JSON.stringify(collection.livePhotoIds) ? "MEMBERS" : "DETAILS" };
    }),
  ];
  const blocked = () => content.photos.filter(photo => statusOf(photo) === "approved" && !content.shoots.find(s => s.id === photo.shootId)?.approved).length;
  const missingLive = () => content.photos.filter(photo => photo.approved && !photo.alt.trim()).length;

  async function publishNow() {
    setBusy(true);
    let note = "";
    await change(async () => { note = (await api<{ note: string }>("/publish", { method: "POST" })).note; },
      () => `${localPreview ? "Local site updated" : "Live on nollestudios.com"}${note ? ` · ${note}` : ""}`);
    setBusy(false);
  }

  return <main class="publish-page page-wrap">
    <div class="eyebrow">PUBLISH · {siteLabel.toUpperCase()}</div>
    <h1>Put the work on the table</h1>
    <p class="intro">Photos move from Draft to Approved in the library. Nothing reaches the site until you publish here: approved photos go live,
      removed ones come off, and alt text and ordering update together.
      {localPreview ? " This updates the local catalog; the GitHub Pages site needs a separate static build and deployment." : ""}</p>
    <Pipeline />
    <div class="publish-layout">
      <section class="panel">
        <div class="panel-title"><h2>Waiting to go live</h2><span>{pending().total} CHANGE{pending().total === 1 ? "" : "S"}</span></div>
        <Show when={groups().length} fallback={<p class="empty-copy">No changes since the last publish. The site matches the content room.</p>}>
          <dl class="publish-groups"><For each={groups()}>{([label, count]) => <><dt>{label}</dt><dd>{count}</dd></>}</For></dl>
        </Show>
        <Show when={blocked()}><p class="publish-note">{photoCount(blocked())} approved in hidden shoots will not appear until those shoots are shown.</p></Show>
        <Show when={missingLive()}><p class="publish-note publish-note--warn">{photoCount(missingLive())} approved without alt text. Add it before publishing.</p></Show>
        <div class="publish-go">
          <button type="button" class="primary" disabled={!pending().total || busy()} onClick={publishNow}>
            {busy() ? "Publishing…" : pending().total ? `Publish ${pending().total} change${pending().total === 1 ? "" : "s"}` : "Nothing to publish"}
          </button>
          <a href={siteUrl("")} target="_blank" rel="noopener">View site ↗</a>
        </div>
        <Show when={rows().length}>
          <details class="publish-details"><summary>Every change</summary>
            <div class="publish-items"><For each={rows()}>{row =>
              <div><img src={row.image} alt="" loading="lazy" /><span><strong>{row.title}</strong><small>{row.sub}</small></span><b>{row.action}</b></div>}</For>
            </div>
          </details>
        </Show>
      </section>
      <section class="panel history">
        <div class="panel-title"><h2>History</h2></div>
        <For each={content.history} fallback={<p class="empty-copy">Publishes from the content room appear here.</p>}>{(row, index) =>
          <div class="history-row">
            <strong>{row.note}</strong><span>{row.changes} CHANGE{row.changes === 1 ? "" : "S"}</span>
            <small>{when(row.createdAt)}</small><Show when={index() === 0}><b>LATEST</b></Show>
          </div>}</For>
      </section>
    </div>
  </main>;
}
