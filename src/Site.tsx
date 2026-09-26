import { Match, Show, Switch, createResource, lazy } from "solid-js";
import { loadArchive } from "./archive";

// The table is its own chunk so the loading screen paints first. Its download
// starts now, alongside the catalog request, rather than after it.
const table = import("./table/LightTable");
const LightTable = lazy(() => table);

// Loading, empty and unavailable states sit on the same cork, under the same
// glass header, as the table itself.
function Status(props: { kind: "loading" | "empty" | "error" | "missing"; preview: boolean; onRetry?: () => void }) {
  const unavailable = () => props.preview ? "Sign in to the Content Room, then try again." :
    import.meta.env.MODE === "static" ? "The photo archive could not be loaded. Try again shortly." :
      "The content server is not responding. Try again shortly.";
  return <main class="ns-status" aria-busy={props.kind === "loading"}>
    <div class="ns-cork" aria-hidden="true">
      <div class="ns-cork__base" /><div class="ns-cork__tile" /><div class="ns-cork__tone" />
      <div class="ns-cork__light" /><div class="ns-cork__edge" />
    </div>
    <header class="ns-bar ns-glass">
      <span class="ns-bar__glint" aria-hidden="true" />
      <div class="ns-bar__start"><span class="ns-bar__mark"><img src="/nolle-studios-mark.svg" alt="" width="38" height="38" /></span></div>
      <div class="ns-bar__center"><span class="ns-bar__brand">Nolle Studios</span></div>
      <div class="ns-bar__end" />
    </header>
    <Show when={props.kind === "loading"} fallback={
      <div class="ns-status__card">
        <div class="ns-status__body">
          <div class="ns-status__eyebrow">NOLLE STUDIOS / PHOTOGRAPHY</div>
          <h1>{props.kind === "missing" ? "Nothing on this table." : props.kind === "error" ? (props.preview ? "Preview unavailable." : "The table is unavailable.") : "The table is being prepared."}</h1>
          <p>{props.kind === "missing" ? "There is no page at this address. The photographs are all on the light table." :
            props.kind === "error" ? unavailable() : props.preview ? "No photographs to preview yet." : "No photographs are published yet. Please check back soon."}</p>
          <Show when={props.kind === "error" && props.onRetry}>
            <button type="button" class="ns-status__retry" onClick={() => props.onRetry?.()}>TRY AGAIN</button>
          </Show>
          <Show when={props.kind === "missing"}>
            <a class="ns-status__retry" href="/">GO TO THE LIGHT TABLE</a>
          </Show>
        </div>
      </div>
    }>
      <div class="ns-status__card ns-status__card--skeleton" role="status">
        <div class="ns-status__body ns-skeleton">
          <div class="ns-skeleton__head"><span>OPENING THE LIGHT TABLE…</span><span class="ns-skeleton__bar" aria-hidden="true" /></div>
          <div class="ns-skeleton__grid" aria-hidden="true">{Array.from({ length: 6 }, () => <span />)}</div>
        </div>
      </div>
    </Show>
  </main>;
}

// The table lives at / and its alias /archive/; anything else is a 404,
// which GitHub Pages serves from 404.html (this same app).
const KNOWN_PATH = /^\/(archive\/?)?(index\.html)?$/;

export default function Site() {
  if (!KNOWN_PATH.test(location.pathname)) {
    document.title = "Not found · Nolle Studios";
    return <Status kind="missing" preview={false} />;
  }
  const params = new URLSearchParams(location.search);
  const preview = params.get("preview") === "1";
  const [shoots, { refetch }] = createResource(() => loadArchive(preview));
  return <Switch>
    <Match when={shoots.error}><Status kind="error" preview={preview} onRetry={refetch} /></Match>
    <Match when={shoots.loading && !shoots.latest}><Status kind="loading" preview={preview} /></Match>
    <Match when={shoots()?.length === 0}><Status kind="empty" preview={preview} /></Match>
    <Match when={shoots()}>{list => <>
      <LightTable shoots={list()} initialShoot={params.get("shoot")} />
      <Show when={preview}><div class="ns-private-preview" role="status">Private preview · Not live</div></Show>
    </>}</Match>
  </Switch>;
}
