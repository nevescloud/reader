# live-reader

Send anything Claude writes to an e-reader (Kindle, Kobo, …) and read it on
e-ink in real time. An anonymous MCP server + an e-ink reader page, served as a
tenant of the **mcp.neves.cloud** gateway at **`mcp.neves.cloud/live-reader`**.

This Worker has **no public route of its own** — it's reachable only through the
gateway's service binding, so its MCP endpoint, reader page, and poll all share
one origin (`mcp.neves.cloud`), and there's no CORS for the ancient Kindle browser.

## How it works
```
Claude (any client, incl. phone)        e-reader (~2012 WebKit, e-ink)
   │  send_to_reader(code, markdown)            │  open mcp.neves.cloud/live-reader
   ▼  (MCP, no auth)                            ▼  shows a 5-char code
   mcp.neves.cloud/live-reader/mcp        polls …/live-reader/s/<code> every 2.5s
        │  (gateway → service binding)          ▲  swaps in new HTML
        ▼                                        │
        ┌──────────────────────────┐            │
        │ Durable Object "<code>"  │────────────┘
        │ { v, html, title }, TTL  │
        └──────────────────────────┘
```
The **e-reader does zero typing**: it shows a code, you read it off-screen and
tell Claude. Polling (not WebSocket/SSE) is deliberate — e-ink repaints in ~1s
and the device's WS/SSE are unreliable, so a 2.5s short-poll with full-document
replace is the right granularity *and* the robust one.

## Pieces (one Worker, all mounted under `/live-reader`)
- `src/mcp.ts` — anonymous `McpAgent`; tools `send_to_reader` / `check_reader`. Sessions isolate by code.
- `src/session.ts` — one Durable Object per code; holds the doc + a version the reader polls against; self-deletes 6h after the last write.
- `src/index.ts` — router under `BASE` (`/live-reader`): `/mcp` · `/s/<code>` poll · `/r`→`/r/<code>` reader · `/` setup (e-reader UA → reader).
- `src/pages.ts` — `landingPage` (setup; HIG over the web-conformance floor) + `readerPage` (e-ink serif, ES5-only inline script).
- `src/md.ts` — markdown → clean reading HTML (same shape as the static `kindle` repo's `build.py`).
- `src/util.ts` — `BASE` and the public-URL constants (single source).

## Develop
```sh
npm install
npm run dev        # wrangler dev (local DOs, no CF auth needed)
npm run typecheck
# full chain (gateway → this tenant): run `wrangler dev` here AND in ../mcp on
# distinct ports + --inspector-port; the dev registry resolves the service binding.
```

## Deploy
Deploy **this Worker first** (so the `live-reader` service exists), then the
gateway in `../mcp` (whose service binding resolves to it):
```sh
npm run deploy                 # live-reader (private service, no route)
cd ../mcp && npm run deploy    # gateway picks up the LIVE_READER binding
```

## Use it
1. Add `https://mcp.neves.cloud/live-reader/mcp` as an MCP server in your Claude client.
2. Open `mcp.neves.cloud/live-reader` on the e-reader; note the 5-char code.
3. Tell Claude: *"send that to my reader, code ABCDE."*
