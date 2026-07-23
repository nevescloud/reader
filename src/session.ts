import { DurableObject } from "cloudflare:workers";

// One instance per reader code. Holds the current document + a monotonic version
// the reader polls against, plus a pending tap (the user's choice) that the
// reader_await tool consumes. Self-deletes after 6h of silence from both sides.
const TTL_MS = 6 * 60 * 60 * 1000;
// Must exceed the client's slowest intentional poll interval (30s deep-idle,
// pages.ts pollDelay) or a healthy device reading quietly reports as asleep.
const CONNECTED_MS = 45_000;

// The client's always-on quick actions. A quick tap is a *request* (simpler /
// more / explain), not an answer to the current doc — it survives a new send,
// where an answer-tap would be stale and is cleared. Kind travels on the tap
// wire (`k=` param) now; the label list remains as a fallback for taps from
// client pages loaded before kinds existed.
const QUICK = ["↻ simpler", "→ more", "✎ explain"];

export type TapKind = "answer" | "quick" | "explain";
// Explain taps carry a quote locator, not context: the driving session authored
// the doc, so quote + approximate before/after anchors are enough to find the
// spot in its own copy. granularity says what the user designated.
export type Target = { before: string; after: string; granularity: "word" | "sentence" | "block" };
export type Choice = { label: string; at: number; v: number; kind?: TapKind; target?: Target };
type Read = { page: number; pages: number; at: number };
type Waiter = { minV: number; resolve: (c: Choice | null) => void; timer: ReturnType<typeof setTimeout> };

const kindOf = (c: Choice): TapKind => c.kind ?? (QUICK.indexOf(c.label) !== -1 ? "quick" : "answer");
// Requests (quick, explain) survive a new send; only answer-taps go stale with their doc.
const isRequest = (c: Choice): boolean => kindOf(c) !== "answer";

