import { describe, it, expect } from "vitest";
import {
  applyTap, buildReport, matchChoice, parseDeck, progressOf, screenFor, staleTap, startState, suspend,
  type Deck, type DrillState,
} from "../src/drill";

const deckOf = (over: Partial<Deck> = {}): Deck => ({
  title: "T",
  requeue: true,
  shuffle: false,
  items: [
    { question_md: "One?", choices: ["a", "b"], answer_index: 0 },
    { question_md: "Two?", choices: ["c", "d"], answer_index: 1, feedback_md: "because d" },
  ],
  ...over,
});

// Drive the machine the way the DO does: apply a tap, then stamp the screen
// version the render would have produced.
const tap = (s: DrillState, label: string, t = 0): DrillState => ({ ...applyTap(s, label, t), screenV: s.screenV + 1 });

describe("parseDeck", () => {
  const ok = { question_md: "q", choices: ["a", "b"], answer_index: 0 };

  it("defaults: requeue on, no shuffle, fallback title", () => {
    const d = parseDeck({ items: [ok] });
    expect(d).toMatchObject({ title: "Drill", requeue: true, shuffle: false });
  });

  it("policy overrides carry through", () => {
    expect(parseDeck({ items: [ok], policy: { requeue_until_correct: false, shuffle: true } }))
      .toMatchObject({ requeue: false, shuffle: true });
  });

  it("rejects a deck with no items", () => {
    expect(parseDeck({})).toHaveProperty("error");
    expect(parseDeck({ items: [] })).toHaveProperty("error");
  });

  it("rejects an out-of-range answer_index — it would mark every attempt wrong", () => {
    expect(parseDeck({ items: [{ ...ok, answer_index: 2 }] })).toHaveProperty("error");
    expect(parseDeck({ items: [{ ...ok, answer_index: -1 }] })).toHaveProperty("error");
    expect(parseDeck({ items: [{ question_md: "q", choices: ["a", "b"] }] })).toHaveProperty("error");
  });

  it("rejects duplicate choice labels — a tap comes back as a label, not an index", () => {
    expect(parseDeck({ items: [{ question_md: "q", choices: ["a", "a"], answer_index: 0 }] })).toHaveProperty("error");
  });

  it("rejects fewer than 2 choices, and labels too long to survive the tap wire", () => {
    expect(parseDeck({ items: [{ question_md: "q", choices: ["a"], answer_index: 0 }] })).toHaveProperty("error");
    expect(parseDeck({ items: [{ question_md: "q", choices: ["a", "x".repeat(101)], answer_index: 0 }] })).toHaveProperty("error");
  });

  it("shuffle yields a permutation, not a loss", () => {
    const d = parseDeck({ items: [ok, ok, ok, ok, ok], policy: { shuffle: true } }) as Deck;
    const s = startState(d, 0);
    expect([...s.order].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("matchChoice", () => {
  it("matches exactly, or on the 120-char prefix /c/ truncates to", () => {
    expect(matchChoice(["a", "b"], "b")).toBe(1);
    expect(matchChoice(["a", "b"], "z")).toBe(-1);
    const long = "x".repeat(200);
    expect(matchChoice(["a", long], long.slice(0, 120))).toBe(1);
  });
});

describe("the loop", () => {
  it("a correct answer with no feedback goes straight to the next question — one tap per item", () => {
    let s = startState(deckOf(), 0);
    expect(screenFor(s, 0).choices).toEqual(["a", "b"]);
    expect(screenFor(s, 0).md).toContain("1 of 2");

    s = tap(s, "a");
    expect(s.phase).toBe("question"); // no feedback screen in between
    expect(screenFor(s, 0).md).toContain("Two?");
    expect(screenFor(s, 0).md).toContain("2 of 2");
  });

  it("authored feedback earns a screen, and the last one closes the deck", () => {
    let s = startState(deckOf(), 0);
    s = tap(s, "a");
    s = tap(s, "d"); // correct, has feedback_md
    expect(s.phase).toBe("feedback");
    const fb = screenFor(s, 0);
    expect(fb.md).toContain("✓ Correct");
    expect(fb.md).toContain("because d");
    expect(fb.choices).toEqual(["See results"]); // queue is empty behind it

    s = tap(s, "See results");
    expect(s.phase).toBe("done");
    expect(screenFor(s, 0).choices).toEqual([]);
    expect(screenFor(s, 0).md).toContain("2 of 2");
  });

  it("a wrong answer always gets a screen, and it reveals the key", () => {
    let s = startState(deckOf(), 0);
    s = tap(s, "b");
    expect(s.phase).toBe("feedback");
    const fb = screenFor(s, 0);
    expect(fb.md).toContain("✗");
    expect(fb.md).toContain("**a**");
    expect(fb.md).toContain("see this one again");
    expect(fb.choices).toEqual(["Next →"]);
  });

  it("requeue sends a miss to the BACK of the queue, not the front", () => {
    let s = startState(deckOf(), 0);
    s = tap(s, "b");        // item 0 wrong
    s = tap(s, "Next →");
    expect(s.order).toEqual([1, 0]); // item 1 comes first — an immediate re-ask gives it away
    expect(screenFor(s, 0).md).toContain("Two?");
    s = tap(s, "d");
    s = tap(s, "Next →");
    expect(screenFor(s, 0).md).toContain("One?");
    expect(screenFor(s, 0).md).toContain("second look");
  });

  it("requeue:false runs one pass straight through", () => {
    let s = startState(deckOf({ requeue: false }), 0);
    s = tap(s, "b");
    expect(s.order).toEqual([1]);
    expect(screenFor(s, 0).md).not.toContain("see this one again");
  });

  it("caps retries at 3 so requeue_until_correct always terminates", () => {
    let s = startState(deckOf({ items: [deckOf().items[0]] }), 0);
    for (let i = 0; i < 2; i++) { s = tap(s, "b"); s = tap(s, "Next →"); }
    expect(s.order).toEqual([0]);
    s = tap(s, "b"); // third miss — revealed and retired
    expect(s.last?.retry).toBe(false);
    expect(screenFor(s, 0).md).toContain("the answer");
    s = tap(s, "See results");
    expect(s.phase).toBe("done");
  });

  it("ignores a duplicate tap on a screen already answered", () => {
    let s = startState(deckOf(), 0);
    s = { ...s, screenV: 5 };
    expect(staleTap(s, 4)).toBe(true);   // device hadn't re-polled — same screen, second tap
    expect(staleTap(s, 5)).toBe(false);
    expect(staleTap(s, 6)).toBe(false);  // an agent append bumped v under us
    expect(staleTap(s, 0)).toBe(false);  // client page from before versions existed
  });
});

describe("quick actions", () => {
  it("park the drill without answering it", () => {
    let s = startState(deckOf(), 0);
    s = suspend(s, "↻ simpler", "quick", 10);
    expect(s.suspended).toBe(true);
    expect(s.phase).toBe("question");
    expect(s.order[0]).toBe(0); // still on the same question
    expect(s.requests).toEqual([{ label: "↻ simpler", kind: "quick", item: 0, at: 10 }]);
    expect(progressOf(s).suspended).toBe(true);

    s = tap(s, "a"); // the next answer-tap resumes on its own
    expect(s.suspended).toBe(false);
    expect(s.requests).toHaveLength(1); // and the request stays in the report
  });
});

describe("report", () => {
  it("counts first-try correctness, keeps every attempt, and times the first answer", () => {
    let s = startState(deckOf(), 0);
    s = tap(s, "b", 2000);       // item 0 missed
    s = tap(s, "Next →", 3000);
    s = tap(s, "d", 4000);       // item 1 right first try
    s = tap(s, "Next →", 5000);
    s = tap(s, "a", 6000);       // item 0 on the second look
    s = tap(s, "See results", 7000);

    const r = buildReport(s, 8000);
    expect(r).toMatchObject({ finished: true, cancelled: false, total: 2, completed: 2, first_try: 1, elapsed_seconds: 8 });
    expect(r.items[0]).toMatchObject({ question: "One?", correct_answer: "a", attempts: ["b", "a"], first_try: false, correct: true, seconds: 2 });
    expect(r.items[1]).toMatchObject({ first_try: true, correct: true });
  });

  it("marks a deck cut short, and shows which items were never reached", () => {
    const s = startState(deckOf(), 0);
    const r = buildReport(s, 1000, true);
    expect(r).toMatchObject({ finished: false, cancelled: true, completed: 0, first_try: 0 });
    expect(r.items.every((i) => !i.attempts.length)).toBe(true);
  });
});
