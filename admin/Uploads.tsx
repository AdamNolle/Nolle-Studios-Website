import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { uploadFile } from "./api";
import { content, load, notice, openScope } from "./store";
import { fileSize, ordered } from "./util";

type State = "queued" | "uploading" | "processing" | "ready" | "failed";
interface Item { key: number; file: File; name: string; size: number; video: boolean; shootId: string; progress: number; state: State; error: string; preview: string; id: string }

const IMAGE = /^image\/(jpeg|png|tiff|webp|avif|heic|heif)$/;
const VIDEO = /^video\/(mp4|quicktime|webm)$/;

// The queue survives moving between screens while files are still uploading.
const [queue, setQueue] = createStore<Item[]>([]);
const [target, setTarget] = createSignal("");
let running = false, nextKey = 0;
export const uploading = () => queue.some(item => item.state === "queued" || item.state === "uploading" || item.state === "processing");

async function drain() {
  if (running) return;
  running = true;
  try {
    for (let index = queue.findIndex(item => item.state === "queued"); index >= 0; index = queue.findIndex(item => item.state === "queued")) {
      const item = queue[index];
      setQueue(index, { state: "uploading", progress: 0 });
      try {
        const { id } = await uploadFile(item.video ? "videos" : "photos", item.shootId, item.file,
          fraction => setQueue(index, "progress", fraction), () => setQueue(index, "state", "processing"));
        setQueue(index, { state: "ready", id, progress: 1 });
      } catch (error) {
        setQueue(index, { state: "failed", error: (error as Error).message });
      }
    }
    await load().catch(() => undefined);
  } finally { running = false; }
}

export default function Uploads(props: { onAltPass(ids: string[]): void; onCreateShoot(): void }) {
  const [over, setOver] = createSignal(false);
  const shoots = createMemo(() => ordered(content.shoots).filter(shoot => !shoot.curated));
  const shootId = () => shoots().some(shoot => shoot.id === target()) ? target() : shoots()[0]?.id ?? "";
  const tally = () => ({
    active: queue.filter(item => ["queued", "uploading", "processing"].includes(item.state)).length,
    ready: queue.filter(item => item.state === "ready").length,
    failed: queue.filter(item => item.state === "failed").length,
  });

  function add(files: FileList | File[] | null | undefined) {
    const into = shootId();
    if (!into) { notice("Create a shoot first", true); return; }
    setQueue(produce(list => {
      for (const file of files ?? []) {
        const video = VIDEO.test(file.type) || /\.(mp4|mov|webm)$/i.test(file.name);
        const image = IMAGE.test(file.type);
        const limit = video ? 2 * 1024 ** 3 : 50 * 1024 ** 2;
        const error = !video && !image ? "Not a supported photo or video" : file.size > limit ? `Over the ${video ? "2 GB" : "50 MB"} limit` : "";
        list.push({ key: nextKey++, file, name: file.name, size: file.size, video, shootId: into, progress: 0, state: error ? "failed" : "queued", error,
          preview: /^image\/(jpeg|png|webp|avif)$/.test(file.type) ? URL.createObjectURL(file) : "", id: "" });
      }
    }));
    void drain();
  }
  function clear() {
    for (const item of queue) if (item.preview && !["queued", "uploading", "processing"].includes(item.state)) URL.revokeObjectURL(item.preview);
    setQueue(list => list.filter(item => ["queued", "uploading", "processing"].includes(item.state)));
  }
  function review() {
    const ready = queue.filter(item => item.state === "ready");
    const ids = ready.map(item => item.id), shoot = ready[0]?.shootId;
    clear();
    if (shoot) openScope({ type: "shoot", id: shoot });
    props.onAltPass(ids);
  }
  // Leaving mid-upload would lose the rest of the queue.
  const guard = (event: BeforeUnloadEvent) => { if (uploading()) event.preventDefault(); };
  window.addEventListener("beforeunload", guard);
  onCleanup(() => window.removeEventListener("beforeunload", guard));

  const label = (item: Item) => item.state === "queued" ? "Waiting" : item.state === "uploading" ? `Uploading ${Math.round(item.progress * 100)}%` :
    item.state === "processing" ? (item.video ? "Transcoding 720p and 1080p" : "Making 640–3200 px variants") :
      item.state === "failed" ? item.error : item.video ? "Draft · video ready" : "Draft · metadata stripped";

  return <main class="uploads-page page-wrap">
    <div class="eyebrow">UPLOADS</div>
    <h1>Add photographs and video</h1>
    <div class="upload-target">
      <label for="upload-target">Into shoot</label>
      <select id="upload-target" value={shootId()} onChange={event => setTarget(event.currentTarget.value)}>
        <For each={shoots()}>{shoot => <option value={shoot.id}>{shoot.title}</option>}</For>
      </select>
      <button type="button" class="quiet-button" onClick={() => props.onCreateShoot()}>+ New shoot</button>
      <span class="muted">New photos arrive as private drafts. Alt text is drafted by the local model when it is running.</span>
    </div>
    <Show when={shoots().length} fallback={<p class="empty-copy panel">Create a shoot first. Curated shoots come from the site files and do not take uploads.</p>}>
      <label class="drop-zone" classList={{ dragover: over() }}
        onDragOver={event => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={event => { event.preventDefault(); setOver(false); add(event.dataTransfer?.files); }}>
        <strong>Drop photographs or video here</strong>
        <small>Photos: JPEG, PNG, TIFF, WebP, AVIF or HEIF up to 50 MB, resized to 640–3200 px with EXIF, GPS and XMP removed.
          Video: MP4, MOV or WebM up to 2 GB, transcoded to 720p and 1080p with a poster frame and metadata removed. Masters stay on private storage.</small>
        <span class="primary">Choose files</span>
        <input id="upload-input" type="file" multiple accept="image/jpeg,image/png,image/tiff,image/webp,image/avif,image/heic,image/heif,video/mp4,video/quicktime,video/webm,.mov"
          onChange={event => { add(event.currentTarget.files); event.currentTarget.value = ""; }} />
      </label>
    </Show>
    <Show when={queue.length}>
      <section class="panel upload-queue">
        <div class="panel-title"><h2>Queue</h2><span>{queue.length} FILES · {tally().active} IN PROGRESS · {tally().ready} READY{tally().failed ? ` · ${tally().failed} FAILED` : ""}</span></div>
        <For each={queue}>{item =>
          <div class={`queue-row ${item.state}`}>
            <span class="queue-thumb"><Show when={item.preview}><img src={item.preview} alt="" /></Show><Show when={item.video}><i aria-hidden="true">▶</i></Show></span>
            <span class="queue-file">
              <span><b>{item.name}</b><small>{fileSize(item.size)}</small></span>
              <span class="queue-bar"><i style={{ width: `${item.state === "uploading" ? Math.round(item.progress * 100) : item.state === "queued" ? 0 : 100}%` }} /></span>
            </span>
            <span class="queue-state"><Show when={item.state === "uploading" || item.state === "processing"}><i class="spin" aria-hidden="true" /></Show>{label(item)}</span>
          </div>}</For>
        <Show when={!tally().active && tally().ready}>
          <div class="queue-done">
            <span>{tally().ready === 1 ? "1 new draft. It stays private until you publish it." : `${tally().ready} new drafts. They stay private until you publish them.`}{tally().failed ? ` ${tally().failed} file${tally().failed === 1 ? "" : "s"} could not be used.` : ""}</span>
            <span><button type="button" onClick={clear}>Clear queue</button><button type="button" class="primary" onClick={review}>Write alt text for new drafts</button></span>
          </div>
        </Show>
      </section>
    </Show>
  </main>;
}