export class Session extends DurableObject {
  // Tap feed: /w/<code> upgrades here. Each recorded tap goes out as one
  // frame, so a harness-side watcher (e.g. Claude Code's Monitor ws mode) can
  // wake on a tap instead of polling. Read-only — same capability model as the
  // content poll: holding the code is holding the feed. Hibernation API keeps
  // an idle socket free.
  async fetch(req: Request): Promise<Response> {
    if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    // Hello frame carries current state so a watcher armed just after a tap
    // doesn't sit blind on a pending it will never see a frame for.
    const v = (await this.ctx.storage.get<number>("v")) ?? 0;
    const c = (await this.ctx.storage.get<Choice>("choice")) ?? null;
    pair[1].send(JSON.stringify({ type: "hello", v, pending: c ? { label: c.label, v: c.v, kind: kindOf(c), target: c.target } : null }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(): void {} // feed is one-way; inbound frames are ignored
  webSocketClose(): void {}
  webSocketError(): void {}

  private broadcast(frame: unknown): void {
    const msg = JSON.stringify(frame);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch { /* a dying socket must not fail the tap */ }
    }
  }

  // choices: button labels rendered under the doc. Writing a doc clears a
  // pending answer-tap so a new prompt starts fresh (quick taps survive).
  // md: the markdown source, kept so appends can re-render the whole doc.
  async setDoc(html: string, title: string, choices: string[] = [], md = ""): Promise<number> {
    const v = ((await this.ctx.storage.get<number>("v")) ?? 0) + 1;
    await this.ctx.storage.put({ v, html, title, choices, md, updatedAt: Date.now() });
    const c = await this.ctx.storage.get<Choice>("choice");
    if (c && !isRequest(c)) await this.ctx.storage.delete("choice");
    await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
    return v;
  }

  async getMd(): Promise<{ md: string; title: string; choices: string[] }> {
    return {
      md: (await this.ctx.storage.get<string>("md")) ?? "",
      title: (await this.ctx.storage.get<string>("title")) ?? "",
      choices: (await this.ctx.storage.get<string[]>("choices")) ?? [],
    };
  }

  // The device's poll doubles as its reading-state heartbeat (page/pages).
  async getSince(since: number, page = 0, pages = 0): Promise<{ v: number; html: string; title: string; choices: string[] } | null> {
    const state: Record<string, unknown> = { lastPoll: Date.now() };
    if (pages > 0) state.read = { page, pages, at: Date.now() } satisfies Read;
    await this.ctx.storage.put(state);
    // A session touched only by polls still needs an expiry armed, or it never cleans up.
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
    const v = (await this.ctx.storage.get<number>("v")) ?? 0;
    // "differs", not "greater": after a TTL wipe v restarts at 1 while a page
    // left open still holds the old higher v — under `v <= since` that device
    // went silently deaf to every later send.
    if (v === 0 || v === since) return null;
    return {
      v,
      html: (await this.ctx.storage.get<string>("html")) ?? "",
      title: (await this.ctx.storage.get<string>("title")) ?? "",
      choices: (await this.ctx.storage.get<string[]>("choices")) ?? [],
    };
  }

  // _api/await parks here; recordChoice resolves the waiter directly. The
  // in-flight RPC keeps this instance pinned, so in-memory waiters can't be
  // lost to hibernation — and the DO is single-threaded, so no lock needed.
  private waiters: Waiter[] = [];

  // The reader taps a button/quick-action/explain-target → deliver to a parked
  // waiter if one exists, else record it (last tap wins), scoped to the doc
  // version it was tapped on, typed by kind (see TapKind).
  async recordChoice(label: string, v = 0, kind?: TapKind, target?: Target): Promise<void> {
    const k: TapKind = kind ?? (QUICK.indexOf(label) !== -1 ? "quick" : "answer");
    const c: Choice = { label, at: Date.now(), v, kind: k, target };
    this.broadcast({ type: "tap", label, v, kind: k, target, at: c.at });
    const w = this.waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      // Same staleness rule as takeChoice: an answer-tap from an older doc is
      // consumed and dropped for this waiter (null re-arms the await loop).
      const stale = k === "answer" && w.minV > 0 && v > 0 && v < w.minV;
      w.resolve(stale ? null : c);
      return; // delivered (or dropped-as-stale) — nothing left pending
    }
    await this.ctx.storage.put("choice", c);
  }

  // reader_await consumes the pending tap (so it isn't returned twice).
  // minV scopes the wait to a specific doc version — but only for answer-taps:
  // a stale answer is dropped, not delivered, while quick/explain taps are
  // requests with no expiring question, valid whenever Claude looks (the same
  // rule that lets them survive setDoc).
  async takeChoice(minV = 0): Promise<Choice | null> {
    const c = (await this.ctx.storage.get<Choice>("choice")) ?? null;
    if (!c) return null;
    await this.ctx.storage.delete("choice");
    if (minV && c.v && c.v < minV && kindOf(c) === "answer") return null;
    return { ...c, kind: kindOf(c) };
  }

  // Blocking take: returns a pending tap immediately, else parks until
  // recordChoice delivers one or timeoutMs elapses (null → caller re-arms).
  async waitChoice(minV = 0, timeoutMs = 30_000): Promise<Choice | null> {
    const pending = await this.takeChoice(minV);
    if (pending) return pending;
    return new Promise((resolve) => {
      const w: Waiter = {
        minV,
        resolve,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((x) => x !== w);
          resolve(null);
        }, timeoutMs),
      };
      this.waiters.push(w);
    });
  }

  async status(): Promise<{
    v: number; title: string; connected: boolean; lastSeenS: number | null;
    reading: Read | null; pending: string | null; pendingKind: TapKind | null;
  }> {
    const v = (await this.ctx.storage.get<number>("v")) ?? 0;
    const lastPoll = (await this.ctx.storage.get<number>("lastPoll")) ?? 0;
    const read = (await this.ctx.storage.get<Read>("read")) ?? null;
    const pending = (await this.ctx.storage.get<Choice>("choice")) ?? null;
    return {
      v,
      title: (await this.ctx.storage.get<string>("title")) ?? "",
      connected: Date.now() - lastPoll < CONNECTED_MS,
      lastSeenS: lastPoll ? Math.round((Date.now() - lastPoll) / 1000) : null,
      reading: read,
      pending: pending?.label ?? null,
      pendingKind: pending ? kindOf(pending) : null,
    };
  }

  async alarm(): Promise<void> {
    // Expire on inactivity, not wall-clock since last write: a device that is
    // still polling (someone reading) keeps its session; expiry needs 6h of
    // silence from BOTH sides.
    const lastPoll = (await this.ctx.storage.get<number>("lastPoll")) ?? 0;
    const updatedAt = (await this.ctx.storage.get<number>("updatedAt")) ?? 0;
    const idle = Date.now() - Math.max(lastPoll, updatedAt);
    if (idle >= TTL_MS) {
      await this.ctx.storage.deleteAll();
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.close(1000, "session expired"); } catch { /* already gone */ }
      }
    } else await this.ctx.storage.setAlarm(Date.now() + (TTL_MS - idle));
  }
}
