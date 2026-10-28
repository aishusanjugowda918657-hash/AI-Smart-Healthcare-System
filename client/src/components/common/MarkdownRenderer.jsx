import React from 'react';
import { parseMarkdownBlocks } from '../../utils/markdownParser';

/**
 * Helper to render inline tokens safely without innerHTML.
 */
function renderInlineTokens(tokens, parentKey = 'tok') {
  if (!tokens || tokens.length === 0) return null;

  return tokens.map((token, index) => {
    const key = `${parentKey}-${index}`;

    switch (token.type) {
      case 'bold':
        return (
          <strong key={key} className="font-bold text-slate-900">
            {token.value}
          </strong>
        );

      case 'bold_italic':
        return (
          <strong key={key} className="font-bold italic text-slate-900">
            {token.value}
          </strong>
        );

      case 'italic':
        return (
          <em key={key} className="italic text-slate-800">
            {token.value}
          </em>
        );

      case 'code':
        return (
          <code
            key={key}
            className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[11px] text-teal-800 border border-slate-200"
          >
            {token.value}
          </code>
        );

      case 'text':
      default:
        return <React.Fragment key={key}>{token.value}</React.Fragment>;
    }
  });
}

/**
 * MarkdownRenderer component
 *
 * Safely renders markdown responses without using dangerouslySetInnerHTML.
 * Cleanly transforms Markdown syntax (such as **PATIENT:**, **ANSWER:**, lists, code)
 * into rich, accessible React elements without visible raw markdown symbols.
 *
 * @param {object} props
 * @param {string} props.content - Markdown string to render
 * @param {string} [props.className] - Optional custom CSS classes
 */
export function MarkdownRenderer({ content, className = '' }) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const blocks = parseMarkdownBlocks(content);

  return (
    <div className={`space-y-1.5 text-xs text-slate-800 leading-relaxed ${className}`}>
      {blocks.map((block, index) => {
        const blockKey = `blk-${index}`;

        switch (block.type) {
          case 'heading': {
            if (block.level === 1) {
              return (
                <h2 key={blockKey} className="text-sm font-bold text-slate-900 mt-2 mb-1">
                  {renderInlineTokens(block.tokens, blockKey)}
                </h2>
              );
            }
            if (block.level === 2) {
              return (
                <h3 key={blockKey} className="text-xs font-bold text-slate-900 mt-1.5 mb-0.5">
                  {renderInlineTokens(block.tokens, blockKey)}
                </h3>
              );
            }
            return (
              <h4 key={blockKey} className="text-xs font-bold text-slate-800 mt-1 mb-0.5">
                {renderInlineTokens(block.tokens, blockKey)}
              </h4>
            );
          }

          case 'bullet_list':
            return (
              <ul key={blockKey} className="list-disc list-inside space-y-1 my-1 pl-1">
                {block.items.map((itemTokens, itemIdx) => (
                  <li key={`${blockKey}-item-${itemIdx}`} className="text-slate-700">
                    {renderInlineTokens(itemTokens, `${blockKey}-item-${itemIdx}`)}
                  </li>
                ))}
              </ul>
            );

          case 'numbered_list':
            return (
              <ol key={blockKey} className="list-decimal list-inside space-y-1 my-1 pl-1">
                {block.items.map((itemTokens, itemIdx) => (
                  <li key={`${blockKey}-item-${itemIdx}`} className="text-slate-700">
                    {renderInlineTokens(itemTokens, `${blockKey}-item-${itemIdx}`)}
                  </li>
                ))}
              </ol>
            );

          case 'blockquote':
            return (
              <blockquote
                key={blockKey}
                className="border-l-2 border-teal-500 pl-2.5 py-1 text-slate-600 italic my-1 bg-slate-50 rounded-r"
              >
                {renderInlineTokens(block.tokens, blockKey)}
              </blockquote>
            );

          case 'paragraph':
          default:
            return (
              <p key={blockKey} className="my-1">
                {renderInlineTokens(block.tokens, blockKey)}
              </p>
            );
        }
      })}
    </div>
  );
}

export default MarkdownRenderer;
