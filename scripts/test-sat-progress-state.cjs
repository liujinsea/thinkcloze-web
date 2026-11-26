"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const P = require("../sat-context/progress-state.js");
const clone = value => JSON.parse(JSON.stringify(value));
const plain = () => ({ progress: {}, favorites: {}, words: {}, rounds: {} });
function change(doc, actor, callback, answer) {
  const before = P.view(doc), after = clone(before);
  callback(after);
  return P.capture(doc, before, after, { actor, ...(answer ? { answer } : {}) });
}
function answer(doc, actor, correct, verified = true, id = "Q0001") {
  return change(doc, actor, state => {
    const p = state.progress[id] ||= {};
    p.attempts = (p.attempts || 0) + 1;
    if (!verified) return;
    p.streak = correct ? Math.min(5, (p.streak || 0) + 1) : 0;
    if (!correct) { p.wrong = true; p.mastered = false; }
    if (p.streak >= 3) p.wrong = false;
    if (p.streak >= 5) p.mastered = true;
  }, { id, correct, verified });
}
const round = (runId, ids = ["Q0001", "Q0002", "Q0003"]) => ({ runId, ids, answers: {}, index: 0, done: false });

// Keep wall-clock-dependent operations deterministic while checking causal advancement.
let now = 1700000000000;
const realNow = Date.now;
Date.now = () => now;
test.after(() => { Date.now = realNow; });

test("stable empty schema, canonical equality, and browser/CommonJS exports", () => {
  assert.deepEqual(P.empty(), P.empty());
  assert.equal(P.empty().version, 1);
  assert.equal(P.empty().format, "thinkcloze.sat-progress");
  assert.deepEqual(P.view(P.empty()), plain());
  assert(P.equal({ z: 1, a: { y: 2, x: 3 } }, { a: { x: 3, y: 2 }, z: 1 }));
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(require.resolve("../sat-context/progress-state.js"), "utf8"), context);
  assert.equal(typeof context.window.SATProgress.capture, "function");
});

test("seed imports each browser once; attempts sum across distinct seeds only", () => {
  const legacy = plain(); legacy.progress.Q0001 = { attempts: 7, streak: 2, wrong: true };
  const a = P.seed(P.empty(), legacy, "browser-a");
  const again = P.seed(a, { ...legacy, progress: { Q0001: { attempts: 99 } } }, "browser-a");
  assert(P.equal(a, again));
  const b = P.seed(P.empty(), legacy, "browser-b");
  assert.equal(P.view(P.merge(a, a, b, b)).progress.Q0001.attempts, 14);
  assert.equal(P.view(P.merge(a, a)).progress.Q0001.attempts, 7);
});

test("seed favorites union; historical wrong defeats another seed's mastery", () => {
  const a = plain(), b = plain();
  a.progress.Q0001 = { attempts: 2, streak: 2, wrong: true };
  b.progress.Q0001 = { attempts: 5, streak: 5, mastered: true };
  a.favorites.Q0001 = true; b.favorites.Q0002 = true;
  const value = P.view(P.merge(P.seed(P.empty(), a, "a"), P.seed(P.empty(), b, "b")));
  assert.equal(value.progress.Q0001.wrong, true);
  assert.equal(value.progress.Q0001.mastered, false);
  assert.equal(value.progress.Q0001.streak, 2);
  assert.deepEqual(value.favorites, { Q0001: true, Q0002: true });
});

test("concurrent actors add attempts once and repeated merge never doubles them", () => {
  const base = P.empty(), a = answer(base, "a", false), b = answer(base, "b", true);
  const m = P.merge(a, b, a, b);
  assert.equal(P.view(m).progress.Q0001.attempts, 2);
  assert.equal(m.events.Q0001.length, 2);
  assert(P.equal(m, P.merge(m, m, a)));
  const next = answer(m, "a", true);
  assert.equal(P.view(P.merge(next, m)).progress.Q0001.attempts, 3);
});

test("last five unique verified events restore 3-correct and 5-correct rules", () => {
  let doc = answer(P.empty(), "a", false);
  assert.equal(P.view(doc).progress.Q0001.wrong, true);
  for (let n = 1; n <= 5; n++) {
    doc = answer(doc, "a", true);
    const p = P.view(doc).progress.Q0001;
    assert.equal(p.streak, n);
    assert.equal(p.wrong, n < 3);
    assert.equal(p.mastered, n >= 5);
  }
  assert.equal(doc.events.Q0001.length, 5);
  doc = answer(doc, "a", false);
  assert.equal(P.view(doc).progress.Q0001.streak, 0);
  assert.equal(P.view(doc).progress.Q0001.mastered, false);
  assert.equal(P.view(doc).progress.Q0001.wrong, true);
  assert.equal(P.view(doc).progress.Q0001.attempts, 7);
});

