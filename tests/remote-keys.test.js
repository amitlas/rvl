import { test } from "node:test";
import assert from "node:assert/strict";
import { pullRemoteKeys } from "../src/remote-keys.js";
import worker, { buildKeys } from "../worker/index.js";

const reply = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

test("pullRemoteKeys returns the non-empty keys and sends the client id", async () => {
  let sent;
  const fetchFn = async (url, init) => { sent = { url, init }; return reply(200, { keys: { gemini: " g ", groq: "" } }); };
  const keys = await pullRemoteKeys({ fetchFn, url: "https://x/keys", clientId: "id-1" });
  assert.deepEqual(keys, { gemini: "g" });
  assert.equal(sent.init.headers["X-Client-Id"], "id-1");
});

test("pullRemoteKeys reports rejected id, server error, bad body, empty and network failure", async () => {
  await assert.rejects(pullRemoteKeys({ fetchFn: async () => reply(403, {}) }), /client id rejected/);
  await assert.rejects(pullRemoteKeys({ fetchFn: async () => reply(500, {}) }), /server error 500/);
  await assert.rejects(pullRemoteKeys({ fetchFn: async () => ({ status: 200, ok: true, json: async () => { throw new Error("x"); } }) }), /bad response/);
  await assert.rejects(pullRemoteKeys({ fetchFn: async () => reply(200, { keys: {} }) }), /no keys on server/);
  await assert.rejects(pullRemoteKeys({ fetchFn: async () => { throw new Error("offline"); } }), /network error/);
});

test("worker returns only the set provider keys", () => {
  assert.deepEqual(buildKeys({ RVL_GEMINI_KEY: "g", RVL_GROQ_KEY: "  ", RVL_OPENAI_KEY: "o" }), { gemini: "g", openai: "o" });
});

test("worker rejects a wrong client id, a wrong path and a wrong method", async () => {
  const env = { RVL_CLIENT_ID: "id-1", RVL_GEMINI_KEY: "g" };
  const ok = await worker.fetch(new Request("https://w/keys", { headers: { "X-Client-Id": "id-1" } }), env);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).keys, { gemini: "g" });
  assert.equal((await worker.fetch(new Request("https://w/keys", { headers: { "X-Client-Id": "nope" } }), env)).status, 403);
  assert.equal((await worker.fetch(new Request("https://w/keys"), env)).status, 403);
  assert.equal((await worker.fetch(new Request("https://w/other", { headers: { "X-Client-Id": "id-1" } }), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://w/keys", { method: "POST", headers: { "X-Client-Id": "id-1" } }), env)).status, 404);
});
