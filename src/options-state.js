// Pure state helpers for the options page, so the "never lose a typed key"
// rules are testable without a browser.

import { PROVIDERS, defaultProvider } from "./providers.js";

// Reads whatever is in chrome.storage.local, including the 0.1 layout
// ({apiKey, model} for Gemini only), into {provider, keys, models, allowMultiple}.
export function normalizeStored(raw = {}) {
  const keys = { ...(raw.keys ?? {}) };
  const models = { ...(raw.models ?? {}) };
  if (raw.apiKey && !keys.gemini) keys.gemini = raw.apiKey;
  if (raw.model && !models.gemini) models.gemini = raw.model;
  return {
    provider: PROVIDERS[raw.provider] ? raw.provider : defaultProvider(keys),
    keys,
    models,
    allowMultiple: raw.allowMultiple !== false,
  };
}

// Records what is typed for one provider and leaves every other provider's
// key and model untouched.
export function withEdit(stored, providerId, { key, model }) {
  return {
    ...stored,
    keys: { ...stored.keys, [providerId]: String(key ?? "").trim() },
    models: { ...stored.models, [providerId]: String(model ?? "").trim() },
  };
}

export function withProvider(stored, providerId) {
  return { ...stored, provider: PROVIDERS[providerId] ? providerId : stored.provider };
}


// Groups a fallback chain into the rows the options page shows: one row per
// provider and key source, in the order rvl tries them.
export function describeChain(chain = []) {
  const rows = [];
  for (const c of chain) {
    const last = rows.at(-1);
    if (last && last.provider === c.provider && last.source === c.source) {
      last.models.push(c.model);
      continue;
    }
    rows.push({ provider: c.provider, source: c.source, apiKey: c.apiKey, models: [c.model] });
  }
  return rows;
}

// The API key field flips between hidden (password) and full text.
export function toggleKeyVisibility(type) {
  return type === "password" ? "text" : "password";
}
