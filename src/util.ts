// This Worker serves the reader website at neves.cloud/reader — a path-scoped
// Cloudflare route that intercepts /reader* in front of the GitHub Pages org site
// on the apex. The public surface is anonymous on purpose: an e-reader can't
// OAuth, so the unguessable code IS the capability. The write path (/reader/_api/*)
// is the protected side — a shared-secret bearer, hit only by the reader_send
// tool that lives on the OAuth'd gateway at mcp.neves.cloud/mcp.
export const GATEWAY = "mcp.neves.cloud"; // OAuth MCP gateway; carries reader_send
export const APEX = "neves.cloud"; // GitHub Pages apex; we own only the /reader* path
export const BASE = "/reader"; // reader mount on the apex (path-route in front of Pages)
export const MCP_URL = `https://${GATEWAY}/mcp`; // the connector added in Claude (OAuth, GitHub sign-in)
export const READER_URL = `${APEX}${BASE}`; // the one thing typed on the e-reader: neves.cloud/reader
export const readerLink = (code: string) => `https://${APEX}${BASE}/${code}`;

// base32 minus visually ambiguous chars (no I/L/O/U, no 0/1) — so a code read
// off an e-ink screen has nothing to misread.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newCode(): string {
  const buf = new Uint8Array(5);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < buf.length; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

// Forgiving on input: uppercase, drop anything not in the display alphabet.
export function normCode(s: string): string {
  return (s || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 8);
}

// e-reader browsers we send straight to the reader; everything else sees the
// setup page. Silk is the Fire tablet (LCD), not e-ink — exclude it.
export function isEreader(ua: string): boolean {
  return /Kindle|Kobo|reMarkable|PocketBook|Boox/i.test(ua) && !/Silk/i.test(ua);
}
