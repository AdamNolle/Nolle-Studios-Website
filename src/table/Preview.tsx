import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import type { ArchiveShoot } from "../archive";
import { background, mid, srcset } from "./media";
import { refract } from "./glass";
import { DownloadIcon } from "./Chrome";
import { download } from "./download";
import { Thumb } from "./Picture";

export interface PreviewApi {
  /** Handle a key the table forwarded; true when it was used. */
  key(event: KeyboardEvent): boolean;
}

interface PreviewProps {
  shoot: ArchiveShoot;
  index: number;
  narrow: boolean;
  width: number;
  height: number;
  onGo(index: number): void;
  onClose(): void;
  api(api: PreviewApi): void;
}

type Point = { x: number; y: number };
type Gesture =
  | { mode: "pan"; startX: number; startY: number; x: number; y: number }
  | { mode: "pinch"; distance: number; scale: number; centerX: number; centerY: number; x: number; y: number };

const clampScale = (value: number) => Math.max(1, Math.min(5, value));
const Arrow = (props: { back?: boolean }) =>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={props.back ? "m14.5 5.5-6.5 6.5 6.5 6.5" : "m9.5 5.5 6.5 6.5-6.5 6.5"} /></svg>;

export default function Preview(props: PreviewProps) {
  let root!: HTMLDivElement, stage!: HTMLDivElement, figure!: HTMLElement, close!: HTMLButtonElement, pct!: HTMLOutputElement;
  let video: HTMLVideoElement | undefined;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const photo = createMemo(() => props.shoot.photos[props.index]);
  const isVideo = () => photo()?.kind === "video";
  const count = () => props.shoot.photos.length;
  const go = (step: number) => props.onGo((props.index + step + count()) % count());

  // The stage sits between the title bar and the thumbnail strip.
  const showStrip = () => props.height > 560;
  const inset = createMemo(() => {
    const edge = props.narrow ? 10 : 16, bar = props.narrow ? 48 : 58;
    return { top: edge + bar + 14, side: props.narrow ? 10 : 80, bottom: showStrip() ? edge + 58 + 14 : edge + 14 };
  });
  const stageW = () => Math.max(90, props.width - inset().side * 2);
  const stageH = () => Math.max(90, props.height - inset().top - inset().bottom);
  // Picks the file for the screen; zooming in asks for a larger one.
  const [detail, setDetail] = createSignal(1);

  const view = { scale: 1, x: 0, y: 0 };
  const pointers = new Map<number, Point>();
  let gesture: Gesture | null = null, swipe: { x: number; y: number } | null = null;

  function limits(scale: number) {
    return {
      x: Math.max(0, (figure.offsetWidth * scale - stage.clientWidth) / 2),
      y: Math.max(0, (figure.offsetHeight * scale - stage.clientHeight) / 2),
    };
  }
  function apply() {
    const bound = limits(view.scale);
    view.x = Math.max(-bound.x, Math.min(bound.x, view.x));
    view.y = Math.max(-bound.y, Math.min(bound.y, view.y));
    figure.style.transform = `translate3d(${view.x.toFixed(2)}px,${view.y.toFixed(2)}px,0) scale(${view.scale.toFixed(3)})`;
    if (pct) pct.textContent = `${Math.round(view.scale * 100)}%`;
    stage.classList.toggle("is-zoomed", view.scale > 1.01);
    if (view.scale > detail() * 1.4) setDetail(Math.min(4, view.scale));
  }
  function fit() {
    view.scale = 1; view.x = 0; view.y = 0;
    pointers.clear(); gesture = null;
    apply();
  }
  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    if (isVideo()) return;
    const scale = clampScale(view.scale * factor);
    if (scale === view.scale) return;
    const rect = stage.getBoundingClientRect();
    const ax = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2;
    const ay = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2;
    view.x = ax - (ax - view.x) * scale / view.scale;
    view.y = ay - (ay - view.y) * scale / view.scale;
    view.scale = scale;
    apply();
  }

  function onDown(event: PointerEvent) {
    if (isVideo() || event.button > 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { mode: "pinch", distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: view.scale,
        centerX: (a.x + b.x) / 2, centerY: (a.y + b.y) / 2, x: view.x, y: view.y };
      swipe = null;
    } else {
      gesture = { mode: "pan", startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
      swipe = view.scale <= 1.01 ? { x: event.clientX, y: event.clientY } : null;
    }
  }
  function onMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture;
    if (g?.mode === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], rect = stage.getBoundingClientRect();
      const scale = clampScale(g.scale * Math.hypot(a.x - b.x, a.y - b.y) / g.distance);
      const ax = (a.x + b.x) / 2 - rect.left - rect.width / 2, ay = (a.y + b.y) / 2 - rect.top - rect.height / 2;
      const gx = g.centerX - rect.left - rect.width / 2, gy = g.centerY - rect.top - rect.height / 2;
      view.scale = scale;
      view.x = ax - (gx - g.x) * scale / g.scale;
      view.y = ay - (gy - g.y) * scale / g.scale;
      apply();
    } else if (g?.mode === "pan" && pointers.size === 1 && view.scale > 1) {
      view.x = g.x + event.clientX - g.startX;
      view.y = g.y + event.clientY - g.startY;
      apply();
    }
  }
  function onUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    // At fit, a horizontal swipe moves to the neighbouring photograph.
    if (swipe && !pointers.size) {
      const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
    }
    swipe = null;
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      gesture = { mode: "pan", startX: p.x, startY: p.y, x: view.x, y: view.y };
    } else if (!pointers.size) gesture = null;
  }
  function onWheel(event: WheelEvent) {
    if (isVideo()) return;
    event.preventDefault();
    const rate = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    zoomAt(Math.exp(-event.deltaY * rate * 0.0015), event.clientX, event.clientY);
  }

  const [saving, setSaving] = createSignal(false);
  async function save() {
    if (saving()) return;
    setSaving(true);
    try { await download(props.shoot, [props.index]); } catch { /* The button stays available to retry. */ }
    finally { setSaving(false); }
  }

  props.api({
    key(event) {
      if (event.target instanceof HTMLVideoElement && event.key.startsWith("Arrow")) return false;
      if (event.key === "Tab") {
        const focusable = [...root.querySelectorAll<HTMLElement>("button:not([disabled]), video[controls]")].filter(el => el.getClientRects().length);
        const head = focusable[0], tail = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail?.focus(); }
        else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head?.focus(); }
        return true;
      }
      if (event.key === " " && isVideo() && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        if (video?.paused) void video.play(); else video?.pause();
        return true;
      }
      if (event.key.toLowerCase() === "d") { event.preventDefault(); void save(); return true; }
      if (event.key === "ArrowRight") { event.preventDefault(); go(1); return true; }
      if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); return true; }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(1.25); return true; }
      if (event.key === "-") { event.preventDefault(); zoomAt(0.8); return true; }
      if (event.key === "0" || event.key.toLowerCase() === "f") { event.preventDefault(); fit(); return true; }
      return false;
    },
  });

  // Each photograph opens at fit.
  createEffect(on(() => props.index, () => { setDetail(1); if (figure) fit(); }, { defer: true }));
  createEffect(on([stageW, stageH], () => apply(), { defer: true }));

  onMount(() => {
    stage.addEventListener("wheel", onWheel, { passive: false });
    close.focus();
  });
  onCleanup(() => {
    stage.removeEventListener("wheel", onWheel);
    if (opener?.isConnected) opener.focus();
  });

  // Nine neighbours on desktop, three on phones, centred on the open photograph.
  const strip = createMemo(() => {
    const n = count(), span = Math.min(n, props.narrow ? 3 : 9), first = -Math.floor(span / 2);
    return Array.from({ length: span }, (_, j) => ({ d: first + j, k: (props.index + first + j + n * 2) % n }));
  });

  return <div class="ns-lift" role="dialog" aria-modal="true" aria-label="Photograph preview" ref={root}>
    <div class="ns-lift__ambient" style={{ "background-image": background(photo()) }} />
    <div class="ns-lift__shade" />
    <div class="ns-lift__stage" classList={{ "ns-lift__stage--video": isVideo() }} ref={stage}
      style={{ inset: `${inset().top}px ${inset().side}px ${inset().bottom}px` }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onDblClick={event => { if (!isVideo()) { if (view.scale > 1.01) fit(); else zoomAt(2, event.clientX, event.clientY); } }}>
      <figure class="ns-lift__figure" classList={{ "ns-lift__figure--video": isVideo() }} ref={figure}
        style={{ "background-image": isVideo() ? "none" : background(photo()) }}>
        <Show when={photo()} keyed>{current => current.kind === "video"
          ? <video ref={video} class="ns-lift__video" controls playsinline preload="metadata" poster={mid(current)} aria-label={current.alt}>
              <Show when={current.video?.webm}><source src={current.video!.webm} type="video/webm" /></Show>
              <Show when={props.narrow && current.video?.mp4_720} fallback={<Show when={current.video?.mp4}><source src={current.video!.mp4} type="video/mp4" /></Show>}>
                <source src={current.video!.mp4_720} type="video/mp4" />
              </Show>
            </video>
          : <picture>
              <source type="image/avif" srcset={srcset(current, "avif")} sizes={`${Math.ceil(stageW() * detail())}px`} />
              <img class="ns-lift__img" src={mid(current)} srcset={srcset(current, "webp")} sizes={`${Math.ceil(stageW() * detail())}px`}
                alt={current.alt} draggable={false} decoding="async" fetchpriority="high"
                style={{ "max-width": `${stageW()}px`, "max-height": `${stageH()}px`, "aspect-ratio": current.width && current.height ? `${current.width} / ${current.height}` : undefined }}
                onLoad={event => { event.currentTarget.classList.add("is-loaded"); apply(); }} />
            </picture>}
        </Show>
      </figure>
    </div>
    <button type="button" class="ns-glass ns-nav ns-nav--prev" ref={el => refract(el, { strength: 22 })} aria-label="Previous photograph" onClick={() => go(-1)}><Arrow back /></button>
    <button type="button" class="ns-glass ns-nav ns-nav--next" ref={el => refract(el, { strength: 22 })} aria-label="Next photograph" onClick={() => go(1)}><Arrow /></button>
    <Show when={!isVideo()}>
      <div class="ns-glass ns-preview-zoom" ref={el => refract(el, { strength: 22 })} role="group" aria-label="Photo preview zoom">
        <button type="button" aria-label="Zoom photo out" onClick={() => zoomAt(0.8)}>−</button>
        <output ref={pct} aria-label="Photo zoom level">100%</output>
        <button type="button" aria-label="Zoom photo in" onClick={() => zoomAt(1.25)}>+</button>
        <button type="button" class="ns-preview-zoom__fit" aria-label="Fit whole photo" onClick={() => fit()}>Fit</button>
      </div>
    </Show>
    <div class="ns-glass ns-liftbar" ref={el => refract(el)}>
      <div class="ns-liftbar__id">
        <span class="ns-liftbar__title">{props.shoot.title}</span>
        <span class="ns-liftbar__count" aria-live="polite">{props.index + 1} / {count()}</span>
      </div>
      <div class="ns-liftbar__actions">
        <button type="button" class="ns-liftbar__btn" aria-label="Download this photo" disabled={saving()} onClick={() => void save()}>
          <DownloadIcon /><span class="ns-wide">{saving() ? "Saving…" : "Download"}</span>
        </button>
        <button type="button" class="ns-liftbar__btn ns-liftbar__close" aria-label="Close preview" ref={close} onClick={() => props.onClose()}>
          <span class="ns-wide">Close</span><span class="ns-liftbar__x">×</span>
        </button>
      </div>
    </div>
    <Show when={showStrip()}>
      <div class="ns-glass ns-strip" ref={el => refract(el)}>
        <div class="ns-strip__reel">
          <For each={strip()}>{item =>
            <button type="button" class="ns-strip__thumb" classList={{ "is-on": item.d === 0 }} aria-label={`Show ${props.shoot.photos[item.k].alt}`}
              aria-current={item.d === 0 ? "true" : undefined} onClick={() => props.onGo(item.k)}>
              <Thumb photo={props.shoot.photos[item.k]} loading="lazy" />
            </button>}</For>
        </div>
      </div>
    </Show>
  </div>;
}
