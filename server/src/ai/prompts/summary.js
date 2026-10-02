/**
 * Pre-consultation Summary Prompt (PRD Section 9.3)
 */
export function buildSummaryPrompt(facts = {}) {
  return `Write one or two sentences for a doctor from the supplied facts only. Do not add, infer or diagnose.
Reply strictly as JSON with key "oneLine".

Supplied Facts:
${JSON.stringify(facts, null, 2)}`;
}
