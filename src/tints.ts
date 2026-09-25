// Average colour of each photo, sampled once from its thumbnail, for tinting
// the timeline. Colours are lifted so even a dark frame reads on the dark rail.
export type RGB = [number, number, number];

const cache = new Map<string, RGB | null>();

function sample(img: HTMLImageElement): RGB {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 12;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context is unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, 12, 12);
  const data = ctx.getImageData(0, 0, 12, 12).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  const n = data.length / 4;
  return lift([r / n, g / n, b / n]);
}

// Push saturation up and keep lightness in a band that glows on dark glass.
function lift([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510;
  const s = max === min ? 0 : (max - min) / 255 / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max !== min) {
    const d = max - min;
    h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  }
  const S = Math.min(1, s * 1.35 + 0.12), L = Math.min(0.78, Math.max(0.62, l + 0.18));
  const C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs((h % 2) - 1)), m = L - C / 2;
  const [R, G, B] = h < 1 ? [C, X, 0] : h < 2 ? [X, C, 0] : h < 3 ? [0, C, X] : h < 4 ? [0, X, C] : h < 5 ? [X, 0, C] : [C, 0, X];
  return [Math.round((R + m) * 255), Math.round((G + m) * 255), Math.round((B + m) * 255)];
}

// Returns RGB after the thumbnail has been sampled, otherwise null and calls
// `ready` once loading ends so the timeline can repaint.
export function tintOf(src: string, ready: () => void): RGB | null {
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  cache.set(src, null);
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    try { cache.set(src, sample(img)); }
    catch { cache.set(src, [236, 240, 245]); }
    ready();
  };
  img.onerror = () => { cache.set(src, [236, 240, 245]); ready(); };
  img.src = src;
  return null;
}
