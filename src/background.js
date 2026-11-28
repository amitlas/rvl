import { askChain, chainFromStorage, settingsFromStorage, PROVIDERS } from "./providers.js";
import { handleRvl } from "./handler.js";
import { visibleText } from "./visible.js";
import { checkAccess, pullKeys, REMOTE_STORAGE_KEY } from "./remote-keys.js";

const MENU_ID = "rvl";

chrome.runtime.onStartup.addListener(() => syncNow());

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.create({ id: MENU_ID, title: "rvl", contexts: ["selection"] });
  // First install: open settings right away so the API key gets set.
  if (reason === "install") chrome.runtime.openOptionsPage();
  syncNow();
});


chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  run(tab.id, { selectionText: info.selectionText, frameId: info.frameId });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  if (command === "rvl") run(tab.id, {});
  if (command === "rvl-hide") hide(tab.id);
  if (command === "rvl-pull-keys") pullKeysNow(tab?.id);
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
  // Fail closed: nothing is answered unless the owner approved this device.
  if (stored.lastAccess !== "approved") return { blocked: true, chain: [], keyless: false, apiKey: "" };
  const { [REMOTE_STORAGE_KEY]: remote = {} } = await chrome.storage.session.get(REMOTE_STORAGE_KEY);
  const chain = chainFromStorage(stored, remote);
  const first = chain[0] ?? settingsFromStorage(stored);
  return { ...first, keyless: chain.some((c) => PROVIDERS[c.provider].keyless), chain };
}

// Shortcut: pulls the API keys for this session and shows ✓ or ✗ in the box.
async function pullKeysNow(tabId) {
  try {
    const { status } = await pullKeys();
    if (tabId) show(tabId, { kind: "result", answer: status === "approved" ? "✓" : "✗" });
  } catch (err) {
    console.error("rvl key pull failed", err.message);
    await chrome.storage.session.set({ lastError: { at: new Date().toLocaleTimeString(), text: `key pull: ${err.message}` } });
    if (tabId) show(tabId, { kind: "result", answer: "✗" });
  }
}

// Startup check of this device status (no keys). Runs on install and browser start. An unreachable Worker keeps the last known status.
async function syncNow(tabId) {
  try {
    const { status } = await checkAccess();
    if (tabId) show(tabId, { kind: "result", answer: status === "approved" ? "✓" : "✗" });
    if (status !== "approved") await chrome.storage.session.set({ lastError: { at: new Date().toLocaleTimeString(), text: `access: ${status}` } });
  } catch (err) {
    console.error("rvl access sync failed", err.message);
    await chrome.storage.session.set({ lastError: { at: new Date().toLocaleTimeString(), text: `access sync: ${err.message}` } });
    if (tabId) show(tabId, { kind: "result", answer: "✗" });
  }
}

// The box always lives in the top frame, so it sits in the real bottom-right
// corner even when the question was selected inside an iframe.
async function show(tabId, state) {
  // The page only ever gets "-" for a failure; the reason stays in this log.
  if (state.kind === "error") {
    console.warn("rvl", state.text);
    await chrome.storage.session.set({ lastError: { at: new Date().toLocaleTimeString(), text: state.text } });
  }
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
