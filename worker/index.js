// rvl-keys: hands provider keys only to devices the owner approved.
// Keys come from three layers: Worker secrets (global), global keys set in the
// admin page, and per-device keys. A device key beats a global one for the same
// provider. Device records and admin-set keys live in the Registry Durable Object.

import { Registry, validateRegistration, validateDeviceKey, validateKeyFields, validateName, PROVIDER_IDS, LIMITS } from "./registry.js";
import { ADMIN_HTML } from "./admin-page.js";

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

    // The page holds no secrets. Every action on it sends the admin key itself.
    if (request.method === "GET" && url.pathname === "/admin") {
      return new Response(ADMIN_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
        },
      });
    }

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
      const globalKeys = await (await ask(env, "/globals", {})).json();
      return json({ status, keys: { ...buildKeys(env), ...globalKeys, ...deviceKeys } });
    }

    if (url.pathname.startsWith("/admin/")) {
      if (!env.RVL_ADMIN_KEY || request.headers.get("X-Admin-Key") !== env.RVL_ADMIN_KEY) {
        return json({ error: "forbidden" }, 403);
      }
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      const body = (await readBody(request)) ?? {};

      if (url.pathname === "/admin/list") return ask(env, "/list", {});

      if (url.pathname === "/admin/approve") return ask(env, "/set", { deviceId: body.deviceId, status: "approved" });
      if (url.pathname === "/admin/revoke") return ask(env, "/set", { deviceId: body.deviceId, status: "revoked" });

      if (url.pathname === "/admin/rename") {
        if (!validateName(body.name)) return json({ error: "bad name" }, 400);
        return ask(env, "/rename", { deviceId: body.deviceId, name: body.name });
      }

      if (url.pathname === "/admin/setkey") {
        const error = validateDeviceKey(body);
        if (error) return json({ error }, 400);
        return ask(env, "/setkey", body);
      }
      if (url.pathname === "/admin/delkey") {
        if (typeof body.deviceId !== "string" || !PROVIDER_IDS.includes(body.provider)) return json({ error: "bad request" }, 400);
        return ask(env, "/delkey", body);
      }

      if (url.pathname === "/admin/setglobal") {
        const error = validateKeyFields(body);
        if (error) return json({ error }, 400);
        return ask(env, "/setglobal", body);
      }
      if (url.pathname === "/admin/delglobal") {
        if (!PROVIDER_IDS.includes(body.provider)) return json({ error: "bad provider" }, 400);
        return ask(env, "/delglobal", body);
      }
    }

    return json({ error: "not found" }, 404);
  },
};
