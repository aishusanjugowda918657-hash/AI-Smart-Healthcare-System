/**
 * Explain Wait Time Prompt (PRD Section 9.3)
 */
export function buildExplainWaitPrompt(reasonText = '', language = 'en') {
  return `Rewrite this wait time reason in a friendly short sentence in ${language}. Do not change the meaning. Include no medical details.
Reason: "${reasonText}"`;
}
