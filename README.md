# live-reader

Send anything Claude writes to an e-reader (Kindle, Kobo, …) and read it on
e-ink in real time. A public, anonymous MCP server + a one-origin reader page,
on one Cloudflare Worker. Live at **live.neves.cloud**.

## How it works
```
Claude (any client, incl. phone)        e-reader (~2012 WebKit, e-ink)
   │  send_to_reader(code, markdown)            │  open live.neves.cloud
   ▼  (MCP, no auth)                            ▼  shows a 5-char code
        ┌──────────────────────────┐      polls /s/<code> every 2.5s
        │ Durable Object "<code>"  │◀──────────┘  swaps in new HTML
        │ { v, html, title }, TTL  │
        └──────────────────────────┘
```
The **e-reader does zero typing**: it displays a code, you read it off the
screen and tell Claude. Polling (not WebSocket/SSE) is deliberate — e-ink
repaints in ~1s and the device's WS/SSE are unreliable, so a 2.5s short-poll
with full-document replace is the right granularity *and* the robust one.

## Pieces (one Worker)
- `src/mcp.ts` — anonymous `McpAgent`; tools `send_to_reader` / `check_reader`. Sessions isolate by code, so one public endpoint serves everyone.
- `src/session.ts` — one Durable Object per code; holds the doc + a version the reader polls against; self-deletes 6h after the last write.
- `src/index.ts` — router: `/mcp` (transport), `/s/<code>` (poll), `/r` → `/r/<code>` (reader), `/` (setup page; e-reader UA is sent straight to a reader).
- `src/pages.ts` — `landingPage` (setup; HIG over the web-conformance floor) + `readerPage` (e-ink serif, ES5-only inline script).
- `src/md.ts` — markdown → clean reading HTML (same shape as the static `kindle` repo's `build.py`).

## Develop
```sh
npm install
npm run dev        # wrangler dev (local DOs, no CF auth needed)
npm run typecheck
```

## Deploy
```sh
wrangler login     # one-time, needs the neves.cloud Cloudflare account
npm run deploy     # custom_domain in wrangler.jsonc manages the DNS record
```

## Use it
1. Add `https://live.neves.cloud/mcp` as an MCP server in your Claude client.
2. Open `live.neves.cloud` on the e-reader; note the 5-char code.
3. Tell Claude: *"send that to my reader, code ABCDE."*
