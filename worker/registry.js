// Registry: one Durable Object holding every device record, its per-device keys,
// the global keys, and the rate counters. A single instance (idFromName "global")
// keeps counts exact.

export const LIMITS = { perIpPerHour: 5, maxPending: 50, maxBodyBytes: 512 };
export const PROVIDER_IDS = ["gemini", "groq", "openrouter", "openai", "anthropic"];
const MAX_HOURS = 24 * 30;

const DEVICE_RE = /^[a-f0-9]{32}$/;
const NAME_RE = /^[\p{L}\p{N} _-]{1,40}$/u;

// Rejects bad input before anything is stored. Returns an error string or null.
export function validateRegistration(body) {
  if (!body || typeof body !== "object") return "bad body";
  if (typeof body.deviceId !== "string" || !DEVICE_RE.test(body.deviceId)) return "bad device id";
  if (!validateName(body.name)) return "bad name";
  return null;
}

export function validateName(name) {
  return typeof name === "string" && NAME_RE.test(name.trim());
}

// A provider key with an optional lifetime in hours (no expiry when hours is absent).
export function validateKeyFields({ provider, key, hours }) {
  if (!PROVIDER_IDS.includes(provider)) return "bad provider";
  if (typeof key !== "string" || key.trim().length < 8 || key.length > 300) return "bad key";
  if (hours !== undefined && (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS)) return "bad hours";
  return null;
}

export function validateDeviceKey(input) {
  if (typeof input.deviceId !== "string" || !DEVICE_RE.test(input.deviceId)) return "bad device id";
  return validateKeyFields(input);
}

const json = (obj, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

const expiresAt = (hours) => (hours ? Date.now() + hours * 3_600_000 : null);
const isLive = (entry) => !entry.expires || entry.expires > Date.now();
const tailOf = (key) => key.trim().slice(-4);

// {provider: key} for the entries that have not expired.
function liveKeys(entries) {
  const out = {};
  for (const [provider, entry] of Object.entries(entries)) {
    if (isLive(entry)) out[provider] = entry.key;
  }
  return out;
}

// Admin view of key entries: provider, last 4 characters and expiry. Never the value.
function redact(entries) {
  return Object.fromEntries(Object.entries(entries).map(([p, e]) => [p, { tail: e.tail, expires: e.expires }]));
}

export class Registry {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const body = request.method === "POST" ? await request.json() : {};
    if (pathname === "/register") return this.register(body);
    if (pathname === "/status") return this.status(body.deviceId);
    if (pathname === "/set") return this.set(body);
    if (pathname === "/rename") return this.rename(body);
    if (pathname === "/setkey") return this.setKey(body);
    if (pathname === "/delkey") return this.delKey(body);
    if (pathname === "/setglobal") return this.setGlobal(body);
    if (pathname === "/delglobal") return this.delGlobal(body);
    if (pathname === "/globals") return json(await this.globals());
    if (pathname === "/list") return json(await this.list());
    return json({ error: "not found" }, 404);
  }

  async register({ deviceId, name, ip }) {
    const bucket = `ip:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
    const count = (await this.storage.get(bucket)) ?? 0;
    if (count >= LIMITS.perIpPerHour) return json({ error: "rate limit" }, 429);
    await this.storage.put(bucket, count + 1);

    const existing = await this.storage.get(`dev:${deviceId}`);
    if (existing) return json({ status: existing.status });

    const pending = [...(await this.storage.list({ prefix: "dev:" })).values()].filter((r) => r.status === "pending");
    if (pending.length >= LIMITS.maxPending) return json({ error: "pending full" }, 503);

    await this.storage.put(`dev:${deviceId}`, { name, status: "pending", at: Date.now(), keys: {} });
    return json({ status: "pending" });
  }

  // Status, and the device's own live keys only when it is approved.
  async status(deviceId) {
    const record = await this.storage.get(`dev:${deviceId}`);
    if (!record) return json({ status: "unknown" });
    const deviceKeys = record.status === "approved" ? liveKeys(record.keys ?? {}) : {};
    return json({ status: record.status, deviceKeys });
  }

  async set({ deviceId, status }) {
    if (status !== "approved" && status !== "revoked") return json({ error: "bad status" }, 400);
    const record = await this.storage.get(`dev:${deviceId}`);
    if (!record) return json({ error: "unknown device" }, 404);
    await this.storage.put(`dev:${deviceId}`, { ...record, status });
    return json({ status });
  }

  async rename({ deviceId, name }) {
    const record = await this.storage.get(`dev:${deviceId}`);
    if (!record) return json({ error: "unknown device" }, 404);
    await this.storage.put(`dev:${deviceId}`, { ...record, name: name.trim() });
    return json({ ok: true });
  }

  async setKey({ deviceId, provider, key, hours }) {
    const record = await this.storage.get(`dev:${deviceId}`);
    if (!record) return json({ error: "unknown device" }, 404);
    const entry = { key: key.trim(), tail: tailOf(key), expires: expiresAt(hours) };
    await this.storage.put(`dev:${deviceId}`, { ...record, keys: { ...(record.keys ?? {}), [provider]: entry } });
    return json({ ok: true, expires: entry.expires });
  }

  async delKey({ deviceId, provider }) {
    const record = await this.storage.get(`dev:${deviceId}`);
    if (!record) return json({ error: "unknown device" }, 404);
    const keys = { ...(record.keys ?? {}) };
    delete keys[provider];
    await this.storage.put(`dev:${deviceId}`, { ...record, keys });
    return json({ ok: true });
  }

  async setGlobal({ provider, key, hours }) {
    const entry = { key: key.trim(), tail: tailOf(key), expires: expiresAt(hours) };
    await this.storage.put(`global:${provider}`, entry);
    return json({ ok: true, expires: entry.expires });
  }

  async delGlobal({ provider }) {
    await this.storage.delete(`global:${provider}`);
    return json({ ok: true });
  }

  // Live global keys as {provider: key}, used by /keys.
  async globals() {
    const entries = {};
    for (const [key, entry] of await this.storage.list({ prefix: "global:" })) {
      entries[key.slice(7)] = entry;
    }
    return liveKeys(entries);
  }

  // Admin view: devices (with redacted keys) and global keys (redacted).
  async list() {
    const devices = {};
    for (const [key, record] of await this.storage.list({ prefix: "dev:" })) {
      const { keys = {}, ...rest } = record;
      devices[key.slice(4)] = { ...rest, keys: redact(keys) };
    }
    const globals = {};
    for (const [key, entry] of await this.storage.list({ prefix: "global:" })) {
      globals[key.slice(7)] = { tail: entry.tail, expires: entry.expires };
    }
    return { devices, globals };
  }
}
