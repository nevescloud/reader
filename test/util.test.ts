import { describe, it, expect } from "vitest";
import { newCode, normCode, isCode, isEreader } from "../src/util";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("codes", () => {
  it("newCode emits 5 chars, alphabet only", () => {
    for (let i = 0; i < 200; i++) {
      const c = newCode();
      expect(c).toHaveLength(5);
      for (const ch of c) expect(ALPHABET).toContain(ch);
    }
  });

  it("normCode uppercases and strips non-alphabet chars (incl. lookalikes)", () => {
    expect(normCode("abcde")).toBe("ABCDE");
    expect(normCode(" ab-cd ")).toBe("ABCD");
    expect(normCode("A0B1I LOU")).toBe("AB"); // 0/1/I/L/O/U never appear in a real code
  });

  it("isCode accepts exactly 5 alphabet chars", () => {
    expect(isCode("ABCDE")).toBe(true);
    expect(isCode(newCode())).toBe(true);
    expect(isCode("ABCD")).toBe(false);
    expect(isCode("ABCDEF")).toBe(false);
    expect(isCode("ABCDO")).toBe(false); // O excluded from the alphabet
    expect(isCode("FAVICONI")).toBe(false); // the junk-path shape that minted DOs
    expect(isCode("")).toBe(false);
  });
});

describe("isEreader", () => {
  it("matches e-ink readers, not the Fire tablet", () => {
    expect(isEreader("Mozilla/5.0 (X11; U; Linux armv7l like Android; en-us) AppleWebKit/531.2 (KHTML, like Gecko) Version/5.0 Safari/533.2 Kindle/3.0")).toBe(true);
    expect(isEreader("Mozilla/5.0 (Linux; Android 9; KFMAWI) AppleWebKit/537.36 Silk/94.2")).toBe(false);
    expect(isEreader("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120")).toBe(false);
  });
});
