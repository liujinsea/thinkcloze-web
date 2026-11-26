/* Account-sync state shared by the SAT question modules. No storage or network side effects.
 * Seeds are immutable, once-only browser imports. Never seed an already aggregated view.
 * Each actor is one sequential writer; distinct concurrent tabs must have distinct actor IDs.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SATProgress = api;
})(typeof window === "object" ? window : typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const FORMAT = "thinkcloze.sat-progress";
  const VERSION = 1;
  const ZERO = [0, 0, ""];
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const object = value => !!value && typeof value === "object" && !Array.isArray(value);
  const entries = value => object(value) ? Object.entries(value) : [];
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const string = value => typeof value === "string" ? value : "";
  const write = (map, key, value) => Object.defineProperty(map, key, { value, enumerable: true, configurable: true, writable: true });

  function canonical(value) {
    if (Array.isArray(value)) return value.map(item => canonical(item === undefined ? null : item));
    if (!object(value)) return value === undefined ? null : value;
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) write(result, key, canonical(value[key]));
    }
    return result;
  }
  const stable = value => JSON.stringify(canonical(value));
  const equal = (a, b) => stable(a) === stable(b);
  const copy = value => canonical(value);
  const deterministic = (a, b) => stable(a) >= stable(b) ? a : b;
  const clock = value => Array.isArray(value) && value.length === 3
    ? [number(value[0]), number(value[1]), string(value[2])] : [...ZERO];
  function compareClock(a, b) {
    return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
  }
  const maxClock = (a, b) => compareClock(a, b) >= 0 ? [...a] : [...b];
  function tick(previous, actor) {
    const now = Math.max(0, Math.floor(Date.now()));
    return now > previous[0] ? [now, 0, actor] : [previous[0], previous[1] + 1, actor];
  }
  const register = (value, at) => ({ clock: [...at], value: copy(value) });
  function mergeRegister(a, b) {
    if (!a) return b && copy(b);
    if (!b) return copy(a);
    const order = compareClock(a.clock, b.clock);
    return copy(order > 0 ? a : order < 0 ? b : deterministic(a, b));
  }
  function normalizeRegister(value) {
    return object(value) && own(value, "value") ? register(value.value, clock(value.clock)) : null;
  }

  function empty() {
    return {
      format: FORMAT, version: VERSION, clock: [...ZERO], seeds: {}, attempts: {}, events: {},
      registers: { review: {}, favorites: {}, words: {} }, rounds: {}
    };
  }
  function plainRound(value) {
    if (!object(value) || !Array.isArray(value.ids)) return null;
    const ids = value.ids.filter(id => typeof id === "string" && id);
    const answers = {};
    for (const [id, answer] of entries(value.answers)) if (typeof answer === "string" && answer) write(answers, id, answer);
    const result = { ids, answers, index: number(value.index), done: value.done === true };
    if (typeof value.runId === "string" && value.runId) result.runId = value.runId;
    if (Array.isArray(value._cycleClock)) result._cycleClock = clock(value._cycleClock);
    return result;
  }
  function roundComparable(value) {
    if (!value) return null;
    const result = copy(value);
    delete result._cycleClock;
    return result;
  }
  function plainState(input) {
    const result = { progress: {}, favorites: {}, words: {}, rounds: {} };
    for (const [id, item] of entries(input && input.progress)) {
      if (!object(item)) continue;
      write(result.progress, id, {
        attempts: number(item.attempts), streak: Math.min(5, number(item.streak)),
        wrong: item.wrong === true, mastered: item.mastered === true, review: item.review === true
      });
    }
    for (const [id, value] of entries(input && input.favorites)) if (value) write(result.favorites, id, true);
    for (const [id, value] of entries(input && input.words)) if (value) write(result.words, id, copy(value));
    for (const [scope, value] of entries(input && input.rounds)) {
      const round = plainRound(value);
      if (round) write(result.rounds, scope, round);
    }
    return canonical(result);
  }
  function seedState(value) {
    const result = plainState(value);
    for (const round of Object.values(result.rounds)) delete round._cycleClock;
    return result;
  }
  function eventOrder(a, b) {
    return compareClock(a.clock, b.clock) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  function mergeEvents(a, b) {
    const unique = {};
    for (const raw of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
      if (!object(raw) || !string(raw.id) || typeof raw.correct !== "boolean") continue;
      const event = { id: raw.id, clock: clock(raw.clock), correct: raw.correct };
      const previous = unique[event.id];
      write(unique, event.id, !previous || eventOrder(event, previous) > 0 ? event
        : eventOrder(event, previous) < 0 ? previous : deterministic(event, previous));
    }
    return Object.values(unique).sort(eventOrder).slice(-5);
  }
  function roundRecord(value) {
    if (!object(value) || !string(value.id)) return null;
    const result = { id: value.id, epoch: clock(value.epoch), deleted: value.deleted === true };
    if (result.deleted) return result;
    result.ids = normalizeRegister(value.ids) || register([], result.epoch);
    result.index = normalizeRegister(value.index) || register(0, result.epoch);
    result.done = normalizeRegister(value.done) || register(false, result.epoch);
    result.answers = {};
    for (const [id, item] of entries(value.answers)) {
      const normalized = normalizeRegister(item);
      if (normalized) write(result.answers, id, normalized);
    }
    return result;
  }
  function fromPlainRound(round, id, epoch) {
    const result = {
      id, epoch: [...epoch], deleted: false, ids: register(round.ids, epoch),
      index: register(round.index, epoch), done: register(round.done, epoch), answers: {}
    };
    for (const [qid, value] of entries(round.answers)) write(result.answers, qid, register(value, epoch));
    return result;
  }
  function mergeRound(a, b) {
    if (!a) return b && copy(b);
    if (!b) return copy(a);
    // The immutable creation stamp is part of the generation identity. A reused
    // UUID with a different stamp is a different generation, never a field merge.
    const generationOrder = compareClock(a.epoch, b.epoch);
    if (generationOrder || a.id !== b.id) {
      return copy(generationOrder > 0 ? a : generationOrder < 0 ? b : deterministic(a, b));
    }
    const epoch = [...a.epoch];
    if (a.deleted || b.deleted) return { id: a.id, epoch, deleted: true };
    const result = {
      id: a.id, epoch, deleted: false, ids: mergeRegister(a.ids, b.ids),
      index: mergeRegister(a.index, b.index), done: mergeRegister(a.done, b.done), answers: {}
    };
    for (const id of new Set([...Object.keys(a.answers), ...Object.keys(b.answers)])) {
      write(result.answers, id, mergeRegister(a.answers[id], b.answers[id]));
    }
    return result;
  }
  function scanClock(doc) {
    let latest = clock(doc.clock);
    const include = at => { latest = maxClock(latest, at); };
    for (const events of Object.values(doc.events)) for (const event of events) include(event.clock);
    for (const collection of Object.values(doc.registers)) for (const item of Object.values(collection)) include(item.clock);
    for (const round of Object.values(doc.rounds)) {
      include(round.epoch);
      if (!round.deleted) {
        include(round.ids.clock); include(round.index.clock); include(round.done.clock);
        for (const item of Object.values(round.answers)) include(item.clock);
      }
    }
    return latest;
  }
  function normalize(raw) {
    const doc = empty();
    if (!object(raw) || raw.format !== FORMAT || raw.version !== VERSION) return doc;
    doc.clock = clock(raw.clock);
    for (const [id, value] of entries(raw.seeds)) write(doc.seeds, id, seedState(value));
    for (const [qid, values] of entries(raw.attempts)) {
      const actors = {};
      for (const [actor, value] of entries(values)) if (number(value)) write(actors, actor, number(value));
      if (Object.keys(actors).length) write(doc.attempts, qid, actors);
    }
    for (const [qid, values] of entries(raw.events)) {
      const events = mergeEvents(values, []);
      if (events.length) write(doc.events, qid, events);
    }
    for (const kind of ["review", "favorites", "words"]) {
      for (const [id, value] of entries(raw.registers && raw.registers[kind])) {
        const item = normalizeRegister(value);
        if (item) write(doc.registers[kind], id, item);
      }
    }
    for (const [scope, value] of entries(raw.rounds)) {
      const item = roundRecord(value);
      if (item) write(doc.rounds, scope, item);
    }
    doc.clock = scanClock(doc);
    return canonical(doc);
  }
  function merge(...values) {
    const result = empty();
    for (const value of values) {
      const doc = normalize(value);
      result.clock = maxClock(result.clock, doc.clock);
      for (const [id, value] of Object.entries(doc.seeds)) write(result.seeds, id,
        own(result.seeds, id) ? copy(deterministic(result.seeds[id], value)) : copy(value));
      for (const [qid, values] of Object.entries(doc.attempts)) {
        const actors = own(result.attempts, qid) ? result.attempts[qid] : {};
        for (const [actor, count] of Object.entries(values)) write(actors, actor, Math.max(actors[actor] || 0, count));
        write(result.attempts, qid, actors);
      }
      for (const [qid, events] of Object.entries(doc.events)) write(result.events, qid, mergeEvents(result.events[qid], events));
      for (const kind of ["review", "favorites", "words"]) for (const [id, item] of Object.entries(doc.registers[kind])) {
        write(result.registers[kind], id, mergeRegister(result.registers[kind][id], item));
      }
      for (const [scope, item] of Object.entries(doc.rounds)) write(result.rounds, scope, mergeRound(result.rounds[scope], item));
    }
    // Merge is purely structural: wall-clock time is consulted only by capture.
    result.clock = scanClock(result);
    return canonical(result);
  }
  function seed(doc, legacy, seedId) {
    if (typeof seedId !== "string" || !seedId) throw new TypeError("A stable, nonempty seedId is required.");
    const result = merge(doc);
    if (!own(result.seeds, seedId)) write(result.seeds, seedId, seedState(legacy));
    return canonical(result);
  }

  function seededRoundCandidates(doc) {
    const result = {};
    for (const [seedId, seed] of Object.entries(doc.seeds)) for (const [scope, raw] of Object.entries(seed.rounds)) {
      const id = raw.runId || `seed:${JSON.stringify([seedId, scope])}`;
      const round = { ...copy(raw), runId: id, _cycleClock: [0, 0, `seed:${seedId}`] };
      const previous = result[scope];
      const count = Object.keys(round.answers).length;
      const previousCount = previous ? Object.keys(previous.answers).length : -1;
      write(result, scope, !previous || count > previousCount ? round : count < previousCount ? previous : copy(deterministic(round, previous)));
    }
    return result;
  }
  function view(value) {
    const doc = merge(value);
    const result = { progress: {}, favorites: {}, words: {}, rounds: seededRoundCandidates(doc) };
    const sources = {};
    for (const seed of Object.values(doc.seeds)) {
      for (const [qid, item] of Object.entries(seed.progress)) {
        if (!own(sources, qid)) write(sources, qid, []);
        sources[qid].push(item);
      }
      for (const id of Object.keys(seed.favorites)) write(result.favorites, id, true);
      for (const [id, ref] of Object.entries(seed.words)) write(result.words, id,
        own(result.words, id) ? copy(deterministic(result.words[id], ref)) : copy(ref));
    }
    const qids = new Set([...Object.keys(sources), ...Object.keys(doc.attempts), ...Object.keys(doc.events), ...Object.keys(doc.registers.review)]);
    for (const qid of qids) {
      const old = sources[qid] || [];
      const failures = old.filter(item => item.wrong);
      const wrong = failures.length > 0;
      const mastered = !wrong && old.some(item => item.mastered);
      const streakSources = wrong ? failures : old;
      const initialStreak = Math.max(0, ...streakSources.map(item => item.streak));
      const item = {
        attempts: old.reduce((sum, item) => sum + item.attempts, 0)
          + Object.values(doc.attempts[qid] || {}).reduce((sum, value) => sum + value, 0),
        streak: wrong ? Math.min(2, initialStreak) : mastered ? 5 : initialStreak,
        wrong, mastered, review: old.some(item => item.review)
      };
      for (const event of doc.events[qid] || []) {
        if (event.correct) {
          item.streak = Math.min(5, item.streak + 1);
          if (item.streak >= 3) item.wrong = false;
          if (item.streak >= 5) item.mastered = true;
        } else {
          item.streak = 0; item.wrong = true; item.mastered = false;
        }
      }
      if (own(doc.registers.review, qid)) item.review = doc.registers.review[qid].value === true;
      write(result.progress, qid, item);
    }
    for (const kind of ["favorites", "words"]) for (const [id, item] of Object.entries(doc.registers[kind])) {
      if (item.value) write(result[kind], id, kind === "favorites" ? true : copy(item.value));
      else delete result[kind][id];
    }
    for (const [scope, record] of Object.entries(doc.rounds)) {
      if (record.deleted) { delete result.rounds[scope]; continue; }
      const ids = Array.isArray(record.ids.value) ? record.ids.value.filter(id => typeof id === "string" && id) : [];
      const answers = {};
      for (const [id, item] of Object.entries(record.answers)) if (item.value) write(answers, id, copy(item.value));
      write(result.rounds, scope, {
        runId: record.id, _cycleClock: [...record.epoch], ids, answers,
        index: Math.min(number(record.index.value), Math.max(0, ids.length - 1)), done: record.done.value === true
      });
    }
    return canonical(result);
  }

  function capture(value, rawBefore, rawAfter, options) {
    const doc = merge(value);
    const before = plainState(rawBefore), after = plainState(rawAfter);
    const actor = options && string(options.actor);
    if (!actor) throw new TypeError("A nonempty writer actor is required.");
    const deltas = [];
    const changes = [];
    const roundChanges = [];
    for (const qid of new Set([...Object.keys(before.progress), ...Object.keys(after.progress)])) {
      const first = before.progress[qid] || {}, last = after.progress[qid] || {};
      const delta = number(last.attempts) - number(first.attempts);
      if (delta > 0) deltas.push([qid, delta]);
      if (!!first.review !== !!last.review) changes.push(["review", qid, !!last.review]);
    }
    for (const kind of ["favorites", "words"]) for (const id of new Set([...Object.keys(before[kind]), ...Object.keys(after[kind])])) {
      const first = before[kind][id] || false, last = after[kind][id] || false;
      if (!equal(first, last)) changes.push([kind, id, last]);
    }
    for (const scope of new Set([...Object.keys(before.rounds), ...Object.keys(after.rounds)])) {
      const first = before.rounds[scope] || null, last = after.rounds[scope] || null;
      if (!equal(roundComparable(first), roundComparable(last))) roundChanges.push([scope, first, last]);
    }
    if (!deltas.length && !changes.length && !roundChanges.length) return doc;
    const at = tick(doc.clock, actor);
    doc.clock = at;
    for (const [qid, delta] of deltas) {
      const actors = own(doc.attempts, qid) ? doc.attempts[qid] : {};
      const next = number(actors[actor]) + delta;
      write(actors, actor, next); write(doc.attempts, qid, actors);
      const answer = options && options.answer;
      if (answer && answer.id === qid && answer.verified === true && typeof answer.correct === "boolean") {
        const event = { id: JSON.stringify([actor, next]), clock: at, correct: answer.correct };
        write(doc.events, qid, mergeEvents(doc.events[qid], [event]));
      }
    }
    for (const [kind, id, value] of changes) write(doc.registers[kind], id, register(value, at));
    for (const [scope, first, last] of roundChanges) {
      if (!last) {
        const tombstone = { id: `deleted:${JSON.stringify(at)}`, epoch: at, deleted: true };
        write(doc.rounds, scope, mergeRound(doc.rounds[scope], tombstone));
        continue;
      }
      const existing = doc.rounds[scope];
      const id = last.runId || first && first.runId || existing && !existing.deleted && existing.id || `run:${JSON.stringify(at)}`;
      const sameRun = !!first && (!last.runId || last.runId === first.runId);
      const epoch = sameRun ? first._cycleClock || last._cycleClock
        || (existing && existing.id === id ? existing.epoch : [0, 0, `legacy:${id}`]) : at;
      const current = existing && existing.id === id && !compareClock(existing.epoch, epoch) && !existing.deleted ? copy(existing)
        : fromPlainRound(sameRun ? first : last, id, epoch);
      current.epoch = [...epoch];
      for (const field of ["ids", "index", "done"]) {
        if (!sameRun || !equal(first[field], last[field])) current[field] = register(last[field], at);
      }
      const previousAnswers = sameRun ? first.answers : {};
      for (const qid of new Set([...Object.keys(previousAnswers), ...Object.keys(last.answers)])) {
        const old = previousAnswers[qid] || false, answer = last.answers[qid] || false;
        if (!sameRun || !equal(old, answer)) write(current.answers, qid, register(answer, at));
      }
      write(doc.rounds, scope, mergeRound(existing, current));
    }
    return merge(doc);
  }

  return Object.freeze({ empty, seed, merge, view, capture, equal });
});
