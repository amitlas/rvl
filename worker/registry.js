// Registry: one Durable Object holding every device record, its per-device keys,
// and the rate counters. A single instance (idFromName "global") keeps counts exact.

export const LIMITS = { perIpPerHour: 5, maxPending: 50, maxBodyBytes: 512 };
export const PROVIDER_IDS = ["gemini", "groq", "openrouter", "openai", "anthropic"];
const MAX_HOURS = 24 * 30;

const DEVICE_RE = /^[a-f0-9]{32}$/;
const NAME_RE = /^[\p{L}\p{N} _-]{1,40}$/u;

// Rejects bad input before anything is stored. Returns an error string or null.
export function validateRegistration(body) {
  if (!body || typeof body !== "object") return "bad body";
  if (typeof body.deviceId !== "string" || !DEVICE_RE.test(body.deviceId)) return "bad device id";
  if (typeof body.name !== "string" || !NAME_RE.test(body.name.trim())) return "bad name";
  return null;
}

// Same idea for a per-device key set by the admin. hours is optional (no expiry).
export function validateDeviceKey({ deviceId, provider, key, hours }) {
  if (typeof deviceId !== "string" || !DEVICE_RE.test(deviceId)) return "bad device id";
  if (!PROVIDER_IDS.includes(provider)) return "bad provider";
  if (typeof key !== "string" || key.trim().length < 8 || key.length > 300) return "bad key";
  if (hours !== undefined && (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS)) return "bad hours";
  return null;
}

const json = (obj, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

// Keys of a record that have not expired, as {provider: key}.
function activeKeys(record) {
  const now = Date.now();
  const out = {};
  for (const [provider, entry] of Object.entries(record.keys ?? {})) {
    if (!entry.expires || entry.expires > now) out[provider] = entry.key;
  }
  return out;
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
    if (pathname === "/setkey") return this.setKey(body);
    if (pathname === "/delkey") return this.delKey(body);
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

  // Returns the status, and the device's own keys only when it is approved.
  async status(deviceId) {
    const record = await this.storage.get(`dev:${deviceId}`);
    if (!record) return json({ status: "unknown" });
    const deviceKeys = record.status === "approved" ? activeKeys(record) : {};
    return json({ status: record.status, deviceKeys });
  }

  async set({ deviceId, status }) {
    if (status !== "approved" && status !== "revoked") return json({ error: "bad status" }, 400);
    const record = await this.storage.get(`dev:${deviceId}`);
    if (!record) return json({ error: "unknown device" }, 404);
    await this.storage.put(`dev:${deviceId}`, { ...record, status });
    return json({ status });
  }

  async setKey({ deviceId, provider, key, hours }) {
    const record = await this.storage.get(`dev:${deviceId}`);
    if (!record) return json({ error: "unknown device" }, 404);
    const expires = hours ? Date.now() + hours * 3_600_000 : null;
    const keys = { ...(record.keys ?? {}), [provider]: { key: key.trim(), expires } };
    await this.storage.put(`dev:${deviceId}`, { ...record, keys });
    return json({ ok: true, expires });
  }

  async delKey({ deviceId, provider }) {
    const record = await this.storage.get(`dev:${deviceId}`);
    if (!record) return json({ error: "unknown device" }, 404);
    const keys = { ...(record.keys ?? {}) };
    delete keys[provider];
    await this.storage.put(`dev:${deviceId}`, { ...record, keys });
    return json({ ok: true });
  }

  // Key values are never listed: only the provider names and their expiry.
  async list() {
    const out = {};
    for (const [key, record] of await this.storage.list({ prefix: "dev:" })) {
      const { keys = {}, ...rest } = record;
      out[key.slice(4)] = {
        ...rest,
        keys: Object.fromEntries(Object.entries(keys).map(([p, e]) => [p, { expires: e.expires }])),
      };
    }
    return out;
  }
}
