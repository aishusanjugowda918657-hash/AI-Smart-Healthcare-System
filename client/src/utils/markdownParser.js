/**
 * markdownParser.js
 *
 * Lightweight, safe parser for markdown formatting in AI Assistant responses.
 * Parses markdown into structured tokens and blocks without any dangerous HTML.
 * Ensures asterisks (e.g., **PATIENT:**, **ANSWER:**) are cleanly rendered as bold elements
 * and never shown as raw symbols to users.
 */

/**
 * Tokenizes an inline string into segments of bold, italic, code, or plain text.
 * @param {string} text
 * @returns {Array<{ type: 'text'|'bold'|'italic'|'code', value: string }>}
 */
export function tokenizeInline(text) {
  if (!text) return [];

  // Match bold-italic (***text*** or ___text___), bold (**text** or __text__),
  // inline code (`code`), or italic (*text* or _text_)
  const regex = /(\*\*\*[^*]+\*\*\*|___[^_]+___|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  const parts = String(text).split(regex);
  const tokens = [];

  for (const part of parts) {
    if (!part) continue;

    // Bold + Italic: ***text*** or ___text___
    if ((part.startsWith('***') && part.endsWith('***') && part.length >= 6) ||
        (part.startsWith('___') && part.endsWith('___') && part.length >= 6)) {
      tokens.push({
        type: 'bold_italic',
        value: part.slice(3, -3)
      });
      continue;
    }

    // Bold: **text** or __text__
    if ((part.startsWith('**') && part.endsWith('**') && part.length >= 4) ||
        (part.startsWith('__') && part.endsWith('__') && part.length >= 4)) {
      tokens.push({
        type: 'bold',
        value: part.slice(2, -2)
      });
      continue;
    }

    // Inline code: `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      tokens.push({
        type: 'code',
        value: part.slice(1, -1)
      });
      continue;
    }

    // Italic: *text* or _text_
    if ((part.startsWith('*') && part.endsWith('*') && part.length >= 2 && !part.slice(1, -1).includes('*')) ||
        (part.startsWith('_') && part.endsWith('_') && part.length >= 2 && !part.slice(1, -1).includes('_'))) {
      tokens.push({
        type: 'italic',
        value: part.slice(1, -1)
      });
      continue;
    }

    // Plain text
    tokens.push({
      type: 'text',
      value: part
    });
  }

  return tokens;
}

/**
 * Strips all markdown syntax markers from text, returning pure human-readable text.
 * Useful for audio speech synthesis and regression assertion testing.
 * @param {string} text
 * @returns {string}
 */
export function stripMarkdown(text) {
  if (!text) return '';
  return String(text)
    // Strip bold-italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/___(.*?)___/g, '$1')
    // Strip bold
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    // Strip italic
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    // Strip inline code
    .replace(/`([^`]+)`/g, '$1')
    // Strip headers
    .replace(/^#{1,6}\s+/gm, '')
    // Strip bullet markers
    .replace(/^[\*\-\•]\s+/gm, '')
    // Strip numbered list markers
    .replace(/^\d+[\.\)]\s+/gm, '');
}

/**
 * Parses markdown into structured block elements (headings, bullet lists, numbered lists, paragraphs).
 * @param {string} text
 * @returns {Array<object>}
 */
export function parseMarkdownBlocks(text) {
  if (!text) return [];

  const rawLines = String(text).split('\n');
  const blocks = [];
  let currentList = null;

  const flushList = () => {
    if (currentList) {
      blocks.push(currentList);
      currentList = null;
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // 1. Empty lines -> separate paragraphs
    if (!trimmed) {
      flushList();
      continue;
    }

    // 2. Headings (#, ##, ###)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        tokens: tokenizeInline(headingMatch[2])
      });
      continue;
    }

    // 3. Bullet list items (- , * , • )
    const bulletMatch = trimmed.match(/^[\*\-\•]\s+(.*)$/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'bullet_list') {
        flushList();
        currentList = { type: 'bullet_list', items: [] };
      }
      currentList.items.push(tokenizeInline(bulletMatch[1]));
      continue;
    }

    // 4. Numbered list items (1. , 2. )
    const numberedMatch = trimmed.match(/^(\d+)[\.\)]\s+(.*)$/);
    if (numberedMatch) {
      if (!currentList || currentList.type !== 'numbered_list') {
        flushList();
        currentList = { type: 'numbered_list', items: [] };
      }
      currentList.items.push(tokenizeInline(numberedMatch[2]));
      continue;
    }

    // 5. Blockquote (> )
    const quoteMatch = trimmed.match(/^>\s*(.*)$/);
    if (quoteMatch) {
      flushList();
      blocks.push({
        type: 'blockquote',
        tokens: tokenizeInline(quoteMatch[1])
      });
      continue;
    }

    // 6. Regular paragraph line
    flushList();
    blocks.push({
      type: 'paragraph',
      tokens: tokenizeInline(trimmed)
    });
  }

  flushList();
  return blocks;
}
