# reader

Send anything Claude writes to an e-reader (Kindle, Kobo, …) and read it on
e-ink in real time. The **reader website** is **`reader.neves.cloud`** — a
Cloudflare Worker on its own subdomain (the nevescloud domain standard: a
worker-backed service `<repo>` lives at `<repo>.neves.cloud`, so the repo name
and the hostname are the same token). The historical mount **`neves.cloud/reader`**
— a path-route intercepting `/reader*` in front of the GitHub Pages apex — stays
live and additive, so paired devices and printed instructions keep working. The
MCP tools that drive the reader (`send_to_reader`, `await_reader_choice`,
`check_reader`, `pair_reader`, `predict_then_reveal`) live on the OAuth'd
**`mcp.neves.cloud/mcp`** server and reach this Worker's write API over a
service binding.

Two surfaces, two audiences (paths shown at the subdomain root; the legacy apex
mount prefixes each with `/reader`):
- **public + anonymous** (`/`, `/<code>`, `/s`, `/c`, `/w`): the reader page, its
  poll/tap, and a read-only WebSocket tap feed. No sign-in — an e-reader can't
  OAuth, so the unguessable 5-char code *is* the capability.
- **write API** (`/_api/*`): gated by the `READER_TOKEN` secret. Only the MCP
  gateway holds it; it sets a reader's document. The reader's anonymous origin is
  deliberately *separate* from the OAuth'd `mcp.neves.cloud`, so there's no
  OAuth-discovery bleed onto it — which is also what keeps the door open to an
  anonymous reader-native MCP endpoint at `reader.neves.cloud/mcp` later.

## How it works
```
Claude (any client, incl. phone)               e-reader (~2012 WebKit, e-ink)
   │  send_to_reader(code, markdown)               │  open reader.neves.cloud
   ▼  (tool on mcp.neves.cloud, OAuth)            ▼  shows a 5-char code
   gateway ─Bearer READER_TOKEN─▶ (binding) /reader/_api/send    polls /s/<code> (2.5s→30s backoff)
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

## Pieces (one Worker; `base` is `""` on the subdomain, `/reader` on the apex mount)
- `src/index.ts` — router: `base` is computed per request from the host (`baseFor`), then every route hangs off it: `/_api/send|await|status` (write, `READER_TOKEN`) · `/s/<code>` poll · `/c/<code>` tap · `/w/<code>` WebSocket tap feed · `/<code>` reader · entry (e-reader UA → sticky code).
- `src/session.ts` — one Durable Object per code; holds the doc + a version the reader polls, the pending tap (typed answer/quick), an in-DO waiter that `_api/await` parks on, and hibernating feed sockets; self-deletes after 6h of mutual silence.
- `src/md.ts` — markdown → clean reading HTML (same shape as the static `kindle` repo's `build.py`).
- `src/pages.ts` — `landingPage(base)` (setup; HIG over the web-conformance floor) + `readerPage(code, base)` (e-ink serif, ES5-only inline script).
- `src/util.ts` — `READER_HOST`, `baseFor`, `isCode`, and the public-URL constants (single source).

The MCP tools live in the gateway repo (`../mcp`, `src/reader-tools.ts` +
`src/cuko-tools.ts`) and reach the write API over a service binding at
`/reader/_api/*` (binding host → `base` `/reader`, so the subdomain move needs
no gateway change) with `Authorization: Bearer ${READER_TOKEN}`. The gateway also
remembers each signed-in user's last verified code, so tools work without a code
after the first pairing.

## Develop
```sh
npm install
npm run dev        # wrangler dev (local DOs, no CF auth needed)
npm run typecheck
npm test           # markdown renderer + code-alphabet invariants (vitest)
# write API (set READER_TOKEN in .dev.vars, e.g. "dev"; fail-closed, always required):
#   curl -H "Authorization: Bearer dev" -X POST localhost:8787/reader/_api/send \
#     -d '{"code":"ABCDE","content":"# hi"}'
```

## Deploy
```sh
wrangler secret put READER_TOKEN   # one-time: the shared secret the gateway tool sends
npm run deploy                   # binds reader.neves.cloud (custom_domain, DNS auto-provisioned)
                                 # + the legacy neves.cloud/reader* route, in front of Pages
```
The gateway (`../mcp`) reaches the write API over a service binding and needs no
change for the subdomain move; redeploy it only when its own code changes.

## Use it
1. Add `https://mcp.neves.cloud/mcp` as a custom MCP server in Claude (GitHub sign-in).
2. Open `reader.neves.cloud` on the e-reader; note the 5-char code.
3. Tell Claude: *"send that to my reader, code ABCDE."*
