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

type TapKind = "answer" | "quick";
type Choice = { label: string; at: number; v: number; kind?: TapKind };
type Read = { page: number; pages: number; at: number };

const isQuick = (c: Choice): boolean => (c.kind ? c.kind === "quick" : QUICK.indexOf(c.label) !== -1);

export class Session extends DurableObject {
  // Tap feed: /reader/w/<code> upgrades here. Each recorded tap goes out as one
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
    pair[1].send(JSON.stringify({ type: "hello", v, pending: c ? { label: c.label, v: c.v, kind: c.kind ?? (isQuick(c) ? "quick" : "answer") } : null }));
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
    if (c && !isQuick(c)) await this.ctx.storage.delete("choice");
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

  // The reader taps a button/quick-action → record it (last tap wins), scoped
  // to the doc version it was tapped on, typed by kind (see TapKind).
  async recordChoice(label: string, v = 0, kind?: TapKind): Promise<void> {
    const k: TapKind = kind ?? (QUICK.indexOf(label) !== -1 ? "quick" : "answer");
    await this.ctx.storage.put("choice", { label, at: Date.now(), v, kind: k } satisfies Choice);
    this.broadcast({ type: "tap", label, v, kind: k, at: Date.now() });
  }

  // reader_await consumes the pending tap (so it isn't returned twice).
  // minV scopes the wait to a specific doc version: a tap from an older doc is
  // stale for that waiter — dropped, not delivered as the answer.
  async takeChoice(minV = 0): Promise<Choice | null> {
    const c = (await this.ctx.storage.get<Choice>("choice")) ?? null;
    if (!c) return null;
    await this.ctx.storage.delete("choice");
    if (minV && c.v && c.v < minV) return null;
    return { ...c, kind: c.kind ?? (isQuick(c) ? "quick" : "answer") };
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
      pendingKind: pending ? (isQuick(pending) ? "quick" : "answer") : null,
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
