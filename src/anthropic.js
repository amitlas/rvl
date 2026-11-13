// Claude through the Messages API (paid). Same contract as gemini.js:
// returns {answer, reason, options} or throws a short readable Error.

import { REQUEST_TIMEOUT_MS, buildInstructions, normalizeOptions } from "./gemini.js";

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    // Verdicts first, so the answer is written after every option was judged.
    options: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, correct: { type: "boolean" } },
        required: ["label", "correct"],
        additionalProperties: false,
      },
    },
    answer: { type: "string" },
    reason: { type: "string" },
  },
  required: ["options", "answer", "reason"],
  additionalProperties: false,
};

export function buildMessagesRequest(question, model, { allowMultiple = true } = {}) {
  return {
    model,
    max_tokens: 16000,
    system: buildInstructions({ allowMultiple }),
    messages: [{ role: "user", content: question }],
    // Thinking is always on for these models; low effort keeps a one-letter answer fast.
    output_config: { effort: "low", format: { type: "json_schema", schema: ANSWER_SCHEMA } },
  };
}

function parse(status, body) {
  if (status === 401) throw new Error("Invalid Claude API key (check options)");
  if (status < 200 || status >= 300) {
    throw new Error(body?.error?.message || `Claude error (HTTP ${status})`);
  }
  if (body?.stop_reason === "refusal") throw new Error("Claude declined to answer");
  const text = body?.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Claude returned an empty answer");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Claude returned an unreadable answer");
  }
  const answer = String(parsed?.answer ?? "").trim();
  if (!answer) throw new Error("Claude returned an empty answer");
  return { answer, reason: String(parsed?.reason ?? "").trim(), options: normalizeOptions(parsed) };
}

// Every error carries the HTTP status, which decides whether the model is frozen.
export function parseMessagesResponse(status, body) {
  try {
    return parse(status, body);
  } catch (err) {
    err.status = status;
    throw err;
  }
}

export async function askAnthropic(question, apiKey, { fetchFn = fetch, model, allowMultiple = true, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2026-10-21",
        // An extension request carries an Origin header; without this the API rejects it.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(buildMessagesRequest(question, model, { allowMultiple })),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("Could not reach Claude (network error)");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return parseMessagesResponse(res.status, body);
}
