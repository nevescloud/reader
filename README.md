# reader

**Read Claude on your e-reader — and tap back.**

[![Add to Claude](https://img.shields.io/badge/Add_to-Claude-D97757?logo=claude&logoColor=white)](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=E-Ink%20Reader&connectorUrl=https%3A%2F%2Freader.neves.cloud%2Fmcp)

Ask Claude for something long and it appears on your Kindle, Kobo, reMarkable,
PocketBook or Boox in about three seconds — through the browser the device
already has. No jailbreak, no email, no EPUB, no account, no app.

And it reads back: Claude can put tappable buttons under what it wrote, so you
answer from the device and the conversation carries on.

## Start

```
1.  Add the connector           https://reader.neves.cloud/mcp
2.  On the e-reader, open       reader.neves.cloud      → shows a 5-char code
3.  Tell Claude                 "send that to my reader, code 8427X"
```

The e-reader **types nothing**. It shows a code; you read it off the screen and
say it out loud. That constraint drives most of the design below.

## The tools

| Tool | What it does |
|---|---|
| `send_to_reader` | Puts markdown on the screen. Optionally with tappable choices. |
| `await_reader_choice` | Blocks until they tap — a choice, a quick action, or text they marked. |
| `check_reader` | Is a device polling, what is it showing, what page are they on. |
| `send_drill` | Hands a whole multiple-choice deck to the server, which runs the loop. |
| `await_drill_report` | Per-item results once the deck clears. |
| `resume_drill` | Puts the drill question back after an interruption. |

Markdown, GFM tables and SVG (fenced ` ```svg ` or raw `<svg>`) render crisply in
grayscale. `mode: "append"` streams a long piece in chunks without losing the
reader's place.

Beyond the buttons Claude sends, the device always offers three of its own:
**↻ simpler**, **→ more**, and **✎ explain** — mark a word, sentence or block and
Claude explains it in place.

## How it works

```
                    "send that to my reader, code 8427X"
                                    │
                                 Claude
                                    │
              ┌─────────────────────┴──────────────────────┐
              ▼                                            ▼
   reader.neves.cloud/mcp                          mcp.neves.cloud/mcp
   anonymous · no sign-in                          GitHub OAuth · remembers
   calls the DO in-process                         your reader
              │                                            │
              │                                  Bearer READER_TOKEN
              │                                     → /_api/send
              └─────────────────────┬──────────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │  Durable Object "<code>"      │
                    │  { v, html, title } · 6h TTL  │
                    └───────────────────────────────┘
                        │                        ▲
       polls /s/<code>  │                        │  taps /c/<code>
       2.5s → 30s       ▼                        │  (also ws /w/<code>,
                    e-reader — stock browser, e-ink   one frame per tap)
```

Polling rather than WebSocket or SSE is deliberate: e-ink repaints in about a
second and these devices' WS/SSE are unreliable, so a 2.5s short-poll with
full-document replace is both the right granularity *and* the robust one.

Two front doors, same tools, same core operations (`src/ops.ts`) — so their
append, render and delivery behaviour cannot drift apart:

- **`reader.neves.cloud/mcp`** — anonymous, served by this Worker (`src/mcp.ts`),
  calling the Session Durable Objects in-process. No OAuth anywhere on this
  origin. The 5-character code is required on every call: with no accounts,
  there is nothing to hang a saved pairing on.
- **`mcp.neves.cloud/mcp`** — GitHub sign-in buys a saved pairing (`code` becomes
  optional after the first send) and a `pair_reader` tool. It reaches this
  Worker's write API over a service binding.

## Deck mode: a drill runs on the device, not through the model

A multiple-choice drill with an answer key is a deterministic loop, but run
screen-by-screen through an agent it costs two round-trips per item — an 18-item
deck is 36 — for work a state machine does.

`send_drill` hands the **whole deck** over: question, choices, answer index,
optional feedback, plus a policy (`requeue_until_correct`, `shuffle`). From there
the Durable Object scores each tap, renders the feedback screen and turns the
page itself. **Pages advance at device speed, with no model in the loop.**
`await_drill_report` returns per-item results at the end: what they tapped,
first-try correctness, retries, seconds.

Its edges stay open. A quick action is the one tap that genuinely needs a model —
it **parks** the drill and surfaces as an ordinary pending tap. Reply with
`mode: "append"` and the next answer-tap resumes it on its own; `resume_drill`
re-renders the question when you want a clean screen. A `mode: "replace"` send
ends the drill, which is also how you cancel one.

The boundary is deliberate: deck mode is only for a deck authored up front with
closed-form answers. Teaching, discussion, partial credit and adaptive
re-explaining stay on `send_to_reader` / `await_reader_choice`. The calling agent
picks the mode.

## Security

The code is the whole capability, so the keyspace is the security parameter:
30<sup>5</sup> = 24,300,000 (base32 minus every character you could misread off
e-ink — no `I`/`L`/`O`/`U`, no `0`/`1`). Unthrottled, that is a search space
rather than a secret, so two per-IP budgets sit in front of it:

- a loose ceiling on every code-bearing device route, sized well above a real
  reader's 2.5s poll — it caps how fast one address can mint Durable Objects;
- a tight budget spent **only on first contact with a code**. A device pays it
  once and is never fresh again; a guesser pays it on every guess. At 30/min, one
  address needs on the order of a year and a half to walk the keyspace.

The MCP endpoint gets only the loose ceiling on purpose: those requests arrive
from the client's shared egress, so a tight per-IP budget there would make users
throttle each other.

The write API (`/_api/*`) is a separate matter — shared-secret bearer,
fail-closed: an unset secret rejects every write.

**Treat the code like a password.** Anyone holding it can see that screen and
send to it. Open `reader.neves.cloud/new` for a fresh one.

## Privacy

No accounts, no email, no analytics, no third-party sharing, nothing used for
training. A session holds the document, your taps and your place in it, and
**deletes itself after 6 hours in which neither side touches it**. One
first-party cookie remembers your code for 48 hours.

Full policy: **https://reader.neves.cloud/privacy** — and `privacyPage` in
`src/pages.ts`, so every claim in it is checkable against the code here.

## Support

Open an issue: https://github.com/nevescloud/reader/issues

## Develop

```sh
npm install
npm run dev        # wrangler dev — local Durable Objects, no Cloudflare auth needed
npm run typecheck
npm test           # markdown renderer, code-alphabet invariants, the drill machine

# write API — set READER_TOKEN in .dev.vars (e.g. "dev"); always required, fail-closed
curl -H "Authorization: Bearer dev" -X POST localhost:8787/_api/send \
  -d '{"code":"ABCDE","content":"# hi"}'
```

## Deploy

```sh
wrangler secret put READER_TOKEN   # one-time: the shared secret the write API expects
npm run deploy                     # binds reader.neves.cloud (DNS auto-provisioned)
```

## Layout

One Worker, served at the origin root.

| File | What lives there |
|---|---|
| `src/index.ts` | Router: `/mcp` · `/_api/*` (write, token) · `/s` poll · `/c` tap · `/w` feed · `/<code>` reader · `/privacy` · `/` entry |
| `src/ops.ts` | `sendDoc` / `awaitChoice` / `readStatus` / `startDrill` / `awaitDrillReport` / `resumeDrill` — the single source both front doors call |
| `src/mcp.ts` | `ReaderMcp` — the anonymous Streamable-HTTP server and its six tools |
| `src/session.ts` | One Durable Object per code: document + version, pending tap, parked waiters, drill state, hibernating feed sockets, 6h expiry |
| `src/drill.ts` | Deck mode's rules, pure — validation, tap→next-state, the three screens, the report. No storage, no rendering, so it tests without a DO harness |
| `src/limit.ts` | The two anti-enumeration budgets (see **Security**) |
| `src/md.ts` | Markdown → clean reading HTML |
| `src/pages.ts` | `landingPage` · `privacyPage` · `readerPage` (e-ink serif, paginated, ES5-only inline script for ~2012 WebKit) |
| `src/util.ts` | Host, code alphabet, public-URL constants — single source |

## License

MIT — see [LICENSE](LICENSE).
