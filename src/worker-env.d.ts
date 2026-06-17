import type { Session } from "./session";

declare global {
  interface Env {
    SESSION: DurableObjectNamespace<Session>;
    // Shared secret guarding /read/_api/* on the public apex. Only the gateway's
    // send_to_reader tool holds it. Set via: wrangler secret put SEND_TOKEN.
    SEND_TOKEN?: string;
  }
}

export {};
