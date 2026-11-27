import { test } from "node:test";
import assert from "node:assert/strict";
import { pullRemoteKeys } from "../src/remote-keys.js";
import worker from "../worker/index.js";
import { Registry, validateRegistration, LIMITS } from "../worker/registry.js";

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

function fakeState() {
  const map = new Map();
  return { storage: {
    get: async (k) => map.get(k),
    put: async (k, v) => { map.set(k, v); },
    list: async ({ prefix = "" } = {}) => new Map([...map].filter(([k]) => k.startsWith(prefix))),
  } };
}

const DEV = "a".repeat(32);
const ok = (env) => env;

test("validateRegistration accepts a 32-hex id and a name, rejects the rest", () => {
  assert.equal(validateRegistration({ deviceId: DEV, name: "Dani" }), null);
  assert.equal(validateRegistration({ deviceId: "xyz", name: "Dani" }), "bad device id");
  assert.equal(validateRegistration({ deviceId: DEV, name: "<script>" }), "bad name");
  assert.equal(validateRegistration(null), "bad body");
});

test("register stores pending, a repeat returns the same status, and IPs are rate limited", async () => {
  const reg = new Registry(fakeState());
  const send = (deviceId, ip = "1.1.1.1") => reg.fetch(new Request("https://r/register", { method: "POST", body: JSON.stringify({ deviceId, name: "x", ip }) }));
  assert.deepEqual(await (await send(DEV)).json(), { status: "pending" });
  assert.deepEqual(await (await send(DEV)).json(), { status: "pending" });
  for (let i = 0; i < LIMITS.perIpPerHour - 1; i++) await send("b".repeat(31) + String(i % 10), "1.1.1.1");
  assert.equal((await send("c".repeat(32), "1.1.1.1")).status, 429);
  assert.equal((await send("d".repeat(32), "2.2.2.2")).status, 200);
});

test("pending registrations are capped", async () => {
  const reg = new Registry(fakeState());
  for (let i = 0; i < LIMITS.maxPending; i++) {
    const id = i.toString(16).padStart(32, "0");
    await reg.fetch(new Request("https://r/register", { method: "POST", body: JSON.stringify({ deviceId: id, name: "x", ip: "ip" + i }) }));
  }
  const res = await reg.fetch(new Request("https://r/register", { method: "POST", body: JSON.stringify({ deviceId: "f".repeat(32), name: "x", ip: "last" }) }));
  assert.equal(res.status, 503);
});

test("keys go only to an approved device; approve, revoke and unknown are gated", async () => {
  const reg = new Registry(fakeState());
  const env = ok({
    RVL_GEMINI_KEY: "g", RVL_ADMIN_KEY: "adm",
    REGISTRY: { idFromName: (n) => n, get: () => ({ fetch: (req) => reg.fetch(req) }) },
  });
  const pull = (id) => worker.fetch(new Request("https://w/keys", { headers: { "X-Device-Id": id } }), env);
  const admin = (path, body) => worker.fetch(new Request("https://w" + path, { method: "POST", headers: { "X-Admin-Key": "adm" }, body: JSON.stringify(body) }), env);

  assert.equal((await pull(DEV)).status, 403); // unknown
  await worker.fetch(new Request("https://w/register", { method: "POST", body: JSON.stringify({ deviceId: DEV, name: "Dani", ip: "9.9.9.9" }) }), env);
  assert.equal((await pull(DEV)).status, 403); // pending
  assert.equal((await admin("/admin/approve", { deviceId: DEV })).status, 200);
  const granted = await pull(DEV);
  assert.equal(granted.status, 200);
  assert.deepEqual((await granted.json()).keys, { gemini: "g" });
  assert.equal((await admin("/admin/revoke", { deviceId: DEV })).status, 200);
  assert.equal((await pull(DEV)).status, 403); // revoked
});

test("admin routes refuse a wrong or missing admin key", async () => {
  const env = { RVL_ADMIN_KEY: "adm", REGISTRY: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response("{}") }) } };
  const res = await worker.fetch(new Request("https://w/admin/list", { method: "POST", headers: { "X-Admin-Key": "nope" } }), env);
  assert.equal(res.status, 403);
});
