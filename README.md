# reader

Send anything Claude writes to an e-reader (Kindle, Kobo, …) and read it on
e-ink in real time. The **reader website** is **`neves.cloud/reader`** — a
path-scoped Cloudflare Worker route that intercepts `/reader*` in front of the
GitHub Pages org site that serves the rest of the apex. The MCP tools that drive
it (`send_to_reader`, `await_reader_choice`, `check_reader`, `pair_reader`,
`predict_then_reveal`) live on the OAuth'd **`mcp.neves.cloud/mcp`** server and
reach this Worker's write API over a shared secret.

Two surfaces, two audiences:
- **public + anonymous** (`/reader`, `/reader/<code>`, `/reader/s`, `/reader/c`,
  `/reader/w`): the reader page, its poll/tap, and a read-only WebSocket tap feed.
  No sign-in — an e-reader can't OAuth, so the unguessable 5-char code *is* the
  capability.
- **write API** (`/reader/_api/*`): gated by the `READER_TOKEN` secret. Only the
  MCP gateway holds it; it sets a reader's document. The reader's anonymous
  origin is deliberately *separate* from the OAuth'd `mcp.neves.cloud`, so
  there's no OAuth-discovery bleed onto it.

## How it works
```
Claude (any client, incl. phone)               e-reader (~2012 WebKit, e-ink)
   │  send_to_reader(code, markdown)               │  open neves.cloud/reader
   ▼  (tool on mcp.neves.cloud, OAuth)            ▼  shows a 5-char code
   gateway ──Bearer READER_TOKEN──▶ /reader/_api/send           polls /reader/s/<code> (2.5s→30s backoff)
                                     │                              ▲  swaps in new HTML
                                     ▼                              │
                            ┌──────────────────────────┐           │
                            │ Durable Object "<code>"  │───────────┘
                            │ { v, html, title }, TTL  │──▶ ws /reader/w/<code>
                            └──────────────────────────┘    one frame per tap
```
The **e-reader does zero typing**: it shows a code, you read it off-screen and
tell Claude. Polling (not WebSocket/SSE) is deliberate — e-ink repaints in ~1s
and the device's WS/SSE are unreliable, so a 2.5s short-poll with full-document
replace is the right granularity *and* the robust one.

Why the tools live on the central server (not here): an anonymous MCP endpoint
can't share an origin with the gateway's OAuth — the origin-wide OAuth discovery
makes the anonymous endpoint look protected, and clients (claude.ai) then fail to
connect. So the reader is exposed as a tool on the one OAuth server instead.

## Pieces (one Worker, all under `/reader`)
- `src/index.ts` — router: `/_api/send|await|status` (write, `READER_TOKEN`) · `/s/<code>` poll · `/c/<code>` tap · `/w/<code>` WebSocket tap feed · `/reader`→`/reader/<code>` reader · `/reader` setup (e-reader UA → sticky code) · bare apex → `/reader`.
- `src/session.ts` — one Durable Object per code; holds the doc + a version the reader polls, the pending tap (typed answer/quick), and hibernating feed sockets; self-deletes after 6h of mutual silence.
- `src/md.ts` — markdown → clean reading HTML (same shape as the static `kindle` repo's `build.py`).
- `src/pages.ts` — `landingPage` (setup; HIG over the web-conformance floor) + `readerPage` (e-ink serif, ES5-only inline script).
- `src/util.ts` — `BASE`, `APEX`, and the public-URL constants (single source).

The MCP tools live in the gateway repo (`../mcp`, `src/reader-tools.ts` +
`src/cuko-tools.ts`) and reach `/reader/_api/*` with
`Authorization: Bearer ${READER_TOKEN}`. The gateway also remembers each
signed-in user's last verified code, so tools work without a code after the
first pairing.

## Develop
```sh
npm install
npm run dev        # wrangler dev (local DOs, no CF auth needed)
npm run typecheck
# write API (set READER_TOKEN in .dev.vars, e.g. "dev"; fail-closed, always required):
#   curl -H "Authorization: Bearer dev" -X POST localhost:8787/reader/_api/send \
#     -d '{"code":"ABCDE","content":"# hi"}'
```

## Deploy
```sh
wrangler secret put READER_TOKEN   # one-time: the shared secret the gateway tool sends
npm run deploy                   # binds the neves.cloud/reader* route, in front of Pages
cd ../mcp && npm run deploy      # gateway (holds the same READER_TOKEN)
```

## Use it
1. Add `https://mcp.neves.cloud/mcp` as a custom MCP server in Claude (GitHub sign-in).
2. Open `neves.cloud/reader` on the e-reader; note the 5-char code.
3. Tell Claude: *"send that to my reader, code ABCDE."*
