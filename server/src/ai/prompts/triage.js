/**
 * Clinical Triage Prompt Template for Gemini AI (PRD Section 9.1)
 */
export function buildTriagePrompt(reasonText = '', answers = {}) {
  return `You are a medical triage assistant for an AI-Smart Healthcare System.
Analyze the patient's complaint and return JSON ONLY matching the schema.

Patient Reason: "${reasonText}"
Answers: ${JSON.stringify(answers)}

Return valid JSON with:
{
  "departmentId": "dept-gen" | "dept-card" | "dept-ped" | "dept-ortho" | "dept-derm",
  "visitType": "new" | "followup" | "report_review" | "procedure",
  "complexity": "simple" | "moderate" | "complex",
  "urgencySuggested": "routine" | "urgent" | "emergency",
  "followUpQuestion": "string"
}`;
}
