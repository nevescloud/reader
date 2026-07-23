// Domain standard (nevescloud): a worker-backed service owns its own subdomain
// <repo>.neves.cloud, so the repo name and the hostname are the same token —
// see either, route to the other. This service is `reader`, canonical at
// reader.neves.cloud (served at the origin root, base ""). The historical mount
// neves.cloud/reader — a path-route intercepting /reader* in front of the GitHub
// Pages apex — stays live and additive so printed instructions and paired
// devices keep working; new visitors get the subdomain.
//
// The public surface is anonymous on purpose: an e-reader can't OAuth, so the
// unguessable code IS the capability. The write path (_api/*) is the protected
// side — a shared-secret bearer, hit only by the reader_send tool on the OAuth'd
// gateway (mcp.neves.cloud), which reaches us over a service binding.
export const GATEWAY = "mcp.neves.cloud"; // OAuth MCP gateway; carries reader_send
export const APEX = "neves.cloud"; // GitHub Pages apex; the legacy /reader* path-route lives here
export const READER_HOST = "reader.neves.cloud"; // canonical service origin (custom_domain)
export const LEGACY_BASE = "/reader"; // grandfathered mount on the apex (path-route in front of Pages)

// The per-request mount. On the canonical subdomain the service is at root ("");
// everywhere else (the legacy apex route, and the gateway's service-binding host
// reader.internal whose path is /reader/_api/*) it stays under /reader.
export const baseFor = (hostname: string): string => (hostname === READER_HOST ? "" : LEGACY_BASE);

export const MCP_URL = `https://${GATEWAY}/mcp`; // the connector added in Claude (OAuth, GitHub sign-in)
export const READER_URL = READER_HOST; // the one thing typed on the e-reader: reader.neves.cloud
export const readerLink = (code: string) => `https://${READER_HOST}/${code}`;

// base32 minus visually ambiguous chars (no I/L/O/U, no 0/1) — so a code read
// off an e-ink screen has nothing to misread.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const NON_ALPHABET = new RegExp(`[^${ALPHABET}]`, "g");
const CODE = new RegExp(`^[${ALPHABET}]{5}$`);

export function newCode(): string {
  const buf = new Uint8Array(5);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < buf.length; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

// Forgiving on input: uppercase, drop anything not in the display alphabet.
export function normCode(s: string): string {
  return (s || "").toUpperCase().replace(NON_ALPHABET, "").slice(0, 8);
}

// The one validity gate for every device-facing route: a real code is exactly 5
// alphabet chars. Anything else (favicon probes, typos, scanner junk) must not
// mint a Durable Object or a reader page.
export function isCode(s: string): boolean {
  return CODE.test(s);
}

// e-reader browsers we send straight to the reader; everything else sees the
// setup page. Silk is the Fire tablet (LCD), not e-ink — exclude it.
export function isEreader(ua: string): boolean {
  return /Kindle|Kobo|reMarkable|PocketBook|Boox/i.test(ua) && !/Silk/i.test(ua);
}
