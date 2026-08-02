# reader

[![Add to Claude](https://img.shields.io/badge/Add_to-Claude-D97757?logo=claude&logoColor=white)](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Reader&connectorUrl=https%3A%2F%2Freader.neves.cloud%2Fmcp)

Send anything Claude writes to an e-reader (Kindle, Kobo, …) and read it on
e-ink in real time. The **reader website** is **`reader.neves.cloud`** — a
Cloudflare Worker on its own subdomain (the nevescloud domain standard: a
worker-backed service `<repo>` lives at `<repo>.neves.cloud`, so the repo name
and the hostname are the same token). The MCP tools that drive the reader
(`send_to_reader`, `await_reader_choice`, `check_reader`, `send_drill`,
`await_drill_report`, `resume_drill`) are served from this Worker itself, at
`reader.neves.cloud/mcp`, with no sign-in anywhere on the origin. A second,
OAuth'd copy of the same tools runs on `mcp.neves.cloud/mcp` for people who want
their reader remembered between sessions; it reaches this Worker's write API over
a service binding.

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
- **OAuth'd, remembers your reader** — `mcp.neves.cloud/mcp`. GitHub sign-in buys
  a saved pairing (`code` optional after the first send) and a `pair_reader` tool.
  It reaches the write API over a service binding at `/_api/*` with
  `Authorization: Bearer ${READER_TOKEN}`.

Both call the same core operations (`src/ops.ts`), so their append/render/
delivery behavior can't drift.

## Deck mode: fixed drills run in the DO, not through the model
A multiple-choice drill with an answer key is a deterministic loop, and running
it screen-by-screen through the agent costs two round-trips per item (an 18-item
drill ≈ 36) for work a state machine does. `send_drill` hands the **whole deck**
to the Session DO — question, choices, answer index, optional feedback, plus a
policy (`requeue_until_correct`, `shuffle`). From there the DO scores each tap,
renders the feedback screen and turns the page itself; **pages advance at poll
speed, with no model in the loop.** `await_drill_report` returns per-item
results at the end (what they tapped, first-try correctness, retries, seconds).

Its edges stay open. A quick action (↻ simpler / → more / ✎ explain) is the one
tap that genuinely needs a model: it **parks** the drill and surfaces as a normal
pending tap. Reply with `mode:"append"` and the next answer-tap resumes on its
own; `resume_drill` re-renders the question when you need a clean screen. A
`mode:"replace"` send ends the drill — that's also how you cancel one.

The boundary is deliberate: deck mode is only for a deck authored up front with
closed-form answers. Teaching, discussion, partial credit and adaptive
re-explaining stay on `send_to_reader` / `await_reader_choice`. The invoking
agent picks the mode.

## Pieces (one Worker, served at the origin root)
- `src/index.ts` — router: `/mcp` (anonymous MCP) · `/_api/send|await|status`, `/_api/drill[/report|/resume]` (write, `READER_TOKEN`) · `/s/<code>` poll · `/c/<code>` tap · `/w/<code>` WebSocket tap feed · `/<code>` reader · `/` entry (e-reader UA → sticky code).
- `src/ops.ts` — `sendDoc` / `awaitChoice` / `readStatus` / `startDrill` / `awaitDrillReport` / `resumeDrill` on a Session DO; the single source shared by the HTTP write API and the in-process MCP tools.
- `src/mcp.ts` — `ReaderMcp` (agents/McpAgent): anonymous Streamable-HTTP server exposing `send_to_reader` / `await_reader_choice` / `check_reader` / `send_drill` / `await_drill_report` / `resume_drill`.
- `src/drill.ts` — deck mode's rules, pure: deck validation, the tap→next-state transition, the three screens (question / feedback / summary), the report. No storage, no rendering — so the machine is testable without a DO harness.
- `src/session.ts` — one Durable Object per code; holds the doc + a version the reader polls, the pending tap (typed answer/quick), an in-DO waiter that `_api/await` parks on, drill state + its report waiter, and hibernating feed sockets; self-deletes after 6h of mutual silence.
- `src/md.ts` — markdown → clean reading HTML.
- `src/pages.ts` — `landingPage` (setup) + `privacyPage` + `readerPage` (e-ink serif, ES5-only inline script).
- `src/limit.ts` — the anti-enumeration budgets. See **Security** below.
- `src/util.ts` — `READER_HOST`, `isCode`, and the public-URL constants (single source).

## Security
The code is the whole capability, so the keyspace is the security parameter:
30<sup>5</sup> = 24,300,000 (base32 minus the characters you can misread off
e-ink). Unthrottled that is a search space rather than a secret, so two per-IP
budgets sit in front of it:

- a loose ceiling on every code-bearing device route, sized well above a real
  reader's 2.5s poll — it caps how fast one address can mint Durable Objects;
- a tight budget spent **only on first contact with a code**. A device pays it
  once and is never fresh again; a guesser pays it on every guess. At 30/min one
  address needs on the order of a year and a half to walk the keyspace.

The write API (`/_api/*`) is a separate matter: shared-secret bearer, fail-closed
(unset secret rejects every write).

## Privacy
No accounts, no email, no analytics, no third-party sharing, nothing used for
training. A session holds the document, your taps, and your place in it, and
**deletes itself after 6h in which neither side touches it**. One first-party
cookie remembers your code for 48h. Full policy: **https://reader.neves.cloud/privacy**
(and `privacyPage` in `src/pages.ts` — every claim in it is checkable against the
code in this repo).

## Support
Open an issue: https://github.com/nevescloud/reader/issues

## Develop
```sh
npm install
npm run dev        # wrangler dev (local DOs, no CF auth needed)
npm run typecheck
npm test           # markdown renderer + code-alphabet invariants + the drill machine (vitest)
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
