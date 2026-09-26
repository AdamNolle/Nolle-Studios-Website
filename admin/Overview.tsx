import { For, Show } from "solid-js";
import { content, counts, coverOf, openScope, photosIn, setFilter, setQuery, setScopeSignal, setView, shootStats, statusOf } from "./store";
import type { Status } from "./store";
import { changeCount, dateLabel, itemCount, localPreview, ordered, photoCount, siteLabel, today, when } from "./util";

/** Draft → Approved → Leaving → Live, each opening the library filtered to it. */
export function Pipeline() {
  const openFiltered = (status: Status) => {
    setScopeSignal({ type: "all" });
    setQuery("");
    setFilter(status);
    setView("library");
  };
  const blocked = () => content.photos.filter(photo => statusOf(photo) === "approved" && !content.shoots.find(s => s.id === photo.shootId)?.approved).length;
  const cells = (): [Status, string, number, string][] => [
    ["draft", "DRAFT", counts().draft, "Private. Only you see these."],
    ["approved", "APPROVED", counts().approved, blocked() ? `${blocked()} ${blocked() === 1 ? "is" : "are"} in hidden shoots.` : "Go live when you publish."],
    ["leaving", "LEAVING", counts().leaving, "Come off the site when you publish."],
    ["live", "LIVE", counts().live, localPreview ? "On the local site now." : "On nollestudios.com now."],
  ];
  return <div class="pipeline">
    <For each={cells()}>{([status, label, count, note]) =>
      <button type="button" class="pipeline-cell" onClick={() => openFiltered(status)}>
        <span class={`pipeline-label ${status}`}><i />{label}<b>→</b></span>
        <strong>{count}</strong>
        <small>{note}</small>
      </button>}</For>
  </div>;
}

export default function Overview(props: { onAltPass(ids: string[]): void }) {
  const tasks = () => {
    const c = counts(), list: { title: string; sub: string; action: string; dot: string; run(): void }[] = [];
    const worst = content.shoots.map(shoot => ({ shoot, missing: shootStats(shoot).missing })).sort((a, b) => b.missing - a.missing)[0];
    if (c.missing) list.push({
      title: `${photoCount(c.missing)} ${c.missing === 1 ? "has" : "have"} no alt text`,
      sub: worst?.missing ? `${worst.missing} of them ${worst.missing === 1 ? "is" : "are"} in ${worst.shoot.title}.` : "",
      action: "Start alt-text pass", dot: "cork",
      run: () => {
        if (!worst?.missing) return;
        openScope({ type: "shoot", id: worst.shoot.id });
        props.onAltPass(photosIn(worst.shoot.id).filter(photo => !photo.alt.trim()).map(photo => photo.id));
      },
    });
    for (const shoot of content.shoots.filter(s => !s.approved)) {
      const stats = shootStats(shoot);
      list.push({
        title: `${shoot.title} is hidden from the site`,
        sub: `${photoCount(stats.total)}, ${stats.approved} approved. Nothing from it appears until you show the shoot.`,
        action: "Open shoot", dot: "muted", run: () => openScope({ type: "shoot", id: shoot.id }),
      });
    }
    if (c.draft) list.push({
      title: `${c.draft} draft${c.draft === 1 ? "" : "s"} waiting for review`, sub: "Approve the ones that belong on the table.",
      action: "Review drafts", dot: "muted", run: () => { setScopeSignal({ type: "all" }); setQuery(""); setFilter("draft"); setView("library"); },
    });
    if (c.pending) list.push({
      title: `${changeCount(c.pending)} ${localPreview ? "not on the local site yet" : "aren’t on nollestudios.com yet"}`,
      sub: "Approved photos, removals, alt text and ordering go live together when you publish.",
      action: "Review and publish", dot: "dark", run: () => setView("publish"),
    });
    return list;
  };
  const last = () => content.history[0];

  return <main class="overview page-wrap">
    <div class="eyebrow">OVERVIEW · {today()}</div>
    <h1>The work in progress</h1>
    <Pipeline />
    <div class="overview-panels">
      <section class="panel attention">
        <div class="panel-title"><h2>Needs attention</h2><span>{itemCount(tasks().length)}</span></div>
        <For each={tasks()} fallback={<p class="empty-copy">Nothing waiting. Everything published is live.</p>}>{task =>
          <button type="button" class="attention-item" onClick={() => task.run()}>
            <i class={task.dot} />
            <span><strong>{task.title}</strong><small>{task.sub}</small></span>
            <b>{task.action} →</b>
          </button>}</For>
      </section>
      <section class="panel site-panel">
        <div class="panel-title"><h2>{siteLabel}</h2>
          <span>{counts().pending ? <><i class="status-dot" /> {counts().pending} NOT LIVE YET</> : "UP TO DATE"}</span>
        </div>
        <dl>
          <dt>Last publish</dt><dd>{last() ? `${when(last()!.createdAt)} · ${last()!.note}` : "Not yet published from here"}</dd>
          <dt>Hosting</dt><dd>{localPreview ? "This computer · localhost" : "Public site"}</dd>
          <dt>Waiting</dt><dd>{changeCount(counts().pending)} since last publish</dd>
        </dl>
        <button type="button" class="primary" onClick={() => setView("publish")}>Review and publish</button>
      </section>
    </div>
    <div class="section-heading"><h2>Shoots</h2><button type="button" onClick={() => setView("uploads")}>Upload media</button></div>
    <div class="shoot-cards">
      <For each={ordered(content.shoots)}>{shoot => {
        const stats = () => shootStats(shoot);
        return <button type="button" class="shoot-card" onClick={() => openScope({ type: "shoot", id: shoot.id })}>
          <img src={coverOf(shoot)} alt="" loading="lazy" decoding="async" />
          <div class="shoot-card-copy">
            <div class="shoot-card-meta"><span>{dateLabel(shoot.date)}</span><span classList={{ live: shoot.published }}>{shoot.published ? "ON SITE" : "HIDDEN"}</span></div>
            <h3>{shoot.title}</h3>
            <div class="progress"><i style={{ width: `${Math.round(stats().live / Math.max(stats().total, 1) * 100)}%` }} /></div>
            <div class="shoot-card-foot"><span>{stats().live} of {stats().total} live</span><span><Show when={stats().missing}>{stats().missing} no alt</Show></span></div>
          </div>
        </button>;
      }}</For>
    </div>
  </main>;
}
