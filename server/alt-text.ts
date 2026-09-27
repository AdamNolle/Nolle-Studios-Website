import sharp from 'sharp';
import type { Settings } from './settings.ts';
import type { AltTextStatus } from '../shared/api.ts';

// Drafts alt text with a local vision model behind an OpenAI-compatible API
// (llama.cpp's llama-server; see `npm run alt:model`). Drafts are suggestions:
// the Content Room shows them for review and nothing is saved as alt text
// until an editor accepts it.

const MAX = 125;
// Tuned against the portfolio: literal, short, and no guesses. The shoot title
// is deliberately left out; models treat it as something they can see. Avoid
// pose examples here: small vision models tend to repeat their example verb
// across an entire shoot instead of looking at each frame.
const PROMPT = [
  'Write concise alt text for a photograph in a professional portfolio.',
  'Describe the central subject first, then the directly visible action or posture, then the setting when useful.',
  'Use only observable facts. Do not infer intent, emotion, relationships, game state, or an action that a single frame does not prove.',
  'Choose literal verbs. If motion is unclear, describe the visible posture instead of guessing.',
  'For a moving object, describe its visible position unless its direction is unambiguous.',
  'Mention only visually important details. Never include names, team identity, visible text, numbers, brands, advertisements, image quality, or photographic technique.',
  'Before answering, verify that every noun and verb is supported by visible evidence.',
  'Return exactly one natural sentence of 8 to 16 words, without a label or introductory phrase.',
].join(' ');

export class AltTextUnavailable extends Error {}

/** Tidy a model reply into alt text: one sentence, no preamble, within the limit. */
export function cleanSuggestion(text: string) {
  let out = text.replace(/\s+/g, ' ').trim()
    .replace(/^(alt[- ]?text|description)\s*:\s*/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/^(a |an )?(close-up |black and white |color |colour )?(photo(graph)?|image|picture|shot) (of|showing|shows)\s+/i, '')
    .replace(/^this is\s+/i, '')
    .trim();
  out = out.split(/(?<=[.!?])\s+/)[0] ?? out;
  if (out.length > MAX) {
    const cut = out.slice(0, MAX + 1);
    out = cut.slice(0, Math.max(cut.lastIndexOf(' '), MAX - 20)).replace(/[\s,;:–—-]+$/, '');
  }
  out = out.replace(/[.\s]+$/, '');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export interface AltWriter {
  configured: boolean;
  status(): Promise<AltTextStatus>;
  /** Draft alt text for an image file or bytes. Calls run one at a time. */
  suggest(image: string | Buffer, context?: { video?: boolean }): Promise<string>;
}

export function createAltWriter(settings: Pick<Settings, 'altTextUrl' | 'altTextModel'>): AltWriter {
  const base = settings.altTextUrl;
  let queue: Promise<unknown> = Promise.resolve();
  let model = settings.altTextModel;

  async function request(image: string | Buffer, context: { video?: boolean }) {
    // 1280 px keeps small details legible (a bat versus a frisbee) at a few
    // seconds per image on a laptop GPU.
    const jpeg = await sharp(image, { limitInputPixels: 80_000_000 }).rotate()
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const hint = context.video ? 'This is the poster frame of a short video clip.' : '';
    let response: Response;
    try {
      response = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          ...(model ? { model } : {}),
          temperature: 0, max_tokens: 64,
          messages: [
            { role: 'system', content: PROMPT },
            { role: 'user', content: [
              { type: 'text', text: `Write the alt text. ${hint}`.trim() },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } },
            ] },
          ],
        }),
      });
    } catch {
      throw new AltTextUnavailable('The local alt-text model is offline. Check the local AI service and try again.');
    }
    if (!response.ok) throw new AltTextUnavailable(`The alt-text model returned ${response.status}.`);
    const data = await response.json() as { model?: string; choices?: { message?: { content?: string } }[] };
    if (data.model && !model) model = data.model;
    const text = cleanSuggestion(data.choices?.[0]?.message?.content ?? '');
    if (!text) throw new AltTextUnavailable('The alt-text model returned an empty description.');
    return text;
  }

  return {
    configured: !!base,
    async status() {
      if (!base) return { available: false, model: '' };
      try {
        // Both llama-server and Ollama expose this OpenAI-compatible endpoint;
        // Ollama intentionally has no /health route.
        const response = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(1500) });
        if (!response.ok) return { available: false, model };
        const models = await response.json().catch(() => null) as { data?: { id?: string }[] } | null;
        if (!model) model = models?.data?.[0]?.id ?? '';
        return { available: true, model: model.split('/').pop() ?? model };
      } catch { return { available: false, model }; }
    },
    suggest(image, context = {}) {
      if (!base) return Promise.reject(new AltTextUnavailable('Alt-text drafting is turned off. Set ALT_TEXT_URL to enable it.'));
      // One request at a time: a local model serves a single slot.
      const next = queue.then(() => request(image, context));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
