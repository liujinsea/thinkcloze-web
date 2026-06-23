#!/usr/bin/env node
import fs from "node:fs";
import vm from "node:vm";

const RAW_PATH = "outputs/thinkcloze-vocab-options-20260623/vocab_question_options_raw.json";
const MERGED_PATH = "outputs/thinkcloze-vocab-options-20260623/vocab_question_options_merged.json";
const ZH_OVERRIDES_PATH = "outputs/thinkcloze-vocab-options-20260623/vocab_question_zh_overrides.json";
const EXCLUDED_SINGLE_OPTION_TERMS = new Set(["in", "to", "about", "for", "on", "by"]);
const PLURAL_NOUN_EXCEPTIONS = new Set([
  "news",
  "series",
  "species",
  "means",
  "headquarters",
  "crossroads",
  "mathematics",
  "physics",
  "economics",
  "politics",
  "ethics",
  "aesthetics",
  "linguistics",
]);
const VERB_LEMMA_OVERRIDES = new Map(Object.entries({
  absorbs: "absorb",
  adjusted: "adjust",
  advocated: "advocate",
  allocating: "allocate",
  allowed: "allow",
  altered: "alter",
  anticipated: "anticipate",
  anticipating: "anticipate",
  approved: "approve",
  argues: "argue",
  attributed: "attribute",
  authorized: "authorize",
  begins: "begin",
  breaks: "break",
  bulges: "bulge",
  categorizing: "categorize",
  characterizes: "characterize",
  complains: "complain",
  condensed: "condense",
  congratulating: "congratulate",
  consolidated: "consolidate",
  contradicted: "contradict",
  converted: "convert",
  corresponded: "correspond",
  corrected: "correct",
  created: "create",
  criticized: "criticize",
  decoupled: "decouple",
  defeating: "defeat",
  deferred: "defer",
  defined: "define",
  denotes: "denote",
  detected: "detect",
  discovered: "discover",
  discovers: "discover",
  distorting: "distort",
  distorts: "distort",
  employed: "employ",
  entrusted: "entrust",
  established: "establish",
  estimated: "estimate",
  evaluated: "evaluate",
  evolving: "evolve",
  examined: "examine",
  exceeding: "exceed",
  excluded: "exclude",
  exhibited: "exhibit",
  exposing: "expose",
  followed: "follow",
  forestalled: "forestall",
  forgets: "forget",
  forgotten: "forget",
  guaranteed: "guarantee",
  helps: "help",
  idealized: "idealize",
  imagined: "imagine",
  imposed: "impose",
  imitated: "imitate",
  inculcated: "inculcate",
  intermingled: "intermingle",
  investigated: "investigate",
  lauded: "laud",
  localized: "localize",
  loses: "lose",
  magnified: "magnify",
  mediated: "mediate",
  misinterpreted: "misinterpret",
  motivated: "motivate",
  neglected: "neglect",
  organized: "organize",
  overheard: "overhear",
  overlooked: "overlook",
  overturning: "overturn",
  pondered: "ponder",
  populated: "populate",
  predicts: "predict",
  predicated: "predicate",
  prepared: "prepare",
  prescribed: "prescribe",
  produces: "produce",
  prohibited: "prohibit",
  promoted: "promote",
  protested: "protest",
  punished: "punish",
  reacts: "react",
  recognized: "recognize",
  referred: "refer",
  reflected: "reflect",
  rejects: "reject",
  reinterpreted: "reinterpret",
  resisted: "resist",
  respected: "respect",
  reveals: "reveal",
  sanitized: "sanitize",
  scattered: "scatter",
  shifted: "shift",
  subverted: "subvert",
  transformed: "transform",
  trying: "try",
  undertaken: "undertake",
  underpinned: "underpin",
  varies: "vary",
  wearing: "wear",
}));

function readText(path) {
  return fs.readFileSync(path, "utf8");
}

function writeText(path, text) {
  fs.writeFileSync(path, text, "utf8");
}

