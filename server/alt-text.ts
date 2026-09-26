import sharp from 'sharp';
import type { Settings } from './settings.ts';
import type { AltTextStatus } from '../shared/api.ts';

// Drafts alt text with a local vision model behind an OpenAI-compatible API
// (llama.cpp's llama-server; see `npm run alt:model`). Drafts are suggestions:
// the Content Room shows them for review and nothing is saved as alt text
// until an editor accepts it.

const MAX = 125;
// Tuned against the portfolio: literal, short, and no guesses. The shoot title
// is deliberately left out; models treat it as something they can see.
const PROMPT = [
  "You write alt text for photographs in a photographer's portfolio.",
  'Look carefully and describe only what is clearly visible.',
  'Name the main subject, then what they are doing, then the setting.',
  'Choose the most ordinary reading of a pose: someone reaching out with one foot planted is stretching, not diving;',
  'someone mid-stride is running or walking.',
  'Give a number of people only when you can count them with certainty.',
  'Leave out time of year, events, team names, jersey numbers, and sign text.',
  'Reply with one sentence of 8 to 20 words and nothing else.',
  "Do not begin with 'A photo of' or 'An image of'.",
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
          temperature: 0.1, max_tokens: 80,
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
      throw new AltTextUnavailable('The local alt-text model is not running. Start it with npm run alt:model.');
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
        const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
        if (!health.ok) return { available: false, model };
        if (!model) {
          const models = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(1500) }).then(r => r.json()).catch(() => null) as { data?: { id?: string }[] } | null;
          model = models?.data?.[0]?.id ?? '';
        }
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
