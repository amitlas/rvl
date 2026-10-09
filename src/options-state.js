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

// Up to 1.0.x Chrome built-in AI was the default, so it may be stored as the
// chosen provider without the user ever picking it. From 1.1.0 it is opt-in:
// on update from an older version, fall back to the normal default.
export function migrateOnUpdate(raw = {}, previousVersion = "") {
  const [major, minor] = String(previousVersion).split(".").map(Number);
  const before110 = major < 1 || (major === 1 && minor < 1);
  if (!before110 || raw.provider !== "chrome") return null;
  return { provider: defaultProvider(raw.keys) };
}
