// The rvl flow, independent of the chrome.* APIs so it can be tested with
// plain fakes. background.js supplies the real deps.

import { cleanQuestion } from "./gemini.js";

// deps:
//   readSelection() -> Promise<string>   selected text from the page ("" if none)
//   readPage()      -> Promise<string>   whole page text, used only when nothing is selected
//   getSettings()   -> Promise<{provider, apiKey, model}>
//   ask(question, settings) -> Promise<{answer, reason}>
//   show(state)     -> Promise<void>     state is {kind: "loading"|"result"|"error", ...}
//   openOptions()   -> void
//   cancelled()     -> boolean           optional; true once the user hid the box, so a late answer is dropped
export async function handleRvl({ selectionText = "" } = {}, deps) {
  let selected = "";
  try {
    selected = await deps.readSelection();
  } catch {
    selected = "";
  }
  // The page selection keeps line breaks between options; the context-menu
  // selectionText flattens them, so it is only the fallback.
  let text = selected || selectionText;
  // Nothing selected: assume the page shows a single question and send all of it.
  if (!text.trim() && deps.readPage) {
    try {
      text = await deps.readPage();
    } catch {
      text = "";
    }
  }
  const question = cleanQuestion(text);
  if (!question) {
    await deps.show({ kind: "error", text: "Select a question first" });
    return;
  }

  const settings = await deps.getSettings();
  // A keyless provider (Pollinations) means there is always something to try.
  if (!settings.apiKey && !settings.keyless) {
    await deps.show({ kind: "error", text: "Set your API key in the rvl options" });
    deps.openOptions();
    return;
  }

  await deps.show({ kind: "loading" });
  try {
    const result = await deps.ask(question, settings);
    if (deps.cancelled?.()) return;
    const shown = chooseAnswer(result, { allowMultiple: settings.allowMultiple !== false, hebrew: /[\u0590-\u05FF]/.test(question) });
    await deps.show({ kind: "result", answer: shown, reason: result.reason });
  } catch (err) {
    if (deps.cancelled?.()) return;
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
// Only letters are ever shown: an option without a short label (the model
// quoted its text) becomes its position letter, A/B/C or א/ב/ג.
export function chooseAnswer({ answer, options = [] }, { allowMultiple = true, hebrew = false } = {}) {
  const limit = allowMultiple ? 2 : 1;
  const letters = hebrew ? "אבגדהוזחטי" : "ABCDEFGHIJ";
  // "?" is the model saying "not a question": shown as "-" like every failure.
  const short = (label) => label.length <= 3 && label !== "?";
  const labelAt = (i) => {
    const label = bareLabel(options[i].label);
    return short(label) ? label : letters[i] ?? "-";
  };
  const correct = options.map((o, i) => (o.correct ? labelAt(i) : null)).filter(Boolean);
  if (correct.length >= 1 && correct.length <= limit) return correct.join(", ");
  return bareLabel(answer).split(", ").slice(0, limit).map((part) => {
    if (short(part)) return part;
    const i = options.findIndex((o) => o.label.startsWith(part) || part.startsWith(o.label));
    return i >= 0 ? labelAt(i) : "-";
  }).join(", ");
}
