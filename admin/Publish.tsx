import { For, Show, createMemo, createSignal } from "solid-js";
import { api } from "./api";
import { publishIncludingShoot } from "./actions";
import { Pipeline } from "./Overview";
import { autoPublishReady, change, collectionPending, content, photoOf, photoPending, photoSrc, shootOf, shootPending, siteUrl, coverOf, intendedLive, openScope, setView } from "./store";
import { localPreview, photoCount, siteLabel, when } from "./util";

export default function Publish() {
  const [busy, setBusy] = createSignal(false);
  const pending = createMemo(() => {
    const photos = content.photos.filter(photoPending);
    const shoots = content.shoots.filter(shootPending);
    const collections = content.collections.filter(collectionPending);
    return { photos, shoots, collections, total: photos.length + shoots.length + collections.length };
  });
  const privateShoots = () => content.shoots.filter(shoot => !shoot.approved && shoot.photos.length);
  const groups = () => {
    const p = pending().photos;
    return ([
      ["Photos and videos going live", p.filter(photo => intendedLive(photo) && !photo.published).length],
      ["Media returning to private storage", p.filter(photo => !intendedLive(photo) && photo.published).length],
      ["Alt text updates", p.filter(photo => intendedLive(photo) && photo.published && photo.alt !== photo.liveAlt).length],
      ["Sequences reordered", new Set(p.filter(photo => intendedLive(photo) && photo.published && photo.sortOrder !== photo.liveSortOrder).map(photo => photo.shootId)).size],
      ["Shoot changes", pending().shoots.length],
      ["Collection changes", pending().collections.length],
    ] as [string, number][]).filter(([, count]) => count);
  };
  const rows = () => [
    ...pending().photos.map(photo => ({
      title: photo.alt || "Untitled photograph", sub: shootOf(photo)?.title ?? "Archive", image: photoSrc(photo),
      action: autoPublishReady(photo) ? "ADDING AUTOMATICALLY" : intendedLive(photo) !== photo.published ? (intendedLive(photo) ? "ADDING" : "RETURNING PRIVATE") :
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
  const missingLive = () => content.photos.filter(photo => !photo.alt.trim() &&
    !photo.published && !!shootOf(photo)?.approved).length;

  async function publishNow() {
    setBusy(true);
    let note = "";
    await change(async () => { note = (await api<{ note: string }>("/publish", { method: "POST" })).note; },
      () => note === "No changes" ? "No public changes made" : `${localPreview ? "Local site updated" : "Live on nollestudios.com"} · ${note}`);
    setBusy(false);
  }
  async function includeAndPublish(shootId: string) {
    setBusy(true);
    await publishIncludingShoot(shootId);
    setBusy(false);
  }

  return <main class="publish-page page-wrap">
    <div class="eyebrow">PUBLISH · {siteLabel.toUpperCase()}</div>
    <h1>Put the work on the table</h1>
    <p class="intro">Publish releases described photos and videos in shoots marked for the site. Private shoots are listed separately below so they never go public by surprise.
      {localPreview ? " This updates the local catalog; the GitHub Pages site needs a separate static build and deployment." : ""}</p>
    <Pipeline />
    <div class="publish-layout">
      <section class="panel">
        <div class="panel-title"><h2>Waiting to go live</h2><span>{pending().total} CHANGE{pending().total === 1 ? "" : "S"}</span></div>
        <Show when={groups().length} fallback={<p class="empty-copy">No public changes queued. Private shoots remain off the site unless you include them below.</p>}>
          <dl class="publish-groups"><For each={groups()}>{([label, count]) => <><dt>{label}</dt><dd>{count}</dd></>}</For></dl>
        </Show>
        <Show when={missingLive()}><p class="publish-note publish-note--warn">{photoCount(missingLive())} in “On site” shoots still need alt text. Add it before publishing everything. <button type="button" onClick={() => setView("library")}>Open Library</button></p></Show>
        <Show when={privateShoots().length}>
          <div class="publish-private">
            <strong>Private shoots · not included above</strong>
            <For each={privateShoots()}>{shoot => {
              const missing = () => shoot.photos.filter(photo => !photo.published && !photo.alt.trim()).length;
              return <div class="publish-private-row">
                <span><b>{shoot.title}</b><small>{shoot.photos.length} media item{shoot.photos.length === 1 ? "" : "s"} · {missing() ? `${missing()} need alt text` : "ready to include"}</small></span>
                <button type="button" disabled={busy() || !!missing()} onClick={() => void includeAndPublish(shoot.id)}>Include & publish</button>
                <Show when={missing()}><button type="button" onClick={() => openScope({ type: "shoot", id: shoot.id })}>Open shoot</button></Show>
              </div>;
            }}</For>
            <small>Including a shoot also publishes other ready changes shown above.</small>
          </div>
        </Show>
        <div class="publish-go">
          <button type="button" class="primary" disabled={!pending().total || !!missingLive() || busy()} onClick={publishNow}>
            {busy() ? "Publishing…" : missingLive() ? `Add alt text to ${photoCount(missingLive())}` : pending().total ? `Publish site changes · ${pending().total}` : "No public changes queued"}
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
