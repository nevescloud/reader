# reader

Send anything Claude writes to an e-reader (Kindle, Kobo, …) and read it on
e-ink in real time. The **reader website** is **`reader.neves.cloud`** — a
Cloudflare Worker on its own subdomain (the nevescloud domain standard: a
worker-backed service `<repo>` lives at `<repo>.neves.cloud`, so the repo name
and the hostname are the same token). The MCP tools that drive the reader
(`send_to_reader`, `await_reader_choice`, `check_reader`, `pair_reader`,
`predict_then_reveal`) live on the OAuth'd **`mcp.neves.cloud/mcp`** server and
reach this Worker's write API over a service binding.

Two surfaces, two audiences:
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
   gateway ─Bearer READER_TOKEN─▶ (binding) /_api/send           polls /s/<code> (2.5s→30s backoff)
                                     │                              ▲  swaps in new HTML
                                     ▼                              │
                            ┌──────────────────────────┐           │
                            │ Durable Object "<code>"  │───────────┘
                            │ { v, html, title }, TTL  │──▶ ws /w/<code>
                            └──────────────────────────┘    one frame per tap
```
The **e-reader does zero typing**: it shows a code, you read it off-screen and
tell Claude. Polling (not WebSocket/SSE) is deliberate — e-ink repaints in ~1s
and the device's WS/SSE are unreliable, so a 2.5s short-poll with full-document
replace is the right granularity *and* the robust one.

## Two ways to drive it (same tools, different front doors)
- **Anonymous, zero sign-in** — `reader.neves.cloud/mcp`, hosted right here
  (`src/mcp.ts`). No OAuth anywhere on this origin, so no origin-wide discovery to
  make an anonymous endpoint look protected — the bleed that blocks this on the
  gateway simply isn't present on the reader's own host. The tools call the
  Session DOs **in-process** (no binding, no token). The 5-char code is required
  on every call (no accounts → nothing to hang a saved pairing on).
- **OAuth'd, remembers your reader** — `mcp.neves.cloud/mcp`, in the gateway repo
  (`../mcp`, `src/reader-tools.ts`). GitHub sign-in buys a saved pairing (`code`
  optional after the first send) and a `pair_reader` tool. It reaches the write
  API over a service binding at `/_api/*` with `Authorization: Bearer
  ${READER_TOKEN}`.

Both call the same core operations (`src/ops.ts`), so their append/render/
delivery behavior can't drift.

## Pieces (one Worker, served at the origin root)
- `src/index.ts` — router: `/mcp` (anonymous MCP) · `/_api/send|await|status` (write, `READER_TOKEN`) · `/s/<code>` poll · `/c/<code>` tap · `/w/<code>` WebSocket tap feed · `/<code>` reader · `/` entry (e-reader UA → sticky code).
- `src/ops.ts` — `sendDoc` / `awaitChoice` / `readStatus` on a Session DO; the single source shared by the HTTP write API and the in-process MCP tools.
- `src/mcp.ts` — `ReaderMcp` (agents/McpAgent): anonymous Streamable-HTTP server exposing `send_to_reader` / `await_reader_choice` / `check_reader`.
- `src/session.ts` — one Durable Object per code; holds the doc + a version the reader polls, the pending tap (typed answer/quick), an in-DO waiter that `_api/await` parks on, and hibernating feed sockets; self-deletes after 6h of mutual silence.
- `src/md.ts` — markdown → clean reading HTML (same shape as the static `kindle` repo's `build.py`).
- `src/pages.ts` — `landingPage` (setup; HIG over the web-conformance floor) + `readerPage` (e-ink serif, ES5-only inline script).
- `src/util.ts` — `READER_HOST`, `isCode`, and the public-URL constants (single source).

## Develop
```sh
npm install
npm run dev        # wrangler dev (local DOs, no CF auth needed)
npm run typecheck
npm test           # markdown renderer + code-alphabet invariants (vitest)
# write API (set READER_TOKEN in .dev.vars, e.g. "dev"; fail-closed, always required):
#   curl -H "Authorization: Bearer dev" -X POST localhost:8787/_api/send \
#     -d '{"code":"ABCDE","content":"# hi"}'
```

## Deploy
```sh
wrangler secret put READER_TOKEN   # one-time: the shared secret the gateway tool sends
npm run deploy                   # binds reader.neves.cloud (custom_domain, DNS auto-provisioned)
```
The gateway (`../mcp`) reaches the write API over a service binding at `/_api/*`;
redeploy it whenever that path or its reader-facing copy changes.

## Use it
1. Connect Claude. One-tap: the landing page's **Add to Claude** button opens
   claude.ai with the connector dialog prefilled
   (`claude.ai/customize/connectors?modal=add-custom-connector&connectorName=…&connectorUrl=…`
   — shipped but undocumented params, so the page keeps a copy-paste fallback).
   Or add a custom connector manually — either `https://reader.neves.cloud/mcp`
   (no sign-in; give the code each time) or `https://mcp.neves.cloud/mcp` (GitHub
   sign-in; remembers your reader).
2. Open `reader.neves.cloud` on the e-reader; note the 5-char code.
3. Tell Claude: *"send that to my reader, code ABCDE."*
