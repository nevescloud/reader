# live-reader

Send anything Claude writes to an e-reader (Kindle, Kobo, …) and read it on
e-ink in real time. The **reader website** lives at **`mcp.neves.cloud/live-reader`**;
the MCP tools that drive it (`send_to_reader`, `check_reader`) live on the unified
**`mcp.neves.cloud`** server and reach this Worker over an internal API.

This Worker has **no public route of its own** — it's reachable only through the
`mcp.neves.cloud` gateway's service binding. Two surfaces:
- **public** (via the gateway): the reader page + its poll, under `/live-reader`.
- **internal** (`/_api/*`, service-binding only — the gateway 404s it publicly):
  what the central `send_to_reader` tool calls to set a reader's document.

## How it works
```
Claude (any client, incl. phone)               e-reader (~2012 WebKit, e-ink)
   │  send_to_reader(code, markdown)                  │  open mcp.neves.cloud/live-reader
   ▼  (tool on mcp.neves.cloud, OAuth)            ▼  shows a 5-char code
   gateway ──service binding──▶ /live-reader/_api/send       polls /live-reader/s/<code> every 2.5s
                                     │                              ▲  swaps in new HTML
                                     ▼                              │
                            ┌──────────────────────────┐           │
                            │ Durable Object "<code>"  │───────────┘
                            │ { v, html, title }, TTL  │
                            └──────────────────────────┘
```
The **e-reader does zero typing**: it shows a code, you read it off-screen and
tell Claude. Polling (not WebSocket/SSE) is deliberate — e-ink repaints in ~1s
and the device's WS/SSE are unreliable, so a 2.5s short-poll with full-document
replace is the right granularity *and* the robust one.

Why the tools live on the central server (not here): an anonymous MCP endpoint
can't share an origin with the gateway's OAuth — the origin-wide OAuth discovery
makes the anonymous endpoint look protected, and clients (claude.ai) then fail to
connect. So the reader is exposed as a tool on the one OAuth server instead.

## Pieces (one Worker, all under `/live-reader`)
- `src/index.ts` — router: `/_api/send` + `/_api/status` (internal) · `/s/<code>` poll · `/r`→`/r/<code>` reader · `/` setup (e-reader UA → reader).
- `src/session.ts` — one Durable Object per code; holds the doc + a version the reader polls; self-deletes 6h after the last write.
- `src/md.ts` — markdown → clean reading HTML (same shape as the static `kindle` repo's `build.py`).
- `src/pages.ts` — `landingPage` (setup; HIG over the web-conformance floor) + `readerPage` (e-ink serif, ES5-only inline script).
- `src/util.ts` — `BASE` and the public-URL constants (single source).

The MCP tools are in the gateway repo: `../mcp/src/reader-tools.ts`.

## Develop
```sh
npm install
npm run dev        # wrangler dev (local DOs, no CF auth needed)
npm run typecheck
# internal API:  curl -X POST localhost:8787/live-reader/_api/send -d '{"code":"ABCDE","content":"# hi"}'
```

## Deploy
Deploy **this Worker first** (the gateway's service binding resolves to it), then
the gateway in `../mcp` (which carries the tools):
```sh
npm run deploy                 # live-reader (private, no public route)
cd ../mcp && npm run deploy
```

## Use it
1. Add `https://mcp.neves.cloud/mcp` as a custom MCP server in Claude (GitHub sign-in).
2. Open `mcp.neves.cloud/live-reader` on the e-reader; note the 5-char code.
3. Tell Claude: *"send that to my reader, code ABCDE."*
