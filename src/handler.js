// The rvl flow, independent of the chrome.* APIs so it can be tested with
// plain fakes. background.js supplies the real deps.

import { cleanQuestion } from "./gemini.js";

// deps:
//   readSelection() -> Promise<string>   selected text from the page ("" if none)
//   getSettings()   -> Promise<{provider, apiKey, model}>
//   ask(question, settings) -> Promise<{answer, reason}>
//   show(state)     -> Promise<void>     state is {kind: "loading"|"result"|"error", ...}
//   openOptions()   -> void
export async function handleRvl({ selectionText = "" } = {}, deps) {
  let selected = "";
  try {
    selected = await deps.readSelection();
  } catch {
    selected = "";
  }
  // The page selection keeps line breaks between options; the context-menu
  // selectionText flattens them, so it is only the fallback.
  const question = cleanQuestion(selected || selectionText);
  if (!question) {
    await deps.show({ kind: "error", text: "Select a question first" });
    return;
  }

  const settings = await deps.getSettings();
  // A keyless provider (Chrome built-in AI) means there is always something to try.
  if (!settings.apiKey && !settings.keyless) {
    await deps.show({ kind: "error", text: "Set your API key in the rvl options" });
    deps.openOptions();
    return;
  }

  await deps.show({ kind: "loading" });
  try {
    const result = await deps.ask(question, settings);
    const shown = chooseAnswer(result, { allowMultiple: settings.allowMultiple !== false });
    await deps.show({ kind: "result", answer: shown, reason: result.reason });
  } catch (err) {
    await deps.show({ kind: "error", text: err?.message || "Something went wrong" });
  }
}

// "B." / "(ג)" / "3)" / "A:" -> just the label, no punctuation around it.
// Several answers ("A., (C)") keep their order and are joined with ", ".
export function bareLabel(answer) {
  const one = (s) => s.trim().replace(/^[(\[]+/, "").replace(/[.):\]\s]+$/, "") || s.trim();
  const parts = String(answer).split(/\s*[,،]\s*|\s+(?:and|ו)\s+/).filter((s) => s.trim());
  return parts.length ? parts.map(one).join(", ") : String(answer).trim();
}

// The per-option verdicts decide what is shown: exactly the options judged
// correct, when that is 1 (or up to 2 if allowed). Otherwise, or when the
// model sent no verdicts, fall back to its "answer" field, capped the same way.
export function chooseAnswer({ answer, options = [] }, { allowMultiple = true } = {}) {
  const limit = allowMultiple ? 2 : 1;
  const correct = options.filter((o) => o.correct).map((o) => bareLabel(o.label));
  if (correct.length >= 1 && correct.length <= limit) return correct.join(", ");
  return bareLabel(answer).split(", ").slice(0, limit).join(", ");
}
