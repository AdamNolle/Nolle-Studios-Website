import assert from "node:assert/strict";
import test from "node:test";
import { ADDRESS, RECIPIENTS, SUBJECT_PREFIX, relay, relayMessage } from "./relay.mjs";

const raw = text => new TextEncoder().encode(text).buffer;
const read = stream => new Response(stream).text();

test("prefixes the subject, preserves reply address and MIME attachment bytes", async () => {
  const body = new Uint8Array([0, 255, 128, 13, 10, 45, 45, 97]);
  const headers = new TextEncoder().encode(
    'From: Photographer <photographer@example.com>\r\nTo: hello@nollestudios.com\r\nSubject: =?UTF-8?B?Qm9va2luZw==?=\r\n\tfor Saturday\r\nDKIM-Signature: invalid-after-rewrite\r\nARC-Seal: invalid-after-rewrite\r\nContent-Type: multipart/mixed; boundary="a"\r\n\r\n');
  const bytes = new Uint8Array(headers.length + body.length);
  bytes.set(headers);
  bytes.set(body, headers.length);
  const result = new Uint8Array(await new Response(relayMessage(bytes.buffer, RECIPIENTS[0], "bounce@example.com", "test")).arrayBuffer());
  const text = new TextDecoder().decode(result);
  assert.match(text, /Subject: \[NOLLESTUDIOS EMAIL\] =\?UTF-8\?B\?Qm9va2luZw==\?=\r\n\tfor Saturday/);
  assert.match(text, /Reply-To: Photographer <photographer@example.com>/);
  assert.match(text, /Content-Type: multipart\/mixed; boundary="a"/);
  assert.match(text, /From: Nolle Studios <hello@nollestudios.com>/);
  assert.match(text, /To: adammnolle@gmail.com/);
  assert.doesNotMatch(text, /DKIM-Signature|ARC-Seal/);
  assert.deepEqual(result.slice(-body.length), body);
});

test("uses an existing Reply-To, handles LF headers, and prefixes only once", async () => {
  const text = await read(relayMessage(raw(`From: sender@example.com\nReply-To: replies@example.com\nSubject: ${SUBJECT_PREFIX} Booking\n\nHello`), RECIPIENTS[0], "bounce@example.com", "test"));
  assert.match(text, /Reply-To: replies@example.com/);
  assert.equal(text.split(SUBJECT_PREFIX).length - 1, 1);
  assert.ok(text.endsWith("Hello"));
});

test("handles absent subject and rejects malformed MIME", async () => {
  const text = await read(relayMessage(raw("From: sender@example.com\r\n\r\nHello"), RECIPIENTS[0], "sender@example.com", "test"));
  assert.match(text, /Subject: \[NOLLESTUDIOS EMAIL\] \(no subject\)/);
  assert.throws(() => relayMessage(raw("broken"), RECIPIENTS[0], "sender@example.com", "test"));
});

const incoming = (overrides = {}) => ({
  to: ADDRESS,
  from: "sender@example.com",
  raw: new Blob(["From: sender@example.com\r\nSubject: Booking\r\n\r\nHello"]).stream(),
  setReject: () => assert.fail("unexpected rejection"),
  forward: () => assert.fail("unexpected fallback"),
  ...overrides,
});
const makeMessage = (from, to, raw) => ({ from, to, raw });

test("delivers independent prefixed messages to both inboxes", async () => {
  const delivered = [];
  await relay(incoming(), { MAILER: { async send(message) {
    delivered.push({ from: message.from, to: message.to, text: await read(message.raw) });
  } } }, makeMessage);
  assert.deepEqual(delivered.map(message => message.to).sort(), [...RECIPIENTS].sort());
  for (const message of delivered) {
    assert.equal(message.from, ADDRESS);
    assert.match(message.text, /Subject: \[NOLLESTUDIOS EMAIL\] Booking/);
    assert.match(message.text, /Reply-To: sender@example.com/);
  }
});

test("one relay failure falls back without interrupting the other delivery", async () => {
  const fallback = [];
  const delivered = [];
  await relay(incoming({ async forward(to) { fallback.push(to); } }), { MAILER: { async send(message) {
    if (message.to === RECIPIENTS[1]) throw new Error("relay unavailable");
    delivered.push(message.to);
  } } }, makeMessage);
  assert.deepEqual(delivered, [RECIPIENTS[0]]);
  assert.deepEqual(fallback, [RECIPIENTS[1]]);
});

test("rejects failed delivery to both destinations and unexpected inbound addresses", async () => {
  let rejection;
  const setReject = reason => { rejection = reason; };
  const unavailable = { MAILER: { async send() { throw new Error("unavailable"); } } };
  await relay(incoming({ setReject, async forward() { throw new Error("unavailable"); } }), unavailable, makeMessage);
  assert.match(rejection, /temporarily unavailable/);
  rejection = undefined;
  await relay(incoming({ to: "other@nollestudios.com", setReject }), unavailable, makeMessage);
  assert.match(rejection, /cannot receive/);
});
