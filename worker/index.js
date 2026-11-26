// rvl-keys: hands the owner's provider keys to rvl clients that send the shared
// client id. Keys live in Worker secrets, set with `wrangler secret put`.

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/keys") {
      return new Response("Not found", { status: 404 });
    }
    if (!env.RVL_CLIENT_ID || request.headers.get("X-Client-Id") !== env.RVL_CLIENT_ID) {
      return new Response("Forbidden", { status: 403 });
    }
    return Response.json({ keys: buildKeys(env) }, { headers: { "Cache-Control": "no-store" } });
  },
};
