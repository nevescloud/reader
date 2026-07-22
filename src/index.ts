import { Session } from "./session";
import { landingPage, readerPage } from "./pages";
import { render } from "./md";
import { BASE, newCode, normCode, isCode, isEreader } from "./util";

export { Session };

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The reader surface is public+anonymous, but this Worker is publicly routed on the
// apex now, so the write API can't lean on "no public route" — it gates on READER_TOKEN.
// Only the reader_send tool on the OAuth'd gateway holds the secret. Fail closed:
// unset secret => every write is rejected. For dev, set READER_TOKEN in `.dev.vars`.
function authed(req: Request, env: Env): boolean {
  return !!env.READER_TOKEN && req.headers.get("authorization") === `Bearer ${env.READER_TOKEN}`;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    // --- internal write API: shared-secret bearer (see authed()). ---
    if (p === `${BASE}/_api/send` && req.method === "POST") {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const { code, content, title, choices, mode } = (await req.json().catch(() => ({}))) as {
        code?: string; content?: string; title?: string; choices?: string[]; mode?: string;
      };
      const c = normCode(code || "");
      if (!isCode(c)) return json({ error: "bad code" }, 400);
      const stub = env.SESSION.get(env.SESSION.idFromName(c));
      const explicit = Array.isArray(choices) ? choices.filter((s) => typeof s === "string" && s.trim()).slice(0, 8) : null;
      let md = (content || "").trim();
      let opts = explicit ?? [];
      let wantTitle = title;
      if (mode === "append") {
        // Append re-renders the whole doc from concatenated markdown, so the new
        // html string is an exact extension of the old one — which is what the
        // device keys on to hold the reading position instead of jumping to page 1.
        const prev = await stub.getMd();
        if (prev.md) md = `${prev.md}\n\n${md}`;
        if (!explicit) opts = prev.choices; // append leaves buttons alone unless told otherwise
        if (!wantTitle) wantTitle = prev.title || undefined;
      }
      const { title: t, html: body } = render(md, wantTitle);
      const v = await stub.setDoc(body, t, opts, md);
      // Delivery honesty: the caller decides what to claim ("on the device" vs
      // "queued" vs "no reader has ever polled") from the same status the DO
      // already tracks — a send to a mistyped code must not look like delivery.
      const s = await stub.status();
      return json({
        code: c, v, title: t, choices: opts, mode: mode === "append" ? "append" : "replace",
        connected: s.connected, lastSeenS: s.lastSeenS, pending: s.pending, pendingKind: s.pendingKind,
      });
    }
    // Long-poll for the user's tap: parks on an in-DO waiter that recordChoice
    // resolves directly, so a tap delivers instantly (no storage-poll tick).
    // min_v scopes the wait to answer-taps on that doc version or later (a tap
    // from an older doc must not answer a newer question); quick/explain taps
    // are requests, never version-stale. Chunked ≤30s per RPC so a DO restart
    // mid-wait costs one re-arm, not the whole timeout.
    if (p === `${BASE}/_api/await`) {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const c = normCode(url.searchParams.get("code") || "");
      if (!isCode(c)) return json({ error: "bad code" }, 400);
      const ms = Math.min(Math.max(parseInt(url.searchParams.get("timeout") || "45", 10) || 45, 5), 55) * 1000;
      const minV = parseInt(url.searchParams.get("min_v") || "0", 10) || 0;
      const stub = env.SESSION.get(env.SESSION.idFromName(c));
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        try {
          const choice = await stub.waitChoice(minV, Math.min(deadline - Date.now(), 30_000));
          if (choice) return json({ choice });
        } catch { await sleep(500); } // DO evicted mid-wait — re-arm
      }
      return json({ timeout: true });
    }
    // Pairing probe: is a reader currently polling this code? (check_reader)
    if (p === `${BASE}/_api/status`) {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const c = normCode(url.searchParams.get("code") || "");
      if (!isCode(c)) return json({ error: "bad code" }, 400);
      const s = await env.SESSION.get(env.SESSION.idFromName(c)).status();
      return json({ code: c, connected: s.connected, v: s.v, title: s.title, lastSeenS: s.lastSeenS, reading: s.reading, pending: s.pending, pendingKind: s.pendingKind });
    }

    // --- public tap target: the reader records a choice/quick-action/explain here. ---
    if (p.startsWith(`${BASE}/c/`)) {
      const c = normCode(decodeURIComponent(p.slice(`${BASE}/c/`.length)));
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
      return Response.redirect(`${url.origin}${BASE}/${c}`, 302);
    }

    // --- reader poll (doubles as the reading-position heartbeat via p/n). ---
    if (p.startsWith(`${BASE}/s/`)) {
      const code = normCode(decodeURIComponent(p.slice(`${BASE}/s/`.length)));
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
    if (p.startsWith(`${BASE}/w/`)) {
      const c = normCode(decodeURIComponent(p.slice(`${BASE}/w/`.length)));
      if (!isCode(c)) return new Response("bad code", { status: 400 });
      if ((req.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      return env.SESSION.get(env.SESSION.idFromName(c)).fetch(req);
    }

    // A device revisiting bare /reader used to mint a fresh code every time,
    // orphaning the code Claude had remembered. The last code rides a cookie so
    // the bookmark / retyped-URL path is sticky; /reader/new opts out.
    const cookieCode = normCode((req.headers.get("cookie") || "").match(/(?:^|;\s*)lr=([^;]+)/)?.[1] || "");
    const stick = (code: string, to: Response): Response => {
      const r = new Response(to.body, to);
      r.headers.append("set-cookie", `lr=${code}; Path=${BASE}; Max-Age=172800; SameSite=Lax; Secure; HttpOnly`);
      return r;
    };

    // --- /reader/new: always a fresh code (pairing-page link + escape hatch). ---
    if (p === `${BASE}/new`) {
      const code = newCode();
      return stick(code, Response.redirect(`${url.origin}${BASE}/${code}`, 302));
    }
    // --- /reader: setup page; an e-reader landing here gets its sticky code, else a fresh one. ---
    if (p === BASE || p === `${BASE}/`) {
      if (isEreader(req.headers.get("user-agent") || "")) {
        const code = isCode(cookieCode) ? cookieCode : newCode();
        return stick(code, Response.redirect(`${url.origin}${BASE}/${code}`, 302));
      }
      return html(landingPage());
    }
    // --- /reader/<code>: the reader page. Anything that isn't a valid code
    // (favicon probes, typos) 404s — it must not get a page, cookie, or DO. ---
    if (p.startsWith(`${BASE}/`)) {
      const code = normCode(decodeURIComponent(p.slice(`${BASE}/`.length)));
      if (!isCode(code)) return new Response("not found", { status: 404 });
      return stick(code, html(readerPage(code)));
    }

    // --- bare apex => the reader entry. ---
    if (p === "/" || p === "") {
      return Response.redirect(`${url.origin}${BASE}`, 302);
    }

    return new Response("not found", { status: 404 });
  },
};
