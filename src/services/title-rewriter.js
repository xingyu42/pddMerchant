import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

let _forbiddenWords = null;
let _synonymMap = null;

function loadForbiddenWords(custom) {
  if (custom) return new Set(custom);
  if (!_forbiddenWords) {
    const raw = JSON.parse(readFileSync(join(DATA_DIR, 'forbidden-words.json'), 'utf-8'));
    _forbiddenWords = new Set(raw);
  }
  return _forbiddenWords;
}

function loadSynonymMap(custom) {
  if (custom) return custom;
  if (!_synonymMap) {
    _synonymMap = JSON.parse(readFileSync(join(DATA_DIR, 'synonyms.json'), 'utf-8'));
  }
  return _synonymMap;
}

function segmentChinese(text) {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  return [...segmenter.segment(text)]
    .filter(s => s.isWordLike)
    .map(s => s.segment);
}

function removeForbiddenFromText(text, forbidden) {
  // Sort by length desc so longer phrases match first
  const phrases = [...forbidden].sort((a, b) => b.length - a.length);
  const removed = [];
  let result = text;
  for (const phrase of phrases) {
    if (result.includes(phrase)) {
      removed.push(phrase);
      result = result.split(phrase).join('');
    }
  }
  return { text: result, removed };
}

function removeForbidden(tokens, forbidden) {
  const removed = [];
  const filtered = tokens.filter(t => {
    if (forbidden.has(t)) {
      removed.push(t);
      return false;
    }
    return true;
  });
  return { tokens: filtered, removed };
}

function applySynonyms(tokens, synonymMap, random = Math.random) {
  return tokens.map(t => {
    const alts = synonymMap[t];
    if (alts && alts.length > 0) {
      return alts[Math.floor(random() * alts.length)];
    }
    return t;
  });
}

function extractCategoryTokens(categoryPath) {
  if (!categoryPath) return new Set();
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  return new Set(
    [...segmenter.segment(categoryPath)]
      .filter(s => s.isWordLike && s.segment.length > 1)
      .map(s => s.segment)
  );
}

export async function rewriteTitle(source, options = {}) {
  const {
    categoryPath,
    forbiddenWords: customForbidden,
    synonymMap: customSynonyms,
    maxLength = 60,
    llmRewrite,
    log,
    random = Math.random,
  } = options;

  const originalTitle = source.goodsName || '';
  if (!originalTitle.trim()) {
    return {
      originalTitle, title: '', changed: false,
      removedForbiddenWords: [], preservedCategoryTokens: [],
      warnings: ['empty_title'], method: 'fallback',
    };
  }

  if (llmRewrite) {
    try {
      const result = await llmRewrite({ goodsName: originalTitle, categoryPath });
      if (result?.title && result.title !== originalTitle) {
        return {
          originalTitle, title: result.title.slice(0, maxLength),
          changed: true, removedForbiddenWords: [],
          preservedCategoryTokens: [], warnings: [],
          method: 'llm',
        };
      }
    } catch (err) {
      if (log) log.warn({ err: err?.message }, 'title-rewriter: LLM fallback to local');
    }
  }

  const forbidden = loadForbiddenWords(customForbidden);
  const synonyms = loadSynonymMap(customSynonyms);
  const categoryTokens = extractCategoryTokens(categoryPath);

  // Phrase-level forbidden removal on raw string (handles multi-char phrases)
  const { text: cleanText, removed } = removeForbiddenFromText(originalTitle, forbidden);

  const tokens = segmentChinese(cleanText);
  const rewritten = applySynonyms(tokens, synonyms, random);

  const preserved = rewritten.filter(t => categoryTokens.has(t));

  let title = rewritten.join('');
  if (title.length > maxLength) title = title.slice(0, maxLength);

  if (!title.trim()) {
    return {
      originalTitle, title: originalTitle, changed: false,
      removedForbiddenWords: removed, preservedCategoryTokens: preserved,
      warnings: ['rewrite_produced_empty_title'], method: 'fallback',
    };
  }

  const changed = title !== originalTitle;

  return {
    originalTitle,
    title,
    changed,
    removedForbiddenWords: removed,
    preservedCategoryTokens: preserved,
    warnings: [],
    method: 'local',
  };
}

export { segmentChinese, removeForbidden, applySynonyms };
