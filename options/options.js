import { PROVIDERS, fetchModels, modelOptions, askChain, chainFromStorage, TEST_QUESTION, TEST_EXPECTED } from "../src/providers.js";
import { describeTestResult } from "../src/keytest.js";
import { normalizeStored, withEdit, withProvider } from "../src/options-state.js";
import { chromeAIStatus, describeLocalStatus } from "../src/chromeai.js";

const providerSelect = document.getElementById("provider");
const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const keyUrl = document.getElementById("keyUrl");
const allowMultipleInput = document.getElementById("allowMultiple");
const status = document.getElementById("status");

let stored = normalizeStored({});

for (const [id, p] of Object.entries(PROVIDERS)) {
  providerSelect.add(new Option(p.label, id));
}

function fillModels(id, live = []) {
  const chosen = stored.models[id] ?? "";
  const { builtIn, extra } = modelOptions(id, live);
  modelInput.replaceChildren(new Option(`Automatic (${PROVIDERS[id].defaultModel} first)`, ""));
  const group = (label, models) => {
    if (!models.length) return;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const m of models) g.appendChild(new Option(m, m));
    modelInput.appendChild(g);
  };
  group("Recommended", builtIn);
  group("Also available", extra);
  // A saved model that is no longer listed stays selectable.
  if (chosen && !builtIn.includes(chosen) && !extra.includes(chosen)) group("Saved", [chosen]);
  modelInput.value = chosen;
}

// Ask the provider which models it has right now, once a key is there.
let liveRequest = 0;
async function loadLiveModels(id) {
  const request = ++liveRequest;
  const live = await fetchModels(id, stored.keys[id]);
  if (request === liveRequest && providerSelect.value === id) fillModels(id, live);
}

// Status line and download button for the on-device model. The download
// has to start from a click, so it can only happen here, not from a page.
async function refreshLocalStatus() {
  const status = await chromeAIStatus();
  document.getElementById("localStatus").textContent = describeLocalStatus(status);
  document.getElementById("downloadModel").hidden = status !== "downloadable";
}

document.getElementById("downloadModel").addEventListener("click", async () => {
  const statusLine = document.getElementById("localStatus");
  try {
    await LanguageModel.create({
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          statusLine.textContent = `Downloading the model... ${Math.round(e.loaded * 100)}%`;
        });
      },
    });
  } catch (err) {
    statusLine.textContent = `Download failed: ${err?.message || err}`;
    return;
  }
  refreshLocalStatus();
});

function fillProvider(id) {
  const p = PROVIDERS[id];
  document.getElementById("keyedSection").hidden = Boolean(p.keyless);
  document.getElementById("localSection").hidden = !p.keyless;
  if (p.keyless) {
    status.textContent = "";
    showSavedKeys();
    refreshLocalStatus();
    return;
  }
  apiKeyInput.value = stored.keys[id] ?? "";
  fillModels(id);
  loadLiveModels(id);
  keyUrl.href = p.keyUrl;
  keyUrl.textContent = new URL(p.keyUrl).host;
  status.textContent = "";
  showSavedKeys();
}

function showSavedKeys() {
  const withKey = Object.keys(PROVIDERS).filter((pid) => stored.keys[pid]);
  document.getElementById("savedKeys").textContent = withKey.length
    ? `Keys saved for: ${withKey.map((pid) => PROVIDERS[pid].label).join(", ")}`
    : "No keys saved yet.";
}

// Everything is saved as it is typed, so switching provider or closing the
// tab never drops a key. set() merges, it never wipes other providers.
async function persist() {
  await chrome.storage.local.set(stored);
  await chrome.storage.local.remove(["apiKey", "model"]); // 0.1 layout, now in keys/models
  showSavedKeys();
}

function captureCurrent() {
  stored = withEdit(stored, providerSelect.value, { key: apiKeyInput.value, model: modelInput.value });
}

chrome.storage.local.get(null).then((raw) => {
  stored = normalizeStored(raw);
  providerSelect.value = stored.provider;
  allowMultipleInput.checked = stored.allowMultiple;
  fillProvider(stored.provider);
});

let keyTimer = null;
apiKeyInput.addEventListener("input", () => {
  captureCurrent();
  persist();
  clearTimeout(keyTimer);
  keyTimer = setTimeout(() => loadLiveModels(providerSelect.value), 600);
});
modelInput.addEventListener("change", () => { captureCurrent(); persist(); });
allowMultipleInput.addEventListener("change", () => {
  stored = { ...stored, allowMultiple: allowMultipleInput.checked };
  persist();
});

providerSelect.addEventListener("change", () => {
  stored = withProvider(stored, providerSelect.value);
  persist();
  fillProvider(providerSelect.value);
});

document.getElementById("save").addEventListener("click", async () => {
  captureCurrent();
  await persist();

  status.className = "";
  status.textContent = "Saved, testing...";
  let result;
  try {
    // Same fallback across this provider's models as real use, so one
    // model being out of quota does not report a working key as broken.
    const chain = chainFromStorage(stored).filter((c) => c.provider === stored.provider);
    const answer = await askChain(TEST_QUESTION, chain);
    result = describeTestResult({ answer: answer.answer, expected: TEST_EXPECTED });
  } catch (err) {
    result = describeTestResult({ error: err });
  }
  status.className = result.ok ? "ok" : "bad";
  status.textContent = result.text;
});

// Chrome owns the shortcut setting; the page only shows it and links to it.
chrome.commands.getAll().then((commands) => {
  const shortcut = commands.find((c) => c.name === "rvl")?.shortcut;
  document.getElementById("shortcut").textContent = shortcut || "not set";
});

document.getElementById("changeShortcut").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});
