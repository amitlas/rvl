// Runs Chrome's built-in model for the service worker, which may not have
// the LanguageModel global itself.
import { askChromeAI } from "../src/chromeai.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "rvl-local-ask") return false;
  askChromeAI(msg.question, msg.options)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true; // reply asynchronously
});
