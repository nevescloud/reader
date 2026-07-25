// Deck mode — a fixed multiple-choice drill that runs *inside* the Session DO
// instead of through the agent. Observed 2026-07-23 (an 18-item AIPI 560 drill):
// question → tap → feedback → next cost ~36 agent round-trips, and the model
// added nothing *inside* the loop, only at its edges. So the agent authors the
// deck up front and reads the report at the end; every tap in between is
// answered by the DO, and pages turn at poll speed.
//
// Everything here is pure — state in, next state / screen / report out. The DO
// owns storage, rendering and delivery (session.ts); this file owns the rules,
// so the machine is testable without a Durable Object harness.

export type DrillItem = {
  question_md: string;
  choices: string[];
  answer_index: number;
  feedback_md?: string;
};
export type Deck = { title: string; items: DrillItem[]; requeue: boolean; shuffle: boolean };

export type Attempt = { label: string; correct: boolean; at: number };
export type Request = { label: string; kind: string; item: number; at: number };

// Parallel arrays keyed by the item's index in `items` — cheap to store as JSON
// and stable across re-queues (which reorder `order`, never `items`).
export type DrillState = {
  title: string;
  items: DrillItem[];
  order: number[];            // queue of item indices; order[0] is the one on screen
  phase: "question" | "feedback" | "done";
  requeue: boolean;
  shownAt: number;            // when the current question went up (per-item timing)
  startedAt: number;
  // The doc version of the last screen *we* rendered. A tap older than this is a
  // double-tap on a screen already answered — see staleTap().
  screenV: number;
  suspended: boolean;         // a quick action / explain parked the drill for the agent
  attempts: Attempt[][];
  seconds: (number | null)[]; // time to first answer, per item
  done: boolean[];
  requests: Request[];
  last: { item: number; correct: boolean; label: string; retry: boolean } | null;
};

export type Screen = { md: string; title: string; choices: string[] };

export type DrillReport = {
  title: string;
  finished: boolean;
  cancelled: boolean;
  total: number;
  completed: number;
  first_try: number;
  elapsed_seconds: number;
  items: {
    index: number;
    question: string;
    correct_answer: string;
    attempts: string[];
    first_try: boolean;
    correct: boolean;
    seconds: number | null;
  }[];
  requests: Request[];
};

// A wrong answer goes back in the queue — but not forever. Without a cap
// `requeue_until_correct` has no terminating condition, and a user who can't get
// an item is stuck with no exit but a quick action. After 3 attempts the item is
// revealed and retired.
const MAX_TRIES = 3;
const MAX_ITEMS = 60;
const MAX_CHOICES = 8; // matches sendDoc's cap — more buttons than that don't fit an e-ink page
const MAX_LABEL = 100; // /c/ truncates a tap label at 120 chars; stay well under it
const MAX_MD = 4000;

// ---- authoring ------------------------------------------------------------

