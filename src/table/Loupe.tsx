import { onCleanup, onMount } from "solid-js";
import { loupeArt } from "./art";

const ZOOM = 1.8, LENS = 88, RADIUS = LENS / 2;

/**
 * A stand loupe that follows a fine pointer over contact-sheet frames and
 * magnifies the mid-size image under it. It writes straight to the DOM and
 * animates only while the pointer moves, so an idle table costs nothing.
 */
export default function Loupe(props: { stage: () => HTMLElement | undefined; enabled: () => boolean }) {
  let root!: HTMLDivElement, body!: HTMLDivElement, lens!: HTMLDivElement, render!: HTMLImageElement;
  let px: number | null = null, py: number | null = null, lx = 0, ly = 0, on = false, raf = 0, last = 0, source = "";
  const fine = matchMedia("(hover: hover) and (pointer: fine)");

  function show(visible: boolean) {
    if (on === visible) return;
    on = visible;
    // Touch screens never show the loupe, so its art loads on first use.
    if (visible && !render.src) render.src = loupeArt;
    body.classList.toggle("is-on", visible);
  }

  function frame(time: number) {
    raf = 0;
    const stage = props.stage();
    if (!stage || px === null || py === null || !props.enabled() || !fine.matches) return show(false);
    const hit = document.elementFromPoint(px, py);
    const img = hit?.closest<HTMLImageElement>("img[data-loupe]");
    if (!img || !img.naturalWidth || !img.naturalHeight) return show(false);
    const s = stage.getBoundingClientRect(), tx = px - s.left, ty = py - s.top;
    const dt = Math.min(0.05, (time - (last || time - 16)) / 1000);
    last = time;
    if (!on) { lx = tx; ly = ty; }
    else { const k = 1 - Math.exp(-dt * 24); lx += (tx - lx) * k; ly += (ty - ly) * k; }
    show(true);
    root.style.transform = `translate3d(${lx.toFixed(2)}px,${ly.toFixed(2)}px,0)`;
    // Reproduce object-fit: cover at object-position 50% 30% inside the lens,
    // so the magnified crop matches the frame.
    const r = img.getBoundingClientRect();
    const cover = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const drawnW = img.naturalWidth * cover, drawnH = img.naturalHeight * cover;
    const cropX = (r.width - drawnW) * 0.5, cropY = (r.height - drawnH) * 0.3;
    const cx = lx + s.left, cy = ly + s.top;
    const wanted = img.dataset.loupe ?? "";
    if (wanted !== source) { source = wanted; lens.style.backgroundImage = wanted; }
    lens.style.backgroundSize = `${(drawnW * ZOOM).toFixed(1)}px ${(drawnH * ZOOM).toFixed(1)}px`;
    lens.style.backgroundPosition = `${(RADIUS - (cx - r.left - cropX) * ZOOM).toFixed(1)}px ${(RADIUS - (cy - r.top - cropY) * ZOOM).toFixed(1)}px`;
    // Keep easing until the lens catches the pointer.
    if (Math.abs(tx - lx) > 0.3 || Math.abs(ty - ly) > 0.3) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const request = () => { if (!raf) raf = requestAnimationFrame(frame); };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    px = event.clientX; py = event.clientY;
    request();
  };
  const onLeave = () => { px = null; request(); };
  const onDown = () => { px = null; show(false); };

  onMount(() => {
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    // Scrolling or a table move changes what is under a still pointer.
    window.addEventListener("transitionend", request, { passive: true });
  });
  onCleanup(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    document.documentElement.removeEventListener("mouseleave", onLeave);
    window.removeEventListener("transitionend", request);
  });

  return <div class="ns-loupe" ref={root} aria-hidden="true">
    <div class="ns-loupe__body" ref={body}>
      <img class="ns-loupe__render" ref={render} alt="" draggable={false} />
      <div class="ns-loupe__glass">
        <div class="ns-loupe__img" ref={lens} />
        <div class="ns-loupe__falloff" />
        <div class="ns-loupe__tint" />
      </div>
    </div>
  </div>;
}
