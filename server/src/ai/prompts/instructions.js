/**
 * Prescription Instructions Prompt (PRD Section 9.3)
 */
export function buildInstructionsPrompt(prescriptionItems = [], language = 'en') {
  return `Rewrite these prescription items as plain, easy-to-read instructions in ${language}.
Do not change any dose, timing or duration.

Items:
${JSON.stringify(prescriptionItems, null, 2)}`;
}
