/**
 * Help Library Search & Matching (PRD F14 – Chatbot Answer Quality)
 * 
 * Matching pipeline:
 *   1. Normalise input (lowercase, trim, strip punctuation)
 *   2. Exact keyword / synonym match
 *   3. Fuzzy match with edit distance ≤ 1
 *   4. If no match → return topic chips for disambiguation
 * 
 * Returns a formatted reply object:
 *   { matched: true/false, article, reply: { message, actionButtons, followUpChips, aiSource } }
 */

import enArticles from '../config/help/en.js';
import hiArticles from '../config/help/hi.js';
import knArticles from '../config/help/kn.js';
import taArticles from '../config/help/ta.js';

const LIBRARIES = {
  en: enArticles.articles || enArticles.default?.articles || enArticles,
  hi: hiArticles.articles || hiArticles.default?.articles || hiArticles,
  kn: knArticles.articles || knArticles.default?.articles || knArticles,
  ta: taArticles.articles || taArticles.default?.articles || taArticles
};

/* ────────────── normalisation helpers ────────────── */

function normalise(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[?!.,;:'"(){}[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenise(text) {
  return normalise(text).split(' ').filter(Boolean);
}

/* ────────────── edit distance (Levenshtein) ────────────── */

function editDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Quick length check – if difference > 1, skip full computation
  if (Math.abs(a.length - b.length) > 1) return 2;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(
        row[j] + 1,      // deletion
        prev + 1,         // insertion
        row[j - 1] + cost // substitution
      );
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'my', 'your', 'our', 'his', 'her', 'their',
  'i', 'me', 'we', 'us', 'you', 'he', 'she', 'it', 'they',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'about',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had',
  'how', 'what', 'where', 'when', 'why', 'who', 'which',
  'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might',
  'please', 'want', 'need', 'give', 'show', 'tell', 'get'
]);

/* ────────────── matching logic ────────────── */

/**
 * Score an article against a normalised query.
 * Returns { score, article } where higher score = better match.
 * score 0 = no match.
 */
function scoreArticle(article, queryNorm, queryTokens) {
  let score = 0;
  const allTerms = [
    ...(article.keywords || []),
    ...(article.synonyms || [])
  ].map(normalise);

  // 1. Exact full-phrase match
  for (const term of allTerms) {
    if (queryNorm === term) {
      score += 200;
    } else if (queryNorm.length > 3 && term.length > 3) {
      if (queryNorm.includes(term)) {
        score += 80 + Math.min(30, term.length * 2);
      } else if (term.includes(queryNorm)) {
        score += 60 + Math.min(30, queryNorm.length * 2);
      }
    }
  }

  // Meaningful query tokens (excluding stop words)
  const meaningfulTokens = queryTokens.filter(t => !STOP_WORDS.has(t) && t.length >= 2);
  const activeTokens = meaningfulTokens.length > 0 ? meaningfulTokens : queryTokens;

  // 2. Token-level matching
  let matchedTokens = 0;
  for (const qToken of activeTokens) {
    let tokenBestScore = 0;
    for (const term of allTerms) {
      const termTokens = term.split(' ');
      for (const tToken of termTokens) {
        if (tToken.length < 2) continue;
        if (qToken === tToken) {
          tokenBestScore = Math.max(tokenBestScore, 45);
        } else if (tToken.startsWith(qToken) && qToken.length >= 3) {
          tokenBestScore = Math.max(tokenBestScore, 30);
        } else if (qToken.length >= 4 && tToken.length >= 4) {
          const tClean = tToken.endsWith('s') ? tToken.slice(0, -1) : tToken;
          const qClean = qToken.endsWith('s') ? qToken.slice(0, -1) : qToken;
          if (editDistance(qToken, tToken) <= 1 || editDistance(qClean, tClean) <= 1) {
            tokenBestScore = Math.max(tokenBestScore, 45);
          }
        }
      }
    }
    if (tokenBestScore > 0) {
      score += tokenBestScore;
      matchedTokens++;
    }
  }

  // Multi-token match boost
  if (matchedTokens > 1 && matchedTokens === activeTokens.length) {
    score += 50;
  }

  // 3. Title match
  const titleNorm = normalise(article.title || '');
  for (const qToken of activeTokens) {
    if (qToken.length >= 3 && titleNorm.includes(qToken)) {
      score += 20;
    } else if (qToken.length >= 4 && titleNorm.split(' ').some(tt => editDistance(qToken, tt) <= 1)) {
      score += 15;
    }
  }

  return { score, article };
}

