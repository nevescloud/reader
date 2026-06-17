import { DurableObject } from "cloudflare:workers";

// One instance per reader code. Holds the current document + a monotonic version
// the reader polls against, plus a pending tap (the user's choice) that the
// reader_await tool consumes. Self-deletes 6h after the last write.
const TTL_MS = 6 * 60 * 60 * 1000;
const CONNECTED_MS = 15_000; // a reader polling within this window counts as live

type Choice = { label: string; at: number };

export class Session extends DurableObject {
  // choices: button labels rendered under the doc. Writing a doc clears any
  // pending tap so a new prompt starts fresh.
  async setDoc(html: string, title: string, choices: string[] = []): Promise<number> {
    const v = ((await this.ctx.storage.get<number>("v")) ?? 0) + 1;
    await this.ctx.storage.put({ v, html, title, choices, updatedAt: Date.now() });
    await this.ctx.storage.delete("choice");
    await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
    return v;
  }

  async getSince(since: number): Promise<{ v: number; html: string; title: string; choices: string[] } | null> {
    await this.ctx.storage.put("lastPoll", Date.now());
    const v = (await this.ctx.storage.get<number>("v")) ?? 0;
    if (v <= since) return null;
    return {
      v,
      html: (await this.ctx.storage.get<string>("html")) ?? "",
      title: (await this.ctx.storage.get<string>("title")) ?? "",
      choices: (await this.ctx.storage.get<string[]>("choices")) ?? [],
    };
  }

  // The reader taps a button/quick-action → record it (last tap wins).
  async recordChoice(label: string): Promise<void> {
    await this.ctx.storage.put("choice", { label, at: Date.now() } satisfies Choice);
  }

  // reader_await consumes the pending tap (so it isn't returned twice).
  async takeChoice(): Promise<Choice | null> {
    const c = (await this.ctx.storage.get<Choice>("choice")) ?? null;
    if (c) await this.ctx.storage.delete("choice");
    return c;
  }

  async status(): Promise<{ v: number; connected: boolean }> {
    const v = (await this.ctx.storage.get<number>("v")) ?? 0;
    const lastPoll = (await this.ctx.storage.get<number>("lastPoll")) ?? 0;
    return { v, connected: Date.now() - lastPoll < CONNECTED_MS };
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
