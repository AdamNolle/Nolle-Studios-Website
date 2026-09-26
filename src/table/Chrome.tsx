import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import type { ArchiveShoot } from "../archive";
import { coverPhoto, thumb } from "./media";
import { refract } from "./glass";
import { download } from "./download";

const CONTACT_EMAIL = "hello@nollestudios.com";
const INSTAGRAM_HANDLE = "@nollestudios";
const INSTAGRAM_URL = "https://www.instagram.com/nollestudios/";

const HINTS_DESKTOP = [["← →", "TABLES"], ["CLICK", "OPEN A SHOOT"], ["?", "ALL KEYS"]] as const;
const HINTS_TOUCH = [["SWIPE", "MORE TABLES"], ["TAP", "OPEN A PHOTO"]] as const;
const KEY_GROUPS = [
  { title: "TABLE", rows: [["← →", "Move between shoots"], ["HOME / END", "Newest or oldest shoot"], ["CLICK", "Open a photograph’s shoot board"], ["SWIPE", "Move between shoots on touch"]] },
  { title: "SHOOT BOARD", rows: [["DRAG", "Pan the board"], ["SCROLL / PINCH", "Zoom"], ["ARROWS  + −", "Pan and zoom from the keyboard"], ["S", "Select photos to download"], ["ESC", "Back to the table"]] },
  { title: "PRINT PREVIEW", rows: [["← →", "Previous or next photo"], ["DOUBLE CLICK", "Zoom in"], ["SPACE", "Play or pause a video"], ["0 / F", "Fit to screen"], ["D", "Download this photo"], ["ESC", "Close"]] },
] as const;

const frames = (count: number) => `${count} ${count === 1 ? "FRAME" : "FRAMES"}`;
export const DownloadIcon = () =>
  <svg viewBox="0 0 24 24" aria-hidden="true" class="ns-icon"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" /></svg>;
const Chevron = (props: { back?: boolean }) =>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={props.back ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} /></svg>;

