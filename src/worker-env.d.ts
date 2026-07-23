import type { Session } from "./session";

declare global {
  interface Env {
    SESSION: DurableObjectNamespace<Session>;
    // Shared secret guarding /_api/* on the public origin. Only the gateway's
    // reader_send tool holds it. Set via: wrangler secret put READER_TOKEN.
    READER_TOKEN?: string;
  }
}

export {};