test("pending answers add attempts without disturbing verified streak or mastery", () => {
  let doc = P.empty();
  for (let n = 0; n < 5; n++) doc = answer(doc, "a", true);
  const scored = P.view(doc).progress.Q0001;
  doc = answer(doc, "a", false, false);
  const pending = P.view(doc).progress.Q0001;
  assert.equal(pending.attempts, 6);
  assert.equal(pending.streak, scored.streak);
  assert.equal(pending.wrong, scored.wrong);
  assert.equal(pending.mastered, scored.mastered);
  assert.equal(doc.events.Q0001.length, 5);
});

test("answer metadata without an increased attempt creates no event or new clock", () => {
  const doc = P.empty();
  const before = P.view(doc);
  const after = clone(before); after.progress.Q0001 = { streak: 5, mastered: true };
  const captured = P.capture(doc, before, after, { actor: "a", answer: { id: "Q0001", correct: true, verified: true } });
  assert(P.equal(doc, captured));
});

test("favorite, word, and review removals survive later imports and can be explicitly re-added", () => {
  const initial = plain();
  initial.favorites.Q0001 = true;
  initial.words.word = { id: "Q0001", letter: "A" };
  initial.progress.Q0001 = { review: true };
  const base = P.seed(P.empty(), initial, "initial");
  const removed = change(base, "a", state => {
    delete state.favorites.Q0001; delete state.words.word; state.progress.Q0001.review = false;
  });
  const later = P.seed(P.empty(), initial, "later-browser");
  const m = P.merge(later, removed);
  assert.deepEqual(P.view(m).favorites, {});
  assert.deepEqual(P.view(m).words, {});
  assert.equal(P.view(m).progress.Q0001.review, false);
  assert.equal(m.registers.favorites.Q0001.value, false);
  const added = change(m, "b", state => { state.favorites.Q0001 = true; });
  assert.equal(P.view(P.merge(removed, added)).favorites.Q0001, true);
});

test("concurrent LWW decisions are deterministic, including equal-stamp value conflicts", () => {
  const base = P.empty();
  const a = change(base, "a", s => { s.favorites.Q0001 = true; });
  const b = change(base, "b", s => { s.favorites.Q0002 = true; });
  assert(P.equal(P.merge(a, b), P.merge(b, a)));
  const sameStamp = clone(a);
  sameStamp.registers.favorites.Q0001.value = false;
  assert(P.equal(P.merge(a, sameStamp), P.merge(sameStamp, a)));
});

test("initial legacy rounds choose the seed with more answered questions", () => {
  const a = plain(), b = plain();
  a.rounds["set-1"] = round(undefined); a.rounds["set-1"].answers.Q0001 = "A";
  b.rounds["set-1"] = round(undefined); b.rounds["set-1"].answers = { Q0001: "B", Q0002: "C" }; b.rounds["set-1"].index = 2;
  const merged = P.merge(P.seed(P.empty(), a, "a"), P.seed(P.empty(), b, "b"));
  assert.deepEqual(P.view(merged).rounds["set-1"].answers, b.rounds["set-1"].answers);
  assert.equal(P.view(merged).rounds["set-1"].index, 2);
});

test("same round generation merges concurrent answers without losing either", () => {
  const base = change(P.empty(), "starter", s => { s.rounds["set-1"] = round("run-1"); });
  const a = change(base, "a", s => { s.rounds["set-1"].answers.Q0001 = "A"; s.rounds["set-1"].index = 1; });
  const b = change(base, "b", s => { s.rounds["set-1"].answers.Q0002 = "B"; s.rounds["set-1"].index = 2; });
  const m = P.merge(a, b);
  assert.deepEqual(P.view(m).rounds["set-1"].answers, { Q0001: "A", Q0002: "B" });
  assert.equal(P.view(m).rounds["set-1"].runId, "run-1");
  assert.equal(P.view(m).rounds["set-1"].index, 2);
  assert(P.equal(m, P.merge(b, a)));
});

test("restart generation wins over old round's later next, even with a newer wall clock", () => {
  const base = change(P.empty(), "starter", s => { s.rounds["set-1"] = round("run-1"); });
  const restarted = change(base, "a", s => { s.rounds["set-1"] = round("run-2"); });
  now += 1000;
  const late = change(base, "z", s => { s.rounds["set-1"].index = 2; s.rounds["set-1"].done = true; });
  const m = P.merge(restarted, late);
  assert.equal(P.view(m).rounds["set-1"].runId, "run-2");
  assert.equal(P.view(m).rounds["set-1"].index, 0);
  assert.equal(P.view(m).rounds["set-1"].done, false);
});

test("stale displayed old generation cannot mutate or restart an already replaced document", () => {
  const base = change(P.empty(), "starter", s => { s.rounds["set-1"] = round("run-1"); });
  const before = P.view(base), stale = clone(before);
  const restarted = change(base, "a", s => { s.rounds["set-1"] = round("run-2"); });
  now += 1000; stale.rounds["set-1"].index = 2;
  const result = P.capture(restarted, before, stale, { actor: "late" });
  assert.equal(P.view(result).rounds["set-1"].runId, "run-2");
  assert.equal(P.view(result).rounds["set-1"].index, 0);
});