function extractBalanced(text, marker, openChar, closeChar) {
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Marker not found: ${marker}`);
  const open = text.indexOf(openChar, start);
  if (open < 0) throw new Error(`Opening ${openChar} not found after ${marker}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let quote = "";
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === openChar) depth += 1;
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return { start: open, end: i + 1, text: text.slice(open, i + 1) };
    }
  }
  throw new Error(`Could not balance ${marker}`);
}

function extractArrayAfter(text, marker) {
  return JSON.parse(extractBalanced(text, marker, "[", "]").text);
}

function extractObjectLiteral(text, marker) {
  return JSON.parse(extractBalanced(text, marker, "{", "}").text);
}

function normalizeTerm(term) {
  return String(term || "")
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/^(?:a|an|the)\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:]$/, "");
}

function lemmaCandidates(term) {
  const normalized = normalizeTerm(term);
  const candidates = new Set([normalized]);
  const parts = normalized.split(" ");
  const first = parts[0] || "";
  const rest = parts.slice(1).join(" ");
  const add = (base) => {
    if (base && base.length > 1) candidates.add(rest ? `${base} ${rest}` : base);
  };
  if (first.endsWith("ies")) add(`${first.slice(0, -3)}y`);
  if (first.endsWith("ied")) add(`${first.slice(0, -3)}y`);
  if (first.endsWith("ing")) {
    add(first.slice(0, -3));
    add(`${first.slice(0, -3)}e`);
    if (/(.)\1ing$/.test(first)) add(first.slice(0, -4));
  }
  if (first.endsWith("ed")) {
    add(first.slice(0, -2));
    add(first.slice(0, -1));
    if (/(.)\1ed$/.test(first)) add(first.slice(0, -3));
  }
  if (first.endsWith("es")) add(first.slice(0, -2));
  if (first.endsWith("s") && !first.endsWith("ss")) add(first.slice(0, -1));
  return [...candidates];
}

function posKeyFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/^(vi|vt|v)\./.test(t)) return "v";
  if (/^n\./.test(t)) return "n";
  if (/^adj\./.test(t)) return "adj";
  if (/^adv\./.test(t)) return "adv";
  if (/^prep\./.test(t)) return "prep";
  return "";
}

function meaningHasNounPos(text) {
  return /^n(?:\.|\/)/i.test(String(text || "").trim());
}

function meaningHasVerbPos(text) {
  const value = String(text || "").trim();
  return /^(?:vi|vt|v)(?:\.|\/)/i.test(value) || /\/v\./i.test(value) || /^v\.\s+phr\./i.test(value);
}

function looksLikeVerbPhrase(term, definitionZh = "") {
  const normalized = normalizeTerm(term);
  const first = normalized.split(" ")[0] || "";
  return normalized.includes(" ") && /^短语\./.test(String(definitionZh || "").trim()) && VERB_LEMMA_OVERRIDES.has(first);
}

function looksLikePassiveInflectedPhrase(term, definitionZh = "") {
  const normalized = normalizeTerm(term);
  if (!normalized.includes(" ")) return false;
  const first = normalized.split(" ")[0] || "";
  const isPastParticiple = /(?:ed|en)$/.test(first) || ["undertaken", "forgotten", "overheard"].includes(first);
  if (!isPastParticiple) return false;
  return /\sby$/.test(normalized) || /(?:被|由……)/.test(String(definitionZh || ""));
}

