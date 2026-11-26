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
// Prepended when the text came from the page, where several questions can be on screen.
export const FIRST_ONLY = "Answer only the first multiple-choice question in the text below. Ignore every other question.\n\n";

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
  // Nothing selected: send what is on screen, and ask for the first question only.
  let fromPage = false;
  if (!text.trim() && deps.readPage) {
    try {
      text = await deps.readPage();
      fromPage = true;
    } catch {
      text = "";
    }
  }
  const cleaned = cleanQuestion(text);
  const question = fromPage && cleaned ? FIRST_ONLY + cleaned : cleaned;
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
    const shown = chooseAnswer(result, { allowMultiple: settings.allowMultiple !== false, stated: questionStatedCount(question), hebrew: /[\u0590-\u05FF]/.test(question) });
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

// How many options the question asks for: a number, Infinity for "all of them",
// or null when the question says nothing. Read locally so it wins over the
// allowMultiple setting.
const HE_NUMBERS = { שתיים: 2, שניים: 2, שתי: 2, שני: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4 };
const EN_NUMBERS = { two: 2, three: 3, four: 4, five: 5 };
export function questionStatedCount(question = "") {
  const q = String(question);
  if (/\b(?:select|choose|pick|mark|check|circle) all\b|all (?:that|of the) (?:apply|correct|true)|\bmore than one\b|כל (?:ה)?(?:תשובות|נכונות|אפשרויות)/i.test(q)) return Infinity;
  const word = "(two|three|four|five|\\d+|שתיים|שניים|שתי|שני|שלוש|שלושה|ארבע|ארבעה)";
  const m = q.match(new RegExp(`(?:\\b(?:select|choose|pick|mark|check|circle|which)\\s+${word}\\b|(?:בחר|בחרו|סמן|סמנו|בחרי|סמני)\\s+${word}|\\b${word}\\s+(?:correct|right)\\s+(?:answers|options))`, "i"));
  if (!m) return null;
  const hit = (m[1] ?? m[2] ?? m[3]).toLowerCase();
  const n = EN_NUMBERS[hit] ?? HE_NUMBERS[hit] ?? parseInt(hit, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The per-option verdicts decide what is shown: exactly the options judged
// correct, when that is 1 (or up to 2 if allowed). Otherwise, or when the
// model sent no verdicts, fall back to its "answer" field, capped the same way.
// Only letters are ever shown: an option without a short label (the model
// quoted its text) becomes its position letter, A/B/C or א/ב/ג.
export function chooseAnswer({ answer, options = [] }, { allowMultiple = true, stated = null, hebrew = false } = {}) {
  const limit = stated ?? (allowMultiple ? 2 : 1);
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
