export const ADDRESS = "hello@nollestudios.com";
export const RECIPIENTS = ["adammnolle@gmail.com", "jackn315@gmail.com"];
export const SUBJECT_PREFIX = "[NOLLESTUDIOS EMAIL]";

// Rewrite only the MIME headers. Keeping the body as bytes preserves attachment
// encodings, multipart boundaries, HTML, and international message content.
export function relayMessage(raw, recipient, envelopeSender, messageId) {
  const bytes = new Uint8Array(raw);
  let end = -1;
  let separatorLength = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      end = i;
      separatorLength = 4;
      break;
    }
    if (bytes[i] === 10 && bytes[i + 1] === 10) {
      end = i;
      separatorLength = 2;
      break;
    }
  }
  if (end < 0) throw new Error("Missing MIME header separator");

  const fields = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end))
    .split(/\r?\n(?![ \t])/)
    .map(field => {
      const colon = field.indexOf(":");
      if (colon < 1) throw new Error("Invalid MIME header");
      return { name: field.slice(0, colon).toLowerCase(), field, value: field.slice(colon + 1).trim() };
    });
  const value = name => fields.find(field => field.name === name)?.value;
  const subject = value("subject") || "(no subject)";
  const replyTo = value("reply-to") || value("from") || envelopeSender;
  const replaced = new Set([
    "from", "to", "cc", "bcc", "sender", "reply-to", "subject", "message-id",
    "return-path", "dkim-signature", "authentication-results", "received-spf",
    // Cloudflare owns these delivery headers; copying the inbound transport
    // history causes its live send API to reject otherwise valid MIME.
    "received", "date",
  ]);
  const preserved = fields.filter(({ name }) =>
    !replaced.has(name) && !name.startsWith("arc-") && !name.startsWith("resent-"));
  const headers = [
    `From: Nolle Studios <${ADDRESS}>`,
    `To: ${recipient}`,
    `Reply-To: ${replyTo}`,
    `Subject: ${subject.startsWith(SUBJECT_PREFIX) ? subject : `${SUBJECT_PREFIX} ${subject}`}`,
    `Message-ID: <${messageId}@nollestudios.com>`,
    ...preserved.map(({ field }) => field),
  ].join("\r\n");
  return new Blob([`${headers}\r\n\r\n`, bytes.subarray(end + separatorLength)]).stream();
}

export async function relay(message, env, makeMessage) {
  if (message.to.toLowerCase() !== ADDRESS || message.canBeForwarded === false) {
    message.setReject("This address cannot receive this message.");
    return;
  }
  const raw = await new Response(message.raw).arrayBuffer();
  // Attempt both deliveries even when one inbox fails. Cloudflare's normal
  // forwarding is the fallback so a relay failure does not lose the inquiry.
  const results = await Promise.allSettled(RECIPIENTS.map(async recipient => {
    try {
      const mime = relayMessage(raw, recipient, message.from, crypto.randomUUID());
      await env.MAILER.send(makeMessage(ADDRESS, recipient, mime));
    } catch {
      console.error("Subject relay failed; using original-message forwarding.");
      await message.forward(recipient);
    }
  }));
  if (results.every(result => result.status === "rejected")) {
    message.setReject("Email delivery is temporarily unavailable. Please try again later.");
  } else if (results.some(result => result.status === "rejected")) {
    console.error("One Nolle Studios inbox could not receive the message.");
  }
}
