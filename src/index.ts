import { Live } from "./mcp";
import { Session } from "./session";
import { landingPage, readerPage } from "./pages";
import { newCode, normCode, isEreader } from "./util";

export { Live, Session };

const mcp = Live.serve("/mcp", { binding: "LIVE" });

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
    if (p === "/mcp" || p.startsWith("/mcp/")) return mcp.fetch(req, env, ctx);

    // Reader poll. Same origin as the reader page, so no CORS dance on the
    // ancient Kindle browser — the permissive header is just for reuse.
    if (p.startsWith("/s/")) {
      const code = normCode(decodeURIComponent(p.slice(3)));
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
    if (p === "/r" || p === "/r/") {
      return Response.redirect(`${url.origin}/r/${newCode()}`, 302);
    }
    if (p.startsWith("/r/")) {
      const code = normCode(decodeURIComponent(p.slice(3)));
      if (!code) return Response.redirect(`${url.origin}/r/${newCode()}`, 302);
      return html(readerPage(code));
    }

    // Setup page — but an e-reader landing on "/" is sent straight to a reader.
    if (p === "/") {
      if (isEreader(req.headers.get("user-agent") || "")) {
        return Response.redirect(`${url.origin}/r`, 302);
      }
      return html(landingPage(url.host));
    }

    return new Response("not found", { status: 404 });
  },
};
