import { Session } from "./session";
import { landingPage, readerPage } from "./pages";
import { render } from "./md";
import { BASE, newCode, normCode, isEreader } from "./util";

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
// apex now, so the write API can't lean on "no public route" — it gates on SEND_TOKEN.
// Only the send_to_reader tool on the OAuth'd gateway holds the secret. Fail closed:
// unset secret => every write is rejected. For dev, set SEND_TOKEN in `.dev.vars`.
function authed(req: Request, env: Env): boolean {
  return !!env.SEND_TOKEN && req.headers.get("authorization") === `Bearer ${env.SEND_TOKEN}`;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    // --- internal write API: shared-secret bearer (see authed()). ---
    if (p === `${BASE}/_api/send` && req.method === "POST") {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const { code, content, title, choices } = (await req.json().catch(() => ({}))) as {
        code?: string; content?: string; title?: string; choices?: string[];
      };
      const c = normCode(code || "");
      if (c.length < 4) return json({ error: "bad code" }, 400);
      const { title: t, html: body } = render(content || "", title);
      const opts = Array.isArray(choices) ? choices.filter((s) => typeof s === "string" && s.trim()).slice(0, 8) : [];
      const v = await env.SESSION.get(env.SESSION.idFromName(c)).setDoc(body, t, opts);
      return json({ code: c, v, title: t, choices: opts });
    }
    // Long-poll for the user's tap. Blocks up to ~timeout, consuming the choice.
    if (p === `${BASE}/_api/await`) {
      if (!authed(req, env)) return json({ error: "unauthorized" }, 401);
      const c = normCode(url.searchParams.get("code") || "");
      if (!c) return json({ error: "bad code" }, 400);
      const ms = Math.min(Math.max(parseInt(url.searchParams.get("timeout") || "45", 10) || 45, 5), 55) * 1000;
      const stub = env.SESSION.get(env.SESSION.idFromName(c));
      const start = Date.now();
      while (Date.now() - start < ms) {
        const choice = await stub.takeChoice();
        if (choice) return json({ choice });
        await sleep(1200);
      }
      return json({ timeout: true });
    }

    // --- public tap target: the reader records a choice/quick-action here. ---
    if (p.startsWith(`${BASE}/c/`)) {
      const c = normCode(decodeURIComponent(p.slice(`${BASE}/c/`.length)));
      const label = (url.searchParams.get("q") || "").slice(0, 120);
      if (c && label) await env.SESSION.get(env.SESSION.idFromName(c)).recordChoice(label);
      // x=1 => XHR (stay on the page); otherwise a plain link tap => back to reader.
      if (url.searchParams.get("x") === "1") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      return Response.redirect(`${url.origin}${BASE}/${c}`, 302);
    }

    // --- reader poll. ---
    if (p.startsWith(`${BASE}/s/`)) {
      const code = normCode(decodeURIComponent(p.slice(`${BASE}/s/`.length)));
      if (!code) return new Response("bad code", { status: 400 });
      const since = parseInt(url.searchParams.get("v") || "0", 10) || 0;
      const r = await env.SESSION.get(env.SESSION.idFromName(code)).getSince(since);
      const headers = { "content-type": "application/json", "cache-control": "no-store" };
      if (!r) return new Response(null, { status: 204, headers });
      return new Response(JSON.stringify(r), { headers });
    }

    // --- /read: setup page; an e-reader landing here gets a fresh code minted. ---
    if (p === BASE || p === `${BASE}/`) {
      if (isEreader(req.headers.get("user-agent") || "")) {
        return Response.redirect(`${url.origin}${BASE}/${newCode()}`, 302);
      }
      return html(landingPage());
    }
    // --- /read/<code>: the reader page (any other sub-path is the code). ---
    if (p.startsWith(`${BASE}/`)) {
      const code = normCode(decodeURIComponent(p.slice(`${BASE}/`.length)));
      if (!code) return Response.redirect(`${url.origin}${BASE}/${newCode()}`, 302);
      return html(readerPage(code));
    }

    // --- bare apex => the reader entry. ---
    if (p === "/" || p === "") {
      return Response.redirect(`${url.origin}${BASE}`, 302);
    }

    return new Response("not found", { status: 404 });
  },
};
