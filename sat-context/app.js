"use strict";

const LETTERS = "ABCD";
const GROUP_SIZE = 10;
const STORAGE_KEY = document.body.dataset.storageKey || "thinkcloze_sat_context_v1";
const VERIFIED = "source_verified";
const screen = document.getElementById("screen");
const notice = document.getElementById("storage-notice");
const wordCount = document.getElementById("word-count");
const headings = {
  questions: "题目收藏", wrong: "错题重练", review: "标记复习", pending: "待核对题"
};
const escaped = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const html = value => String(value ?? "").replace(/[&<>"']/g, char => escaped[char]);

let questions = [];
let questionById;
let groupCount;
let state;
let route = "practice";
let canPersist = true;
let flash = null;
const excludedWords = new Set();

function emptyState() {
  return { progress: {}, favorites: {}, words: {}, rounds: {} };
}

function warnStorage() {
  canPersist = false;
  notice.textContent = "当前浏览器无法保存新记录，本次练习仍可继续。";
  notice.hidden = false;
}

function loadState() {
  if (!canPersist) return state;
  try {
    return { ...emptyState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    warnStorage();
    return state || emptyState();
  }
}

function updateState(change) {
  state = loadState();
  change(state);
  if (canPersist) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      warnStorage();
    }
  }
}

function statusFor(question) {
  if (question.status === "inferred_answer") return "答案为语境推定 · 待同卷答案键复核";
  if (question.status === "incomplete_source") return "原图局部缺文 · 参考练习";
  if (question.status === "historical_unverified") return "历史题 · 原答案待核对";
  if (question.status !== VERIFIED) return "答案为编辑建议 · 原答案待核对";
  return "";
}

function progressFor(id) {
  return state.progress[id] || {};
}

function scopeQuestions(scope) {
  if (scope.startsWith("set-")) {
    const start = (Number(scope.slice(4)) - 1) * GROUP_SIZE;
    return questions.slice(start, start + GROUP_SIZE);
  }
  if (scope === "questions") return questions.filter(q => state.favorites[q.id]);
  if (scope === "wrong") return questions.filter(q => progressFor(q.id).wrong);
  if (scope === "review") return questions.filter(q => progressFor(q.id).review);
  if (scope === "pending") return questions.filter(q => q.status !== VERIFIED);
  return [];
}

function titleFor(scope) {
  return headings[scope] || `第 ${Number(scope.slice(4))} 组`;
}

function roundTitle() {
  if (route.startsWith("q-")) return "单题练习";
  return titleFor(route.replace(/^run-/, ""));
}

function render() {
  document.getElementById("question-count").textContent = Object.keys(state.favorites).length;
  if (wordCount) wordCount.textContent = Object.keys(state.words).length;
  const activeTab = ["words", "memorize"].includes(route) ? "words"
    : ["questions", "run-questions"].includes(route) || (route.startsWith("q-") && state.favorites[route.slice(2)])
      ? "questions" : "practice";
  document.querySelectorAll(".tabs a").forEach(link => {
    if (link.hash === `#${activeTab}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (route === "practice") renderPractice();
  else if (Object.hasOwn(headings, route)) renderQuestionList();
  else if (route === "words") renderWordList();
  else if (route === "memorize") renderFlashcard();
  else renderRound();
}

function renderPractice() {
  const mastered = questions.filter(q => progressFor(q.id).mastered).length;
  const completed = questions.filter(q => progressFor(q.id).attempts).length;
  const sets = Array.from({ length: groupCount }, (_, index) => {
    const scope = `set-${index + 1}`;
    const total = scopeQuestions(scope).length;
    const round = state.rounds[scope];
    const label = round?.done ? "已完成 · 可重刷"
      : round ? `继续 · 已答 ${Object.keys(round.answers).length}/${total}` : `${total} 题`;
    return `<a class="set" href="#${scope}"><strong>${titleFor(scope)}</strong><span>${label}</span></a>`;
  });
  screen.innerHTML = `
    <div class="card stack">
      <h2 tabindex="-1" data-focus>专项练习</h2>
      <p class="muted">已练 ${completed}/${questions.length} 题 · 已掌握 ${mastered} 题</p>
      <div class="actions">
        <a class="btn" href="#wrong">错题重练 · ${scopeQuestions("wrong").length}</a>
        <a class="btn" href="#review">标记复习 · ${scopeQuestions("review").length}</a>
        <a class="btn" href="#pending">待核对题 · ${scopeQuestions("pending").length}</a>
      </div>
      <p class="muted">答错后进入错题，连续答对 3 次移出，连续答对 5 次标为掌握。待核对题提供参考解析。</p>
    </div>
    <div class="card stack">
      <h2>分组练习</h2>
      <p class="muted">${questions.length} 题 · ${groupCount} 组 · 每组最多 ${GROUP_SIZE} 题</p>
      <div class="sets">${sets.join("")}</div>
    </div>`;
}

function renderQuestionList() {
  const list = scopeQuestions(route);
  const canContinue = state.rounds[`run-${route}`] && !state.rounds[`run-${route}`].done;
  screen.innerHTML = `
    <div class="card stack">
      <div class="row spread">
        <h2 tabindex="-1" data-focus>${titleFor(route)} <span class="badge">${list.length} 题</span></h2>
        ${list.length || canContinue ? `<a class="btn primary" href="#run-${route}">${canContinue ? "继续练习" : "开始练习"}</a>` : ""}
      </div>
      ${list.length ? `<div class="items">${list.map(q => `
        <div class="item row">
          <div><strong>${q.id}</strong> <span class="muted">${html(q.source)}</span></div>
          <a class="btn" href="#q-${q.id}">练习此题</a>
          ${route === "questions" ? `<button class="btn" data-action="remove-question" data-id="${q.id}">取消收藏</button>` : ""}
        </div>`).join("")}</div>` : `<p class="muted">${route === "questions" ? "点题目上的「收藏题目」即可在这里重刷。" : "当前没有需要复习的题目。"}</p>`}
    </div>`;
}

function backRoute() {
  if (route.startsWith("run-")) return route.slice(4);
  if (route.startsWith("q-") && state.favorites[route.slice(2)]) return "questions";
  return "practice";
}

function wordKey(option) {
  return JSON.stringify([option.term.toLowerCase(), option.meaning]);
}

function renderRound() {
  const round = state.rounds[route];
  if (!round) return;
  const { ids, answers, index, done } = round;
  const back = `<a class="btn" href="#${backRoute()}">返回列表</a>`;
  if (done) {
    const scored = ids.filter(id => questionById.get(id).status === VERIFIED);
    const correct = scored.filter(id => answers[id] === questionById.get(id).answer).length;
    screen.innerHTML = `<div class="card stack">
      <h2 tabindex="-1" data-focus>${roundTitle()}完成</h2>
      <p>本轮已练 ${ids.length} 题 · ${scored.length ? `答对 ${correct}/${scored.length} 道计分题` : "本轮为待核对练习"}</p>
      ${scored.length !== ids.length ? `<p class="muted">${ids.length - scored.length} 道待核对题仅显示参考答案。</p>` : ""}
      <div class="actions"><button class="btn primary" data-action="restart">再练一轮</button>${back}
        ${scopeQuestions("wrong").length ? '<a class="btn" href="#wrong">去错题重练</a>' : ""}</div>
    </div>`;
    return;
  }

  const q = questionById.get(ids[index]);
  const answer = answers[q.id];
  const pending = statusFor(q);
  const item = progressFor(q.id);
  const result = answer === q.answer ? "correct" : "wrong";
  screen.innerHTML = `
    <article class="card stack">
      <div class="row spread">
        <h2 tabindex="-1" data-focus>${roundTitle()} · ${index + 1}/${ids.length}</h2>
        ${back}
      </div>
      <progress class="progress" max="${ids.length}" value="${Object.keys(answers).length}" aria-label="本轮已答题数"></progress>
      <div class="row">
        <span class="muted">${q.id} · ${html(q.source)}</span>
        ${pending ? `<span class="badge">${pending}</span>` : `<span class="badge">${item.mastered ? "已掌握" : `连续答对 ${item.streak || 0}/5`}</span>`}
      </div>
      <p class="passage" lang="en">${html(q.passage)}</p>
      <p class="prompt" lang="en">${html(q.prompt)}</p>
      <div class="options" aria-label="选项">${q.options.map((opt, i) => {
        const letter = LETTERS[i];
        const isSaved = wordCount && !!state.words[wordKey(opt)];
        const outcome = letter === q.answer ? "correct" : letter === answer ? "wrong" : "";
        const label = outcome === "correct" ? (pending ? "参考答案" : "正确答案") : "你的选择";
        return `<div class="option-row">
          <button class="answer" data-action="answer" data-letter="${letter}"
            ${answer ? `disabled data-result="${outcome}"` : ""}>
            <span class="letter">${letter}</span> <span lang="en">${html(opt.text)}</span>
            ${answer && outcome ? `<span class="badge">${label}</span>` : ""}
          </button>
          ${answer && wordCount ? `<div class="row spread option-gloss">
            <span>${html(opt.meaning)}</span>
            <button class="btn" data-action="word" data-letter="${letter}" aria-label="${isSaved ? "取消收藏" : "收藏单词"} ${letter} ${html(opt.text)}" aria-pressed="${isSaved}">${isSaved ? "★ 已收藏" : "☆ 收藏单词"}</button>
          </div>` : ""}
        </div>`;
      }).join("")}</div>
      ${answer ? `<div class="feedback" tabindex="-1" data-feedback>
        <p class="${result === "correct" ? "good" : "bad"}"><strong>${pending ? "参考答案" : result === "correct" ? "答对了" : "正确答案"} · ${q.answer}</strong></p>
        ${q.clue ? `<p><strong>关键线索</strong> · ${html(q.clue)}</p>` : ""}
        <p>${html(q.explanation)}</p>
        ${q.optionAnalysis ? `<details class="option-analysis">
          <summary>查看四个选项的分析</summary>
          <ol type="A">${q.optionAnalysis.map(analysis => `<li>${html(analysis)}</li>`).join("")}</ol>
        </details>` : ""}
      </div>` : ""}
      <div class="actions">
        <button class="btn" data-action="favorite" aria-pressed="${!!state.favorites[q.id]}">${state.favorites[q.id] ? "★ 已收藏题目" : "☆ 收藏题目"}</button>
        <button class="btn" data-action="review" aria-pressed="${!!item.review}">${item.review ? "已标记复习" : "标记复习"}</button>
        ${answer ? `<button class="btn primary" data-action="next">${index + 1 === ids.length ? "完成本轮" : "下一题"}</button>` : ""}
      </div>
    </article>`;
}

function renderWordList() {
  const entries = Object.entries(state.words);
  screen.innerHTML = `<div class="card stack">
    <h2 tabindex="-1" data-focus>我的词汇表</h2>
    <p class="muted">答完题后收藏选项和词义。勾选想复习的词，再用卡片回忆中文释义。</p>
    ${entries.length ? `
      <div class="row spread">
        <input class="word-filter" type="search" id="word-filter" aria-label="搜索我的词汇" placeholder="搜索单词或释义">
        <button class="btn primary" data-action="memorize" id="memorize-start">背诵所选</button>
      </div>
      <div class="row">
        <button class="btn" data-action="select-all">全选显示词汇</button>
        <button class="btn" data-action="select-none">清空选择</button>
      </div>
      <div class="items" id="saved-words">${entries.map(([key, ref]) => {
        const q = questionById.get(ref.id);
        const opt = q?.options[LETTERS.indexOf(ref.letter)];
        if (!opt) return "";
        return `<div class="item row" data-word-item data-search="${html(`${opt.term} ${opt.text} ${opt.meaning}`.toLowerCase())}">
          <label class="word-check">
            <input type="checkbox" data-word-key="${html(key)}" ${excludedWords.has(key) ? "" : "checked"}>
            <span><strong lang="en">${html(opt.term)}</strong><span class="muted">${html(opt.meaning)}</span></span>
          </label>
          <a href="#q-${q.id}" class="btn" aria-label="查看词汇 ${html(opt.term)} 的来源 ${q.id}">查看原题</a>
          <button class="btn" data-action="remove-word" data-key="${html(key)}" aria-label="取消收藏 ${html(opt.term)}">移除</button>
        </div>`;
      }).join("")}</div>
      <p class="muted" id="word-empty" hidden>没有匹配的词汇。</p>`
      : '<p>词表目前是空的。<a href="#practice">去做一组题</a>，收藏想背的选项。</p>'}
    </div>`;
  updateWordSelection();
}

function wordCheckboxes() {
  return [...screen.querySelectorAll("[data-word-key]")];
}

function updateWordSelection() {
  const start = document.getElementById("memorize-start");
  if (!start) return;
  const count = wordCheckboxes().filter(box => box.checked).length;
  start.textContent = `背诵所选 · ${count}`;
  start.disabled = count === 0;
}

function renderFlashcard() {
  if (!flash || !flash.queue.length) {
    screen.innerHTML = `<div class="card stack"><h2 tabindex="-1" data-focus>${flash ? "本轮背诵完成" : "选择背诵词汇"}</h2>
      <div class="actions"><a class="btn primary" href="#words">返回我的词汇表</a>
      ${flash ? '<button class="btn" data-action="flash-restart">再背一轮</button>' : ""}</div></div>`;
    return;
  }
  const ref = flash.queue[0];
  const q = questionById.get(ref.id);
  const opt = q.options[LETTERS.indexOf(ref.letter)];
  screen.innerHTML = `<div class="card flashcard stack">
    <p class="muted">还剩 ${flash.queue.length} 个词</p>
    <h2 class="flash-term" lang="en" tabindex="-1" data-focus>${html(opt.term)}</h2>
    ${flash.revealed ? `<div class="feedback" tabindex="-1" data-feedback>
      <p><strong>${html(opt.meaning)}</strong></p>
      <p class="muted">原题 ${q.id} · ${ref.letter}. <span lang="en">${html(opt.text)}</span></p>
    </div>` : ""}
    <div class="actions">
      ${flash.revealed ? '<button class="btn" data-action="flash-again">再背一次</button><button class="btn primary" data-action="flash-known">记住了</button>'
        : '<button class="btn primary" data-action="flash-reveal">显示词义</button>'}
      <a class="btn" href="#words">返回词汇表</a>
    </div>
  </div>`;
}

function startRound() {
  const candidates = route.startsWith("q-") ? [questionById.get(route.slice(2))]
    : scopeQuestions(route.replace(/^run-/, ""));
  if (!candidates.length || !candidates[0]) return false;
  updateState(data => {
    data.rounds[route] = { ids: candidates.map(q => q.id), answers: {}, index: 0, done: false };
  });
  return true;
}

function readRoute(focus = false) {
  const requested = location.hash.slice(1);
  const group = /^set-([1-9]\d*)$/.exec(requested);
  const isRound = !!(group && Number(group[1]) <= groupCount)
    || (requested.startsWith("q-") && questionById.has(requested.slice(2)))
    || (requested.startsWith("run-") && Object.hasOwn(headings, requested.slice(4)));
  if (isRound) {
    route = requested;
    if (!state.rounds[route] && !startRound()) route = requested.slice(4);
  } else {
    const isWordRoute = wordCount && ["words", "memorize"].includes(requested);
    route = Object.hasOwn(headings, requested) || isWordRoute ? requested : "practice";
  }
  render();
  if (focus) screen.querySelector("[data-focus]")?.focus();
}

function recordAnswer(data, id, letter) {
  const round = data.rounds[route];
  if (round.done || round.ids[round.index] !== id || round.answers[id]) return;
  round.answers[id] = letter;
  const q = questionById.get(id);
  const item = data.progress[id] ||= {};
  item.attempts = (item.attempts || 0) + 1;
  if (q.status !== VERIFIED) return;
  if (q.answer === letter) {
    item.streak = Math.min(5, (item.streak || 0) + 1);
    if (item.streak >= 3) item.wrong = false;
    if (item.streak >= 5) item.mastered = true;
  } else {
    item.wrong = true;
    item.streak = 0;
    item.mastered = false;
  }
}

function toggle(object, key, value = true) {
  if (object[key]) delete object[key];
  else object[key] = value;
}

screen.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, letter, id, key } = button.dataset;
  const round = state.rounds[route];
  const qid = round?.ids[round.index];

  switch (action) {
    case "answer": updateState(data => recordAnswer(data, qid, letter)); break;
    case "favorite": updateState(data => toggle(data.favorites, qid)); break;
    case "review": updateState(data => {
      const item = data.progress[qid] ||= {};
      item.review = !item.review;
    }); break;
    case "word": {
      const option = questionById.get(qid).options[LETTERS.indexOf(letter)];
      const savedKey = wordKey(option);
      updateState(data => toggle(data.words, savedKey, { id: qid, letter }));
      excludedWords.delete(savedKey);
      break;
    }
    case "remove-question": updateState(data => { delete data.favorites[id]; }); break;
    case "remove-word": updateState(data => { delete data.words[key]; }); break;
    case "next": updateState(data => {
      const current = data.rounds[route];
      if (current.done || current.ids[current.index] !== qid || !current.answers[qid]) return;
      if (current.index + 1 === current.ids.length) current.done = true;
      else current.index++;
    }); break;
    case "restart":
      if (!startRound()) {
        updateState(data => { delete data.rounds[route]; });
        location.hash = backRoute();
        return;
      }
      break;
    case "select-all":
    case "select-none":
      wordCheckboxes().forEach(box => {
        if (action === "select-all" && box.closest("[data-word-item]").hidden) return;
        box.checked = action === "select-all";
        if (box.checked) excludedWords.delete(box.dataset.wordKey);
        else excludedWords.add(box.dataset.wordKey);
      });
      updateWordSelection();
      return;
    case "memorize": {
      const cards = wordCheckboxes().filter(box => box.checked).map(box => state.words[box.dataset.wordKey]);
      if (cards.length) {
        flash = { cards, queue: [...cards], revealed: false };
        location.hash = "memorize";
      }
      return;
    }
    case "flash-reveal": flash.revealed = true; break;
    case "flash-again": flash.queue.push(flash.queue.shift()); flash.revealed = false; break;
    case "flash-known": flash.queue.shift(); flash.revealed = false; break;
    case "flash-restart": flash.queue = [...flash.cards]; break;
  }

  render();
  const repeated = ["word", "review", "favorite"].includes(action)
    ? screen.querySelector(`[data-action="${action}"]${letter ? `[data-letter="${letter}"]` : ""}`)
    : null;
  const focus = ["answer", "flash-reveal"].includes(action) ? "[data-feedback]" : "[data-focus]";
  (repeated || screen.querySelector(focus))?.focus();
});

screen.addEventListener("change", event => {
  const key = event.target.dataset.wordKey;
  if (!key) return;
  if (event.target.checked) excludedWords.delete(key);
  else excludedWords.add(key);
  updateWordSelection();
});

screen.addEventListener("input", event => {
  if (event.target.id !== "word-filter") return;
  const query = event.target.value.toLowerCase().trim();
  let matches = 0;
  screen.querySelectorAll("[data-word-item]").forEach(item => {
    item.hidden = !item.dataset.search.includes(query);
    if (!item.hidden) matches++;
  });
  document.getElementById("word-empty").hidden = matches !== 0;
});

async function initialize() {
  try {
    const response = await fetch("./questions.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    questions = await response.json();
    questionById = new Map(questions.map(q => [q.id, q]));
    groupCount = Math.ceil(questions.length / GROUP_SIZE);
    state = loadState();
    readRoute();
    window.addEventListener("hashchange", () => readRoute(true));
    window.addEventListener("storage", event => {
      if (event.key !== STORAGE_KEY || !canPersist) return;
      state = loadState();
      readRoute();
    });
  } catch (error) {
    console.error(error);
    screen.innerHTML = '<div class="card stack"><h2>题库暂时无法加载</h2><p>请刷新页面后再试。</p></div>';
  } finally {
    screen.removeAttribute("aria-busy");
  }
}

initialize();
