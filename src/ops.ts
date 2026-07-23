// The reader's core operations on a Session DO, shared by the two front doors so
// their append/render/delivery logic can't drift:
//   • the HTTP write API (index.ts /_api/*), reached by the OAuth gateway over a
//     service binding;
//   • the anonymous in-process MCP endpoint (mcp.ts), which calls these directly
//     on env.SESSION — no binding, no token.
import { render } from "./md";
import { normCode, isCode } from "./util";
import type { Choice, TapKind } from "./session";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Reading = { page: number; pages: number } | null;
export type Delivery = {
  code: string; v: number; title: string; choices: string[]; mode: "append" | "replace";
  connected: boolean; lastSeenS: number | null; pending: string | null; pendingKind: TapKind | null;
};
export type Status = {
  code: string; v: number; title: string; connected: boolean; lastSeenS: number | null;
  reading: Reading; pending: string | null; pendingKind: TapKind | null;
};

export type SendParams = { code?: string; content?: string; title?: string; choices?: string[]; mode?: string };

// Set (or append to) the document a reader code shows. Append re-renders the
// whole doc from concatenated markdown so the new html is an exact extension of
// the old — what the device keys on to hold the reading position (see md.ts).
// Returns delivery honesty from the same status the DO tracks: a send to a
// mistyped code must not look like delivery.
export async function sendDoc(env: Env, p: SendParams): Promise<Delivery | { error: string }> {
  const c = normCode(p.code || "");
  if (!isCode(c)) return { error: "bad code" };
  const stub = env.SESSION.get(env.SESSION.idFromName(c));
  const explicit = Array.isArray(p.choices) ? p.choices.filter((s) => typeof s === "string" && s.trim()).slice(0, 8) : null;
  let md = (p.content || "").trim();
  let opts = explicit ?? [];
  let wantTitle = p.title;
  const mode = p.mode === "append" ? "append" : "replace";
  if (mode === "append") {
    const prev = await stub.getMd();
    if (prev.md) md = `${prev.md}\n\n${md}`;
    if (!explicit) opts = prev.choices; // append leaves buttons alone unless told otherwise
    if (!wantTitle) wantTitle = prev.title || undefined;
  }
  const { title: t, html: body } = render(md, wantTitle);
  const v = await stub.setDoc(body, t, opts, md);
  const s = await stub.status();
  return {
    code: c, v, title: t, choices: opts, mode,
    connected: s.connected, lastSeenS: s.lastSeenS, pending: s.pending, pendingKind: s.pendingKind,
  };
}

// Block for the user's tap, chunked ≤30s per RPC so a DO eviction mid-wait costs
// one re-arm, not the whole timeout. minV scopes to answer-taps on that doc
// version or later; quick/explain taps are requests, never version-stale.
export async function awaitChoice(env: Env, code: string, timeoutMs: number, minV: number): Promise<Choice | null | { error: string }> {
  const c = normCode(code);
  if (!isCode(c)) return { error: "bad code" };
  const stub = env.SESSION.get(env.SESSION.idFromName(c));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const choice = await stub.waitChoice(minV, Math.min(deadline - Date.now(), 30_000));
      if (choice) return choice;
    } catch { await sleep(500); } // DO evicted mid-wait — re-arm
  }
  return null;
}

export async function readStatus(env: Env, code: string): Promise<Status | { error: string }> {
  const c = normCode(code);
  if (!isCode(c)) return { error: "bad code" };
  const s = await env.SESSION.get(env.SESSION.idFromName(c)).status();
  return {
    code: c, v: s.v, title: s.title, connected: s.connected, lastSeenS: s.lastSeenS,
    reading: s.reading ? { page: s.reading.page, pages: s.reading.pages } : null,
    pending: s.pending, pendingKind: s.pendingKind,
  };
}
