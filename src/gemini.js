// Talks to the Gemini API (free tier). Pure functions plus one fetch call,
// with fetch injectable so tests never touch the network.

export const DEFAULT_MODEL = "gemini-flash-latest";
export const MAX_QUESTION_CHARS = 8000;

const BASE_INSTRUCTIONS = `You are given a multiple-choice question that a user selected on a web page.
It may be in Hebrew, English, or another language, and the selection may include extra page text around it.
First fill "options": one entry per option, in the order shown, with its "label" and "correct" true or false.
Judge each option on its own against established textbook knowledge, not by comparing it with the others.
Then build "answer" only from the options you marked correct.
Return "answer" as the option's label exactly as written (for example "B", "3" or "ג").
If the options have no labels, return the start of the correct option's text instead.
Return "reason" as one short sentence, in the question's language, explaining why.
If the text is not a multiple-choice question, return "answer": "?" and say so in "reason".`;

const SINGLE = "Find the single correct option.";
// Multiple answers are allowed, never required: one correct option stays the
// expected case, and the model lists more only when more are truly correct.
const MULTIPLE = `Check every option on its own, as true or false. One or two options may be correct,
even when the question does not say so (for example a single "Answer" field).
If exactly two options are true, return both labels in "answer", separated by ", " (for example "A, C").
If only one is true, return only that one. Never return more than two.`;

export function buildInstructions({ allowMultiple = true } = {}) {
  return `${allowMultiple ? MULTIPLE : SINGLE}\n${BASE_INSTRUCTIONS}`;
}

export function buildRequest(question, { allowMultiple = true } = {}) {
  return {
    systemInstruction: { parts: [{ text: buildInstructions({ allowMultiple }) }] },
    contents: [{ role: "user", parts: [{ text: question }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          options: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { label: { type: "STRING" }, correct: { type: "BOOLEAN" } },
              required: ["label", "correct"],
            },
          },
          answer: { type: "STRING" },
          reason: { type: "STRING" },
        },
        // Verdicts first, so the answer is written after every option was judged.
        propertyOrdering: ["options", "answer", "reason"],
        required: ["options", "answer", "reason"],
      },
    },
  };
}

export function cleanQuestion(text) {
  const trimmed = String(text ?? "").replace(/\r\n/g, "\n").trim();
  return trimmed.slice(0, MAX_QUESTION_CHARS);
}

// Turns a Gemini HTTP status + JSON body into {answer, reason}, or throws an
// Error whose message is short enough to show in the on-page box.
export function parseResponse(status, body) {
  if (status === 429) {
    throw new Error("Gemini free-tier quota reached, try again later");
  }
  if (status === 400 || status === 401 || status === 403) {
    const msg = body?.error?.message || `HTTP ${status}`;
    if (/api key/i.test(msg)) throw new Error("Invalid Gemini API key (check options)");
    throw new Error(msg);
  }
  if (status < 200 || status >= 300) {
    throw new Error(body?.error?.message || `Gemini error (HTTP ${status})`);
  }
  if (body?.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request (${body.promptFeedback.blockReason})`);
  }
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned an empty answer");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned an unreadable answer");
  }
  const answer = String(parsed?.answer ?? "").trim();
  if (!answer) throw new Error("Gemini returned an empty answer");
  return { answer, reason: String(parsed?.reason ?? "").trim(), options: normalizeOptions(parsed) };
}

// [{label, correct}] from a parsed reply; [] when missing or malformed.
export function normalizeOptions(parsed) {
  if (!Array.isArray(parsed?.options)) return [];
  return parsed.options
    .filter((o) => o && String(o.label ?? "").trim())
    .map((o) => ({ label: String(o.label).trim(), correct: o.correct === true }));
}

export async function askGemini(question, apiKey, { fetchFn = fetch, model = DEFAULT_MODEL, allowMultiple = true } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let res;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildRequest(question, { allowMultiple })),
    });
  } catch {
    throw new Error("Could not reach Gemini (network error)");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return parseResponse(res.status, body);
}
