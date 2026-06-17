import type { Session } from "./session";

declare global {
  interface Env {
    SESSION: DurableObjectNamespace<Session>;
    // Shared secret guarding /reader/_api/* on the public apex. Only the gateway's
    // reader_send tool holds it. Set via: wrangler secret put READER_TOKEN.
    READER_TOKEN?: string;
  }
}

export {};
