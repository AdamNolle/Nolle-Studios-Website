import { EmailMessage } from "cloudflare:email";
import { relay } from "./relay.mjs";

export default {
  async email(message, env) {
    await relay(message, env, (from, to, raw) => new EmailMessage(from, to, raw));
  },
};
