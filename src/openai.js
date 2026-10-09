// OpenAI-compatible chat completions (Groq, OpenRouter, ...). Same contract
// as gemini.js: returns {answer, reason} or throws a short readable Error.

import { buildInstructions, normalizeOptions } from "./gemini.js";

export function buildChatRequest(question, model, { allowMultiple = true } = {}) {
  return {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: `${buildInstructions({ allowMultiple })}\nReply with only a JSON object: {"options": [{"label": "...", "correct": true}], "answer": "...", "reason": "..."}` },
      { role: "user", content: question },
    ],
  };
}

// Free models do not all support a JSON response mode, so accept a JSON
// object anywhere in the reply (bare, in a code fence, or after some text).
export function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function parseChatResponse(status, body) {
  if (status === 401 || status === 403) throw new Error("Invalid API key (check options)");
  if (status === 429) throw new Error("Free-tier quota reached, try again later");
  // Pollinations' keyless tier answers 402 once its short-term allowance is used up.
  if (status === 402) throw new LimitError("Free no-key limit reached: wait a minute, or add a free Gemini key");
  if (status < 200 || status >= 300) {
    throw new Error(body?.error?.message || `API error (HTTP ${status})`);
  }
  const text = body?.choices?.[0]?.message?.content;
  if (!text) throw new Error("The model returned an empty answer");
  const parsed = extractJson(text);
  if (!parsed) throw new Error("The model returned an unreadable answer");
  const answer = String(parsed.answer ?? "").trim();
  if (!answer) throw new Error("The model returned an empty answer");
  return { answer, reason: String(parsed.reason ?? "").trim(), options: normalizeOptions(parsed) };
}

// endpoint overrides baseUrl/chat/completions for services with another path;
// with no key, no Authorization header is sent (keyless services).
// retryOn402: {tries, delayMs} retries a 402 (the keyless tier's short-term
// limit, roughly one question per 30s) instead of failing straight away.
export async function askOpenAICompatible(question, apiKey, {
  baseUrl, endpoint, model, allowMultiple = true, fetchFn = fetch, retryOn402, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const tries = retryOn402?.tries ?? 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return await askOnce(question, apiKey, { baseUrl, endpoint, model, allowMultiple, fetchFn });
    } catch (err) {
      if (!(err instanceof LimitError) || attempt >= tries) throw err;
      await sleep(retryOn402.delayMs);
    }
  }
}

class LimitError extends Error {}

async function askOnce(question, apiKey, { baseUrl, endpoint, model, allowMultiple, fetchFn }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let res;
  try {
    res = await fetchFn(endpoint ?? `${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildChatRequest(question, model, { allowMultiple })),
    });
  } catch {
    throw new Error("Could not reach the API (network error)");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return parseChatResponse(res.status, body);
}
