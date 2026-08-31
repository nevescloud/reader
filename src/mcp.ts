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
// MCP Tasks (spec 2026-07-28, io.modelcontextprotocol/tasks) — @experimental in
// the SDK, and no client (Claude web/Desktop/Code) negotiates it yet as of
// 2026-08. Wired anyway because it's pure upside: taskSupport "optional" means a
// client that never asks for a task gets today's exact blocking behavior via the
// SDK's own automatic-task-polling fallback (see buildChoiceReply/
// buildDrillReportReply below, used by both paths); only a client that sends
// `task` on the call gets the non-blocking handle instead. Nothing to revert
// later — it just starts working the day a client speaks it.
import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { sendDoc, awaitChoice, readStatus, startDrill, awaitDrillReport, resumeDrill } from "./ops";
import { readerLink, tapFeedUrl, ICON_PNG_URL, ICON_SVG_URL } from "./util";

const fmtAgo = (s: number): string => (s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

// A completed/failed task's result stays fetchable for this long — independent
// of the tool's own wait timeout, which only bounds how long the background
// wait below runs before it settles (with or without a tap).
const TASK_RESULT_TTL_MS = 10 * 60_000;
// Suggested tasks/get cadence. Also the SDK's own re-check interval when a
// non-task client falls back to automatic polling (see the module comment
// above) — kept short so that fallback doesn't add a visible delay on top of
// the near-instant tap delivery awaitChoice already gives a real tap.
const TASK_POLL_INTERVAL_MS = 1000;

// Shared by the direct (task-aware client) and automatic-polling (everyone
// else, via the SDK's taskSupport "optional" fallback) paths — see the
// `execution: { taskSupport: "optional" }` tools below. Exactly the reply
// await_reader_choice always returned, now built once so both paths agree.
function buildChoiceReply(r: Awaited<ReturnType<typeof awaitChoice>>, code: string, timeoutSec: number) {
  if (r && "error" in r) return { content: [{ type: "text" as const, text: `Couldn't wait: ${r.error}.` }], isError: true };
  if (r && r.label) {
    const kind = r.kind === "quick" ? "quick_action" as const : r.kind === "explain" ? "explain" as const : "choice" as const;
    if (kind === "explain") {
      const tg = r.target;
      const anchors = tg && (tg.before || tg.after) ? ` Context anchors — before: "…${tg.before}", after: "${tg.after}…".` : "";
      return {
        content: [{ type: "text" as const, text: `The user marked text on the reader for explanation: "${r.label}" (${tg?.granularity ?? "block"}${r.v ? `, on doc version ${r.v}` : ""}).${anchors} Locate it in the markdown YOU sent at that version, explain it in context, and reply with send_to_reader — prefer mode "append". This is a request, not an answer to your choices.` }],
        structuredContent: { label: r.label, kind, target: tg ?? null, document_version: r.v ?? null, timed_out: false },
      };
    }
    const note = kind === "quick_action" ? " (a quick action — a request to act on, not an answer)" : "";
    return { content: [{ type: "text" as const, text: `The user tapped: "${r.label}"${note}` }], structuredContent: { label: r.label, kind, target: null, document_version: r.v ?? null, timed_out: false } };
  }
  return { content: [{ type: "text" as const, text: `No tap within ${timeoutSec}s. A late tap may still be coming — don't re-send the question. Watch wss://reader.neves.cloud/w/${code} if your harness can hold a WebSocket; otherwise one more await is fine, or move on.` }], structuredContent: { label: null, kind: null, timed_out: true } };
}

// Same role as buildChoiceReply, for await_drill_report.
function buildDrillReportReply(r: Awaited<ReturnType<typeof awaitDrillReport>>, code: string) {
  if (r && "error" in r) return { content: [{ type: "text" as const, text: `Couldn't wait: ${r.error}.` }], isError: true };
  if (!r) {
    return {
      content: [{ type: "text" as const, text: `No drill is running on reader ${code} and no report is waiting. Start one with send_drill.` }],
      structuredContent: { finished: false, cancelled: false, report: null, progress: null },
    };
  }
  if (r.report) {
    const rep = r.report;
    const missed = rep.items.filter((i) => i.attempts.length && !i.first_try);
    const skipped = rep.items.filter((i) => !i.attempts.length);
    const lines = [
      `Drill "${rep.title}" ${rep.cancelled ? "ended early" : "complete"}: ${rep.first_try}/${rep.total} right first try in ${rep.elapsed_seconds}s.`,
      missed.length
        ? `Missed first time:\n${missed.map((i) => `• ${i.question}\n  tapped ${i.attempts.map((a) => `"${a}"`).join(" → ")} · answer "${i.correct_answer}"`).join("\n")}`
        : "Nothing missed.",
      skipped.length ? `${skipped.length} item(s) never reached.` : "",
      rep.requests.length ? `They asked for help ${rep.requests.length}× during the drill: ${rep.requests.map((q) => `"${q.label}"`).join(", ")}.` : "",
    ].filter(Boolean);
    return {
      content: [{ type: "text" as const, text: lines.join("\n\n") }],
      structuredContent: {
        finished: true, cancelled: rep.cancelled,
        report: { title: rep.title, total: rep.total, completed: rep.completed, first_try: rep.first_try, elapsed_seconds: rep.elapsed_seconds, items: rep.items, requests: rep.requests },
        progress: null,
      },
    };
  }
  const p = r.progress!;
  const parked = p.suspended
    ? ` The drill is PARKED on a request from the user — call await_reader_choice to see it, answer with send_to_reader mode "append", then resume_drill.`
    : "";
  return {
    content: [{ type: "text" as const, text: `Still going: ${p.done}/${p.total} done${p.question ? `, on "${p.question}"` : ""}.${parked} Don't send anything with mode "replace" — that would end the drill. Watch wss://reader.neves.cloud/w/${code} for a {"type":"drill_done"} frame, or call this again.` }],
    structuredContent: { finished: false, cancelled: false, report: null, progress: p },
  };
}

// Deck mode's wire shape, shared by send_drill's input schema and the report's
// output schema below.
const DECK_ITEM = z.object({
  question_md: z.string().describe("The question, as markdown. One idea per screen — it's shown alone above the buttons."),
  choices: z.array(z.string()).describe("2–8 answer labels, ≤100 chars each (they're buttons on e-ink). Must be distinct — taps come back as labels."),
  answer_index: z.number().int().describe("0-based index into choices of the correct answer."),
  feedback_md: z.string().optional().describe("Shown after they answer. Omit it and a CORRECT answer skips straight to the next question (one tap per item); a wrong answer always gets a screen, revealing the right choice."),
});
const REPORT_ITEM = z.object({
  index: z.number(), question: z.string(), correct_answer: z.string(),
  attempts: z.array(z.string()).describe("Labels tapped, in order."),
  first_try: z.boolean(), correct: z.boolean(),
  seconds: z.number().nullable().describe("Time to the first answer."),
});
const PROGRESS = z.object({
  done: z.number(), total: z.number(),
  suspended: z.boolean().describe("True when a quick action / explain parked the drill — answer it, then resume_drill."),
  question: z.string().nullable().describe("The question currently on screen."),
});

// No OAuth on this origin, so no injected props — an empty record.
export class ReaderMcp extends McpAgent<Env, unknown, Record<string, never>> {
  server = new McpServer(
    {
      name: "reader.neves.cloud",
      version: "0.1.0",
      // SEP-973 (MCP 2025-11-25). claude.ai does not render this for custom
      // connectors yet — anthropics/claude-ai-mcp#152 is open — so today the
      // connector list falls back to the icon it resolves from the domain. It
      // costs nothing to be correct here: other MCP clients do render it, and
      // this is the path that stops being a fallback the day #152 ships. PNG
      // first, since clients MUST support it and only SHOULD support SVG.
      icons: [
        { src: ICON_PNG_URL, mimeType: "image/png", sizes: ["256x256"] },
        { src: ICON_SVG_URL, mimeType: "image/svg+xml", sizes: ["any"] },
      ],
    },
    {
      instructions: `Drive the user's e-ink reader (reader.neves.cloud). Send long-form text to read on e-ink instead of the chat window, optionally with tappable choices, and read back their taps.

The 5-character code shown on the device is required on every tool — it's the whole capability (this endpoint has no accounts). Ask the user to open reader.neves.cloud on the e-reader and read off the code.

WAITING FOR TAPS — arm the tap feed, don't poll. Every code has a read-only WebSocket at wss://reader.neves.cloud/w/<CODE>; each tap arrives as one JSON frame. If your harness can hold a WebSocket (e.g. Claude Code's Monitor, ws mode), arm it once, end your turn, and let a frame wake you — then call await_reader_choice, which returns instantly. Otherwise call await_reader_choice directly; never loop it (a re-send would discard a tap landing in the gap).

VERSION DISCIPLINE: pass the version a send returns as min_version to await_reader_choice, so a tap left on an older screen can't answer the current question. A quick action (↻ simpler / → more) or explain-request is a request to act on, not an answer to your choices.

FIXED DRILLS — use send_drill, not a send/await loop. When the whole deck is known up front and every answer is closed-form (multiple choice with a key), send_drill hands the loop to the server: it scores each tap, shows your feedback and turns the page with no round-trip, and await_drill_report gives you per-item results at the end. Reserve send_to_reader/await_reader_choice for teaching, discussion, and adaptive questioning — anything where the next screen depends on what they said.

E-INK CONTENT: markdown + GFM tables + SVG (fenced \`\`\`svg or raw <svg>) render crisply; grayscale high-contrast only, big fonts, one idea per screen; mode "append" streams chunks without losing the user's page.`,
      // Backs await_reader_choice / await_drill_report's task augmentation.
      // In-memory (SDK's own store, not production-hardened per its own docs):
      // acceptable because this DO's other wait state (session.ts's Waiter[]/
      // ReportWaiter[]) already accepts the same "lost on DO eviction, caller
      // re-arms" risk — this isn't a new class of fragility.
      taskStore: new InMemoryTaskStore(),
      // Must be declared explicitly — registering a task-based tool does not
      // by itself advertise capabilities.tasks.requests.tools.call, and a
      // spec-conformant client checks this before ever sending `task` on a
      // tools/call. Merged with (not replacing) the tools/resources
      // capabilities McpServer derives from registerTool/registerResource.
      capabilities: { tasks: { requests: { tools: { call: {} } } } },
    },
  );

  async init() {
    const env = this.env;

    this.server.registerTool(
      "send_to_reader",
      {
        title: "Send to e-reader",
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
        annotations: { title: "Send to e-reader", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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

    this.server.experimental.tasks.registerToolTask(
      "await_reader_choice",
      {
        title: "Wait for a tap on the e-reader",
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
        annotations: { title: "Wait for a tap on the e-reader", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // "optional": a client that never asks for a task (everyone today) gets
        // this exact wait via the SDK's automatic task polling — unchanged
        // behavior. A client that sends `task` gets an immediate handle and
        // polls tasks/get itself instead of holding the call open.
        execution: { taskSupport: "optional" },
      },
      {
        createTask: async ({ code, timeout_seconds, min_version }, extra) => {
          const t = Math.min(Math.max(timeout_seconds ?? 45, 5), 55);
          const task = await extra.taskStore.createTask({ ttl: TASK_RESULT_TTL_MS, pollInterval: TASK_POLL_INTERVAL_MS });
          this.ctx.waitUntil(
            awaitChoice(env, code, t * 1000, min_version ?? 0)
              .then((r) => extra.taskStore.storeTaskResult(task.taskId, "completed", buildChoiceReply(r, code, t)))
              .catch((e) => extra.taskStore.storeTaskResult(task.taskId, "failed", {
                content: [{ type: "text", text: `Internal error waiting for a tap: ${e instanceof Error ? e.message : String(e)}` }],
                isError: true,
              })),
          );
          return { task };
        },
        getTask: async (_args, extra) => extra.taskStore.getTask(extra.taskId),
        getTaskResult: async (_args, extra) => extra.taskStore.getTaskResult(extra.taskId) as Promise<CallToolResult>,
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
          drill: PROGRESS.nullable().describe("Set while a send_drill deck is running."),
        },
        annotations: { title: "Check reader connection", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async ({ code }) => {
        const d = await readStatus(env, code);
        if ("error" in d) return { content: [{ type: "text", text: `Couldn't check: ${d.error}.` }], isError: true };
        const pos = d.reading && d.reading.pages ? ` — on page ${d.reading.page + 1} of ${d.reading.pages}` : "";
        const pend = d.pending ? ` A tap is pending: "${d.pending}" (await_reader_choice will return it).` : "";
        const drill = d.drill
          ? ` A drill is running: ${d.drill.done}/${d.drill.total} done${d.drill.suspended ? ", parked on a request — answer it and call resume_drill" : ""}.`
          : "";
        const text = d.connected
          ? `Reader ${d.code} is connected${d.v ? ` (showing update #${d.v}, "${d.title}"${pos})` : " and waiting"}.${pend}${drill} Go ahead and send.`
          : d.lastSeenS != null
            ? `Reader ${d.code} last polled ${fmtAgo(d.lastSeenS)} ago — the device may be asleep (it catches up on wake).${pend}${drill}`
            : `No reader has ever polled code ${d.code}. Ask the user to open reader.neves.cloud on their e-reader and read off the code shown.`;
        return {
          content: [{ type: "text", text }],
          structuredContent: {
            code: d.code, connected: d.connected, last_seen_seconds: d.lastSeenS,
            version: d.v || null, title: d.title || null,
            page: d.reading ? d.reading.page + 1 : null, pages: d.reading?.pages ?? null,
            pending_tap: d.pending ?? null,
            pending_kind: d.pending ? (d.pendingKind === "quick" ? "quick_action" as const : d.pendingKind === "explain" ? "explain" as const : "choice" as const) : null,
            drill: d.drill,
          },
        };
      },
    );

    // ---- deck mode ------------------------------------------------------
    this.server.registerTool(
      "send_drill",
      {
        title: "Run a drill on the e-reader",
        description:
          `Run a fixed multiple-choice drill on the e-reader WITHOUT a round-trip per question. You author the whole deck here; the server then scores each tap, shows your feedback and turns the page on its own, so pages advance at device speed instead of at model speed. Collect the results with await_drill_report. Use this whenever the questions and answers are known up front and closed-form (flashcards, active recall, quizzing a reading, exam prep). Use send_to_reader + await_reader_choice instead when the next screen depends on what they say — teaching, discussion, partial credit, adaptive re-explaining. While a drill runs, the user's quick actions (↻ simpler / → more / ✎ explain) still reach you: they park the drill and surface via await_reader_choice — answer with send_to_reader mode "append", then resume_drill. A send_to_reader with mode "replace" ends the drill.`,
        inputSchema: {
          code: z.string().describe("The 5-character reader code shown on the device."),
          title: z.string().optional().describe("Deck title, shown as the heading on every screen (default \"Drill\")."),
          items: z.array(DECK_ITEM).describe("The deck, in order. Max 60 items."),
          policy: z.object({
            requeue_until_correct: z.boolean().optional().describe("Default true: a missed item goes to the back of the queue and comes round again (max 3 attempts, then it's revealed and retired). False = one pass, straight through."),
            shuffle: z.boolean().optional().describe("Shuffle item order (default false)."),
          }).optional(),
        },
        outputSchema: {
          code: z.string(),
          version: z.number().describe("Update number of the first question screen."),
          title: z.string(),
          total: z.number().describe("Items in the deck."),
          delivered: z.boolean().describe("True when a device is actively polling; false means queued (asleep) or a wrong code."),
          last_seen_seconds: z.number().nullable(),
          link: z.string(),
          tap_feed: z.string().describe("Read-only WebSocket. Frames: {type:\"drill\"} per answer, {type:\"drill_done\"} when the deck clears — watch for drill_done, then call await_drill_report."),
        },
        annotations: { title: "Run a drill on the e-reader", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async ({ code, title, items, policy }) => {
        const d = await startDrill(env, code, { title, items, policy });
        if ("error" in d) return { content: [{ type: "text", text: `Couldn't start the drill: ${d.error}.` }], isError: true };
        const out = {
          code: d.code, version: d.v, title: d.title, total: d.total,
          delivered: d.connected, last_seen_seconds: d.lastSeenS, link: readerLink(d.code), tap_feed: tapFeedUrl(d.code),
        };
        const delivery = d.connected
          ? "The device is polling — question 1 appears within seconds."
          : d.lastSeenS != null
            ? `Queued: the device last checked ${fmtAgo(d.lastSeenS)} ago (it starts on wake).`
            : `⚠ No reader has EVER polled ${d.code} — probably the wrong code. Confirm it before waiting on results.`;
        return {
          content: [{ type: "text", text: `Drill "${out.title}" started on reader ${out.code} — ${out.total} item(s). ${delivery} The server runs the loop from here; you're out of it until it ends. To collect results: watch ${out.tap_feed} for a {"type":"drill_done"} frame if your harness can hold a WebSocket, then call await_drill_report (it returns instantly); otherwise call await_drill_report and re-arm on each progress return. Link: ${out.link}` }],
          structuredContent: out,
        };
      },
    );

    this.server.experimental.tasks.registerToolTask(
      "await_drill_report",
      {
        title: "Get drill results",
        description:
          `Collect the results of a send_drill deck. Blocks until the deck clears, then returns per-item results — what they tapped, whether they got it first try, retries, seconds per item, and any quick-action/explain requests they made along the way. A deck takes minutes, so a return with finished=false is normal: it carries progress, and you re-arm (or better, wait for a {"type":"drill_done"} frame on the tap feed and call this once). finished=true with cancelled=true means a send_to_reader replace, or a new deck, superseded it.`,
        inputSchema: {
          code: z.string().describe("The 5-character reader code shown on the device."),
          timeout_seconds: z.number().optional().describe("How long to wait (5–55, default 45)."),
        },
        outputSchema: {
          finished: z.boolean().describe("False = still running; `progress` says where."),
          cancelled: z.boolean().describe("The drill was superseded before the deck cleared."),
          report: z.object({
            title: z.string(), total: z.number(), completed: z.number(),
            first_try: z.number().describe("Items answered correctly on the first attempt — the number that means anything for recall."),
            elapsed_seconds: z.number(),
            items: z.array(REPORT_ITEM),
            requests: z.array(z.object({ label: z.string(), kind: z.string(), item: z.number(), at: z.number() })).describe("Quick actions / explain requests made during the drill."),
          }).nullable(),
          progress: PROGRESS.nullable(),
        },
        annotations: { title: "Get drill results", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        execution: { taskSupport: "optional" }, // see await_reader_choice
      },
      {
        createTask: async ({ code, timeout_seconds }, extra) => {
          const t = Math.min(Math.max(timeout_seconds ?? 45, 5), 55);
          const task = await extra.taskStore.createTask({ ttl: TASK_RESULT_TTL_MS, pollInterval: TASK_POLL_INTERVAL_MS });
          this.ctx.waitUntil(
            awaitDrillReport(env, code, t * 1000)
              .then((r) => extra.taskStore.storeTaskResult(task.taskId, "completed", buildDrillReportReply(r, code)))
              .catch((e) => extra.taskStore.storeTaskResult(task.taskId, "failed", {
                content: [{ type: "text", text: `Internal error waiting for the drill report: ${e instanceof Error ? e.message : String(e)}` }],
                isError: true,
              })),
          );
          return { task };
        },
        getTask: async (_args, extra) => extra.taskStore.getTask(extra.taskId),
        getTaskResult: async (_args, extra) => extra.taskStore.getTaskResult(extra.taskId) as Promise<CallToolResult>,
      },
    );

    this.server.registerTool(
      "resume_drill",
      {
        title: "Put the drill question back on screen",
        description:
          `Put the current drill question back on screen after you've answered a quick action or an explain-request that parked it. Only needed when your reply used send_to_reader mode "replace" (which ends the drill — you'd have to re-send the deck) or when the user is waiting on a fresh screen; a reply sent with mode "append" leaves the buttons in place and the next answer-tap resumes the drill on its own.`,
        inputSchema: { code: z.string().describe("The 5-character reader code shown on the device.") },
        outputSchema: { code: z.string(), version: z.number(), progress: PROGRESS },
        annotations: { title: "Put the drill question back on screen", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async ({ code }) => {
        const r = await resumeDrill(env, code);
        if ("error" in r) return { content: [{ type: "text", text: `Couldn't resume: ${r.error}. If you replaced the screen, the drill ended — send_drill again with the items still to cover.` }], isError: true };
        return {
          content: [{ type: "text", text: `Back to the drill on reader ${r.code} (update #${r.v}) — ${r.progress.done}/${r.progress.total} done, showing "${r.progress.question}". Collect results with await_drill_report.` }],
          structuredContent: { code: r.code, version: r.v, progress: r.progress },
        };
      },
    );
  }
}
