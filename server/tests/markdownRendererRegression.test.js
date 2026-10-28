/**
 * markdownRendererRegression.test.js
 *
 * Regression tests confirming that Markdown markers (asterisks, backticks, hashes)
 * are cleanly parsed into structured formatting tokens without visible asterisks in rendered output,
 * and ordinary text remains strictly unchanged.
 */

import { describe, it, expect } from 'vitest';
import { tokenizeInline, parseMarkdownBlocks, stripMarkdown } from '../../client/src/utils/markdownParser.js';

describe('Markdown Renderer Regression Suite — Safe AI Response Formatting', () => {

  it('1. Parses **PATIENT:** into a bold token with zero asterisks', () => {
    const input = '**PATIENT:**';
    const tokens = tokenizeInline(input);

    expect(tokens.length).toBe(1);
    expect(tokens[0].type).toBe('bold');
    expect(tokens[0].value).toBe('PATIENT:');
    expect(tokens[0].value).not.toContain('*');

    const stripped = stripMarkdown(input);
    expect(stripped).toBe('PATIENT:');
    expect(stripped).not.toContain('*');
  });

  it('2. Parses **Priya Sharma** into a bold token with zero asterisks', () => {
    const input = '**Priya Sharma**';
    const tokens = tokenizeInline(input);

    expect(tokens.length).toBe(1);
    expect(tokens[0].type).toBe('bold');
    expect(tokens[0].value).toBe('Priya Sharma');
    expect(tokens[0].value).not.toContain('*');

    const stripped = stripMarkdown(input);
    expect(stripped).toBe('Priya Sharma');
    expect(stripped).not.toContain('*');
  });

  it('3. Parses **ANSWER:** into a bold token with zero asterisks', () => {
    const input = '**ANSWER:**';
    const tokens = tokenizeInline(input);

    expect(tokens.length).toBe(1);
    expect(tokens[0].type).toBe('bold');
    expect(tokens[0].value).toBe('ANSWER:');
    expect(tokens[0].value).not.toContain('*');

    const stripped = stripMarkdown(input);
    expect(stripped).toBe('ANSWER:');
    expect(stripped).not.toContain('*');
  });

  it('4. Leaves ordinary plain text unchanged', () => {
    const ordinary = 'No diagnosis is recorded in the available medical records for Priya Sharma.';
    const tokens = tokenizeInline(ordinary);

    expect(tokens.length).toBe(1);
    expect(tokens[0].type).toBe('text');
    expect(tokens[0].value).toBe(ordinary);

    const stripped = stripMarkdown(ordinary);
    expect(stripped).toBe(ordinary);
  });

  it('5. Correctly parses inline code block for Health ID', () => {
    const input = 'Health ID: `SCAI-2026-000011-P`';
    const tokens = tokenizeInline(input);

    expect(tokens.length).toBe(2);
    expect(tokens[0].type).toBe('text');
    expect(tokens[0].value).toBe('Health ID: ');
    expect(tokens[1].type).toBe('code');
    expect(tokens[1].value).toBe('SCAI-2026-000011-P');
    expect(tokens[1].value).not.toContain('`');

    const stripped = stripMarkdown(input);
    expect(stripped).toBe('Health ID: SCAI-2026-000011-P');
  });

  it('6. Parses full Patient Medical Record lookup answer with blocks, headings, lists, and bold items', () => {
    const fullLookupOutput = [
      '**PATIENT:**',
      '**Priya Sharma**',
      'Health ID: `SCAI-2026-000011-P`',
      '',
      '**ANSWER:**',
      'The available medical records show:',
      '- **Hypertension** (Profile Record)',
      '- **Acute Viral Pharyngitis** — recorded on 2026-10-27',
      '',
      '### Latest recorded diagnosis:',
      'Acute Viral Pharyngitis'
    ].join('\n');

    const blocks = parseMarkdownBlocks(fullLookupOutput);

    // Verify block sequence
    expect(blocks.length).toBe(8);

    // Block 0: Paragraph with **PATIENT:**
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].tokens[0].type).toBe('bold');
    expect(blocks[0].tokens[0].value).toBe('PATIENT:');

    // Block 1: Paragraph with **Priya Sharma**
    expect(blocks[1].type).toBe('paragraph');
    expect(blocks[1].tokens[0].type).toBe('bold');
    expect(blocks[1].tokens[0].value).toBe('Priya Sharma');

    // Block 2: Paragraph with Health ID code token
    expect(blocks[2].type).toBe('paragraph');
    const codeTok = blocks[2].tokens.find(t => t.type === 'code');
    expect(codeTok).toBeDefined();
    expect(codeTok.value).toBe('SCAI-2026-000011-P');

    // Block 3: Paragraph with **ANSWER:**
    expect(blocks[3].type).toBe('paragraph');
    expect(blocks[3].tokens[0].type).toBe('bold');
    expect(blocks[3].tokens[0].value).toBe('ANSWER:');

    // Block 4: Intro line
    expect(blocks[4].type).toBe('paragraph');
    expect(blocks[4].tokens[0].value).toBe('The available medical records show:');

    // Block 5: Bullet list with 2 items
    expect(blocks[5].type).toBe('bullet_list');
    expect(blocks[5].items.length).toBe(2);
    // Item 1: **Hypertension**
    expect(blocks[5].items[0][0].type).toBe('bold');
    expect(blocks[5].items[0][0].value).toBe('Hypertension');
    // Item 2: **Acute Viral Pharyngitis**
    expect(blocks[5].items[1][0].type).toBe('bold');
    expect(blocks[5].items[1][0].value).toBe('Acute Viral Pharyngitis');

    // Block 6: Heading level 3: Latest recorded diagnosis:
    expect(blocks[6].type).toBe('heading');
    expect(blocks[6].level).toBe(3);
    expect(blocks[6].tokens[0].value).toBe('Latest recorded diagnosis:');

    // Block 7: Paragraph with diagnosis value
    expect(blocks[7].type).toBe('paragraph');
    expect(blocks[7].tokens[0].value).toBe('Acute Viral Pharyngitis');

    // Entire stripped representation has NO markdown asterisks anywhere
    const stripped = stripMarkdown(fullLookupOutput);
    expect(stripped).not.toContain('**');
    expect(stripped).not.toContain('`');
    expect(stripped).not.toContain('###');
  });

  it('7. Handles multiple bold words and punctuation on a single line safely', () => {
    const input = 'Patient **Ravi Kumar** has allergies to **Penicillin** and **Dust**.';
    const tokens = tokenizeInline(input);

    const boldTokens = tokens.filter(t => t.type === 'bold');
    expect(boldTokens.length).toBe(3);
    expect(boldTokens[0].value).toBe('Ravi Kumar');
    expect(boldTokens[1].value).toBe('Penicillin');
    expect(boldTokens[2].value).toBe('Dust');

    // None of the bold tokens have asterisks
    boldTokens.forEach(t => expect(t.value).not.toContain('*'));
  });

  it('8. Treats potentially unsafe HTML tags as plain text safely without script injection', () => {
    const maliciousInput = '**ALERT:** <script>alert("hack")</script> <b>injected</b>';
    const tokens = tokenizeInline(maliciousInput);

    expect(tokens[0].type).toBe('bold');
    expect(tokens[0].value).toBe('ALERT:');

    const textToken = tokens.find(t => t.value.includes('<script>'));
    expect(textToken).toBeDefined();
    expect(textToken.type).toBe('text');
    // Content is preserved as raw text string (React JSX renders string literals safely without HTML execution)
    expect(textToken.value).toContain('<script>alert("hack")</script>');
  });

  it('9. Formats vital signs, allergies, and medicines without asterisks', () => {
    const vitals = 'BP: **120/80 mmHg**, Pulse: **72 bpm**, SpO2: **98%**';
    const tokens = tokenizeInline(vitals);
    const bolds = tokens.filter(t => t.type === 'bold').map(t => t.value);

    expect(bolds).toEqual(['120/80 mmHg', '72 bpm', '98%']);
    bolds.forEach(b => expect(b).not.toContain('*'));
  });

});
