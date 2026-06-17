import { DurableObject } from "cloudflare:workers";

// One instance per reader code. Holds the current document and a monotonic
// version the reader polls against. Self-deletes 6h after the last write.
const TTL_MS = 6 * 60 * 60 * 1000;
const CONNECTED_MS = 15_000; // a reader polling within this window counts as live

export class Session extends DurableObject {
  async setDoc(html: string, title: string): Promise<number> {
    const v = ((await this.ctx.storage.get<number>("v")) ?? 0) + 1;
    await this.ctx.storage.put({ v, html, title, updatedAt: Date.now() });
    await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
    return v;
  }

  // Reader poll: return the doc only if newer than the version the reader holds.
  async getSince(since: number): Promise<{ v: number; html: string; title: string } | null> {
    await this.ctx.storage.put("lastPoll", Date.now());
    const v = (await this.ctx.storage.get<number>("v")) ?? 0;
    if (v <= since) return null;
    return {
      v,
      html: (await this.ctx.storage.get<string>("html")) ?? "",
      title: (await this.ctx.storage.get<string>("title")) ?? "",
    };
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
