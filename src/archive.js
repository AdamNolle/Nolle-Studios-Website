// Everything on the light table comes from here.

// One roll per shoot, newest first: [name, date, frames shot].
export const EVENTS = [
  ["Ballpark Semifinal", "12 SEP 2026", 84], ["Rose Garden, First Light", "02 SEP 2026", 41],
  ["Club Circuit Night Race", "23 AUG 2026", 212], ["Marina's Studio Sitting", "09 AUG 2026", 63],
  ["Coastal Run, Highway 1", "27 JUL 2026", 128], ["Summer Rooftop", "04 JUL 2026", 176],
  ["Hillclimb Practice", "14 JUN 2026", 240], ["Portraits: The Quartet", "30 MAY 2026", 52],
  ["Lake Cabin Weekend", "11 MAY 2026", 97], ["Paddock, Round Two", "19 APR 2026", 305],
  ["Cherry Blossom Walk", "28 MAR 2026", 66], ["Winter Testing", "07 FEB 2026", 188]
];

// Frames cycle through this set by index. Each photo needs a thumbnail
// (~420px wide, contact sheets and prints) and a mid (~1500px wide, loupe and
// full-screen preview) in public/photos/.
const PHOTOS = [1, 2, 3, 4, 5, 6, 7].map(n => ({
  thumb: "photos/t0" + n + ".jpg",
  mid: "photos/m0" + n + ".jpg"
}));

const BASE = import.meta.env.BASE_URL;
const at = i => PHOTOS[((i % PHOTOS.length) + PHOTOS.length) % PHOTOS.length];
export const TH = i => BASE + at(i).thumb;
export const MID = i => BASE + at(i).mid;