test("round deletion tombstone defeats seed reimport and old-generation updates", () => {
  const seed = plain(); seed.rounds["set-1"] = round(undefined);
  const base = P.seed(P.empty(), seed, "browser");
  const deleted = change(base, "a", s => { delete s.rounds["set-1"]; });
  now += 1000;
  const late = change(base, "z", s => { s.rounds["set-1"].answers.Q0001 = "A"; });
  const result = P.merge(deleted, late, P.seed(P.empty(), seed, "other-browser"));
  assert.equal(P.view(result).rounds["set-1"], undefined);
  assert.equal(result.rounds["set-1"].deleted, true);
});

test("same-round answer deletion and set extensions preserve explicit field changes", () => {
  let base = change(P.empty(), "starter", s => { s.rounds["set-1"] = round("one", ["Q0001"]); });
  base = change(base, "starter", s => { s.rounds["set-1"].answers.Q0001 = "A"; s.rounds["set-1"].done = true; });
  const extended = change(base, "a", s => { s.rounds["set-1"].ids.push("Q0002"); s.rounds["set-1"].done = false; s.rounds["set-1"].index = 1; });
  const roundResult = P.view(P.merge(base, extended)).rounds["set-1"];
  assert.deepEqual(roundResult.ids, ["Q0001", "Q0002"]);
  assert.deepEqual(roundResult.answers, { Q0001: "A" });
  assert.equal(roundResult.index, 1);
  assert.equal(roundResult.done, false);
  const removed = change(extended, "b", s => { delete s.rounds["set-1"].answers.Q0001; });
  assert.deepEqual(P.view(P.merge(removed, base)).rounds["set-1"].answers, {});
});

test("clock is causal under backwards wall time and merge does not advance on repeated polls", () => {
  let doc = change(P.empty(), "a", s => { s.favorites.Q0001 = true; });
  const first = clone(doc.clock); now -= 10000;
  doc = change(doc, "a", s => { delete s.favorites.Q0001; });
  assert.equal(doc.clock[0], first[0]);
  assert.equal(doc.clock[1], first[1] + 1);
  const freeze = clone(doc); now += 100000;
  for (let n = 0; n < 20; n++) doc = P.merge(doc, freeze);
  assert(P.equal(freeze, doc));
  const unordered = Object.fromEntries(Object.entries(doc).reverse());
  assert(P.equal(P.merge(unordered), doc));
  assert.equal(JSON.stringify(P.merge(unordered)), JSON.stringify(doc));
});

test("latest-five event join is bounded, associative, commutative, and idempotent across offline branches", () => {
  let a = P.empty(), b = P.empty(), c = P.empty();
  for (let n = 0; n < 13; n++) {
    a = answer(a, "a", n % 3 !== 0);
    b = answer(b, "b", n % 4 !== 0);
    c = answer(c, "c", n % 5 !== 0);
  }
  const left = P.merge(P.merge(a, b), c), right = P.merge(a, P.merge(b, c));
  assert(P.equal(left, right));
  assert(P.equal(left, P.merge(c, b, a)));
  assert(P.equal(left, P.merge(left, left)));
  assert.equal(left.events.Q0001.length, 5);
  assert.equal(P.view(left).progress.Q0001.attempts, 39);
});

test("inputs are immutable and invalid/empty inputs do not pollute valid state", () => {
  const base = P.empty(), saved = clone(base);
  const a = answer(base, "a", true);
  assert.deepEqual(base, saved);
  assert(P.equal(P.merge(a, null, {}, false), a));
  assert.throws(() => P.seed(base, plain(), ""), /seedId/);
  assert.throws(() => P.capture(base, plain(), plain(), {}), /actor/);
});


test("reused run IDs with distinct creation stamps remain associative and isolate stale updates", () => {
  const first = change(P.empty(), "first", s => { s.rounds["set-1"] = round("reused"); });
  const old = change(first, "old", s => { s.rounds["set-1"].answers.Q0001 = "A"; });
  const middle = change(old, "middle", s => { s.rounds["set-1"] = round("middle"); });
  const latest = change(middle, "latest", s => { s.rounds["set-1"] = round("reused"); s.rounds["set-1"].answers.Q0002 = "B"; });
  assert(P.equal(P.merge(P.merge(old, middle), latest), P.merge(old, P.merge(middle, latest))));
  assert.deepEqual(P.view(P.merge(old, latest)).rounds["set-1"].answers, { Q0002: "B" });
  const before = P.view(old), after = clone(before); after.rounds["set-1"].index = 2;
  const stale = P.capture(latest, before, after, { actor: "stale" });
  assert.equal(P.view(stale).rounds["set-1"].index, 0);
  assert.deepEqual(P.view(stale).rounds["set-1"].answers, { Q0002: "B" });
});
