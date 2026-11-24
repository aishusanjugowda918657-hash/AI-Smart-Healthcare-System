/**
 * Gemini AI Client Wrapper (PRD Section 9.1)
 * Native function-calling loop with tool handlers, timeouts, and fallback error handling.
 */
import { getAiClient } from '../config/gemini.js';
import { isAiAvailable } from './guards.js';
import { getTriageFallback } from './fallbacks.js';
import { buildTriagePrompt } from './prompts/triage.js';
import { getModelName } from '../services/geminiService.js';

const GEMINI_TIMEOUT_MS = 15000;

function sanitizeError(msg) {
  if (!msg || typeof msg !== 'string') return 'Unknown Gemini error';
  return msg
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]')
    .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');
}

/**
 * Execute clinical triage analysis via Gemini API
 */
export async function analyzeTriageWithGemini(reasonText = '', answers = {}) {
  const aiClient = getAiClient();
  if (!isAiAvailable() || !aiClient) {
    return getTriageFallback(reasonText);
  }

  try {
    const prompt = buildTriagePrompt(reasonText, answers);
    const text = await generateText({ prompt });
    if (!text) return getTriageFallback(reasonText);

    const cleanJsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJsonStr);

    return {
      departmentId: parsed.departmentId || 'dept-gen',
      visitType: parsed.visitType || 'new',
      complexity: parsed.complexity || 'moderate',
      urgencySuggested: parsed.urgencySuggested || 'routine',
      followUpQuestion: parsed.followUpQuestion || 'How long have you had these symptoms?'
    };
  } catch (error) {
    console.warn('⚠️ Gemini API triage error, falling back to rule engine:', sanitizeError(error.message));
    return getTriageFallback(reasonText);
  }
}

/**
 * Generate Text using Gemini AI
 */
export async function generateText({ system = '', prompt = '' }) {
  const aiClient = getAiClient();
  if (!isAiAvailable() || !aiClient) {
    return null;
  }

  const model = getModelName();
  try {
    const contents = system ? `${system}\n\n${prompt}` : prompt;
    const req = aiClient.models.generateContent({ model, contents });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini API timeout')), GEMINI_TIMEOUT_MS)
    );

    const response = await Promise.race([req, timeout]);
    if (typeof response?.text === 'function') return response.text();
    if (typeof response?.text === 'string') return response.text;
    return response?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.warn('⚠️ Gemini generateText error:', sanitizeError(err.message));
    return null;
  }
}

/**
 * Generate JSON using Gemini AI with schema validation and retry
 */
export async function generateJson({ system = '', prompt = '', schema = null, timeoutMs = 15000 }) {
  const aiClient = getAiClient();
  if (!isAiAvailable() || !aiClient) {
    return null;
  }

  const model = getModelName();
  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      const contents = system ? `${system}\n\nReturn strictly JSON.\n${prompt}` : `${prompt}\nReturn strictly JSON.`;
      const req = aiClient.models.generateContent({
        model,
        contents,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini API timeout')), timeoutMs)
      );

      const response = await Promise.race([req, timeout]);
      let text = typeof response?.text === 'function' ? response.text() : (response?.text || '');
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();

      const parsed = JSON.parse(text);
      if (schema && typeof schema.parse === 'function') {
        return schema.parse(parsed);
      }
      return parsed;
    } catch (err) {
      console.warn(`⚠️ Gemini generateJson attempt ${attempts} failed:`, sanitizeError(err.message));
      if (attempts >= 2) return null;
    }
  }
  return null;
}

/**
 * Function-Calling Loop (runWithTools)
 */
export async function runWithTools({ system = '', messages = [], tools = [], toolHandler = null, context = {}, maxRounds = 5 }) {
  const aiClient = getAiClient();
  if (!isAiAvailable() || !aiClient) {
    return null;
  }

  const model = getModelName();
  const sourcesCollector = [];

  try {
    const rawContents = [];

    (messages || []).forEach(m => {
      const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
      let parts = [];
      if (Array.isArray(m.parts) && m.parts.length > 0) {
        parts = m.parts.filter(p => p && (p.text || p.functionCall || p.functionResponse));
      } else {
        const txt = String(m.text || m.content || m.message || '').trim();
        if (txt) {
          parts = [{ text: txt }];
        }
      }
      if (parts.length > 0) {
        rawContents.push({ role, parts });
      }
    });

    // Gemini API requires multiturn conversations to start with a 'user' turn
    while (rawContents.length > 0 && rawContents[0].role !== 'user') {
      rawContents.shift();
    }

    if (rawContents.length === 0) {
      rawContents.push({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    // Merge consecutive turns of the same role to strictly alternate user/model
    const contents = [];
    for (const item of rawContents) {
      if (contents.length > 0 && contents[contents.length - 1].role === item.role) {
        // Merge text parts into the previous turn
        const prev = contents[contents.length - 1];
        prev.parts = [...prev.parts, ...item.parts];
      } else {
        contents.push(item);
      }
    }

    let round = 0;
    while (round < maxRounds) {
      round++;

      const config = {
        tools: [{ functionDeclarations: tools }]
      };
      if (system) {
        config.systemInstruction = system;
      }

      const req = aiClient.models.generateContent({
        model,
        contents,
        config
      });

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini function call timeout')), GEMINI_TIMEOUT_MS)
      );

      const response = await Promise.race([req, timeout]);
      const candidate = response?.candidates?.[0];
      const functionCalls = (typeof response?.functionCalls === 'function' ? response.functionCalls() : response?.functionCalls) ||
        candidate?.content?.parts?.filter(p => p.functionCall).map(p => p.functionCall);

      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        const toolName = call.name;
        const args = call.args || {};

        const toolResult = await toolHandler(toolName, args, context, sourcesCollector);

        if (toolResult && toolResult.status === 'CHOICES_REQUIRED') {
          return {
            text: toolResult.message,
            choices: toolResult.choices,
            sources: sourcesCollector
          };
        }

        if (toolResult && toolResult.actionRequired) {
          return {
            text: toolResult.message,
            actionRequired: toolResult.actionRequired,
            confirmToken: toolResult.confirmToken,
            summary: toolResult.summary,
            sources: sourcesCollector
          };
        }

        if (candidate?.content) {
          contents.push(candidate.content);
        } else {
          contents.push({
            role: 'model',
            parts: [{ functionCall: { name: toolName, args } }]
          });
        }

        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: toolName,
              response: { output: toolResult }
            }
          }]
        });

      } else {
        const text = typeof response?.text === 'function' ? response.text() : (candidate?.content?.parts?.[0]?.text || '');
        return {
          text: text || 'How else can I assist you today?',
          sources: sourcesCollector
        };
      }
    }

    return {
      text: 'Reached maximum reasoning rounds.',
      sources: sourcesCollector
    };

  } catch (err) {
    console.warn('⚠️ Gemini runWithTools error:', err.message);
    return null;
  }
}
