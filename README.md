# live-reader

Send anything Claude writes to an e-reader (Kindle, Kobo, …) and read it on
e-ink in real time. The **reader website** is its own origin — the apex
**`neves.cloud/read`**. The MCP tools that drive it (`send_to_reader`,
`check_reader`) live on the OAuth'd **`mcp.neves.cloud/mcp`** server and reach
this Worker's write API over a shared secret.

Two surfaces, two audiences:
- **public + anonymous** (`/read`, `/read/<code>`, `/read/s`, `/read/c`): the
  reader page and its poll/tap. No sign-in — an e-reader can't OAuth, so the
  unguessable 5-char code *is* the capability.
- **write API** (`/read/_api/*`): gated by the `SEND_TOKEN` secret (localhost is
  exempt for dev). Only the central `send_to_reader` tool holds it; it sets a
  reader's document. The reader's anonymous origin is deliberately *separate* from
  the OAuth'd `mcp.neves.cloud`, so there's no OAuth-discovery bleed onto it.

## How it works
```
Claude (any client, incl. phone)               e-reader (~2012 WebKit, e-ink)
   │  send_to_reader(code, markdown)                  │  open neves.cloud/read
   ▼  (tool on mcp.neves.cloud, OAuth)            ▼  shows a 5-char code
   gateway ──Bearer SEND_TOKEN──▶ /read/_api/send           polls /read/s/<code> every 2.5s
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

## Pieces (one Worker, all under `/read`)
- `src/index.ts` — router: `/_api/send` + `/_api/await` (write, `SEND_TOKEN`) · `/s/<code>` poll · `/c/<code>` tap · `/read`→`/read/<code>` reader · `/read` setup (e-reader UA → fresh code) · bare apex → `/read`.
- `src/session.ts` — one Durable Object per code; holds the doc + a version the reader polls; self-deletes 6h after the last write.
- `src/md.ts` — markdown → clean reading HTML (same shape as the static `kindle` repo's `build.py`).
- `src/pages.ts` — `landingPage` (setup; HIG over the web-conformance floor) + `readerPage` (e-ink serif, ES5-only inline script).
- `src/util.ts` — `BASE`, `APEX`, and the public-URL constants (single source).

The MCP tools (`send_to_reader`, `check_reader`) belong in the gateway repo
(`../mcp`) and reach `/read/_api/*` with `Authorization: Bearer ${SEND_TOKEN}`.
**Not yet wired there** — that's the remaining integration step.

## Develop
```sh
npm install
npm run dev        # wrangler dev (local DOs, no CF auth needed)
npm run typecheck
# write API (set SEND_TOKEN in .dev.vars, e.g. "dev"; fail-closed, always required):
#   curl -H "Authorization: Bearer dev" -X POST localhost:8787/read/_api/send \
#     -d '{"code":"ABCDE","content":"# hi"}'
```

## Deploy
```sh
wrangler secret put SEND_TOKEN   # one-time: the shared secret the gateway tool sends
npm run deploy                   # claims neves.cloud (custom_domain), serves /read
cd ../mcp && npm run deploy      # gateway — once the send_to_reader tool is wired
```

## Use it
1. Add `https://mcp.neves.cloud/mcp` as a custom MCP server in Claude (GitHub sign-in).
2. Open `neves.cloud/read` on the e-reader; note the 5-char code.
3. Tell Claude: *"send that to my reader, code ABCDE."*
