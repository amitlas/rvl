import { askChain, chainFromStorage, settingsFromStorage, PROVIDERS } from "./providers.js";
import { askChromeAI } from "./chromeai.js";
import { handleRvl } from "./handler.js";

const MENU_ID = "rvl";

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.create({ id: MENU_ID, title: "rvl", contexts: ["selection"] });
  // First install: open settings right away so the API key gets set.
  if (reason === "install") chrome.runtime.openOptionsPage();
});

// The toolbar icon opens the settings page.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  run(tab.id, { selectionText: info.selectionText, frameId: info.frameId });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "rvl" || !tab?.id) return;
  run(tab.id, {});
});

function run(tabId, { selectionText = "", frameId }) {
  handleRvl({ selectionText }, {
    readSelection: () => readSelection(tabId, frameId),
    getSettings,
    ask: (question, settings) => askChain(question, settings.chain, { localAsk }),
    show: (state) => show(tabId, state),
    openOptions: () => chrome.runtime.openOptionsPage(),
  }).catch((err) => console.error("rvl failed", err));
}

// With a frameId (context menu) read that frame; without one (keyboard
// shortcut) look in every frame and take the first non-empty selection, so
// questions inside iframes (e.g. quiz players) still work.
async function readSelection(tabId, frameId) {
  const target = frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
  const results = await chrome.scripting.executeScript({
    target,
    func: () => window.getSelection()?.toString() ?? "",
  });
  return results.map((r) => r.result).find((text) => text && text.trim()) ?? "";
}

// The first provider with a key is the one the handler checks; the whole
// chain rides along so askChain can fall back to the others.
async function getSettings() {
  const stored = await chrome.storage.local.get(null);
  const chain = chainFromStorage(stored);
  const first = chain[0] ?? settingsFromStorage(stored);
  return { ...first, keyless: chain.some((c) => PROVIDERS[c.provider].keyless), chain };
}

// The Prompt API may not exist in the service worker; an offscreen document
// is a normal extension page where it does.
async function localAsk(question, options) {
  if (globalThis.LanguageModel) return askChromeAI(question, options);
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: ["WORKERS"],
      justification: "Run Chrome's built-in on-device language model",
    });
  }
  const reply = await chrome.runtime.sendMessage({ type: "rvl-local-ask", question, options });
  if (!reply?.ok) throw new Error(reply?.error || "Chrome built-in AI failed");
  return reply.result;
}

// The box always lives in the top frame, so it sits in the real bottom-right
// corner even when the question was selected inside an iframe.
async function show(tabId, state) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content.js"] });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (s) => window.__rvlShow(s),
      args: [state],
    });
  } catch (err) {
    // chrome:// pages, the Web Store and PDFs do not allow injection.
    console.error("rvl cannot show its box on this page", err);
  }
}
