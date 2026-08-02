// The 5-char code IS the capability (an e-reader can't OAuth), so the keyspace —
// 30^5 = 24,300,000 — is this service's security parameter. Unthrottled, that
// isn't a secret, it's a search space: a script can sweep it and land on live
// sessions, where the anonymous surface lets it *read* what a stranger is reading
// and *write* to their screen. Two budgets close it, both per-IP, both per-colo
// (that is what the platform primitive measures):
//
//   ALL   — every code-bearing device route. Sized against real behaviour: a
//           reader short-polls at 2.5s (~24/min) and taps rarely, so 240/min
//           leaves room for a NAT'd household and still never fires for a human.
//           Its job is to cap how fast one address can mint Durable Objects.
//   FRESH — spent only when a poll lands on a code no DO has ever seen. A real
//           device spends exactly one (its second poll is no longer fresh); an
//           enumerator spends one per guess. That asymmetry is the whole control:
//           30/min ⇒ ~1.5 years for one address to walk the keyspace.
//
// /mcp is deliberately NOT on the tight budget. Those requests arrive from the
// MCP client's egress, not the reader's — on a shared pool, a tight per-IP limit
// would make users throttle each other. It gets a loose ceiling instead: enough
// to stop a single-host enumeration script, far above any real session's rate.
export const MCP_CEILING_KEY = "mcp";

// A missing binding allows the request. Deliberate: wrangler.jsonc declares both
// namespaces, so absence means a local run or a unit test, not production — and
// an anti-enumeration throttle must never be the reason the service 503s.
async function ok(rl: RateLimit | undefined, key: string): Promise<boolean> {
  if (!rl) return true;
  const { success } = await rl.limit({ key });
  return success;
}

// Client address, as the edge sees it. Absent only in local dev.
export const clientIp = (req: Request): string => req.headers.get("cf-connecting-ip") || "local";

export const allowDeviceRequest = (env: Env, req: Request): Promise<boolean> => ok(env.RL_ALL, clientIp(req));
export const allowFreshCode = (env: Env, req: Request): Promise<boolean> => ok(env.RL_FRESH, clientIp(req));
export const allowMcpRequest = (env: Env, req: Request): Promise<boolean> => ok(env.RL_MCP, clientIp(req));

// Retry-After is the honest reply: the budget is a fixed window, so a minute is
// the longest a caller ever has to hold off.
export function tooMany(): Response {
  return new Response("too many requests", {
    status: 429,
    headers: { "retry-after": "60", "cache-control": "no-store" },
  });
}
