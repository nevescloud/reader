import { Session } from "./session";
import { ReaderMcp } from "./mcp";
import { landingPage, readerPage } from "./pages";
import { sendDoc, awaitChoice, readStatus } from "./ops";
import { newCode, normCode, isCode, isEreader } from "./util";

export { Session, ReaderMcp };

// Anonymous MCP endpoint (no OAuth on this origin). Built once at module scope;
// it owns /mcp and speaks Streamable HTTP to the connecting client.
const mcpHandler = ReaderMcp.serve("/mcp", { binding: "READER_MCP" });

function html(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// The reader surface is public+anonymous, so the write API can't lean on "no
// public route" — it gates on READER_TOKEN. Only the reader_send tool on the
// OAuth'd gateway holds the secret. Fail closed: unset secret => every write is
// rejected. For dev, set READER_TOKEN in `.dev.vars`.
function authed(req: Request, env: Env): boolean {
  return !!env.READER_TOKEN && req.headers.get("authorization") === `Bearer ${env.READER_TOKEN}`;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    // --- anonymous MCP endpoint (Streamable HTTP). No auth on this origin. ---
    if (p === "/mcp" || p.startsWith("/mcp/")) {
      return mcpHandler.fetch(req, env, ctx);
    }

    // --- internal write API: shared-secret bearer (see authed()). Reached by the
    // gateway over a service binding; also publicly at /_api/* (token-gated). The
    // logic lives in ops.ts, shared with the in-process MCP tools above. ---
    if (p === "/_api/send" && req.method === "POST") {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const body = (await req.json().catch(() => ({}))) as {
        code?: string; content?: string; title?: string; choices?: string[]; mode?: string;
      };
      const d = await sendDoc(env, body);
      if ("error" in d) return json({ error: d.error }, 400);
      return json({
        code: d.code, v: d.v, title: d.title, choices: d.choices, mode: d.mode,
        connected: d.connected, lastSeenS: d.lastSeenS, pending: d.pending, pendingKind: d.pendingKind,
      });
    }
    if (p === "/_api/await") {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const ms = Math.min(Math.max(parseInt(url.searchParams.get("timeout") || "45", 10) || 45, 5), 55) * 1000;
      const minV = parseInt(url.searchParams.get("min_v") || "0", 10) || 0;
      const r = await awaitChoice(env, url.searchParams.get("code") || "", ms, minV);
      if (r && "error" in r) return json({ error: r.error }, 400);
      return json(r ? { choice: r } : { timeout: true });
    }
    if (p === "/_api/status") {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const s = await readStatus(env, url.searchParams.get("code") || "");
      if ("error" in s) return json({ error: s.error }, 400);
      return json({ code: s.code, connected: s.connected, v: s.v, title: s.title, lastSeenS: s.lastSeenS, reading: s.reading, pending: s.pending, pendingKind: s.pendingKind });
    }

    // --- public tap target: the reader records a choice/quick-action/explain here. ---
    if (p.startsWith("/c/")) {
      const c = normCode(decodeURIComponent(p.slice("/c/".length)));
      const tapV = parseInt(url.searchParams.get("v") || "0", 10) || 0;
      // k=q|a|e types the tap on the wire; absent (pages loaded pre-kind) the DO
      // falls back to matching the label against the known quick-action set.
      const k = url.searchParams.get("k");
      const kind = k === "q" ? ("quick" as const) : k === "a" ? ("answer" as const) : k === "e" ? ("explain" as const) : undefined;
      // Explain labels are quotes to locate, not button captions — they get a
      // wider cap plus before/after anchors (context stays with the session).
      const label = (url.searchParams.get("q") || "").slice(0, kind === "explain" ? 300 : 120);
      const g = url.searchParams.get("g");
      const target = kind === "explain"
        ? {
            before: (url.searchParams.get("b") || "").slice(0, 80),
            after: (url.searchParams.get("a") || "").slice(0, 80),
            granularity: (g === "word" || g === "sentence" ? g : "block") as "word" | "sentence" | "block",
          }
        : undefined;
      if (isCode(c) && label) await env.SESSION.get(env.SESSION.idFromName(c)).recordChoice(label, tapV, kind, target);
      // x=1 => XHR (stay on the page); otherwise a plain link tap => back to reader.
      if (url.searchParams.get("x") === "1") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      return Response.redirect(`${url.origin}/${c}`, 302);
    }

    // --- reader poll (doubles as the reading-position heartbeat via p/n). ---
    if (p.startsWith("/s/")) {
      const code = normCode(decodeURIComponent(p.slice("/s/".length)));
      if (!isCode(code)) return new Response("bad code", { status: 400 });
      const since = parseInt(url.searchParams.get("v") || "0", 10) || 0;
      const page = parseInt(url.searchParams.get("p") || "0", 10) || 0;
      const pages = parseInt(url.searchParams.get("n") || "0", 10) || 0;
      const r = await env.SESSION.get(env.SESSION.idFromName(code)).getSince(since, page, pages);
      const headers = { "content-type": "application/json", "cache-control": "no-store" };
      if (!r) return new Response(null, { status: 204, headers });
      return new Response(JSON.stringify(r), { headers });
    }

    // --- tap feed: one WS frame per tap, for event-driven callers (e.g. a
    // Claude Code Monitor holding the socket — tap wakes the model with no
    // polling). Read-only; keyed on the code like every device-facing route. ---
    if (p.startsWith("/w/")) {
      const c = normCode(decodeURIComponent(p.slice("/w/".length)));
      if (!isCode(c)) return new Response("bad code", { status: 400 });
      if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      return env.SESSION.get(env.SESSION.idFromName(c)).fetch(req);
    }

    // A device revisiting the bare entry used to mint a fresh code every time,
    // orphaning the code Claude had remembered. The last code rides a cookie so
    // the bookmark / retyped-URL path is sticky; /new opts out.
    const cookieCode = normCode((req.headers.get("cookie") || "").match(/(?:^|;\s*)lr=([^;]+)/)?.[1] || "");
    const stick = (code: string, to: Response): Response => {
      const r = new Response(to.body, to);
      r.headers.append("set-cookie", `lr=${code}; Path=/; Max-Age=172800; SameSite=Lax; Secure; HttpOnly`);
      return r;
    };

    // --- /new: always a fresh code (pairing-page link + escape hatch). ---
    if (p === "/new") {
      const code = newCode();
      return stick(code, Response.redirect(`${url.origin}/${code}`, 302));
    }
    // --- / : setup page; an e-reader landing here gets its sticky code, else a fresh one. ---
    if (p === "/" || p === "") {
      if (isEreader(req.headers.get("user-agent") || "")) {
        const code = isCode(cookieCode) ? cookieCode : newCode();
        return stick(code, Response.redirect(`${url.origin}/${code}`, 302));
      }
      return html(landingPage());
    }
    // --- /<code>: the reader page. Anything that isn't a valid code (favicon
    // probes, typos) 404s — it must not get a page, cookie, or DO. ---
    const code = normCode(decodeURIComponent(p.slice(1)));
    if (!isCode(code)) return new Response("not found", { status: 404 });
    return stick(code, html(readerPage(code)));
  },
};
