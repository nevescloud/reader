import { Live } from "./mcp";
import { Session } from "./session";
import { landingPage, readerPage } from "./pages";
import { BASE, newCode, normCode, isEreader } from "./util";

export { Live, Session };

// Mounted under BASE because this Worker runs behind the gateway at
// mcp.neves.cloud/live-reader/* — it has no public route of its own.
const mcp = Live.serve(`${BASE}/mcp`, { binding: "LIVE" });

function html(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    // MCP transport (Streamable HTTP) — Claude clients connect here.
    if (p === `${BASE}/mcp` || p.startsWith(`${BASE}/mcp/`)) return mcp.fetch(req, env, ctx);

    // Reader poll. Same origin as the reader page (both under the gateway), so
    // no CORS dance on the ancient Kindle browser.
    if (p.startsWith(`${BASE}/s/`)) {
      const code = normCode(decodeURIComponent(p.slice(`${BASE}/s/`.length)));
      if (!code) return new Response("bad code", { status: 400 });
      const since = parseInt(url.searchParams.get("v") || "0", 10) || 0;
      const stub = env.SESSION.get(env.SESSION.idFromName(code));
      const r = await stub.getSince(since);
      const headers = {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      };
      if (!r) return new Response(null, { status: 204, headers });
      return new Response(JSON.stringify(r), { headers });
    }

    // Reader page. /r mints a fresh code and redirects so the URL is stable
    // (bookmark/refresh keep the same code); /r/<code> renders.
    if (p === `${BASE}/r` || p === `${BASE}/r/`) {
      return Response.redirect(`${url.origin}${BASE}/r/${newCode()}`, 302);
    }
    if (p.startsWith(`${BASE}/r/`)) {
      const code = normCode(decodeURIComponent(p.slice(`${BASE}/r/`.length)));
      if (!code) return Response.redirect(`${url.origin}${BASE}/r/${newCode()}`, 302);
      return html(readerPage(code));
    }

    // Setup page — but an e-reader landing on the base is sent straight to a reader.
    if (p === BASE || p === `${BASE}/`) {
      if (isEreader(req.headers.get("user-agent") || "")) {
        return Response.redirect(`${url.origin}${BASE}/r`, 302);
      }
      return html(landingPage());
    }

    return new Response("not found", { status: 404 });
  },
};