/** Fade a scroll area's lower edge while more of it is below, since it has no scroll bar. */
function fadeWhileScrollable(el: HTMLElement) {
  const update = () => el.classList.toggle("is-overflowing", el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  const observer = new ResizeObserver(update);
  observer.observe(el);
  el.addEventListener("scroll", update, { passive: true });
  onCleanup(() => observer.disconnect());
}

// ---- Header -----------------------------------------------------------------

interface HeaderProps {
  narrow: boolean;
  board: ArchiveShoot | null;
  zoom: number;
  /** The board is zoomed as far out as it goes: every print in view. */
  atFit: boolean;
  overlay: "about" | "help" | null;
  onHome(): void;
  onBack(): void;
  onZoom(factor: number): void;
  onFit(): void;
  /** Whether the board is picking photographs to download. */
  selecting: boolean;
  onSelect(): void;
  onOverlay(which: "about" | "help"): void;
}

export function Header(props: HeaderProps) {
  return <header class="ns-bar ns-glass" ref={el => refract(el)} classList={{ "ns-bar--board": !!props.board }}>
    <span class="ns-bar__glint" aria-hidden="true" />
    <div class="ns-bar__start">
      <Show when={props.board} fallback={
        <button type="button" class="ns-bar__mark" aria-label="Nolle Studios, newest shoot" onClick={() => props.onHome()}>
          <img src="/nolle-studios-mark.svg" alt="" width="38" height="38" draggable={false} />
        </button>
      }>
        <button type="button" class="ns-pill ns-pill--solid ns-pill--back" onClick={() => props.onBack()} aria-label={props.narrow ? "Back to the tables" : undefined}>
          <Chevron back /><span class="ns-wide">Tables</span>
        </button>
      </Show>
    </div>
    <div class="ns-bar__center">
      <Show when={props.board} fallback={<span class="ns-bar__brand">Nolle Studios</span>}>
        {shoot => <>
          <span class="ns-bar__title">{shoot().title}</span>
          <span class="ns-bar__meta">{shoot().displayDate} · {frames(shoot().photos.length)}</span>
        </>}
      </Show>
    </div>
    <nav class="ns-bar__end" aria-label="Site">
      <Show when={!props.board} fallback={
        <div class="ns-bar__tools">
        <button type="button" class="ns-pill ns-pill--select" classList={{ "is-active": props.selecting }} aria-pressed={props.selecting} onClick={() => props.onSelect()}>
          <DownloadIcon /><span class="ns-wide">Select</span><span class="ns-sr">photos to download</span>
        </button>
        <div class="ns-zoom" role="group" aria-label="Board zoom">
          <button type="button" aria-label="Zoom out" disabled={props.atFit} onClick={() => props.onZoom(0.8)}>−</button>
          <span class="ns-zoom__pct" aria-live="polite">{Math.round(props.zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => props.onZoom(1.25)}>+</button>
          <button type="button" class="ns-zoom__fit" onClick={() => props.onFit()}>Fit</button>
        </div>
        </div>
      }>
        <Show when={!props.narrow} fallback={
          <button type="button" class="ns-pill is-active" aria-expanded={props.overlay === "about"} onClick={() => props.onOverlay("about")}>
            <span class="ns-pill__dot" aria-hidden="true" />Info
          </button>
        }>
          <span class="ns-pill is-active" aria-current="page"><span class="ns-pill__dot" aria-hidden="true" />Tables</span>
          <button type="button" class="ns-pill" aria-expanded={props.overlay === "about"} onClick={() => props.onOverlay("about")}>About</button>
          <button type="button" class="ns-pill" onClick={() => props.onOverlay("about")}>Contact</button>
          <span class="ns-bar__rule" aria-hidden="true" />
          <button type="button" class="ns-keycap" aria-label="Keyboard and gesture help" aria-expanded={props.overlay === "help"} onClick={() => props.onOverlay("help")}>?</button>
        </Show>
      </Show>
    </nav>
  </header>;
}

// ---- Transport: a row of shoot covers --------------------------------------

interface TransportProps {
  shoots: ArchiveShoot[];
  current: number;
  narrow: boolean;
  reduce: boolean;
  onSelect(index: number): void;
}

export function Transport(props: TransportProps) {
  let chips!: HTMLDivElement;
  // Keep the open chip in view as the table moves.
  createEffect(on(() => props.current, (index, previous) => {
    const chip = chips.querySelector<HTMLElement>(`[data-chip="${index}"]`);
    if (!chip) return;
    const opened = props.narrow ? 170 : 270;
    chips.scrollTo({ left: Math.max(0, chip.offsetLeft - (chips.clientWidth - opened) / 2), behavior: previous === undefined || props.reduce ? "auto" : "smooth" });
  }));
  return <div class="ns-rail ns-glass" ref={el => refract(el)} role="group" aria-label="Shoots">
    <Show when={!props.narrow}>
      <button type="button" class="ns-rail__step" aria-label="Previous shoot" disabled={props.current === 0} onClick={() => props.onSelect(props.current - 1)}><Chevron back /></button>
    </Show>
    <div class="ns-rail__chips" ref={chips}>
      <For each={props.shoots}>{(shoot, index) => {
        const on = () => index() === props.current;
        return <button type="button" class="ns-chip" classList={{ "is-on": on() }} data-chip={index()} aria-current={on() ? "true" : undefined}
          aria-label={`${shoot.title}, ${shoot.displayDate}, ${shoot.photos.length} ${shoot.photos.length === 1 ? "frame" : "frames"}`}
          onClick={() => props.onSelect(index())}>
          <span class="ns-chip__stack" aria-hidden="true">
            <img src={thumb(coverPhoto(shoot))} alt="" draggable={false} loading={Math.abs(index() - props.current) < 6 ? "eager" : "lazy"} decoding="async" />
          </span>
          <span class="ns-chip__text" aria-hidden="true">
            <span class="ns-chip__title">{shoot.title}</span>
            <span class="ns-chip__meta">{shoot.displayDate.slice(0, 6)} · {frames(shoot.photos.length)}</span>
          </span>
        </button>;
      }}</For>
    </div>
    <Show when={!props.narrow}>
      <button type="button" class="ns-rail__step" aria-label="Next shoot" disabled={props.current === props.shoots.length - 1} onClick={() => props.onSelect(props.current + 1)}><Chevron /></button>
    </Show>
  </div>;
}

// ---- Idle hint ----------------------------------------------------------------

export function Hint(props: { on: boolean; narrow: boolean; onDismiss(): void }) {
  return <div class="ns-hint ns-glass" ref={el => refract(el, { strength: 24 })} classList={{ "is-on": props.on }} aria-hidden={!props.on}>
    <For each={props.narrow ? HINTS_TOUCH : HINTS_DESKTOP}>{([key, label]) =>
      <span class="ns-hint__item"><kbd>{key}</kbd>{label}</span>}</For>
    <button type="button" class="ns-hint__close" aria-label="Dismiss hints" tabIndex={props.on ? 0 : -1} onClick={() => props.onDismiss()}>×</button>
  </div>;
}

// ---- About and keys panels --------------------------------------------------

/** Move focus into a dialog, trap Tab inside it, and give focus back on close. */
function useDialog(root: () => HTMLElement, first: () => HTMLElement | undefined, onClose: () => void) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...root().querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")].filter(el => el.getClientRects().length);
    if (!focusable.length) return;
    const head = focusable[0], tail = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus(); }
    else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus(); }
  };
  onMount(() => {
    first()?.focus();
    // Capture phase: the dialog answers Escape before the table does.
    window.addEventListener("keydown", onKey, true);
  });
  onCleanup(() => {
    window.removeEventListener("keydown", onKey, true);
    if (opener?.isConnected) opener.focus();
  });
}

