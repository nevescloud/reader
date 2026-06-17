import type { Session } from "./session";

declare global {
  interface Env {
    SESSION: DurableObjectNamespace<Session>;
  }
}

export {};