function singularizeNounTerm(term) {
  const normalized = normalizeTerm(term);
  if (!normalized || normalized.includes(" ") || PLURAL_NOUN_EXCEPTIONS.has(normalized)) return normalized;
  if (!/^[a-z][a-z'-]*s$/i.test(normalized) || /(?:ss|us|is)$/.test(normalized)) return normalized;
  if (/[^aeiou]ies$/.test(normalized)) return `${normalized.slice(0, -3)}y`;
  if (/(?:sses|xes|zes|ches|shes)$/.test(normalized)) return normalized.slice(0, -2);
  if (/[^s]ses$/.test(normalized)) return normalized.slice(0, -1);
  return normalized.slice(0, -1);
}

function baseVerbWord(word) {
  const lower = String(word || "").toLowerCase();
  if (VERB_LEMMA_OVERRIDES.has(lower)) return VERB_LEMMA_OVERRIDES.get(lower);
  if (!/^[a-z][a-z'-]*$/i.test(lower) || /(?:ss|ous|is)$/.test(lower)) return lower;
  if (/[^aeiou]ies$/.test(lower)) return `${lower.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zzes|sses)$/.test(lower)) return lower.slice(0, -2);
  if (lower.endsWith("s")) return lower.slice(0, -1);
  if (lower.endsWith("ying")) return `${lower.slice(0, -4)}ie`;
  if (lower.endsWith("ing")) {
    let stem = lower.slice(0, -3);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem) && !/(ll|ss|zz)$/.test(stem)) stem = stem.slice(0, -1);
    if (/(?:at|iz|is|iv|os|pos|ak|ov)$/.test(stem)) return `${stem}e`;
    return stem;
  }
  if (lower.endsWith("ied")) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("ed") && !/(?:eed|ceed)$/.test(lower)) {
    let stem = lower.slice(0, -2);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem) && !/(ll|ss|zz)$/.test(stem)) stem = stem.slice(0, -1);
    if (/(?:at|iz|iv|ad|ud|clud|lud|crib|ov|ens|par|figur)$/.test(stem)) return `${stem}e`;
    return stem;
  }
  return lower;
}

function baseVerbTerm(term) {
  const normalized = normalizeTerm(term);
  if (!normalized) return normalized;
  const parts = normalized.split(" ");
  parts[0] = baseVerbWord(parts[0]);
  return parts.join(" ");
}

function canonicalizeOptionTerm(rowTerm, definitionZh = "", definitionEn = "") {
  if (looksLikePassiveInflectedPhrase(rowTerm, definitionZh)) return rowTerm;
  if (meaningHasVerbPos(definitionZh) || posKeyFromText(definitionEn) === "v" || looksLikeVerbPhrase(rowTerm, definitionZh)) {
    const base = baseVerbTerm(rowTerm);
    if (base && base !== normalizeTerm(rowTerm)) return base;
  }
  if (!meaningHasNounPos(definitionZh) && posKeyFromText(definitionEn) !== "n") return rowTerm;
  const singular = singularizeNounTerm(rowTerm);
  return singular && singular !== normalizeTerm(rowTerm) ? singular : rowTerm;
}

function inferPos(term, meaning = "") {
  const normalized = normalizeTerm(term);
  const fromMeaning = posKeyFromText(meaning);
  if (fromMeaning) return { posKey: fromMeaning, pos: `${fromMeaning}.` };
  if (/\s/.test(normalized)) return { posKey: "phr", pos: "phr." };
  if (/ly$/.test(normalized)) return { posKey: "adv", pos: "adv." };
  if (/(tion|sion|ment|ness|ity|ance|ence|ism|ship|age|or|er|ist|ure|tude|hood|ics|um|a|us)$/.test(normalized)) {
    return { posKey: "n", pos: "n." };
  }
  if (/(ous|ive|less|ful|able|ible|al|ial|ic|ical|ary|ory|ent|ant|ed)$/.test(normalized)) {
    return { posKey: "adj", pos: "adj." };
  }
  if (/(ate|ize|ise|ify|fy)$/.test(normalized)) return { posKey: "v", pos: "v." };
  return { posKey: "n", pos: "n." };
}

function noteChinese(note) {
  const match = String(note || "").match(/中文：(.+?)(?:；(?:原始写法|来源|出现次数|正确答案次数|释义来源)：|$)/);
  return match ? match[1].trim() : "";
}

function isPlaceholderDefinition(en, zh, note = "") {
  return /^Definition to review:/i.test(String(en || "").trim())
    || /^待补充释义/.test(String(zh || "").trim())
    || /释义来源：needs-review/.test(String(note || ""));
}

function stripPos(text) {
  const value = String(text || "").trim();
  if (/^(?:vi|vt|v|n|adj|adv|prep|phr)\.\s+(?!phr\.)(?!\/)/i.test(value)) {
    return value.replace(/^(?:vi|vt|v|n|adj|adv|prep|phr)\.\s*/i, "").trim();
  }
  return value;
}

function sourceMonth(source) {
  const match = String(source || "").match(/^(\d{4})年(\d{1,2})月/);
  if (!match) return "";
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`;
}

function sourceRef(row) {
  const month = sourceMonth(row.source);
  return `${month} ${row.questionCode}(${row.letter})`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function readZhOverrides() {
  if (!fs.existsSync(ZH_OVERRIDES_PATH)) return new Map();
  const payload = JSON.parse(readText(ZH_OVERRIDES_PATH));
  const entries = Array.isArray(payload) ? payload : payload.entries || [];
  return new Map(
    entries
      .map((entry) => [normalizeTerm(entry.term), String(entry.meaningZh || "").trim()])
      .filter(([, meaning]) => meaning && !/^待补充释义/.test(meaning)),
  );
}

function excludedReason(row) {
  const term = normalizeTerm(row.term);
  if (EXCLUDED_SINGLE_OPTION_TERMS.has(term)) {
    return "单独介词/功能词，疑似 OCR 缺词或非词汇题选项";
  }
  return "";
}

function getBarronWords() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readText("sat-words/SAT2020605A/barron3500.js"), context);
  return context.window.BARRON_3500_WORDS || [];
}

function buildDictionaries() {
  const wordsHtml = readText("sat-words/SAT2020605A/index.html");
  const vocabHtml = readText("sat-vocab/SAT2020605A/index.html");
  const existingVocab = extractArrayAfter(wordsHtml, "const VOCAB_QUESTION_WORDS =");
  const existingZh = extractObjectLiteral(vocabHtml, "const VOCAB_QUESTION_ZH =");
  const baseWords = extractArrayAfter(wordsHtml, "const BASE_WORDS =");
  const meaningEn = extractObjectLiteral(wordsHtml, "const MEANING_EN =");
  const barronWords = getBarronWords();

  const dictionaries = [];
  const add = (source, word, extra = {}) => {
    const key = normalizeTerm(word.term);
    if (!key) return;
    dictionaries.push({ key, source, word, ...extra });
  };

  existingVocab.forEach((word) => {
    const zh = existingZh[word.term] || noteChinese(word.note);
    if (isPlaceholderDefinition(word.meaning, zh, word.note)) return;
    add("existing", word, {
      en: word.meaning,
      zh,
      id: word.id,
      pos: word.pos,
      posKey: word.posKey,
    });
  });
  baseWords.forEach((word) => {
    add("base", word, {
      en: meaningEn[String(word.id)] || word.definitionEn || word.meaning,
      zh: word.meaning,
      pos: word.pos,
      posKey: word.posKey,
    });
  });
  barronWords.forEach((word) => {
    add("barron", word, {
      en: word.definitionEn || word.meaning,
      zh: word.meaningZh || word.meaning,
      pos: word.pos,
      posKey: word.posKey,
    });
  });

  const byKey = new Map();
  for (const item of dictionaries) {
    if (!byKey.has(item.key)) byKey.set(item.key, item);
  }
  return { existingVocab, existingZh, byKey };
}

function findDictionaryEntry(byKey, term) {
  for (const candidate of lemmaCandidates(term)) {
    if (byKey.has(candidate)) {
      const found = byKey.get(candidate);
      return { ...found, matchedKey: candidate, matchedByLemma: candidate !== normalizeTerm(term) };
    }
  }
  return null;
}

function buildMergedWords(raw, dictionaries, zhOverrides = new Map()) {
  const grouped = new Map();
  const auditRows = [];
  const excludedRows = [];
  const maxExistingId = Math.max(...dictionaries.existingVocab.map((word) => Number(word.id) || 0), 1000);
  let nextId = maxExistingId + 1;

  for (const row of raw.optionRows) {
    const reason = excludedReason(row);
    if (reason) {
      const excluded = {
        ...row,
        canonicalTerm: row.term,
        definitionStatus: "excluded",
        englishMeaning: "",
        chineseMeaning: "",
        exclusionReason: reason,
      };
      excludedRows.push(excluded);
      auditRows.push(excluded);
      continue;
    }
    const found = findDictionaryEntry(dictionaries.byKey, row.term);
    const preliminaryTerm = found?.word?.term || row.term;
    const preliminaryKey = normalizeTerm(preliminaryTerm);
    const rowKey = normalizeTerm(row.term);
    const preliminaryOverrideZh = zhOverrides.get(preliminaryKey) || zhOverrides.get(rowKey) || "";
    const preliminaryZh = preliminaryOverrideZh || found?.zh || "";
    const canonicalTerm = canonicalizeOptionTerm(preliminaryTerm, preliminaryZh, found?.en);
    const key = normalizeTerm(canonicalTerm);
    const overrideZh = zhOverrides.get(key) || zhOverrides.get(preliminaryKey) || zhOverrides.get(rowKey) || "";
    if (!grouped.has(key)) {
      const en = found?.en || `Definition to review: ${canonicalTerm}`;
      const zh = overrideZh || found?.zh || `待补充释义：${row.term}`;
      const posInfo = inferPos(canonicalTerm, en || zh);
      grouped.set(key, {
        term: canonicalTerm,
        id: found?.source === "existing" ? found.id : nextId++,
        question: row.questionCode,
        meaning: en,
        meaningZh: zh,
        pos: found?.pos || posInfo.pos,
        posKey: found?.posKey || posInfo.posKey,
        priority: found?.source === "existing" ? !!found.word.priority : false,
        definitionSource: found ? found.source : (overrideZh ? "manual-zh" : "needs-review"),
        matchedByLemma: !!found?.matchedByLemma,
        occurrences: [],
        originalForms: new Set(),
      });
    }
    const entry = grouped.get(key);
    entry.occurrences.push(row);
    entry.originalForms.add(row.originalChoice);
      auditRows.push({
        ...row,
        canonicalTerm,
        definitionStatus: found ? (found.matchedByLemma ? `matched by lemma: ${found.source}` : `matched: ${found.source}`) : (overrideZh ? "manual zh supplied" : "needs definition review"),
        englishMeaning: found?.en || `Definition to review: ${canonicalTerm}`,
        chineseMeaning: overrideZh || found?.zh || `待补充释义：${row.term}`,
      });
  }

  const words = [...grouped.values()]
    .sort((a, b) => {
      const firstA = a.occurrences[0];
      const firstB = b.occurrences[0];
      return firstA.questionCode.localeCompare(firstB.questionCode) || a.term.localeCompare(b.term);
    })
    .map((entry) => {
      const refs = entry.occurrences.map(sourceRef);
      const sources = uniqueSorted(entry.occurrences.map((row) => row.source));
      const originals = uniqueSorted([...entry.originalForms]);
      const correctionNotes = uniqueSorted(entry.occurrences.map((row) => row.correctionNote));
      const zhNoPos = stripPos(entry.meaningZh);
      const reviewStatus = /^待补充释义/.test(entry.meaningZh) ? "needs-definition" : "ready";
      const noteParts = [
        `中文：${zhNoPos || entry.meaningZh}`,
        `原始写法：${originals.join("；")}`,
        `来源：${refs.join("；")}`,
        `出现次数：${entry.occurrences.length}`,
        `释义来源：${entry.definitionSource}${entry.matchedByLemma ? "（词形匹配）" : ""}`,
      ];
      if (correctionNotes.length) noteParts.push(`修正说明：${correctionNotes.join("；")}`);
      return {
        id: entry.id,
        question: entry.question,
        term: entry.term,
        meaning: entry.meaning,
        note: noteParts.join("；"),
        priority: entry.priority,
        pos: entry.pos,
        posKey: entry.posKey,
        meaningZh: entry.meaningZh,
        definitionSource: entry.definitionSource,
        matchedByLemma: entry.matchedByLemma,
        count: entry.occurrences.length,
        reviewStatus,
        sourceRefs: refs,
        originalForms: originals,
        sources,
        correctionNotes,
      };
    });

  return { words, auditRows, excludedRows };
}

function replaceRange(text, marker, openChar, closeChar, replacement) {
  const range = extractBalanced(text, marker, openChar, closeChar);
  return `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`;
}

function upsertConstArrayAfter(text, constName, jsonArray, afterMarker, afterOpenChar, afterCloseChar) {
  const marker = `const ${constName} =`;
  if (text.includes(marker)) {
    return replaceRange(text, marker, "[", "]", jsonArray);
  }
  const afterRange = extractBalanced(text, afterMarker, afterOpenChar, afterCloseChar);
  const semicolon = text.indexOf(";", afterRange.end);
  const insertAt = semicolon >= 0 ? semicolon + 1 : afterRange.end;
  return `${text.slice(0, insertAt)}\nconst ${constName} = ${jsonArray};${text.slice(insertAt)}`;
}

function replaceVocabQuestionsBlock(text, words) {
  const marker = '"词汇题":';
  const start = text.indexOf(marker);
  if (start < 0) throw new Error("Chinese vocab list block not found");
  const open = text.indexOf("{", start);
  const block = extractBalanced(text.slice(open), "", "{", "}");
  const absoluteStart = open + block.start;
  const absoluteEnd = open + block.end;
  const replacement = `{\n    label: "词汇题",\n    title: "SAT 词汇题选项",\n    description: "${words.length} 个从 SAT Words in Context 题目选项中整理的词和短语。",\n    words: ${JSON.stringify(words.map(siteWordZh), null, 4).replace(/\n/g, "\n    ")}\n  }`;
  return `${text.slice(0, absoluteStart)}${replacement}${text.slice(absoluteEnd)}`;
}

function siteWordEn(word) {
  return {
    id: word.id,
    question: word.question,
    term: word.term,
    meaning: word.meaning,
    note: word.note.replace(/^中文：.+?；/, ""),
    priority: word.priority,
    pos: word.pos,
    posKey: word.posKey,
    reviewStatus: word.reviewStatus,
    definitionSource: word.definitionSource,
    count: word.count,
    sources: word.sources,
    sourceRefs: word.sourceRefs,
    originalForms: word.originalForms,
    correctionNotes: word.correctionNotes,
  };
}

function siteWordZh(word) {
  return {
    id: word.id,
    question: word.question,
    term: word.term,
    meaning: word.meaning,
    note: word.note,
    priority: word.priority,
    reviewStatus: word.reviewStatus,
    definitionSource: word.definitionSource,
    count: word.count,
    sources: word.sources,
    sourceRefs: word.sourceRefs,
    originalForms: word.originalForms,
    correctionNotes: word.correctionNotes,
  };
}

function auditExcludedRow(row) {
  return {
    source: row.source,
    questionLabel: row.questionLabel,
    questionCode: row.questionCode,
    letter: row.letter,
    originalChoice: row.originalChoice,
    term: row.term,
    sourceFile: row.sourceFile.split("/").pop(),
    reason: row.exclusionReason,
  };
}

function updateSatWords(words, excludedRows) {
  let text = readText("sat-words/SAT2020605A/index.html");
  text = replaceRange(text, "const VOCAB_QUESTION_WORDS =", "[", "]", JSON.stringify(words.map(siteWordEn)));
  text = upsertConstArrayAfter(
    text,
    "VOCAB_QUESTION_EXCLUDED",
    JSON.stringify(excludedRows.map(auditExcludedRow)),
    "const VOCAB_QUESTION_WORDS =",
    "[",
    "]",
  );
  text = text.replace(
    /description: "\d+ answer-choice words collected from SAT Words in Context questions\."/,
    `description: "${words.length} answer-choice words collected from SAT Words in Context questions."`,
  );
  writeText("sat-words/SAT2020605A/index.html", text);
}

function updateSatVocab(words, excludedRows) {
  let text = readText("sat-vocab/SAT2020605A/index.html");
  text = replaceVocabQuestionsBlock(text, words);
  const zhMap = Object.fromEntries(words.map((word) => [word.term, word.meaningZh]));
  text = replaceRange(text, "const VOCAB_QUESTION_ZH =", "{", "}", JSON.stringify(zhMap, null, 2));
  text = upsertConstArrayAfter(
    text,
    "VOCAB_QUESTION_EXCLUDED",
    JSON.stringify(excludedRows.map(auditExcludedRow), null, 2),
    "const VOCAB_QUESTION_ZH =",
    "{",
    "}",
  );
  writeText("sat-vocab/SAT2020605A/index.html", text);
}

function updateIndexCards(count) {
  for (const path of ["sat-words/index.html", "sat-vocab/index.html"]) {
    let text = readText(path);
    text = text.replace(/\d+ answer-choice words collected from SAT Words in Context questions\./g, `${count} answer-choice words collected from SAT Words in Context questions.`);
    text = text.replace(/\d+ 个从 SAT 词汇题选项中整理的词和短语。/g, `${count} 个从 SAT 词汇题选项中整理的词和短语。`);
    text = text.replace(/\d+ 个从 SAT 词汇题选项中整理的词和短语，包含词性和中文释义审校标记。/g, `${count} 个从 SAT 词汇题选项中整理的词和短语，包含词性和中文释义审校标记。`);
    text = text.replace(/\d+ 个词和短语，包含筛选后的词汇题选项、词性和中文释义。/g, `${count} 个从 SAT 词汇题选项中整理的词和短语，包含词性和中文释义审校标记。`);
    writeText(path, text);
  }
}

function bumpServiceWorker(path) {
  let text = readText(path);
  text = text.replace(/(CACHE_NAME\s*=\s*['"][^'"]*?v)(\d+)(['"])/, (_, prefix, version, suffix) => `${prefix}${Number(version) + 1}${suffix}`);
  writeText(path, text);
}

function main() {
  const raw = JSON.parse(readText(RAW_PATH));
  const dictionaries = buildDictionaries();
  const zhOverrides = readZhOverrides();
  const { words, auditRows, excludedRows } = buildMergedWords(raw, dictionaries, zhOverrides);
  const bySource = words.reduce((acc, word) => {
    acc[word.definitionSource] = (acc[word.definitionSource] || 0) + 1;
    return acc;
  }, {});

  const merged = {
    stats: {
      ...raw.stats,
      mergedWords: words.length,
      definitionSources: bySource,
      needsDefinitionReview: bySource["needs-review"] || 0,
      excludedOptionRows: excludedRows.length,
      excludedUniqueTerms: uniqueSorted(excludedRows.map((row) => row.term)).length,
    },
    selectedSources: raw.selectedSources,
    words,
    excludedRows,
    auditRows,
  };
  fs.mkdirSync("outputs/thinkcloze-vocab-options-20260623", { recursive: true });
  writeText(MERGED_PATH, JSON.stringify(merged, null, 2));

  updateSatWords(words, excludedRows);
  updateSatVocab(words, excludedRows);
  updateIndexCards(words.length);
  bumpServiceWorker("sat-words/SAT2020605A/service-worker.js");
  bumpServiceWorker("sat-vocab/SAT2020605A/service-worker.js");
  bumpServiceWorker("sat-words/service-worker.js");
  bumpServiceWorker("sat-vocab/service-worker.js");

  console.log(JSON.stringify(merged.stats, null, 2));
}

main();
