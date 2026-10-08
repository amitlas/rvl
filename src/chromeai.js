// Chrome's built-in on-device model (Gemini Nano, Prompt API). No key, no
// quota, but smaller and less accurate than the cloud models, and only on
// machines Chrome supports. The LanguageModel global is injectable for tests.

import { buildInstructions, normalizeOptions } from "./gemini.js";

const SCHEMA = {
  type: "object",
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, correct: { type: "boolean" } },
        required: ["label", "correct"],
      },
    },
    answer: { type: "string" },
    reason: { type: "string" },
  },
  required: ["options", "answer", "reason"],
};

const NEEDS_KEY = "add a free API key in rvl options";

export async function chromeAIStatus(LM = globalThis.LanguageModel) {
  if (!LM) return "unsupported";
  try {
    return await LM.availability();
  } catch {
    return "unavailable";
  }
}

export async function askChromeAI(question, { allowMultiple = true, LM = globalThis.LanguageModel } = {}) {
  const status = await chromeAIStatus(LM);
  if (status === "unsupported" || status === "unavailable") {
    throw new Error(`Chrome built-in AI is not available on this computer, ${NEEDS_KEY}`);
  }
  if (status !== "available") {
    // "downloadable" / "downloading": the download needs a click, which the
    // options page provides.
    throw new Error(`Chrome built-in AI model is not downloaded yet: open rvl options, or ${NEEDS_KEY}`);
  }
  const session = await LM.create({
    initialPrompts: [{ role: "system", content: buildInstructions({ allowMultiple }) }],
  });
  try {
    const text = await session.prompt(question, { responseConstraint: SCHEMA });
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Chrome built-in AI returned an unreadable answer");
    }
    const answer = String(parsed?.answer ?? "").trim();
    if (!answer) throw new Error("Chrome built-in AI returned an empty answer");
    return { answer, reason: String(parsed?.reason ?? "").trim(), options: normalizeOptions(parsed) };
  } finally {
    session.destroy?.();
  }
}

export function describeLocalStatus(status) {
  switch (status) {
    case "available": return "Ready.";
    case "downloadable": return "Supported here, the model is not downloaded yet.";
    case "downloading": return "The model is downloading...";
    case "unsupported": return "Not supported in this Chrome version. Add a free API key instead.";
    default: return "Not available on this computer. Add a free API key instead.";
  }
}
