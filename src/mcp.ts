// Anonymous MCP endpoint at reader.neves.cloud/mcp — the zero-sign-in path to
// drive the reader. It lives on the reader's own origin (no OAuth anywhere on
// this host, so no origin-wide discovery to make an anonymous endpoint look
// protected — the exact bleed that forces the gateway's copy onto mcp.neves.cloud)
// and calls the Session DOs in-process via ops.ts — no service binding, no token.
//
// The capability model is the reader's throughout: the 5-char code IS the
// capability, so it's REQUIRED on every tool (there's no OAuth identity to hang a
// saved pairing on — that's what the gateway's copy adds, and why pair_reader
// exists there and not here).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { sendDoc, awaitChoice, readStatus } from "./ops";
import { readerLink, tapFeedUrl } from "./util";

const fmtAgo = (s: number): string => (s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

// No OAuth on this origin, so no injected props — an empty record.
export class ReaderMcp extends McpAgent<Env, unknown, Record<string, never>> {
  server = new McpServer(
    { name: "reader.neves.cloud", version: "0.1.0" },
    {
      instructions: `Drive the user's e-ink reader (reader.neves.cloud). Send long-form text to read on e-ink instead of the chat window, optionally with tappable choices, and read back their taps.

The 5-character code shown on the device is required on every tool — it's the whole capability (this endpoint has no accounts). Ask the user to open reader.neves.cloud on the e-reader and read off the code.

WAITING FOR TAPS — arm the tap feed, don't poll. Every code has a read-only WebSocket at wss://reader.neves.cloud/w/<CODE>; each tap arrives as one JSON frame. If your harness can hold a WebSocket (e.g. Claude Code's Monitor, ws mode), arm it once, end your turn, and let a frame wake you — then call await_reader_choice, which returns instantly. Otherwise call await_reader_choice directly; never loop it (a re-send would discard a tap landing in the gap).

VERSION DISCIPLINE: pass the version a send returns as min_version to await_reader_choice, so a tap left on an older screen can't answer the current question. A quick action (↻ simpler / → more) or explain-request is a request to act on, not an answer to your choices.

E-INK CONTENT: markdown + GFM tables + SVG (fenced \`\`\`svg or raw <svg>) render crisply; grayscale high-contrast only, big fonts, one idea per screen; mode "append" streams chunks without losing the user's page.`,
    },
  );

  async init() {
    const env = this.env;

    this.server.registerTool(
      "send_to_reader",
      {
        description:
          `Display long-form text on the user's e-reader (Kindle, Kobo, etc.) in real time, for comfortable reading on e-ink instead of the chat window. "code" is the 5-character code on the device (they get it by opening reader.neves.cloud). mode "replace" (default) swaps what's shown and returns to page 1; mode "append" adds to the end — if they're reading the tail it follows, otherwise their page is held (stream a long piece in section-sized chunks: send only the new chunk). Optionally pass "choices" — short labels rendered as big tappable buttons; the user taps one and you read it back with await_reader_choice. The reader also always shows quick actions (↻ simpler / → more / ✎ explain) in its menu — those taps surface via await_reader_choice or check_reader. Every code has a read-only WebSocket tap feed (wss://reader.neves.cloud/w/<CODE>, returned as tap_feed) — watch it instead of polling. The response says honestly whether the device is live, sleeping, or has never polled the code.`,
        inputSchema: {
          code: z.string().describe("The 5-character reader code shown on the device."),
          content: z.string().describe("The text to display, as markdown. Also supports GFM tables and SVG (a ```svg fenced block or a raw <svg>…</svg>) for diagrams, charts, and line art — rendered crisply on e-ink. (No other raw HTML/JS.)"),
          title: z.string().optional().describe("Optional title; else a leading '# heading' or 'Reading' is used (append keeps the current title)."),
          choices: z.array(z.string()).optional().describe("Up to 8 short option labels, shown as tappable buttons. Follow with await_reader_choice to get the tap. On append, omitting this keeps the current buttons."),
          mode: z.enum(["replace", "append"]).optional().describe('"replace" (default) swaps the document; "append" adds this content to the end, preserving the reading position.'),
        },
        outputSchema: {
          code: z.string(),
          version: z.number().describe("The update number now shown (increments per send). Pass as min_version to await_reader_choice."),
          title: z.string(),
          choices: z.array(z.string()).optional(),
          mode: z.enum(["replace", "append"]),
          delivered: z.boolean().describe("True when a device is actively polling; false means queued (asleep) or a wrong code."),
          last_seen_seconds: z.number().nullable().describe("Seconds since the device last polled; null if none ever has (likely a mistyped code)."),
          link: z.string(),
          tap_feed: z.string().describe("Read-only WebSocket URL streaming one JSON frame per tap."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async ({ code, content, title, choices, mode }) => {
        const d = await sendDoc(env, { code, content, title, choices, mode });
        if ("error" in d) return { content: [{ type: "text", text: `Couldn't send: ${d.error}. Ask the user for the 5-character code on their reader (open reader.neves.cloud).` }], isError: true };
        const out = {
          code: d.code, version: d.v, title: d.title, choices: d.choices, mode: d.mode,
          delivered: d.connected, last_seen_seconds: d.lastSeenS, link: readerLink(d.code), tap_feed: tapFeedUrl(d.code),
        };
        const verb = d.mode === "append" ? "Appended to" : "Sent to";
        const delivery = d.connected
          ? "The device is polling — it appears within seconds."
          : d.lastSeenS != null
            ? `Queued: the device last checked ${fmtAgo(d.lastSeenS)} ago (asleep readers catch up on wake).`
            : `⚠ No reader has EVER polled ${d.code} — if the user is looking at a code on their screen, this is probably the wrong one. Confirm it before sending more.`;
        const tail = out.choices && out.choices.length
          ? ` Showing ${out.choices.length} tappable choice(s). To wait for the tap: arm ${out.tap_feed} once if your harness can watch a WebSocket, then await_reader_choice (min_version ${out.version}) returns it instantly; otherwise call await_reader_choice directly — never loop it.`
          : "";
        const pend = d.pending ? ` A ${d.pendingKind === "quick" ? "quick-action" : d.pendingKind === "explain" ? "explain-request" : ""} tap is pending: "${d.pending}" — call await_reader_choice to consume it.` : "";
        return { content: [{ type: "text", text: `${verb} reader ${out.code} (update #${out.version}) — "${out.title}". ${delivery}${tail}${pend} Link: ${out.link}` }], structuredContent: out };
      },
    );

    this.server.registerTool(
      "await_reader_choice",
      {
        description:
          `Consume the user's tap on their e-reader — one of the choices you passed to send_to_reader, a quick action (↻ simpler / → more) they can tap anytime, or an explain-request (they marked a word/sentence/block via ✎ explain… for an in-context explanation). Blocks until they tap or it times out; a timeout is not an answer — the tap may land moments later, so don't re-send the question (prefer watching wss://reader.neves.cloud/w/<CODE> and calling this after a frame arrives). Pass min_version (the version returned by your send) so a tap left on an older document isn't mistaken for an answer to the current one.`,
        inputSchema: {
          code: z.string().describe("The 5-character reader code shown on the device."),
          timeout_seconds: z.number().optional().describe("How long to wait (5–55, default 45)."),
          min_version: z.number().optional().describe("Ignore taps made on a document older than this version (use the version returned by send_to_reader)."),
        },
        outputSchema: {
          label: z.string().nullable().describe("The label the user tapped (for explain: the quoted text they marked), or null if it timed out."),
          kind: z.enum(["choice", "quick_action", "explain"]).nullable().describe('"choice" = one of your buttons (an answer); "quick_action" = ↻ simpler / → more (a request); "explain" = the user marked text for an in-context explanation (a request).'),
          target: z.object({
            before: z.string().describe("Up to ~80 chars of rendered text immediately before the quote — an approximate anchor."),
            after: z.string().describe("Up to ~80 chars immediately after the quote."),
            granularity: z.enum(["word", "sentence", "block"]).describe("What the user designated on the device."),
          }).nullable().optional().describe("Explain taps only: locate label+anchors in the markdown YOU sent at the tap's doc version, then explain it in context via send_to_reader (prefer mode \"append\")."),
          document_version: z.number().nullable().optional().describe("The doc version the tap was made on."),
          timed_out: z.boolean(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async ({ code, timeout_seconds, min_version }) => {
        const t = Math.min(Math.max(timeout_seconds ?? 45, 5), 55);
        const r = await awaitChoice(env, code, t * 1000, min_version ?? 0);
        if (r && "error" in r) return { content: [{ type: "text", text: `Couldn't wait: ${r.error}.` }], isError: true };
        if (r && r.label) {
          const kind = r.kind === "quick" ? "quick_action" as const : r.kind === "explain" ? "explain" as const : "choice" as const;
          if (kind === "explain") {
            const tg = r.target;
            const anchors = tg && (tg.before || tg.after) ? ` Context anchors — before: "…${tg.before}", after: "${tg.after}…".` : "";
            return {
              content: [{ type: "text", text: `The user marked text on the reader for explanation: "${r.label}" (${tg?.granularity ?? "block"}${r.v ? `, on doc version ${r.v}` : ""}).${anchors} Locate it in the markdown YOU sent at that version, explain it in context, and reply with send_to_reader — prefer mode "append". This is a request, not an answer to your choices.` }],
              structuredContent: { label: r.label, kind, target: tg ?? null, document_version: r.v ?? null, timed_out: false },
            };
          }
          const note = kind === "quick_action" ? " (a quick action — a request to act on, not an answer)" : "";
          return { content: [{ type: "text", text: `The user tapped: "${r.label}"${note}` }], structuredContent: { label: r.label, kind, target: null, document_version: r.v ?? null, timed_out: false } };
        }
        return { content: [{ type: "text", text: `No tap within ${t}s. A late tap may still be coming — don't re-send the question. Watch wss://reader.neves.cloud/w/${code} if your harness can hold a WebSocket; otherwise one more await is fine, or move on.` }], structuredContent: { label: null, kind: null, timed_out: true } };
      },
    );

    this.server.registerTool(
      "check_reader",
      {
        title: "Check reader connection",
        description: "Check whether an e-reader is currently connected and polling, what it's showing, where the user is in it (page/total), and whether a tap is pending. Use to confirm the code is live before sending, or to see reading progress before deciding to send more.",
        inputSchema: { code: z.string().describe("The 5-character reader code shown on the device.") },
        outputSchema: {
          code: z.string(),
          connected: z.boolean(),
          last_seen_seconds: z.number().nullable(),
          version: z.number().nullable(),
          title: z.string().nullable(),
          page: z.number().nullable().describe("The page the user is on (1-based), if reported."),
          pages: z.number().nullable(),
          pending_tap: z.string().nullable(),
          pending_kind: z.enum(["choice", "quick_action", "explain"]).nullable(),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async ({ code }) => {
        const d = await readStatus(env, code);
        if ("error" in d) return { content: [{ type: "text", text: `Couldn't check: ${d.error}.` }], isError: true };
        const pos = d.reading && d.reading.pages ? ` — on page ${d.reading.page + 1} of ${d.reading.pages}` : "";
        const pend = d.pending ? ` A tap is pending: "${d.pending}" (await_reader_choice will return it).` : "";
        const text = d.connected
          ? `Reader ${d.code} is connected${d.v ? ` (showing update #${d.v}, "${d.title}"${pos})` : " and waiting"}.${pend} Go ahead and send.`
          : d.lastSeenS != null
            ? `Reader ${d.code} last polled ${fmtAgo(d.lastSeenS)} ago — the device may be asleep (it catches up on wake).${pend}`
            : `No reader has ever polled code ${d.code}. Ask the user to open reader.neves.cloud on their e-reader and read off the code shown.`;
        return {
          content: [{ type: "text", text }],
          structuredContent: {
            code: d.code, connected: d.connected, last_seen_seconds: d.lastSeenS,
            version: d.v || null, title: d.title || null,
            page: d.reading ? d.reading.page + 1 : null, pages: d.reading?.pages ?? null,
            pending_tap: d.pending ?? null,
            pending_kind: d.pending ? (d.pendingKind === "quick" ? "quick_action" as const : d.pendingKind === "explain" ? "explain" as const : "choice" as const) : null,
          },
        };
      },
    );
  }
}
