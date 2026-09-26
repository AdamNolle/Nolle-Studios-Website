import { onCleanup } from "solid-js";
import normalMap from "../assets/glass/liquid-glass-normal.png";

// Liquid-glass refraction. art/liquid_glass.py renders the surface normals of
// a thick glass slab with a round shoulder; here that map is nine-sliced to
// each bar's size and drives an SVG feDisplacementMap, so the backdrop bends
// at the rim the way it does through real glass, with a little chromatic
// fringing. Chromium applies SVG filters to backdrop-filter; Safari and
// Firefox keep the frosted glass from the stylesheet.

const MAP_SLICE = 80, MAP_RADIUS = 48;
const SVG = "http://www.w3.org/2000/svg";
type Brands = { brands?: { brand: string }[] };
const supported = typeof navigator !== "undefined" &&
  !!(navigator as Navigator & { userAgentData?: Brands }).userAgentData?.brands?.some(b => b.brand === "Chromium") &&
  !matchMedia("(prefers-reduced-transparency: reduce)").matches;

let map: Promise<HTMLImageElement> | undefined;
const loadMap = () => map ??= new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = normalMap;
});

let defs: SVGDefsElement | undefined, count = 0;
function filterDefs() {
  if (!defs) {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    defs = document.createElementNS(SVG, "defs");
    svg.append(defs);
    document.body.append(svg);
  }
  return defs;
}

// One displacement per colour channel, each bent slightly less than the
// last, screened back together: the rim fringes like real glass. The scale
// is negative so every sample comes from inside the bar; samples from
// outside the filter region would be transparent and show as a dark line.
const CHANNELS = [[1, "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"], [0.96, "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"], [0.92, "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"]] as const;

function filterMarkup(id: string, strength: number, frost: number) {
  const bends = CHANNELS.map(([k, matrix], i) =>
    `<feDisplacementMap in="soft" in2="map" scale="${(-strength * k).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="d${i}"/>` +
    `<feColorMatrix in="d${i}" type="matrix" values="${matrix}" result="c${i}"/>`).join("");
  return `<filter id="${id}" x="0" y="0" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${frost}" edgeMode="duplicate" result="soft"/>` +
    `<feImage x="0" y="0" preserveAspectRatio="none" result="map"/>${bends}` +
    `<feBlend in="c0" in2="c1" mode="screen" result="rg"/><feBlend in="rg" in2="c2" mode="screen"/></filter>`;
}

/** Nine-slice the normal map to a bar's size and corner radius. */
function sliceMap(image: HTMLImageElement, w: number, h: number, radius: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const s = Math.min(MAP_SLICE * radius / MAP_RADIUS, w / 2, h / 2), size = image.naturalWidth;
  const src = [0, MAP_SLICE, size - MAP_SLICE, size], dx = [0, s, w - s, w], dy = [0, s, h - s, h];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (dx[i + 1] > dx[i] && dy[j + 1] > dy[j]) ctx.drawImage(image, src[i], src[j], src[i + 1] - src[i], src[j + 1] - src[j], dx[i], dy[j], dx[i + 1] - dx[i], dy[j + 1] - dy[j]);
  }
  return canvas.toDataURL();
}

/**
 * Give an element refracting liquid glass. Call from a ref; it rebuilds as
 * the element resizes and removes itself with the owning component.
 */
export function refract(el: HTMLElement, options: { strength?: number; frost?: number } = {}) {
  if (!supported) return;
  const id = `ns-glass-${++count}`;
  const host = document.createElementNS(SVG, "g");
  // On a thin bar the shoulder covers much of its height, so a strong bend
  // squeezes the backdrop into streaks; 16 px reads as clear, bent glass.
  host.innerHTML = filterMarkup(id, options.strength ?? 16, options.frost ?? 0.8);
  filterDefs().append(host);
  const filter = host.firstElementChild as SVGFilterElement, feImage = filter.querySelector("feImage")!;
  let frame = 0, last = "";
  const build = async () => {
    const image = await loadMap().catch(() => null);
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (!image || !w || !h || !el.isConnected) return;
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 16;
    const key = `${w}x${h}@${radius}`;
    if (key === last) return;
    last = key;
    for (const [name, value] of [["width", w], ["height", h]] as const) {
      filter.setAttribute(name, String(value));
      feImage.setAttribute(name, String(value));
    }
    feImage.setAttribute("href", sliceMap(image, w, h, radius));
    const value = `url(#${id}) saturate(1.45) brightness(1.04)`;
    el.style.setProperty("backdrop-filter", value);
    el.style.setProperty("-webkit-backdrop-filter", value);
    el.classList.add("is-refracting");
  };
  const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => void build()); });
  observer.observe(el);
  onCleanup(() => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    host.remove();
  });
}