/* ────────────── format reply ────────────── */

function formatArticleReply(article) {
  const lines = [article.answer || ''];
  if (article.steps && article.steps.length > 0) {
    article.steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
  }
  return lines.join('\n');
}

/* ────────────── public API ────────────── */

/**
 * Search help library for a given user message.
 * @param {string} message – The user's raw message text
 * @param {string} language – 'en', 'hi', 'kn', 'ta'
 * @returns {{ matched: boolean, article?: object, reply: object }}
 */
export function searchHelp(message, language = 'en') {
  const lang = (language || 'en').split('-')[0]; // handle 'en-IN' → 'en'
  const articles = LIBRARIES[lang] || LIBRARIES.en;
  const queryNorm = normalise(message);
  const queryTokens = tokenise(message);

  if (!queryNorm || queryTokens.length === 0) {
    return { matched: false, reply: buildTopicChipsReply(articles, lang) };
  }

  // Score all articles
  const scored = articles
    .map(a => scoreArticle(a, queryNorm, queryTokens))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { matched: false, reply: buildTopicChipsReply(articles, lang) };
  }

  const best = scored[0];

  // Require a minimum score threshold to reduce false positives
  if (best.score < 40) {
    return { matched: false, reply: buildTopicChipsReply(articles, lang) };
  }

  const article = best.article;
  const replyText = formatArticleReply(article);

  return {
    matched: true,
    article,
    reply: {
      success: true,
      message: replyText,
      response: replyText.includes('Disclaimer:') ? replyText : `${replyText}\n\nDisclaimer: This is AI generated content.`,
      actionButtons: article.actionButtons || [],
      quickChips: (article.followUpChips || []).map(label => ({ label, action: 'TOPIC_CHIP' })),
      aiSource: 'help_library',
      language: lang
    }
  };
}

/**
 * Build a topic-chips fallback reply when no article matches.
 */
function buildTopicChipsReply(articles, lang) {
  const messages = {
    en: "I'm not sure I understood. Could you try one of these topics?",
    hi: 'मुझे समझ नहीं आया। क्या आप इनमें से कोई विषय चुन सकते हैं?',
    kn: 'ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ಈ ವಿಷಯಗಳಲ್ಲಿ ಒಂದನ್ನು ಪ್ರಯತ್ನಿಸಬಹುದೇ?',
    ta: 'புரியவில்லை. இந்த தலைப்புகளில் ஒன்றைத் தேர்வு செய்யவும்?'
  };

  const topicChips = articles.slice(0, 5).map(a => ({
    label: a.title,
    action: 'TOPIC_CHIP'
  }));

  const msg = messages[lang] || messages.en;

  return {
    success: true,
    message: msg,
    response: `${msg}\n\nDisclaimer: This is AI generated content.`,
    quickChips: topicChips,
    aiSource: 'topic_chips_fallback',
    language: lang
  };
}

/**
 * Get all article titles for a language (used for Gemini context grounding).
 */
export function getArticleSummaries(language = 'en') {
  const lang = (language || 'en').split('-')[0];
  const articles = LIBRARIES[lang] || LIBRARIES.en;
  return articles.map(a => ({
    id: a.id,
    title: a.title,
    answer: a.answer,
    steps: a.steps
  }));
}

export default { searchHelp, getArticleSummaries };
