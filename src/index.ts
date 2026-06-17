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

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    // --- internal API: service-binding only. The gateway returns 404 for any
    // public /_api/ path, so the central send_to_reader tool (which reaches us
    // via the binding, bypassing the gateway's router) is the only caller. ---
    if (p === `${BASE}/_api/send` && req.method === "POST") {
      const { code, content, title } = (await req.json().catch(() => ({}))) as {
        code?: string; content?: string; title?: string;
      };
      const c = normCode(code || "");
      if (c.length < 4) return json({ error: "bad code" }, 400);
      const { title: t, html: body } = render(content || "", title);
      const v = await env.SESSION.get(env.SESSION.idFromName(c)).setDoc(body, t);
      return json({ code: c, v, title: t });
    }
    if (p === `${BASE}/_api/status`) {
      const c = normCode(url.searchParams.get("code") || "");
      if (!c) return json({ error: "bad code" }, 400);
      const s = await env.SESSION.get(env.SESSION.idFromName(c)).status();
      return json({ code: c, ...s });
    }

    // --- reader poll. Same origin as the reader page (both under the gateway). ---
    if (p.startsWith(`${BASE}/s/`)) {
      const code = normCode(decodeURIComponent(p.slice(`${BASE}/s/`.length)));
      if (!code) return new Response("bad code", { status: 400 });
      const since = parseInt(url.searchParams.get("v") || "0", 10) || 0;
      const r = await env.SESSION.get(env.SESSION.idFromName(code)).getSince(since);
      const headers = { "content-type": "application/json", "cache-control": "no-store" };
      if (!r) return new Response(null, { status: 204, headers });
      return new Response(JSON.stringify(r), { headers });
    }

    // --- reader page. /r mints a stable code; /r/<code> renders. ---
    if (p === `${BASE}/r` || p === `${BASE}/r/`) {
      return Response.redirect(`${url.origin}${BASE}/r/${newCode()}`, 302);
    }
    if (p.startsWith(`${BASE}/r/`)) {
      const code = normCode(decodeURIComponent(p.slice(`${BASE}/r/`.length)));
      if (!code) return Response.redirect(`${url.origin}${BASE}/r/${newCode()}`, 302);
      return html(readerPage(code));
    }

    // --- setup page; an e-reader landing on the base goes straight to a reader. ---
    if (p === BASE || p === `${BASE}/`) {
      if (isEreader(req.headers.get("user-agent") || "")) {
        return Response.redirect(`${url.origin}${BASE}/r`, 302);
      }
      return html(landingPage());
    }

    return new Response("not found", { status: 404 });
  },
};
