const fs = require("fs");
const path = require("path");

const workspace = path.resolve(__dirname, "..");
const sourcePath = process.argv[2] || path.join(process.env.USERPROFILE || "", "Downloads", "SAT_Teacher_Flashcards_Mobile.html");
const outDir = path.join(workspace, "sat-teacher");

function readCards(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/const CARDS = (\[.*?\]);\s*const STORAGE_KEY/s);
  if (!match) {
    throw new Error("Could not find CARDS data in " + htmlPath);
  }
  return JSON.parse(match[1]);
}

function buildIndex(cards) {
  const cardsJson = JSON.stringify(cards);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="SAT教学语言" />
<meta name="theme-color" content="#3157d5" />
<link rel="manifest" href="manifest.json" />
<link rel="apple-touch-icon" href="icon-192.png" />
<title>SAT教学语言练习</title>
<style>
:root{--bg:#f7f7fb;--card:#fff;--text:#171827;--muted:#70758a;--line:#e6e7ef;--primary:#3157d5;--good:#0a8f5a;--bad:#ce2f45;--chip:#eef2ff;--warn:#fff8df;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif;}
.app{max-width:760px;margin:0 auto;padding:18px 14px 40px}
header{position:sticky;top:0;z-index:5;background:rgba(247,247,251,.94);backdrop-filter:blur(10px);padding:10px 0 12px;border-bottom:1px solid var(--line)}
h1{font-size:22px;margin:4px 0 6px}
.sub{color:var(--muted);font-size:13px;line-height:1.45}
.tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:14px 0 10px}
button,select,input{font:inherit}
.tab,.btn{border:0;border-radius:14px;padding:11px 10px;background:#fff;color:var(--text);box-shadow:0 1px 0 rgba(0,0,0,.04)}
.tab.active,.btn.primary{background:var(--primary);color:#fff}
.btn{width:100%;margin:6px 0;font-weight:650}
.btn.ghost{background:#fff;border:1px solid var(--line)}
.btn.good{background:var(--good);color:#fff}
.btn.bad{background:var(--bad);color:#fff}
.panel{display:none}
.panel.active{display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:18px;margin:14px 0;box-shadow:0 8px 22px rgba(28,32,54,.05)}
.row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:4px;border-radius:999px;background:var(--chip);padding:5px 9px;font-size:12px;color:#293b8f;margin:3px}
.promptLabel{color:var(--muted);font-size:13px;margin-top:12px}
.term{font-size:30px;font-weight:800;line-height:1.22;margin:18px 0 14px;overflow-wrap:anywhere}
.answer{font-size:22px;line-height:1.42;margin:16px 0;color:#213f98;font-weight:760;overflow-wrap:anywhere}
.note{color:var(--muted);font-size:14px;line-height:1.55;background:#fafafd;border-radius:14px;padding:10px;margin-top:10px}
select,input{width:100%;padding:12px;border-radius:14px;border:1px solid var(--line);background:#fff;margin:6px 0 10px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.stat{background:#fff;border:1px solid var(--line);border-radius:16px;padding:12px;text-align:center}
.num{font-size:22px;font-weight:800}
.label{font-size:12px;color:var(--muted)}
.option{width:100%;text-align:left;margin:8px 0;padding:14px;border-radius:16px;border:1px solid var(--line);background:#fff;line-height:1.35;overflow-wrap:anywhere}
.option.correct{border-color:var(--good);background:#eefaf5}
.option.wrong{border-color:var(--bad);background:#fff0f2}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.btn.star{background:var(--warn);border:1px solid #f0d36a;color:#765a00}
.btn.done{background:#eefaf5;border:1px solid #9dddbf;color:#075f3b}
.listItem{padding:12px 0;border-bottom:1px solid var(--line)}
.small{font-size:12px;color:var(--muted)}
.hidden{display:none}
.center{text-align:center}
.speakBtn{width:auto;display:inline-flex;align-items:center;justify-content:center;padding:7px 11px;border-radius:999px;font-size:13px;background:#fff;color:var(--text);border:1px solid var(--line);box-shadow:none;margin:2px 0 8px}
.content-top{display:none;align-items:center;gap:12px;margin:0 0 10px;padding:6px 0 10px;border-bottom:1px solid var(--line)}
.content-top .btn{width:auto;margin:0;padding:8px 12px}
.content-title{font-weight:800;color:var(--muted)}
body.menu-view .panel{display:none}
body.content-view header{display:none}
body.content-view .content-top{display:flex}
body.study-view .content-top,body.quiz-view .content-top{display:none}
body.content-view #study .study-setup{display:none}
body.menu-view .app{max-width:980px;padding:44px 18px 28px}
body.menu-view header{position:static;background:transparent;backdrop-filter:none;border-bottom:0;padding:0}
body.menu-view h1{font-size:34px;line-height:1.08;margin:0 0 10px}
body.menu-view .sub{font-size:16px;max-width:780px}
body.menu-view .tabs{grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:28px 0 0}
body.menu-view .tab{min-height:92px;display:flex;align-items:flex-end;justify-content:flex-start;border:1px solid var(--line);border-radius:18px;padding:18px;font-size:18px;font-weight:800;text-align:left;box-shadow:0 10px 26px rgba(28,32,54,.06)}
@media (min-width:900px){
  .app{max-width:980px;padding:14px 18px 28px}
  h1{font-size:20px;margin:2px 0 4px}
  .sub{font-size:12px}
  .tabs{gap:8px;margin:10px 0 8px}
  .tab,.btn{border-radius:12px;padding:8px 9px;font-size:14px}
  .card{border-radius:18px;padding:14px;margin:10px 0}
  .term{font-size:26px;margin:14px 0 12px;line-height:1.18}
  .answer{font-size:18px;margin:10px 0}
  .note{font-size:13px;line-height:1.4;padding:8px;margin-top:8px}
  select,input{padding:9px;border-radius:12px;margin:4px 0 8px;font-size:14px}
  .stats{gap:8px}
  .stat{border-radius:14px;padding:8px}
  .num{font-size:18px}
  .label{font-size:11px}
  .option{margin:6px 0;padding:10px 12px;border-radius:13px;font-size:15px;line-height:1.3}
  .actions{gap:8px;margin-top:8px}
  .actions .btn{font-size:14px;padding:8px 9px}
  .pill{font-size:11px;padding:4px 8px}
  .listItem{padding:9px 0}
  body.menu-view .app{padding-top:38px}
}
@media (max-width:480px){
  .app{padding:14px 12px 36px}
  .term{font-size:26px}
  .answer{font-size:20px}
  .option{padding:13px;font-size:16px}
  .stats{gap:7px}
  .stat{padding:9px 5px}
  .label{font-size:11px}
  body.menu-view .app{padding:24px 14px 24px}
  body.menu-view h1{font-size:28px}
  body.menu-view .sub{font-size:14px}
  body.menu-view .tabs{grid-template-columns:1fr 1fr;gap:10px;margin-top:20px}
  body.menu-view .tab{min-height:74px;border-radius:16px;padding:14px;font-size:16px}
}
</style>
</head>
<body class="menu-view"><div class="app">
<header>
  <h1>SAT教学语言练习</h1>
  <div class="sub">Grammar / Math / Reading · 410 张课堂表达卡</div>
  <div class="tabs">
    <button class="tab" data-tab="study">背诵</button>
    <button class="tab" data-tab="quiz">测验</button>
    <button class="tab" data-tab="review">复习</button>
    <button class="tab" data-tab="wrong">错题</button>
    <button class="tab" data-tab="list">句表</button>
  </div>
</header>
<div class="content-top"><button class="btn ghost" id="backToMenu" type="button">返回功能菜单</button><div class="content-title" id="contentTitle"></div></div>

<section id="study" class="panel">
  <div class="card study-setup">
    <label for="scope">选择范围</label>
    <select id="scope"></select>
    <div class="stats">
      <div class="stat"><div class="num" id="totalN">0</div><div class="label">待练</div></div>
      <div class="stat"><div class="num" id="knownN">0</div><div class="label">已掌握</div></div>
      <div class="stat"><div class="num" id="wrongN">0</div><div class="label">错题</div></div>
      <div class="stat"><div class="num" id="dueN">0</div><div class="label">今日复习</div></div>
    </div>
  </div>
  <div class="card center">
    <div id="cardMeta"></div>
    <div class="promptLabel">中文提示</div>
    <div class="term" id="studyTerm">-</div>
    <button class="btn primary" id="showBtn">显示英文</button>
    <div id="answerBox" class="hidden">
      <div class="answer" id="studyMeaning"></div>
      <button class="speakBtn" id="studySpeakBtn" type="button">朗读英文</button>
      <div class="note" id="studyNote"></div>
      <button class="btn good" id="knowBtn">已掌握</button>
      <button class="btn bad" id="dontKnowBtn">还不熟 / 加入错题</button>
    </div>
    <button class="btn ghost" id="nextBtn">下一张</button>
  </div>
</section>

<section id="quiz" class="panel">
  <div class="hidden">
    <label for="quizScope">测验范围</label>
    <select id="quizScope"></select>
    <button class="btn primary" id="startQuiz">开始 / 下一题</button>
  </div>
  <div class="card">
    <div id="quizMeta"></div>
    <div class="promptLabel">中文提示</div>
    <div class="term" id="quizTerm">点击开始</div>
    <div id="options"></div>
    <div class="actions">
      <button class="btn bad" id="favQuizBtn">未掌握</button>
      <button class="btn done" id="knownQuizBtn">已掌握</button>
    </div>
    <div id="quizFeedback" class="note hidden"></div>
  </div>
</section>

<section id="review" class="panel">
  <div class="card">
    <div class="row"><strong>间隔复习</strong><button class="btn primary" style="width:auto;padding:9px 12px" id="startReview">开始今日复习</button></div>
  </div>
  <div class="card">
    <div id="reviewMeta"></div>
    <div class="promptLabel">中文提示</div>
    <div class="term" id="reviewTerm">今日到期表达会显示在这里</div>
    <div id="reviewOptions"></div>
    <div id="reviewFeedback" class="note hidden"></div>
  </div>
  <div class="card" id="reviewList"></div>
</section>

<section id="wrong" class="panel">
  <div class="card">
    <div class="row"><strong>错题本</strong><button class="btn primary" style="width:auto;padding:9px 12px" id="wrongQuizBtn">错题集中测验</button><button class="btn ghost" style="width:auto;padding:9px 12px" id="clearWrong">清空</button></div>
  </div>
  <div class="card" id="wrongList"></div>
</section>

<section id="list" class="panel">
  <div class="card">
    <input id="search" placeholder="搜索中文 / 英文 / Unit / ID" />
    <select id="listScope"></select>
  </div>
  <div class="card" id="cardList"></div>
</section>
</div>

<script>
const SOURCE_CARDS = ${cardsJson};
const CARDS = SOURCE_CARDS.map((c, i) => ({
  id: i + 1,
  code: c.ID,
  subject: c.Subject,
  unit: c.Unit,
  level: Number(c.Level) || 0,
  term: c.Chinese,
  meaning: c.English,
  note: c.Subject + " · " + c.Unit + " · Level " + c.Level + " · " + c.ID
}));
const STORAGE_KEY = "sat_teacher_language_state_v1";
let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"known":[],"wrong":[],"favorite":[],"idx":0,"correctCounts":{},"review":{}}');
state.known ||= [];
state.wrong ||= [];
state.favorite ||= [];
state.idx ||= 0;
state.correctCounts ||= {};
state.review ||= {};

function save(){localStorage.setItem(STORAGE_KEY, JSON.stringify(state));}
function byId(id){return document.getElementById(id);}
function escapeHtml(str){return String(str || "").replace(/[&<>"']/g, function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[m];});}
function enc(str){return encodeURIComponent(str);}
function dec(str){return decodeURIComponent(str);}
function sample(arr,n){return [...arr].sort(function(){return Math.random() - 0.5;}).slice(0,n);}
function uniqueByMeaning(arr){const seen = new Set(); return arr.filter(function(w){if(seen.has(w.meaning)) return false; seen.add(w.meaning); return true;});}
function subjects(){return [...new Set(CARDS.map(function(w){return w.subject;}))];}
function unitsForSubject(subject){return [...new Set(CARDS.filter(function(w){return w.subject === subject;}).map(function(w){return w.unit;}))];}

function speakEnglish(text, silent){
  if(!("speechSynthesis" in window)){if(!silent) alert("当前浏览器不支持发音功能"); return;}
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.86;
  speechSynthesis.speak(u);
}
function speakButton(text){return '<button class="speakBtn" type="button" data-speak="' + escapeHtml(text) + '">朗读英文</button>';}

function scopeOptions(sel){
  let html = '<option value="all">全部表达</option><option value="level:1">Level 1 必须会</option><option value="level:2">Level 2 高频补充</option><option value="favorite">收藏句</option><option value="wrong">错题本</option><option value="due">今日复习</option>';
  subjects().forEach(function(subject){
    html += '<optgroup label="' + escapeHtml(subject) + '">';
    html += '<option value="subject:' + enc(subject) + '">' + escapeHtml(subject) + ' 全部</option>';
    unitsForSubject(subject).forEach(function(unit){
      html += '<option value="unit:' + enc(subject) + '|' + enc(unit) + '">' + escapeHtml(subject + ' · ' + unit) + '</option>';
    });
    html += '</optgroup>';
  });
  sel.innerHTML = html;
}
["scope","quizScope","listScope"].forEach(function(id){scopeOptions(byId(id));});

function baseFiltered(scope){
  let arr = CARDS;
  if(scope === "favorite") arr = CARDS.filter(function(w){return state.favorite.includes(w.id);});
  else if(scope === "wrong") arr = CARDS.filter(function(w){return state.wrong.includes(w.id);});
  else if(scope === "due") arr = dueReviewCards();
  else if(scope && scope.indexOf("level:") === 0){
    const level = Number(scope.split(":")[1]);
    arr = CARDS.filter(function(w){return w.level === level;});
  } else if(scope && scope.indexOf("subject:") === 0){
    const subject = dec(scope.slice(8));
    arr = CARDS.filter(function(w){return w.subject === subject;});
  } else if(scope && scope.indexOf("unit:") === 0){
    const parts = scope.slice(5).split("|");
    const subject = dec(parts[0]);
    const unit = dec(parts[1] || "");
    arr = CARDS.filter(function(w){return w.subject === subject && w.unit === unit;});
  }
  return arr;
}
function filtered(scope){return baseFiltered(scope);}
function practiceFiltered(scope){return baseFiltered(scope).filter(function(w){return !state.known.includes(w.id);});}
function correctCount(id){return Math.min(state.correctCounts[id] || 0, 5);}
const REVIEW_INTERVALS = [1,3,7,15,30];
function todayStart(){const d = new Date(); d.setHours(0,0,0,0); return d.getTime();}
function addDays(days){const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + days); return d.getTime();}
function reviewInfo(id){return state.review[id] || null;}
function isDue(w){const r = reviewInfo(w.id); return r && r.due <= todayStart() && state.known.includes(w.id);}
function dueReviewCards(){return CARDS.filter(isDue);}
function scheduleReview(id, stage){const safeStage = stage || 0; const interval = REVIEW_INTERVALS[Math.min(safeStage, REVIEW_INTERVALS.length - 1)]; state.review[id] = {stage:safeStage,due:addDays(interval),last:Date.now()};}
function markKnown(id){state.known = [...new Set([...state.known,id])]; state.correctCounts[id] = 5; state.wrong = state.wrong.filter(function(x){return x !== id;}); if(!state.review[id]) scheduleReview(id,0);}
function failReview(id){state.wrong = [...new Set([...state.wrong,id])]; state.known = state.known.filter(function(x){return x !== id;}); state.correctCounts[id] = 0; delete state.review[id];}
function chip(w){
  return '<span class="pill">' + escapeHtml(w.subject) + '</span><span class="pill">' + escapeHtml(w.unit) + '</span><span class="pill">Level ' + w.level + '</span><span class="pill">' + escapeHtml(w.code) + '</span>' +
    (state.favorite.includes(w.id) ? '<span class="pill">已收藏</span>' : '') +
    (state.known.includes(w.id) ? '<span class="pill">已掌握</span>' : '<span class="pill">正确 ' + correctCount(w.id) + '/5</span>') +
    (isDue(w) ? '<span class="pill">今日复习</span>' : '');
}
function updateStats(){
  const scope = byId("scope").value;
  const arr = filtered(scope);
  byId("totalN").textContent = practiceFiltered(scope).length;
  byId("knownN").textContent = arr.filter(function(w){return state.known.includes(w.id);}).length;
  byId("wrongN").textContent = state.wrong.length;
  byId("dueN").textContent = dueReviewCards().length;
}

let current = null;
function pickStudy(){
  const arr = practiceFiltered(byId("scope").value);
  if(!arr.length){
    current = null;
    byId("cardMeta").innerHTML = "";
    byId("studyTerm").textContent = "当前范围没有待练表达";
    byId("studyMeaning").textContent = "";
    byId("studyNote").textContent = "已掌握的表达不会再显示。";
    byId("answerBox").classList.add("hidden");
    updateStats();
    return;
  }
  state.idx = (state.idx || 0) % arr.length;
  current = arr[state.idx++];
  save();
  byId("cardMeta").innerHTML = chip(current);
  byId("studyTerm").textContent = current.term;
  byId("studyMeaning").textContent = current.meaning;
  byId("studySpeakBtn").onclick = function(){speakEnglish(current.meaning);};
  byId("studyNote").textContent = current.note;
  byId("answerBox").classList.add("hidden");
  updateStats();
}
byId("showBtn").onclick = function(){byId("answerBox").classList.remove("hidden");};
byId("nextBtn").onclick = pickStudy;
byId("scope").onchange = function(){state.idx = 0; pickStudy(); renderWrong();};
byId("knowBtn").onclick = function(){if(current){markKnown(current.id); save(); pickStudy(); renderWrong(); renderReview(); renderList();}};
byId("dontKnowBtn").onclick = function(){if(current){state.wrong = [...new Set([...state.wrong,current.id])]; save(); pickStudy(); renderWrong(); updateStats(); renderList();}};

let quizCurrent = null;
let quizAutoTimer = null;
function optionMeaningsFor(card){
  let pool = uniqueByMeaning(CARDS.filter(function(w){return w.id !== card.id && w.meaning !== card.meaning && w.subject === card.subject;}));
  if(pool.length < 3) pool = uniqueByMeaning(CARDS.filter(function(w){return w.id !== card.id && w.meaning !== card.meaning;}));
  return sample([card.meaning].concat(sample(pool,3).map(function(w){return w.meaning;})),4);
}
function updateQuizActionButtons(){
  const disabled = !quizCurrent;
  byId("favQuizBtn").textContent = "未掌握";
  byId("knownQuizBtn").textContent = "已掌握";
  byId("favQuizBtn").disabled = disabled;
  byId("knownQuizBtn").disabled = disabled;
}
function startQuiz(){
  if(quizAutoTimer){clearTimeout(quizAutoTimer); quizAutoTimer = null;}
  const arr = practiceFiltered(byId("quizScope").value);
  if(arr.length < 1){
    quizCurrent = null;
    byId("quizTerm").textContent = "待测表达不足";
    byId("quizMeta").innerHTML = "已掌握的表达不会再显示。";
    byId("options").innerHTML = "";
    byId("quizFeedback").classList.add("hidden");
    updateQuizActionButtons();
    return;
  }
  quizCurrent = sample(arr,1)[0];
  byId("quizMeta").innerHTML = chip(quizCurrent);
  byId("quizTerm").textContent = quizCurrent.term;
  byId("options").innerHTML = "";
  byId("quizFeedback").classList.add("hidden");
  byId("quizFeedback").innerHTML = "";
  updateQuizActionButtons();
}
byId("startQuiz").onclick = startQuiz;
byId("favQuizBtn").onclick = function(){
  if(!quizCurrent) return;
  state.wrong = [...new Set([...state.wrong,quizCurrent.id])];
  state.known = state.known.filter(function(x){return x !== quizCurrent.id;});
  state.correctCounts[quizCurrent.id] = 0;
  delete state.review[quizCurrent.id];
  save();
  byId("quizFeedback").innerHTML = "英文：" + escapeHtml(quizCurrent.meaning) + " " + speakButton(quizCurrent.meaning);
  byId("quizFeedback").classList.remove("hidden");
  byId("quizMeta").innerHTML = chip(quizCurrent);
  renderWrong();
  renderList();
  renderReview();
  updateStats();
  quizAutoTimer = setTimeout(startQuiz, 1100);
};
byId("knownQuizBtn").onclick = function(){
  if(!quizCurrent) return;
  markKnown(quizCurrent.id);
  save();
  renderWrong();
  renderList();
  renderReview();
  updateStats();
  startQuiz();
};

let reviewCurrent = null;
function startReview(){
  const arr = dueReviewCards();
  if(!arr.length){
    reviewCurrent = null;
    byId("reviewTerm").textContent = "今天没有到期复习表达";
    byId("reviewMeta").innerHTML = "";
    byId("reviewOptions").innerHTML = "";
    byId("reviewFeedback").classList.add("hidden");
    renderReview();
    updateStats();
    return;
  }
  reviewCurrent = sample(arr,1)[0];
  byId("reviewMeta").innerHTML = chip(reviewCurrent);
  byId("reviewTerm").textContent = reviewCurrent.term;
  const opts = optionMeaningsFor(reviewCurrent);
  byId("reviewOptions").innerHTML = opts.map(function(o){return '<button class="option reviewOption">' + escapeHtml(o) + '</button>';}).join("");
  byId("reviewFeedback").classList.add("hidden");
  [...document.querySelectorAll(".reviewOption")].forEach(function(b){
    b.onclick = function(){
      const ok = b.textContent === reviewCurrent.meaning;
      [...document.querySelectorAll(".reviewOption")].forEach(function(x){x.disabled = true;});
      b.classList.add(ok ? "correct" : "wrong");
      if(ok){
        const r = reviewInfo(reviewCurrent.id) || {stage:0};
        const nextStage = Math.min((r.stage || 0) + 1, REVIEW_INTERVALS.length - 1);
        scheduleReview(reviewCurrent.id, nextStage);
        byId("reviewFeedback").innerHTML = "复习正确，下次间隔：" + REVIEW_INTERVALS[nextStage] + " 天。 " + speakButton(reviewCurrent.meaning);
        setTimeout(startReview, 900);
      } else {
        failReview(reviewCurrent.id);
        [...document.querySelectorAll(".reviewOption")].forEach(function(x){if(x.textContent === reviewCurrent.meaning)x.classList.add("correct");});
        byId("reviewFeedback").innerHTML = "复习错误，已放回错题本。正确答案：" + escapeHtml(reviewCurrent.meaning) + " " + speakButton(reviewCurrent.meaning);
      }
      byId("reviewFeedback").classList.remove("hidden");
      save();
      renderWrong();
      renderReview();
      updateStats();
      renderList();
    };
  });
}
function renderReview(){
  const arr = dueReviewCards();
  byId("reviewList").innerHTML = arr.length ? '<div class="small">今日到期 ' + arr.length + ' 张</div>' + arr.map(function(w){return '<div class="listItem">' + chip(w) + '<div><b>' + escapeHtml(w.term) + '</b></div><div>' + escapeHtml(w.meaning) + '</div>' + speakButton(w.meaning) + '</div>';}).join("") : '<div class="small">今天没有到期复习表达。</div>';
}
byId("startReview").onclick = startReview;

function renderWrong(){
  const arr = CARDS.filter(function(w){return state.wrong.includes(w.id);});
  byId("wrongList").innerHTML = arr.length ? arr.map(function(w){return '<div class="listItem">' + chip(w) + '<div><b>' + escapeHtml(w.term) + '</b></div><div>' + escapeHtml(w.meaning) + '</div>' + speakButton(w.meaning) + '<div class="small">' + escapeHtml(w.note) + '</div></div>';}).join("") : "暂无错题。";
}
byId("clearWrong").onclick = function(){state.wrong = []; save(); renderWrong(); updateStats(); renderList();};
byId("wrongQuizBtn").onclick = function(){
  openPanel("quiz", {scope:"wrong"});
};

function renderList(){
  const scope = byId("listScope").value;
  const kw = byId("search").value.trim().toLowerCase();
  const arr = filtered(scope).filter(function(w){return (w.term + " " + w.meaning + " " + w.subject + " " + w.unit + " " + w.code).toLowerCase().includes(kw);});
  byId("cardList").innerHTML = '<div class="small">显示 ' + arr.length + ' 张</div>' + arr.map(function(w){return '<div class="listItem">' + chip(w) + '<div><b>' + escapeHtml(w.term) + '</b></div><div>' + escapeHtml(w.meaning) + '</div>' + speakButton(w.meaning) + '<div class="small">' + escapeHtml(w.note) + '</div></div>';}).join("");
}
byId("search").oninput = renderList;
byId("listScope").onchange = renderList;
const PANEL_TITLES = {study:"背诵",quiz:"测验",review:"复习",wrong:"错题",list:"句表"};
function openPanel(tabName, opts){
  opts = opts || {};
  if(!PANEL_TITLES[tabName]) return;
  document.body.classList.remove("menu-view");
  document.body.classList.add("content-view");
  document.body.classList.toggle("study-view", tabName === "study");
  document.body.classList.toggle("quiz-view", tabName === "quiz");
  document.querySelectorAll(".tab,.panel").forEach(function(x){x.classList.remove("active");});
  const tab = document.querySelector('[data-tab="' + tabName + '"]');
  if(tab) tab.classList.add("active");
  byId(tabName).classList.add("active");
  byId("contentTitle").textContent = PANEL_TITLES[tabName];
  if(tabName === "study"){
    byId("scope").value = opts.scope || "all";
    state.idx = opts.keepPosition ? state.idx : state.idx || 0;
    pickStudy();
  }
  if(tabName === "quiz"){
    byId("quizScope").value = opts.scope || "all";
    startQuiz();
  }
  renderList();
  renderWrong();
  renderReview();
  updateStats();
}
function showMenu(){
  document.body.classList.add("menu-view");
  document.body.classList.remove("content-view","study-view","quiz-view");
  document.querySelectorAll(".tab,.panel").forEach(function(x){x.classList.remove("active");});
  if(quizAutoTimer){clearTimeout(quizAutoTimer); quizAutoTimer = null;}
  renderList();
  renderWrong();
  renderReview();
  updateStats();
}
document.querySelectorAll(".tab").forEach(function(t){
  t.onclick = function(){
    openPanel(t.dataset.tab);
  };
});
byId("backToMenu").onclick = showMenu;
document.addEventListener("click", function(e){
  const btn = e.target.closest("[data-speak]");
  if(btn){e.preventDefault(); speakEnglish(btn.dataset.speak);}
});
renderList();
renderWrong();
renderReview();
updateStats();
showMenu();

if("serviceWorker" in navigator){
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("./service-worker.js").catch(function(){});
  });
}
</script>
</body></html>
`;
}

function buildManifest() {
  return JSON.stringify({
    name: "SAT教学语言练习",
    short_name: "SAT教学语言",
    description: "SAT课堂表达背诵、测验、错题和间隔复习",
    start_url: "./index.html",
    display: "standalone",
    background_color: "#f7f7fb",
    theme_color: "#3157d5",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  }, null, 2);
}

function buildServiceWorker() {
  return `const CACHE_NAME = 'sat-teacher-language-pwa-v3';
const ASSETS = ['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
`;
}

const cards = readCards(sourcePath);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), buildIndex(cards), "utf8");
fs.writeFileSync(path.join(outDir, "manifest.json"), buildManifest(), "utf8");
fs.writeFileSync(path.join(outDir, "service-worker.js"), buildServiceWorker(), "utf8");

for (const icon of ["icon-192.png", "icon-512.png"]) {
  const src = path.join(workspace, "sat-vocab", icon);
  const dest = path.join(outDir, icon);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

console.log("Generated sat-teacher with " + cards.length + " cards at " + outDir);
