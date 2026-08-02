import type { Session } from "./session";
import type { ReaderMcp } from "./mcp";

declare global {
  interface Env {
    SESSION: DurableObjectNamespace<Session>;
    READER_MCP: DurableObjectNamespace<ReaderMcp>; // anonymous /mcp endpoint (agents/McpAgent)
    // Shared secret guarding /_api/* on the public origin. Only the gateway's
    // reader_send tool holds it. Set via: wrangler secret put READER_TOKEN.
    READER_TOKEN?: string;
    // Anti-enumeration budgets (limit.ts, declared in wrangler.jsonc). Optional
    // in the type because unit tests and local runs have no binding — absence
    // allows the request, which is the right failure for a throttle.
    RL_ALL?: RateLimit;
    RL_FRESH?: RateLimit;
    RL_MCP?: RateLimit;
  }
}

export {};
