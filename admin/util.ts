export const localPreview = ["127.0.0.1", "localhost"].includes(location.hostname);
export const siteLabel = localPreview ? "Local site preview" : "nollestudios.com";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** "2026-09-20" → "20 SEP 2026". */
export function dateLabel(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[3]} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "UNDATED";
}

/** Newest shoot first; undated shoots last, in their saved order. */
export const ordered = <T extends { date: string; sortOrder: number }>(rows: readonly T[]) => [...rows].sort((a, b) =>
  (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || a.sortOrder - b.sortOrder);

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
export const frameCount = (count: number) => plural(count, "FRAME");
export const itemCount = (count: number) => plural(count, "ITEM");
export const photoCount = (count: number) => plural(count, "photograph");
export const changeCount = (count: number) => plural(count, "change");

export const runtime = (seconds = 0) => {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export function when(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(+date) ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export const today = () => new Intl.DateTimeFormat("en-US", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date()).toUpperCase();

export const pad2 = (value: number) => String(value).padStart(2, "0");

export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (!!target.closest("input, textarea, select") || target.isContentEditable);

export const fileSize = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
