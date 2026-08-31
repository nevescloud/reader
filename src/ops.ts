// The reader's core operations on a Session DO, shared by the two front doors so
// their append/render/delivery logic can't drift:
//   • the HTTP write API (index.ts /_api/*), reached by the OAuth gateway over a
//     service binding;
//   • the anonymous in-process MCP endpoint (mcp.ts), which calls these directly
//     on env.SESSION — no binding, no token.
import { render } from "./md";
import { normCode, isCode } from "./util";
import type { Choice, DrillWait, Progress, TapKind } from "./session";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared shape of awaitChoice/awaitDrillReport: block on a DO RPC in ≤30s
// chunks (a single call any longer risks the DO being evicted mid-wait, which
// throws) until `keepWaiting` says stop or the deadline passes. Pulled out
// because the two callers disagree on what a null poll result means: a
// choice-wait treats it as "still nothing, keep chunking"; a report-wait
// treats it as "no drill running, nothing to wait for" and returns immediately
// — so the stop condition is the caller's to supply, not this helper's.
async function chunkedWait<T>(timeoutMs: number, poll: (chunkMs: number) => Promise<T | null>, keepWaiting: (r: T | null) => boolean): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null = null;
  while (Date.now() < deadline) {
    try {
      last = await poll(Math.min(deadline - Date.now(), 30_000));
    } catch { await sleep(500); continue; } // DO evicted mid-wait — re-arm
    if (!keepWaiting(last)) return last;
  }
  return last;
}

export type Reading = { page: number; pages: number } | null;
export type Delivery = {
  code: string; v: number; title: string; choices: string[]; mode: "append" | "replace";
  connected: boolean; lastSeenS: number | null; pending: string | null; pendingKind: TapKind | null;
};
export type Status = {
  code: string; v: number; title: string; connected: boolean; lastSeenS: number | null;
  reading: Reading; pending: string | null; pendingKind: TapKind | null; drill: Progress | null;
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
  const v = await stub.setDoc(body, t, opts, md, mode);
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
  return chunkedWait(timeoutMs, (chunkMs) => stub.waitChoice(minV, chunkMs), (choice) => !choice);
}

export async function readStatus(env: Env, code: string): Promise<Status | { error: string }> {
  const c = normCode(code);
  if (!isCode(c)) return { error: "bad code" };
  const s = await env.SESSION.get(env.SESSION.idFromName(c)).status();
  return {
    code: c, v: s.v, title: s.title, connected: s.connected, lastSeenS: s.lastSeenS,
    reading: s.reading ? { page: s.reading.page, pages: s.reading.pages } : null,
    pending: s.pending, pendingKind: s.pendingKind, drill: s.drill,
  };
}

// ---- deck mode (drill.ts) ---------------------------------------------------
// Hand the DO a whole deck and it runs the loop itself: score the tap, render
// feedback, turn the page. The agent's work moves to the edges — author the deck
// here, read the report at the end.

export async function startDrill(env: Env, code: string, deck: unknown): Promise<{ code: string; v: number; title: string; total: number; connected: boolean; lastSeenS: number | null } | { error: string }> {
  const c = normCode(code);
  if (!isCode(c)) return { error: "bad code" };
  const stub = env.SESSION.get(env.SESSION.idFromName(c));
  const r = await stub.startDrill(deck);
  if ("error" in r) return r;
  const s = await stub.status();
  return { code: c, v: r.v, title: r.title, total: r.total, connected: s.connected, lastSeenS: s.lastSeenS };
}

// Blocks for the finished report, chunked ≤30s per RPC like awaitChoice so a DO
// eviction mid-wait costs one re-arm. On timeout returns progress instead — a
// deck takes minutes, far longer than any single tool call should hold.
export async function awaitDrillReport(env: Env, code: string, timeoutMs: number): Promise<DrillWait | null | { error: string }> {
  const c = normCode(code);
  if (!isCode(c)) return { error: "bad code" };
  const stub = env.SESSION.get(env.SESSION.idFromName(c));
  // Keep chunking while there's a drill running with no report yet (progress,
  // no report field); stop as soon as it's null (nothing running) or a report
  // lands (finished or cancelled).
  return chunkedWait(timeoutMs, (chunkMs) => stub.waitReport(chunkMs), (last) => !!last && !last.report);
}

export async function resumeDrill(env: Env, code: string): Promise<{ code: string; v: number; progress: Progress } | { error: string }> {
  const c = normCode(code);
  if (!isCode(c)) return { error: "bad code" };
  const r = await env.SESSION.get(env.SESSION.idFromName(c)).resumeDrill();
  return "error" in r ? r : { code: c, v: r.v, progress: r.progress };
}
