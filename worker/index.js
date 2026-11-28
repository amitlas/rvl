// rvl-keys: hands the owner's provider keys only to devices the owner approved.
// Keys live in Worker secrets. Device records live in the Registry Durable Object.

import { Registry, validateRegistration, validateDeviceKey, LIMITS } from "./registry.js";

export { Registry };

const PROVIDER_SECRETS = {
  gemini: "RVL_GEMINI_KEY",
  groq: "RVL_GROQ_KEY",
  openrouter: "RVL_OPENROUTER_KEY",
  openai: "RVL_OPENAI_KEY",
  anthropic: "RVL_ANTHROPIC_KEY",
};

// Only providers whose secret is set are returned; empty values are skipped.
export function buildKeys(env) {
  const keys = {};
  for (const [id, name] of Object.entries(PROVIDER_SECRETS)) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) keys[id] = value.trim();
  }
  return keys;
}

const json = (obj, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

// Reads the body with a size cap; returns null when too large or not JSON.
async function readBody(request) {
  const text = await request.text();
  if (text.length > LIMITS.maxBodyBytes) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function registry(env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName("global"));
}

// Sends a request to the Registry and returns its response as-is.
function ask(env, path, payload) {
  return registry(env).fetch(new Request(`https://registry${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/register") {
      const body = await readBody(request);
      if (!body) return json({ error: "bad request" }, 400);
      const error = validateRegistration(body);
      if (error) return json({ error }, 400);
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      return ask(env, "/register", { deviceId: body.deviceId, name: body.name.trim(), ip });
    }

    // Status only, no keys: used by the startup check.
    if (request.method === "GET" && url.pathname === "/status") {
      const deviceId = request.headers.get("X-Device-Id") ?? "";
      const { status } = await (await ask(env, "/status", { deviceId })).json();
      return json({ status });
    }

    if (request.method === "GET" && url.pathname === "/keys") {
      const deviceId = request.headers.get("X-Device-Id") ?? "";
      const { status, deviceKeys = {} } = await (await ask(env, "/status", { deviceId })).json();
      if (status !== "approved") return json({ status }, 403);
      // Keys bound to this device win over the global ones for the same provider.
      return json({ status, keys: { ...buildKeys(env), ...deviceKeys } });
    }

    if (url.pathname.startsWith("/admin/")) {
      if (!env.RVL_ADMIN_KEY || request.headers.get("X-Admin-Key") !== env.RVL_ADMIN_KEY) {
        return json({ error: "forbidden" }, 403);
      }
      if (request.method === "POST" && url.pathname === "/admin/list") return ask(env, "/list", {});
      if (request.method === "POST" && (url.pathname === "/admin/setkey" || url.pathname === "/admin/delkey")) {
        const body = await readBody(request);
        if (!body) return json({ error: "bad request" }, 400);
        const error = validateDeviceKey(url.pathname.endsWith("setkey") ? body : { ...body, key: "placeholder" });
        if (error) return json({ error }, 400);
        return ask(env, url.pathname.endsWith("setkey") ? "/setkey" : "/delkey", body);
      }
      if (request.method === "POST" && url.pathname === "/admin/approve") {
        const body = await readBody(request);
        return ask(env, "/set", { deviceId: body?.deviceId, status: "approved" });
      }
      if (request.method === "POST" && url.pathname === "/admin/revoke") {
        const body = await readBody(request);
        return ask(env, "/set", { deviceId: body?.deviceId, status: "revoked" });
      }
    }

    return json({ error: "not found" }, 404);
  },
};
