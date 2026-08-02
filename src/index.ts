import { Session } from "./session";
import { ReaderMcp } from "./mcp";
import { landingPage, privacyPage, readerPage } from "./pages";
import { sendDoc, awaitChoice, readStatus, startDrill, awaitDrillReport, resumeDrill } from "./ops";
import { newCode, normCode, isCode, isEreader } from "./util";
import { allowDeviceRequest, allowFreshCode, allowMcpRequest, tooMany } from "./limit";

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

// decodeURIComponent throws a URIError on a malformed escape ("/%", "/%zz"), and
// an uncaught throw here is a 500 on a path that should simply 404. Every
// device-facing route decodes through this.
function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
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
    // Loose ceiling only: these come from the MCP client's egress, which is
    // shared across users — a tight per-IP budget here would have them throttle
    // each other (see limit.ts).
    if (p === "/mcp" || p.startsWith("/mcp/")) {
      if (!(await allowMcpRequest(env, req))) return tooMany();
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
      return json({ code: s.code, connected: s.connected, v: s.v, title: s.title, lastSeenS: s.lastSeenS, reading: s.reading, pending: s.pending, pendingKind: s.pendingKind, drill: s.drill });
    }

    // --- deck mode: hand over a whole drill, then collect the report. ---
    if (p === "/_api/drill" && req.method === "POST") {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const body = (await req.json().catch(() => ({}))) as { code?: string };
      const d = await startDrill(env, body.code || "", body);
      return "error" in d ? json({ error: d.error }, 400) : json(d);
    }
    if (p === "/_api/drill/report") {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const ms = Math.min(Math.max(parseInt(url.searchParams.get("timeout") || "45", 10) || 45, 5), 55) * 1000;
      const r = await awaitDrillReport(env, url.searchParams.get("code") || "", ms);
      if (r && "error" in r) return json({ error: r.error }, 400);
      return json(r ?? { none: true });
    }
    if (p === "/_api/drill/resume" && req.method === "POST") {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const body = (await req.json().catch(() => ({}))) as { code?: string };
      const r = await resumeDrill(env, body.code || "");
      return "error" in r ? json({ error: r.error }, 400) : json(r);
    }

    // --- everything below is device-facing and code-bearing. One per-IP budget
    // covers the lot, sized so a real reader never touches it (limit.ts); it caps
    // how fast one address can mint Durable Objects. The tight first-contact
    // budget — the control that actually restores the keyspace — is spent inside
    // the /s/ poll, where the DO can say whether the code is new. ---
    const bareCode = p.length > 1 && !p.includes("/", 1) ? normCode(decode(p.slice(1))) : "";
    if (p.startsWith("/c/") || p.startsWith("/s/") || p.startsWith("/w/") || isCode(bareCode)) {
      if (!(await allowDeviceRequest(env, req))) return tooMany();
    }

    // --- public tap target: the reader records a choice/quick-action/explain here. ---
    if (p.startsWith("/c/")) {
      const c = normCode(decode(p.slice("/c/".length)));
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
      const code = normCode(decode(p.slice("/s/".length)));
      if (!isCode(code)) return new Response("bad code", { status: 400 });
      const since = parseInt(url.searchParams.get("v") || "0", 10) || 0;
      const page = parseInt(url.searchParams.get("p") || "0", 10) || 0;
      const pages = parseInt(url.searchParams.get("n") || "0", 10) || 0;
      const { fresh, doc } = await env.SESSION.get(env.SESSION.idFromName(code)).getSince(since, page, pages);
      // First contact with this code. A device pays this once and is never fresh
      // again; a guesser pays it every time — so this budget, not the loose one
      // above, is what makes 24.3M codes behave like a secret.
      if (fresh && !(await allowFreshCode(env, req))) return tooMany();
      const headers = { "content-type": "application/json", "cache-control": "no-store" };
      if (!doc) return new Response(null, { status: 204, headers });
      return new Response(JSON.stringify(doc), { headers });
    }

    // --- tap feed: one WS frame per tap, for event-driven callers (e.g. a
    // Claude Code Monitor holding the socket — tap wakes the model with no
    // polling). Read-only; keyed on the code like every device-facing route. ---
    if (p.startsWith("/w/")) {
      const c = normCode(decode(p.slice("/w/".length)));
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

    // --- /privacy: the policy. A stable public URL, because the Connectors
    // Directory listing points at it and a moved one reads as an absent one. ---
    if (p === "/privacy") return html(privacyPage());

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
    const code = normCode(decode(p.slice(1)));
    if (!isCode(code)) return new Response("not found", { status: 404 });
    // The UA picks the dark palette: e-ink gets a two-ink one (greys are dither
    // patterns there — see pages.ts). Light is identical either way.
    return stick(code, html(readerPage(code, isEreader(req.headers.get("user-agent") || ""))));
  },
};
