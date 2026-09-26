import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import type { ArchiveShoot } from "../archive";
import { runtime, sheetLayout, sheetOffsets, tableFrame } from "./layout";
import { background } from "./media";
import Picture from "./Picture";
import { About, Header, Hint, Keys, Picker, Transport } from "./Chrome";
import Board from "./Board";
import type { BoardApi } from "./Board";
import Preview from "./Preview";
import type { PreviewApi } from "./Preview";
import Loupe from "./Loupe";

const HINT_KEY = "ns-hints-seen";
const frames = (count: number) => `${count} ${count === 1 ? "FRAME" : "FRAMES"}`;

/**
 * The light table: contact sheets for every shoot laid across a cork board.
 * A shoot opens as a board of pinned and taped prints, and a print opens
 * full screen. All state lives in fine-grained signals, so moving between
 * shoots updates a handful of style properties rather than re-rendering.
 */
export default function LightTable(props: { shoots: ArchiveShoot[]; initialShoot: string | null }) {
  let stage!: HTMLDivElement;
  const shoots = props.shoots;
  const [current, setCurrent] = createSignal(Math.max(0, shoots.findIndex(shoot => shoot.id === props.initialShoot)));
  const [board, setBoard] = createSignal<{ e: number; k: number } | null>(null);
  const [lifted, setLifted] = createSignal<number | null>(null);
  const [overlay, setOverlay] = createSignal<"about" | "help" | null>(null);
  const [hint, setHint] = createSignal(false);
  const [size, setSize] = createSignal({ w: window.innerWidth, h: window.innerHeight });
  const [dragX, setDragX] = createSignal<number | null>(null);
  const [zoom, setZoom] = createSignal(1);
  const [atFit, setAtFit] = createSignal(true);
  /** Frames picked for download on the open board; null when not selecting. */
  const [picked, setPicked] = createSignal<ReadonlySet<number> | null>(null);
  const toggleSelecting = () => setPicked(picked() ? null : new Set<number>());
  const pick = (k: number) => {
    const next = new Set(picked());
    if (next.has(k)) next.delete(k); else next.add(k);
    setPicked(next);
  };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const [reduce, setReduce] = createSignal(motion.matches);
  const narrow = () => size().w < 760;
  let boardApi: BoardApi | undefined, previewApi: PreviewApi | undefined;

  const layouts = createMemo(() => shoots.map(shoot => sheetLayout(shoot.photos.length, narrow(), size().w, size().h)));
  const offsets = createMemo(() => sheetOffsets(layouts().map(layout => layout.w), current(), narrow() ? 34 : 56));
  // Only sheets near the current one are in the DOM; the rest are off the table.
  const nearby = createMemo(() => shoots.map((_, i) => i).filter(i => Math.abs(i - current()) <= 2));
  const boardShoot = () => { const b = board(); return b ? shoots[b.e] : null; };

  // ---- Idle hints ------------------------------------------------------------
  let hintDone = false, hintTimer = 0, hintHide = 0;
  /** Any deliberate movement retires the idle hint for this visit. */
  function touch() {
    if (hintDone) return;
    hintDone = true;
    clearTimeout(hintTimer); clearTimeout(hintHide);
    setHint(false);
  }

  function go(index: number) {
    touch();
    setCurrent(Math.max(0, Math.min(shoots.length - 1, index)));
  }
  function openBoard(e: number, k: number) {
    touch();
    batch(() => { setZoom(1); setPicked(null); setBoard({ e, k }); });
  }
  function closeBoard() {
    const b = board();
    batch(() => { setLifted(null); setPicked(null); setBoard(null); });
    if (b) queueMicrotask(() => stage.querySelector<HTMLElement>(`[data-shoot-index="${b.e}"][data-photo-index="${b.k}"]`)?.focus({ preventScroll: true }));
  }

  // ---- Swipe and wheel on the table -----------------------------------------
  let swipe: { id: number; x: number; y: number; t: number } | null = null, suppressClick = false;
  const chrome = ".ns-bar, .ns-rail, .ns-hint, .ns-overlay, .ns-lift, .ns-board";
  function onDown(event: PointerEvent) {
    suppressClick = false;
    if (board() || overlay() || event.button > 0 || (event.target as Element).closest(chrome)) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now() };
  }
  function onMove(event: PointerEvent) {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    if (dragX() === null && Math.abs(dx) < 8) return;
    if (dragX() === null && Math.abs(event.clientY - swipe.y) > Math.abs(dx)) { swipe = null; return; }
    suppressClick = true;
    // Resist past the first and last shoot.
    const edge = (dx > 0 && current() === 0) || (dx < 0 && current() === shoots.length - 1);
    setDragX(edge ? dx / 3 : dx);
  }
  function onUp(event: PointerEvent) {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x, speed = Math.abs(dx) / Math.max(1, performance.now() - swipe.t);
    swipe = null;
    if (dragX() === null) return;
    batch(() => {
      if (Math.abs(dx) > 50 || (Math.abs(dx) > 20 && speed > 0.45)) go(current() + (dx < 0 ? 1 : -1));
      setDragX(null);
    });
  }
  let wheelAt = 0, wheelSum = 0, wheelUsed = false;
  function onWheel(event: WheelEvent) {
    if (board() || lifted() !== null || overlay()) return;
    event.preventDefault();
    const time = performance.now();
    if (time - wheelAt > 240) { wheelSum = 0; wheelUsed = false; }
    wheelAt = time;
    if (wheelUsed) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    wheelSum += (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
    // One shoot per gesture, however long the trackpad keeps scrolling.
    if (Math.abs(wheelSum) >= 28) { wheelUsed = true; go(current() + Math.sign(wheelSum)); }
  }

  // ---- Keyboard ----------------------------------------------------------------
  function onKey(event: KeyboardEvent) {
    if (overlay() || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (lifted() !== null) {
      if (event.key === "Escape") { event.preventDefault(); setLifted(null); }
      else previewApi?.key(event);
      return;
    }
    if (board()) {
      const step = event.shiftKey ? 320 : 140;
      const pan: Record<string, [number, number]> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] };
      if (event.key === "Escape") { event.preventDefault(); if (picked()) setPicked(null); else closeBoard(); }
      else if (event.key.toLowerCase() === "s") { event.preventDefault(); toggleSelecting(); }
      else if (pan[event.key]) { event.preventDefault(); boardApi?.pan(...pan[event.key]); }
      else if (event.key === "+" || event.key === "=") boardApi?.zoomBy(1.25);
      else if (event.key === "-") boardApi?.zoomBy(0.8);
      else if (event.key === "0" || event.key.toLowerCase() === "f") boardApi?.fit();
      return;
    }
    if (event.key === "ArrowRight") { event.preventDefault(); go(current() + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); go(current() - 1); }
    else if (event.key === "Home") { event.preventDefault(); go(0); }
    else if (event.key === "End") { event.preventDefault(); go(shoots.length - 1); }
    else if (event.key === "?") { event.preventDefault(); touch(); setOverlay("help"); }
  }

  onMount(() => {
    const resize = new ResizeObserver(entries => {
      const box = entries[entries.length - 1].contentRect;
      if (box.width && box.height) setSize({ w: Math.round(box.width), h: Math.round(box.height) });
    });
    resize.observe(stage);
    const onMotion = () => setReduce(motion.matches);
    motion.addEventListener("change", onMotion);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    stage.addEventListener("wheel", onWheel, { passive: false });
    // Hints appear only if the visitor hasn't moved the table after a few
    // seconds, then fade out. They show once per browser session.
    try { hintDone = !!sessionStorage.getItem(HINT_KEY); } catch { /* Storage unavailable. */ }
    if (!hintDone) hintTimer = window.setTimeout(() => {
      if (hintDone || overlay() || board()) return;
      try { sessionStorage.setItem(HINT_KEY, "1"); } catch { /* Storage unavailable. */ }
      setHint(true);
      hintHide = window.setTimeout(touch, 7000);
    }, 3500);
    onCleanup(() => {
      resize.disconnect();
      motion.removeEventListener("change", onMotion);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("wheel", onWheel);
      clearTimeout(hintTimer); clearTimeout(hintHide);
    });
  });

  // The address names the open shoot, so it can be shared or reloaded.
  createEffect(on(current, index => {
    const url = new URL(location.href);
    url.searchParams.set("shoot", shoots[index].id);
    history.replaceState(history.state, "", url);
  }, { defer: true }));

  const Sheet = (p: { index: number }) => {
    const shoot = shoots[p.index];
    const layout = () => layouts()[p.index];
    const distance = () => p.index - current();
    const isCurrent = () => distance() === 0;
    const transform = () => {
      const d = distance(), x = offsets()[p.index] + (dragX() ?? 0);
      return `translate(-50%,-50%) translate3d(${x.toFixed(1)}px,${(p.index % 2 ? 1 : -1) * 7}px,0) rotate(${(d * 0.45).toFixed(2)}deg) scale(${(1 - Math.min(Math.abs(d), 2) * 0.035).toFixed(3)})`;
    };
    const cell = (span: [number, number, number, number]) => {
      const l = layout(), track = (l.w - l.pad * 2 - l.gap * (l.tracks - 1)) / l.tracks;
      return Math.ceil(track * span[3] + l.gap * (span[3] - 1));
    };
    return <div class="ns-sheet" data-shoot-index={p.index} style={{ width: `${layout().w}px`, transform: transform() }}
      onClick={() => { if (!suppressClick && !isCurrent()) go(p.index); }}>
      <div class="ns-sheet__shadow" />
      <div class="ns-sheet__body" style={{ padding: `${layout().pad + 16}px ${layout().pad}px ${layout().pad}px` }}>
        <div class="ns-sheet__sheen" />
        <div class="ns-sheet__head">
          <h2 class="ns-sheet__title">{shoot.title}</h2>
          <span class="ns-sheet__date"><span>{frames(shoot.photos.length)}</span><span>{shoot.displayDate}</span></span>
        </div>
        <div class="ns-sheet__grid" style={{ gap: `${layout().gap}px`, "grid-template-columns": `repeat(${layout().tracks},minmax(0,1fr))`, "grid-auto-rows": `${layout().rowH}px` }}>
          <For each={layout().plan}>{(span, slot) => {
            const photo = shoot.photos[slot()];
            const more = () => slot() === layout().visible - 1 ? layout().more : 0;
            return <div class="ns-frame" style={{ "grid-area": `${span[0]} / ${span[1]} / span ${span[2]} / span ${span[3]}` }}>
              <button type="button" class="ns-frame__btn" data-shoot-index={p.index} data-photo-index={slot()} tabIndex={isCurrent() ? 0 : -1}
                aria-label={more() ? `Open ${shoot.title}, ${more()} more photographs` : `Open ${photo.alt}`}
                onClick={event => { event.stopPropagation(); if (suppressClick) return; if (!isCurrent()) go(p.index); else openBoard(p.index, slot()); }}>
                <Picture photo={photo} class="ns-frame__img" alt={photo.alt} sizes={`${cell(span)}px`}
                  eager={Math.abs(distance()) <= 1} priority={isCurrent() && slot() < 4} loupe={background(photo)} />
                <Show when={photo.kind === "video"}>
                  <span class="ns-video-badge" aria-hidden="true"><svg viewBox="0 0 10 10" width="8" height="8"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>{runtime(photo.duration)}</span>
                </Show>
                <Show when={more()}><span class="ns-frame__more" aria-hidden="true">+{more()}</span></Show>
              </button>
              <div class="ns-frame__edge" />
            </div>;
          }}</For>
        </div>
        <div class="ns-sheet__dim" style={{ opacity: (Math.min(Math.abs(distance()), 1.8) * 0.34).toFixed(2) }} />
      </div>
    </div>;
  };

  const shootAnnouncement = () => { const shoot = shoots[current()]; return `${shoot.title}, ${shoot.displayDate}, ${frames(shoot.photos.length).toLowerCase()}`; };

  return <div class="ns-stage" ref={stage}>
    <div class="ns-cork" aria-hidden="true">
      <div class="ns-cork__base" />
      <div class="ns-cork__tile" style={{ transform: `translate3d(${(-current() * 54 + (dragX() ?? 0) * 0.15).toFixed(1)}px,${-current() * 12}px,0)` }} />
      <div class="ns-cork__tone" />
      <div class="ns-cork__light" />
      <div class="ns-cork__edge" />
    </div>

    <Show when={!board()}>
      <div class="ns-tabletop" aria-hidden="true" onClick={() => { if (!suppressClick) go((current() + 1) % shoots.length); }} />
      <div class="ns-table" classList={{ "is-dragging": dragX() !== null }} style={{ top: `${tableFrame(narrow(), size().h).centerY}px` }}>
        <For each={nearby()}>{index => <Sheet index={index} />}</For>
      </div>
      <Loupe stage={() => stage} enabled={() => !board() && !overlay() && dragX() === null} />
    </Show>

    <Show when={board()} keyed>{b =>
      <Board shoot={shoots[b.e]} seed={b.e} focus={b.k} narrow={narrow()} width={size().w} height={size().h} reduce={reduce()}
        picked={picked()} onOpen={k => picked() ? pick(k) : setLifted(k)} onZoom={(z, fit) => batch(() => { setZoom(z); setAtFit(fit); })} api={api => { boardApi = api; }} />}
    </Show>

    <Header narrow={narrow()} board={boardShoot()} zoom={zoom()} atFit={atFit()} overlay={overlay()}
      onHome={() => go(0)} onBack={closeBoard} onZoom={factor => boardApi?.zoomBy(factor)} onFit={() => boardApi?.fit()}
      selecting={!!picked()} onSelect={toggleSelecting}
      onOverlay={which => { touch(); setOverlay(which); }} />

    <Show when={!board()}>
      <Transport shoots={shoots} current={current()} narrow={narrow()} reduce={reduce()} onSelect={go} />
      <Hint on={hint()} narrow={narrow()} onDismiss={touch} />
    </Show>
    <Show when={board() && picked()}>{set =>
      <Picker shoot={boardShoot()!} picked={set()} narrow={narrow()} onAll={() => setPicked(new Set(boardShoot()!.photos.map((_, i) => i)))}
        onClear={() => setPicked(new Set<number>())} onDone={() => setPicked(null)} />}
    </Show>
    <div class="ns-sr" aria-live="polite">{board() ? "" : shootAnnouncement()}</div>

    <Show when={overlay() === "about"}><About shootCount={shoots.length} onClose={() => setOverlay(null)} /></Show>
    <Show when={overlay() === "help"}><Keys onClose={() => setOverlay(null)} /></Show>

    <Show when={board() && lifted() !== null}>
      <Preview shoot={boardShoot()!} index={lifted()!} narrow={narrow()} width={size().w} height={size().h}
        onGo={setLifted} onClose={() => setLifted(null)} api={api => { previewApi = api; }} />
    </Show>
  </div>;
}
