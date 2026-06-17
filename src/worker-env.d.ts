import type { Session } from "./session";

declare global {
  interface Env {
    LIVE: DurableObjectNamespace;
    SESSION: DurableObjectNamespace<Session>;
  }
}

export {};
