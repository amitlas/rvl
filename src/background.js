import { askChain, chainFromStorage, settingsFromStorage, PROVIDERS } from "./providers.js";
import { handleRvl } from "./handler.js";
import { visibleText } from "./visible.js";

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
  if (!tab?.id) return;
  if (command === "rvl") run(tab.id, {});
  if (command === "rvl-hide") hide(tab.id);
});

// A new or changed key gets tried right away instead of waiting out a freeze.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.keys) chrome.storage.session.remove("frozen");
});

// Latest run per tab. Hiding or starting a new run bumps it, so an answer
// still on its way for an older run is dropped instead of popping back up.
const runIds = new Map();

function run(tabId, { selectionText = "", frameId }) {
  const id = (runIds.get(tabId) ?? 0) + 1;
  runIds.set(tabId, id);
  handleRvl({ selectionText }, {
    cancelled: () => runIds.get(tabId) !== id,
    readSelection: () => readSelection(tabId, frameId),
    readPage: () => readPage(tabId),
    getSettings,
    ask: async (question, settings) => {
      // storage.session: survives the service worker going idle, not a browser restart.
      const { frozen = {} } = await chrome.storage.session.get("frozen");
      return askChain(question, settings.chain, {
        frozen,
        log: (line) => console.warn("rvl", line),
        onFreeze: (key, until) => {
          frozen[key] = until;
          chrome.storage.session.set({ frozen });
        },
      });
    },
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

// No selection: take the text inside the viewport of every frame and keep the
// longest, so only the question on screen is sent (not the ones further down),
// and a quiz inside an iframe wins over a short wrapper page.
async function readPage(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: visibleText,
  });
  return results.map((r) => r.result ?? "").reduce((a, b) => (b.trim().length > a.trim().length ? b : a), "");
}

// shortcut: the request itself is not aborted, its answer is just ignored.
async function hide(tabId) {
  runIds.set(tabId, (runIds.get(tabId) ?? 0) + 1);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__rvlHide?.() });
  } catch {
    // Page does not allow injection, so there is no box to hide.
  }
}

// The first provider with a key is the one the handler checks; the whole
// chain rides along so askChain can fall back to the others.
async function getSettings() {
  const stored = await chrome.storage.local.get(null);
  const chain = chainFromStorage(stored);
  const first = chain[0] ?? settingsFromStorage(stored);
  return { ...first, keyless: chain.some((c) => PROVIDERS[c.provider].keyless), chain };
}

// The box always lives in the top frame, so it sits in the real bottom-right
// corner even when the question was selected inside an iframe.
async function show(tabId, state) {
  // The page only ever gets "-" for a failure; the reason stays in this log.
  if (state.kind === "error") console.warn("rvl", state.text);
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