// The deck arrives from a tool call (typed) or raw JSON on /_api/drill (not), so
// validate the same way for both. Fail loudly: a deck with a bad answer_index
// would silently mark every attempt wrong for the whole drill.
export function parseDeck(input: unknown): Deck | { error: string } {
  const d = (input ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(d.items) ? d.items : null;
  if (!raw || !raw.length) return { error: "deck needs at least one item" };
  if (raw.length > MAX_ITEMS) return { error: `deck too long (${raw.length} items, max ${MAX_ITEMS})` };

  const items: DrillItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it = (raw[i] ?? {}) as Record<string, unknown>;
    const where = `item ${i + 1}`;
    const q = typeof it.question_md === "string" ? it.question_md.trim() : "";
    if (!q) return { error: `${where}: question_md is required` };
    if (q.length > MAX_MD) return { error: `${where}: question_md too long` };
    const choices = Array.isArray(it.choices) ? it.choices.filter((c): c is string => typeof c === "string").map((c) => c.trim()) : [];
    if (choices.length < 2) return { error: `${where}: needs at least 2 choices` };
    if (choices.length > MAX_CHOICES) return { error: `${where}: at most ${MAX_CHOICES} choices` };
    if (choices.some((c) => !c)) return { error: `${where}: empty choice label` };
    if (choices.some((c) => c.length > MAX_LABEL)) return { error: `${where}: choice labels must be ≤${MAX_LABEL} chars (they're buttons on e-ink)` };
    // Taps come back as labels, so two identical labels are indistinguishable —
    // the answer key would be a coin flip.
    if (new Set(choices).size !== choices.length) return { error: `${where}: duplicate choice labels` };
    const ai = typeof it.answer_index === "number" ? it.answer_index : -1;
    if (!Number.isInteger(ai) || ai < 0 || ai >= choices.length) {
      return { error: `${where}: answer_index must be 0..${choices.length - 1}` };
    }
    const fb = typeof it.feedback_md === "string" ? it.feedback_md.trim() : "";
    if (fb.length > MAX_MD) return { error: `${where}: feedback_md too long` };
    items.push({ question_md: q, choices, answer_index: ai, ...(fb ? { feedback_md: fb } : {}) });
  }

  const p = (d.policy ?? {}) as Record<string, unknown>;
  return {
    title: (typeof d.title === "string" && d.title.trim() ? d.title.trim() : "Drill").slice(0, 100),
    items,
    requeue: p.requeue_until_correct !== false, // default on: a drill is retrieval practice, not a test
    shuffle: p.shuffle === true,
  };
}

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  const r = new Uint32Array(n);
  crypto.getRandomValues(r);
  for (let i = n - 1; i > 0; i--) {
    const j = r[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function startState(deck: Deck, now: number): DrillState {
  const n = deck.items.length;
  return {
    title: deck.title,
    items: deck.items,
    order: deck.shuffle ? shuffled(n) : Array.from({ length: n }, (_, i) => i),
    phase: "question",
    requeue: deck.requeue,
    shownAt: now,
    startedAt: now,
    screenV: 0,
    suspended: false,
    attempts: Array.from({ length: n }, () => []),
    seconds: Array.from({ length: n }, () => null),
    done: Array.from({ length: n }, () => false),
    requests: [],
    last: null,
  };
}

// ---- the machine ----------------------------------------------------------

// A tap carries the doc version it was made on. Anything older than the screen
// we last rendered is a duplicate of a question already answered (the device
// hasn't re-polled yet) — the same version discipline await_reader_choice uses.
// v=0 means a client page from before kinds/versions existed: accept it.
export function staleTap(s: DrillState, tapV: number): boolean {
  return tapV > 0 && s.screenV > 0 && tapV < s.screenV;
}

// /c/<code> truncates a tap label at 120 chars, so a long choice comes back
// clipped; parseDeck caps labels below that, and the prefix compare covers any
// deck that slipped through an older cap.
export function matchChoice(choices: string[], label: string): number {
  const l = (label || "").trim();
  const exact = choices.findIndex((c) => c === l);
  return exact >= 0 ? exact : choices.findIndex((c) => c.slice(0, 120) === l);
}

// One tap → the next state. The DO renders screenFor(next) and stores it.
export function applyTap(s: DrillState, label: string, now: number): DrillState {
  if (s.phase === "done") return s;
  const next: DrillState = { ...s, suspended: false }; // any answer auto-resumes a parked drill

  // Feedback screen: the tap is "Next →", not an answer. Move on.
  if (s.phase === "feedback") {
    next.phase = next.order.length ? "question" : "done";
    next.shownAt = now;
    return next;
  }

  const cur = s.order[0];
  const item = s.items[cur];
  const correct = matchChoice(item.choices, label) === item.answer_index;
  const attempts = s.attempts.map((a, i) => (i === cur ? [...a, { label, correct, at: now }] : a));
  const seconds = s.seconds.map((v, i) => (i === cur && v === null ? Math.round((now - s.shownAt) / 100) / 10 : v));
  const retry = !correct && s.requeue && attempts[cur].length < MAX_TRIES;

  next.attempts = attempts;
  next.seconds = seconds;
  next.order = s.order.slice(1);
  if (retry) next.order.push(cur); // to the back, not the front — an immediate re-ask gives it away
  else next.done = s.done.map((v, i) => (i === cur ? true : v));
  next.last = { item: cur, correct, label, retry };

  // A right answer with nothing to say goes straight to the next question: one
  // tap per item. Whether an item costs one screen or two is the deck author's
  // call, made by writing feedback_md (or not).
  if (correct && !item.feedback_md) {
    next.phase = next.order.length ? "question" : "done";
    next.shownAt = now;
  } else {
    next.phase = "feedback";
  }
  return next;
}

// A quick action (↻ simpler / → more) or an explain-request is a request for the
// *model*, never an answer — park the drill, keep the question on screen, and
// let the pending tap surface to the agent as usual. The next choice-tap (or
// resume_drill) picks the drill back up.
export function suspend(s: DrillState, label: string, kind: string, now: number): DrillState {
  if (s.phase === "done") return s;
  return { ...s, suspended: true, requests: [...s.requests, { label, kind, item: s.order[0] ?? -1, at: now }] };
}

// ---- screens --------------------------------------------------------------

const fmtSecs = (s: number): string => {
  const m = Math.floor(s / 60);
  return m ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
};
// First line of the question, stripped of markdown noise — the report and the
// miss list need a handle for an item, not its whole body.
const gist = (md: string, n = 110): string => {
  const l = md.split("\n").map((x) => x.trim()).find((x) => x && !/^[#>*-]+$/.test(x)) ?? md.trim();
  const clean = l.replace(/^#{1,6}\s+/, "").replace(/[*_`]/g, "").trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
};

export function screenFor(s: DrillState, now: number): Screen {
  if (s.phase === "done") return summaryScreen(s, now);
  if (s.phase === "feedback") return feedbackScreen(s);
  const cur = s.order[0];
  const n = s.done.filter(Boolean).length + 1;
  // "second look" instead of a retry counter: the point is that they've seen it,
  // not how many times they've missed it.
  const again = s.attempts[cur].length ? " · second look" : "";
  return {
    md: `*${n} of ${s.items.length}${again}*\n\n${s.items[cur].question_md}`,
    title: s.title,
    choices: s.items[cur].choices,
  };
}

function feedbackScreen(s: DrillState): Screen {
  const l = s.last!;
  const item = s.items[l.item];
  const parts: string[] = [];
  if (l.correct) parts.push("## ✓ Correct");
  else {
    parts.push(l.retry ? "## ✗ Not quite" : "## ✗ — the answer");
    parts.push(`**${item.choices[item.answer_index]}**`);
  }
  if (item.feedback_md) parts.push(item.feedback_md);
  if (l.retry) parts.push("*You'll see this one again.*");
  return { md: parts.join("\n\n"), title: s.title, choices: [s.order.length ? "Next →" : "See results"] };
}

function summaryScreen(s: DrillState, now: number): Screen {
  const total = s.items.length;
  const firstTry = s.attempts.filter((a) => a.length && a[0].correct).length;
  const elapsed = fmtSecs(Math.max(0, (now - s.startedAt) / 1000));
  const parts = [`## Done`, `**${firstTry} of ${total}** right first try · ${elapsed}`];
  const missed = s.items.map((it, i) => ({ it, i })).filter(({ i }) => s.attempts[i].length && !s.attempts[i][0].correct);
  if (missed.length) {
    parts.push("**Missed first time**");
    // Capped: the device shows the shape of the misses; the full list is in the
    // report the agent gets.
    parts.push(missed.slice(0, 8).map(({ it }) => `- ${gist(it.question_md, 70)}`).join("\n"));
    if (missed.length > 8) parts.push(`*…and ${missed.length - 8} more.*`);
  }
  return { md: parts.join("\n\n"), title: s.title, choices: [] };
}

// ---- report ---------------------------------------------------------------

export function buildReport(s: DrillState, now: number, cancelled = false): DrillReport {
  return {
    title: s.title,
    finished: s.phase === "done",
    cancelled,
    total: s.items.length,
    completed: s.done.filter(Boolean).length,
    first_try: s.attempts.filter((a) => a.length && a[0].correct).length,
    elapsed_seconds: Math.round(Math.max(0, now - s.startedAt) / 1000),
    items: s.items.map((it, i) => ({
      index: i,
      question: gist(it.question_md),
      correct_answer: it.choices[it.answer_index],
      attempts: s.attempts[i].map((a) => a.label),
      first_try: !!s.attempts[i].length && s.attempts[i][0].correct,
      correct: s.attempts[i].some((a) => a.correct),
      seconds: s.seconds[i],
    })),
    requests: s.requests,
  };
}

// Progress line for a report that isn't in yet (await timed out, or check_reader).
export function progressOf(s: DrillState): { done: number; total: number; suspended: boolean; question: string | null } {
  const cur = s.phase === "done" ? null : s.items[s.order[0]];
  return {
    done: s.done.filter(Boolean).length,
    total: s.items.length,
    suspended: s.suspended,
    question: cur ? gist(cur.question_md, 70) : null,
  };
}