export function About(props: { shootCount: number; onClose(): void }) {
  let root!: HTMLDivElement, close!: HTMLButtonElement;
  useDialog(() => root, () => close, () => props.onClose());
  return <div class="ns-overlay ns-overlay--about" ref={root}>
    <div class="ns-overlay__scrim" aria-hidden="true" onClick={() => props.onClose()} />
    <aside class="ns-about ns-glass" ref={el => refract(el, { strength: 40, frost: 6 })} role="dialog" aria-modal="true" aria-labelledby="ns-about-title">
      <div class="ns-about__top">
        <span id="ns-about-title" class="ns-about__label">About</span>
        <button type="button" class="ns-about__close" aria-label="Close" ref={close} onClick={() => props.onClose()}>×</button>
      </div>
      <div class="ns-about__body ns-scroll" ref={fadeWhileScrollable}>
        <img class="ns-about__logo" src="/nolle-studios-header-on-dark.svg" alt="Nolle Studios" width="210" height="60" draggable={false} />
        <p class="ns-about__lead">Photographs laid out like prints on a table: every shoot, newest first.</p>
        <p class="ns-about__text">For prints, portraits, or a shoot of your own, get in touch.</p>
        <div class="ns-about__links">
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}<span>EMAIL ↗</span></a>
          <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">{INSTAGRAM_HANDLE}<span>INSTAGRAM ↗</span></a>
        </div>
        <div class="ns-about__foot">NOLLESTUDIOS.COM · {props.shootCount} {props.shootCount === 1 ? "SHOOT" : "SHOOTS"} ON THE TABLE</div>
      </div>
    </aside>
  </div>;
}

export function Keys(props: { onClose(): void }) {
  let root!: HTMLDivElement, close!: HTMLButtonElement;
  useDialog(() => root, () => close, () => props.onClose());
  return <div class="ns-overlay ns-overlay--keys" ref={root}>
    <div class="ns-overlay__scrim" aria-hidden="true" onClick={() => props.onClose()} />
    <div class="ns-keys ns-glass" ref={el => refract(el, { strength: 40, frost: 6 })} role="dialog" aria-modal="true" aria-labelledby="ns-keys-title">
      <div class="ns-keys__head">
        <h2 id="ns-keys-title">Moving around the table</h2>
        <button type="button" class="ns-keys__esc" ref={close} onClick={() => props.onClose()}>ESC TO CLOSE</button>
      </div>
      <div class="ns-keys__groups ns-scroll" ref={fadeWhileScrollable}>
        <For each={KEY_GROUPS}>{group => <section>
          <h3>{group.title}</h3>
          <For each={group.rows}>{([key, label]) => <div class="ns-keys__row"><kbd>{key}</kbd><span>{label}</span></div>}</For>
        </section>}</For>
      </div>
    </div>
  </div>;
}

// ---- Picking photographs to download ----------------------------------------

interface PickerProps {
  shoot: ArchiveShoot;
  picked: ReadonlySet<number>;
  narrow: boolean;
  onAll(): void;
  onClear(): void;
  onDone(): void;
}

/** The glass bar shown while selecting: count, select all, download. */
export function Picker(props: PickerProps) {
  const [busy, setBusy] = createSignal<number | null>(null);
  const [error, setError] = createSignal("");
  const count = () => props.picked.size, total = () => props.shoot.photos.length;
  async function save() {
    if (!count() || busy() !== null) return;
    setError("");
    setBusy(0);
    try {
      await download(props.shoot, [...props.picked], done => setBusy(done));
      props.onDone();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(null); }
  }
  return <div class="ns-glass ns-picker" ref={el => refract(el)} role="toolbar" aria-label="Download photographs">
    <span class="ns-picker__count" aria-live="polite">
      {error() || (busy() !== null ? `PREPARING ${busy()} OF ${count()}` : count() ? `${count()} SELECTED` : "TAP PHOTOS TO SELECT")}
    </span>
    <button type="button" class="ns-pill" onClick={() => count() === total() ? props.onClear() : props.onAll()}>
      {count() === total() ? "Clear" : props.narrow ? "All" : "Select all"}
    </button>
    <button type="button" class="ns-pill ns-pill--solid ns-picker__save" disabled={!count() || busy() !== null} onClick={() => void save()}>
      <DownloadIcon />{count() > 1 ? `Download ${count()}` : "Download"}
    </button>
    <button type="button" class="ns-picker__close" aria-label="Stop selecting" onClick={() => props.onDone()}>×</button>
  </div>;
}
