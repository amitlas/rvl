// Registry: one Durable Object holding every device record and the rate counters.
// A single instance (idFromName "global") makes the counts exact.

export const LIMITS = { perIpPerHour: 5, maxPending: 50, maxBodyBytes: 512 };

const DEVICE_RE = /^[a-f0-9]{32}$/;
const NAME_RE = /^[\p{L}\p{N} _-]{1,40}$/u;

// Rejects bad input before anything is stored. Returns an error string or null.
export function validateRegistration(body) {
  if (!body || typeof body !== "object") return "bad body";
  if (typeof body.deviceId !== "string" || !DEVICE_RE.test(body.deviceId)) return "bad device id";
  if (typeof body.name !== "string" || !NAME_RE.test(body.name.trim())) return "bad name";
  return null;
}

const json = (obj, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

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

    await this.storage.put(`dev:${deviceId}`, { name, status: "pending", at: Date.now() });
    return json({ status: "pending" });
  }

  async status(deviceId) {
    const record = await this.storage.get(`dev:${deviceId}`);
    return json({ status: record ? record.status : "unknown" });
  }

  async set({ deviceId, status }) {
    if (status !== "approved" && status !== "revoked") return json({ error: "bad status" }, 400);
    const record = await this.storage.get(`dev:${deviceId}`);
    if (!record) return json({ error: "unknown device" }, 404);
    await this.storage.put(`dev:${deviceId}`, { ...record, status });
    return json({ status });
  }

  async list() {
    const out = {};
    for (const [key, record] of await this.storage.list({ prefix: "dev:" })) {
      out[key.slice(4)] = record;
    }
    return out;
  }
}
