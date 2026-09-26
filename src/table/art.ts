import type { PinColour } from "./layout";
export { default as loupeArt } from "../assets/loupe/preview-loupe.webp";

// Tape and pin sprites are Blender renders (see art/). Pins are centred on the
// needle; tape has translucent film edges so the print shows through.
const sprites = import.meta.glob<string>("../assets/{tape,pins}/*.webp", { eager: true, query: "?url", import: "default" });

export const tapeArt = (shape: "corner" | "strip", variant: number) => sprites[`../assets/tape/tape-${shape}-${variant}.webp`];
export const pinArt = (colour: PinColour, lean: number) => sprites[`../assets/pins/pin-${colour}-${lean}.webp`];
