// This Worker is a private service mounted behind the mcp.neves.cloud gateway at
// a fixed base path. Everything it serves — MCP, reader, poll — lives under BASE,
// so links are correct on the gateway origin and there's no CORS (one host).
export const GATEWAY = "mcp.neves.cloud";
export const BASE = "/live-reader"; // = mcp.neves.cloud/<repo>
export const MCP_URL = `https://${GATEWAY}${BASE}/mcp`; // what you add to a Claude client
export const READER_HOST = `${GATEWAY}${BASE}`; // what you open on the e-reader
export const readerLink = (code: string) => `https://${GATEWAY}${BASE}/r/${code}`;

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
