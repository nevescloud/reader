import { DurableObject } from "cloudflare:workers";

// One instance per reader code. Holds the current document + a monotonic version
// the reader polls against, plus a pending tap (the user's choice) that the
// reader_await tool consumes. Self-deletes after 6h of silence from both sides.
const TTL_MS = 6 * 60 * 60 * 1000;
const CONNECTED_MS = 15_000; // a reader polling within this window counts as live

// The client's always-on quick actions. A quick tap is a *request* (simpler /
// more / explain), not an answer to the current doc — it survives a new send,
// where an answer-tap would be stale and is cleared.
const QUICK = ["↻ simpler", "→ more", "✎ explain"];

type Choice = { label: string; at: number; v: number };
type Read = { page: number; pages: number; at: number };

export class Session extends DurableObject {
  // choices: button labels rendered under the doc. Writing a doc clears a
  // pending answer-tap so a new prompt starts fresh (quick taps survive).
  // md: the markdown source, kept so appends can re-render the whole doc.
  async setDoc(html: string, title: string, choices: string[] = [], md = ""): Promise<number> {
    const v = ((await this.ctx.storage.get<number>("v")) ?? 0) + 1;
    await this.ctx.storage.put({ v, html, title, choices, md, updatedAt: Date.now() });
    const c = await this.ctx.storage.get<Choice>("choice");
    if (c && QUICK.indexOf(c.label) === -1) await this.ctx.storage.delete("choice");
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
  // to the doc version it was tapped on.
  async recordChoice(label: string, v = 0): Promise<void> {
    await this.ctx.storage.put("choice", { label, at: Date.now(), v } satisfies Choice);
  }

  // reader_await consumes the pending tap (so it isn't returned twice).
  // minV scopes the wait to a specific doc version: a tap from an older doc is
  // stale for that waiter — dropped, not delivered as the answer.
  async takeChoice(minV = 0): Promise<Choice | null> {
    const c = (await this.ctx.storage.get<Choice>("choice")) ?? null;
    if (!c) return null;
    await this.ctx.storage.delete("choice");
    if (minV && c.v && c.v < minV) return null;
    return c;
  }

  async status(): Promise<{
    v: number; title: string; connected: boolean; lastSeenS: number | null;
    reading: Read | null; pending: string | null;
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
    };
  }

  async alarm(): Promise<void> {
    // Expire on inactivity, not wall-clock since last write: a device that is
    // still polling (someone reading) keeps its session; expiry needs 6h of
    // silence from BOTH sides.
    const lastPoll = (await this.ctx.storage.get<number>("lastPoll")) ?? 0;
    const updatedAt = (await this.ctx.storage.get<number>("updatedAt")) ?? 0;
    const idle = Date.now() - Math.max(lastPoll, updatedAt);
    if (idle >= TTL_MS) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(Date.now() + (TTL_MS - idle));
  }
}
