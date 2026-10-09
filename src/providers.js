// Free AI providers rvl can use. Each has its own key. Every model has its
// own free quota, so each provider lists several in fallback order, cheapest
// first; the options page adds whatever the provider currently offers on top.

import { askGemini } from "./gemini.js";
import { askOpenAICompatible } from "./openai.js";

export const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    // Cheapest (lite) first. The -latest aliases follow Google's renames.
    models: ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-3.5-flash", "gemini-2.5-flash"],
    keyUrl: "https://aistudio.google.com/apikey",
  },
  groq: {
    label: "Groq",
    // Smallest (cheapest) first.
    models: ["llama-3.1-8b-instant", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
    keyUrl: "https://console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  openrouter: {
    label: "OpenRouter (free models)",
    // Smallest (cheapest) first.
    models: ["google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it:free", "nvidia/nemotron-3-super-120b-a12b:free"],
    keyUrl: "https://openrouter.ai/keys",
    baseUrl: "https://openrouter.ai/api/v1",
  },
};

// Free, no key, no sign-up: the default until a key is added, and the
// fallback after the keyed providers.
PROVIDERS.pollinations = {
  label: "Pollinations (free, no key)",
  models: ["openai"],
  keyless: true,
  endpoint: "https://text.pollinations.ai/openai",
  // About one answer per 30s without a key: keep retrying for ~30s.
  retryOn402: { tries: 4, delayMs: 10000 },
};


for (const p of Object.values(PROVIDERS)) p.defaultModel = p.models[0];

// With no provider chosen yet: the first one that has a key, else the keyless one.
export function defaultProvider(keys = {}) {
  return Object.keys(PROVIDERS).find((id) => !PROVIDERS[id].keyless && String(keys[id] ?? "").trim()) ?? DEFAULT_PROVIDER;
}

export const DEFAULT_PROVIDER = "pollinations";

// Used by the options page to prove the key and model work end to end.
export const TEST_QUESTION = "What is 2 + 2?\nA. 3\nB. 4\nC. 5";
export const TEST_EXPECTED = "B";

export function resolveSettings({ provider, apiKey, model, allowMultiple } = {}) {
  const id = PROVIDERS[provider] ? provider : DEFAULT_PROVIDER;
  return {
    provider: id,
    apiKey: String(apiKey ?? "").trim(),
    model: String(model ?? "").trim() || PROVIDERS[id].defaultModel,
    // On unless explicitly turned off.
    allowMultiple: allowMultiple !== false,
  };
}

export function ask(question, settings, { fetchFn = fetch, sleep } = {}) {
  const { provider, apiKey, model, allowMultiple } = resolveSettings(settings);
  if (provider === "gemini") return askGemini(question, apiKey, { model, allowMultiple, fetchFn });
  const { baseUrl, endpoint, retryOn402 } = PROVIDERS[provider];
  return askOpenAICompatible(question, apiKey, { baseUrl, endpoint, model, allowMultiple, fetchFn, retryOn402, ...(sleep ? { sleep } : {}) });
}

// Storage layout: {provider, keys: {gemini: "...", groq: "..."}, models: {...}, allowMultiple}
// so switching provider keeps the other provider's key.
// Version 0.1 stored a single Gemini key as {apiKey, model}; still honored.
export function settingsFromStorage(stored = {}) {
  if (stored.apiKey && !stored.keys) {
    stored = { provider: "gemini", keys: { gemini: stored.apiKey }, models: { gemini: stored.model } };
  }
  const provider = PROVIDERS[stored.provider] ? stored.provider : defaultProvider(stored.keys);
  return resolveSettings({
    provider,
    apiKey: stored.keys?.[provider],
    model: stored.models?.[provider],
    allowMultiple: stored.allowMultiple,
  });
}

// The fallback order: every provider that has a key, the selected one
// first; within each, the chosen model first and then its other models,
// since each model has its own free quota.
export function chainFromStorage(stored = {}) {
  const primary = settingsFromStorage(stored);
  const keys = stored.keys ?? (stored.apiKey ? { gemini: stored.apiKey } : {});
  const order = [primary.provider, ...Object.keys(PROVIDERS).filter((id) => id !== primary.provider)];
  const chain = [];
  for (const id of order) {
    const first = resolveSettings({
      provider: id,
      apiKey: keys[id],
      model: stored.models?.[id] || (id === primary.provider && !stored.keys ? stored.model : ""),
      allowMultiple: stored.allowMultiple,
    });
    if (!first.apiKey && !PROVIDERS[id].keyless) continue;
    for (const model of [first.model, ...PROVIDERS[id].models.filter((m) => m !== first.model)]) {
      chain.push({ ...first, model });
    }
  }
  return chain;
}

// A bad key or no network fails every model of that provider the same way,
// so the rest of its models are skipped.
function failsWholeProvider(message) {
  return /API key|network/i.test(message);
}

// Tries each provider in turn; any failure (quota, bad key, network, outage)
// moves on to the next. Only when all fail does the error reach the popup.
export async function askChain(question, chain, { fetchFn = fetch } = {}) {
  const failures = [];
  const deadProviders = new Set();
  for (const settings of chain) {
    if (deadProviders.has(settings.provider)) continue;
    try {
      return await ask(question, settings, { fetchFn });
    } catch (err) {
      const message = err?.message || "failed";
      if (failsWholeProvider(message)) deadProviders.add(settings.provider);
      // One line per provider: its last error is the one worth showing.
      const i = failures.findIndex((f) => f.startsWith(`${settings.provider}: `));
      if (i >= 0) failures.splice(i, 1);
      failures.push(`${settings.provider}: ${message}`);
    }
  }
  if (failures.length === 0) throw new Error("Set an API key in the rvl options");
  if (failures.length === 1) throw new Error(failures[0].replace(/^[^:]+: /, ""));
  throw new Error(`All providers failed. ${failures.join(" | ")}`);
}

// Models the provider offers right now, for the options dropdown. Returns []
// on any failure; the built-in list is always shown anyway.
export async function fetchModels(providerId, apiKey, { fetchFn = fetch } = {}) {
  const p = PROVIDERS[providerId];
  if (!p || !apiKey) return [];
  try {
    if (providerId === "gemini") {
      const res = await fetchFn("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
        headers: { "x-goog-api-key": apiKey },
      });
      if (res.status !== 200) return [];
      const body = await res.json();
      return (body.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => String(m.name).replace(/^models\//, ""))
        .filter((id) => /^gemini-/.test(id) && !/tts|image|embedding|live|audio/.test(id));
    }
    const res = await fetchFn(`${p.baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.status !== 200) return [];
    const ids = ((await res.json()).data ?? []).map((m) => String(m.id));
    if (providerId === "openrouter") return ids.filter((id) => id.endsWith(":free"));
    return ids.filter((id) => !/whisper|tts|guard|playai|distil/i.test(id));
  } catch {
    return [];
  }
}

// Built-in models first (the fallback order), then any extra live ones.
export function modelOptions(providerId, liveModels = []) {
  const builtIn = PROVIDERS[providerId]?.models ?? [];
  const extra = [...new Set(liveModels)].filter((m) => !builtIn.includes(m)).sort();
  return { builtIn, extra };
}
