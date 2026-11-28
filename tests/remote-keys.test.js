import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccess, getDeviceId, checkAccess, pullKeys } from "../src/remote-keys.js";
import worker from "../worker/index.js";
import { Registry, validateRegistration, validateDeviceKey, LIMITS } from "../worker/registry.js";
import { ADMIN_HTML } from "../worker/admin-page.js";

const reply = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

test("syncAccess sends the device id and returns keys when approved", async () => {
  let sent;
  const fetchFn = async (url, init) => { sent = { url, init }; return reply(200, { status: "approved", keys: { gemini: " g ", groq: "" } }); };
  const out = await syncAccess({ fetchFn, url: "https://x", deviceId: "d1" });
  assert.deepEqual(out, { status: "approved", keys: { gemini: "g" } });
  assert.equal(sent.init.headers["X-Device-Id"], "d1");
});

test("syncAccess registers an unknown device and reports pending", async () => {
  const calls = [];
  const fetchFn = async (url) => { calls.push(url); return url.endsWith("/keys") ? reply(403, { status: "unknown" }) : reply(200, { status: "pending" }); };
  assert.deepEqual(await syncAccess({ fetchFn, url: "https://x", deviceId: "d1" }), { status: "pending", keys: {} });
  assert.ok(calls.some((u) => u.endsWith("/register")));
});

test("syncAccess reports revoked, and throws on network failure", async () => {
  assert.deepEqual(await syncAccess({ fetchFn: async () => reply(403, { status: "revoked" }), url: "https://x", deviceId: "d1" }), { status: "revoked", keys: {} });
  await assert.rejects(syncAccess({ fetchFn: async () => { throw new Error("offline"); }, url: "https://x", deviceId: "d1" }), /network error/);
});

test("getDeviceId creates one id and keeps it", async () => {
  const store = {};
  const storage = { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) };
  const a = await getDeviceId(storage);
  assert.equal(await getDeviceId(storage), a);
  assert.match(a, /^[a-f0-9]{32}$/);
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

test("validateDeviceKey accepts a known provider and a sane key, rejects the rest", () => {
  const base = { deviceId: DEV, provider: "gemini", key: "AIzaSyDUMMYKEY1234" };
  assert.equal(validateDeviceKey(base), null);
  assert.equal(validateDeviceKey({ ...base, provider: "nope" }), "bad provider");
  assert.equal(validateDeviceKey({ ...base, key: "short" }), "bad key");
  assert.equal(validateDeviceKey({ ...base, hours: 0 }), "bad hours");
  assert.equal(validateDeviceKey({ ...base, deviceId: "x" }), "bad device id");
});

test("a device key is returned only when approved, and an expired one is dropped", async () => {
  const reg = new Registry(fakeState());
  const post = (path, body) => reg.fetch(new Request("https://r" + path, { method: "POST", body: JSON.stringify(body) }));
  await post("/register", { deviceId: DEV, name: "Dani", ip: "1.1.1.1" });
  await post("/setkey", { deviceId: DEV, provider: "gemini", key: "AIzaSyDUMMYKEY1234", hours: 2 });
  await post("/setkey", { deviceId: DEV, provider: "groq", key: "gsk_DUMMYKEY1234", hours: 0.000001 });
  assert.deepEqual((await (await post("/status", { deviceId: DEV })).json()).deviceKeys, {});
  await post("/set", { deviceId: DEV, status: "approved" });
  await new Promise((r) => setTimeout(r, 10));
  const got = await (await post("/status", { deviceId: DEV })).json();
  assert.deepEqual(got.deviceKeys, { gemini: "AIzaSyDUMMYKEY1234" });
});

test("list shows key providers and expiry but never the key values", async () => {
  const reg = new Registry(fakeState());
  const post = (path, body) => reg.fetch(new Request("https://r" + path, { method: "POST", body: JSON.stringify(body) }));
  await post("/register", { deviceId: DEV, name: "Dani", ip: "1.1.1.1" });
  await post("/setkey", { deviceId: DEV, provider: "gemini", key: "AIzaSyDUMMYKEY1234" });
  const text = JSON.stringify(await (await post("/list", {})).json());
  assert.ok(text.includes("gemini"));
  assert.ok(!text.includes("AIzaSyDUMMYKEY1234"));
});

test("a device key overrides the global key for the same provider on /keys", async () => {
  const reg = new Registry(fakeState());
  const env = {
    RVL_GEMINI_KEY: "global-g", RVL_GROQ_KEY: "global-q", RVL_ADMIN_KEY: "adm",
    REGISTRY: { idFromName: (n) => n, get: () => ({ fetch: (req) => reg.fetch(req) }) },
  };
  const send = (path, body, headers = {}) => worker.fetch(new Request("https://w" + path, { method: "POST", headers, body: JSON.stringify(body) }), env);
  await send("/register", { deviceId: DEV, name: "Dani", ip: "1.1.1.1" });
  await send("/admin/approve", { deviceId: DEV }, { "X-Admin-Key": "adm" });
  await send("/admin/setkey", { deviceId: DEV, provider: "gemini", key: "device-gemini-key" }, { "X-Admin-Key": "adm" });
  const res = await worker.fetch(new Request("https://w/keys", { headers: { "X-Device-Id": DEV } }), env);
  assert.deepEqual((await res.json()).keys, { gemini: "device-gemini-key", groq: "global-q" });
});

test("admin setkey refuses without the admin key", async () => {
  const env = { RVL_ADMIN_KEY: "adm", REGISTRY: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response("{}") }) } };
  const res = await worker.fetch(new Request("https://w/admin/setkey", { method: "POST", body: JSON.stringify({ deviceId: DEV, provider: "gemini", key: "AIzaSyDUMMYKEY1234" }) }), env);
  assert.equal(res.status, 403);
});

test("checkAccess stores the status and never asks for keys", async () => {
  const mem = () => {
    const m = {};
    return { m, get: async (k) => ({ [k]: m[k] }), set: async (o) => Object.assign(m, o), remove: async (k) => { delete m[k]; } };
  };
  const local = mem();
  const session = mem();
  session.m.remoteKeys = { gemini: "old" };
  const urls = [];
  const fetchFn = async (url) => { urls.push(url); return reply(200, { status: "approved" }); };
  assert.deepEqual(await checkAccess({ fetchFn, local, session, url: "https://x" }), { status: "approved" });
  assert.equal(local.m.lastAccess, "approved");
  assert.ok(urls.every((u) => u.endsWith("/status")));
  assert.deepEqual(session.m.remoteKeys, { gemini: "old" });
  await checkAccess({ fetchFn: async () => reply(200, { status: "revoked" }), local, session, url: "https://x" });
  assert.equal(local.m.lastAccess, "revoked");
  assert.equal(session.m.remoteKeys, undefined);
});

test("pullKeys fills session keys only when approved", async () => {
  const mem = () => {
    const m = {};
    return { m, get: async (k) => ({ [k]: m[k] }), set: async (o) => Object.assign(m, o), remove: async (k) => { delete m[k]; } };
  };
  const local = mem();
  const session = mem();
  const out = await pullKeys({ fetchFn: async () => reply(200, { status: "approved", keys: { gemini: "g" } }), local, session, url: "https://x" });
  assert.deepEqual(out, { status: "approved", count: 1 });
  assert.deepEqual(session.m.remoteKeys, { gemini: "g" });
  await pullKeys({ fetchFn: async () => reply(403, { status: "pending" }), local, session, url: "https://x" });
  assert.equal(session.m.remoteKeys, undefined);
});

test("the status endpoint never returns keys, even for an approved device", async () => {
  const reg = new Registry(fakeState());
  const env = {
    RVL_GEMINI_KEY: "g", RVL_ADMIN_KEY: "adm",
    REGISTRY: { idFromName: (n) => n, get: () => ({ fetch: (req) => reg.fetch(req) }) },
  };
  await worker.fetch(new Request("https://w/register", { method: "POST", body: JSON.stringify({ deviceId: DEV, name: "Dani", ip: "1.1.1.1" }) }), env);
  await worker.fetch(new Request("https://w/admin/approve", { method: "POST", headers: { "X-Admin-Key": "adm" }, body: JSON.stringify({ deviceId: DEV }) }), env);
  const res = await worker.fetch(new Request("https://w/status", { headers: { "X-Device-Id": DEV } }), env);
  const body = await res.json();
  assert.deepEqual(body, { status: "approved" });
});

test("keys merge in order: Worker secret, then global key, then device key", async () => {
  const reg = new Registry(fakeState());
  const env = {
    RVL_GEMINI_KEY: "env-g", RVL_ADMIN_KEY: "adm",
    REGISTRY: { idFromName: (n) => n, get: () => ({ fetch: (req) => reg.fetch(req) }) },
  };
  const admin = (path, body) => worker.fetch(new Request("https://w" + path, { method: "POST", headers: { "X-Admin-Key": "adm" }, body: JSON.stringify(body) }), env);
  const pull = () => worker.fetch(new Request("https://w/keys", { headers: { "X-Device-Id": DEV } }), env);
  await worker.fetch(new Request("https://w/register", { method: "POST", body: JSON.stringify({ deviceId: DEV, name: "Dani", ip: "1.1.1.1" }) }), env);
  await admin("/admin/approve", { deviceId: DEV });
  assert.equal((await (await pull()).json()).keys.gemini, "env-g");
  await admin("/admin/setglobal", { provider: "gemini", key: "global-gemini-key" });
  assert.equal((await (await pull()).json()).keys.gemini, "global-gemini-key");
  await admin("/admin/setkey", { deviceId: DEV, provider: "gemini", key: "device-gemini-key" });
  assert.equal((await (await pull()).json()).keys.gemini, "device-gemini-key");
});

test("admin list shows names, tails and expiry for devices and globals, never values", async () => {
  const reg = new Registry(fakeState());
  const env = { RVL_ADMIN_KEY: "adm", REGISTRY: { idFromName: (n) => n, get: () => ({ fetch: (req) => reg.fetch(req) }) } };
  const admin = (path, body) => worker.fetch(new Request("https://w" + path, { method: "POST", headers: { "X-Admin-Key": "adm" }, body: JSON.stringify(body) }), env);
  await worker.fetch(new Request("https://w/register", { method: "POST", body: JSON.stringify({ deviceId: DEV, name: "Dani", ip: "1.1.1.1" }) }), env);
  await admin("/admin/rename", { deviceId: DEV, name: "Dani laptop" });
  await admin("/admin/setkey", { deviceId: DEV, provider: "groq", key: "gsk_SECRETVALUE1234", hours: 4 });
  await admin("/admin/setglobal", { provider: "openai", key: "sk-GLOBALVALUE9999" });
  const data = await (await admin("/admin/list", {})).json();
  assert.equal(data.devices[DEV].name, "Dani laptop");
  assert.equal(data.devices[DEV].keys.groq.tail, "1234");
  assert.ok(data.devices[DEV].keys.groq.expires > Date.now());
  assert.equal(data.globals.openai.tail, "9999");
  const text = JSON.stringify(data);
  assert.ok(!text.includes("SECRETVALUE") && !text.includes("GLOBALVALUE"));
});

test("the admin page is served as HTML and holds no key values", async () => {
  const res = await worker.fetch(new Request("https://w/admin"), {});
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(await res.text(), /rvl admin/);
  assert.ok(ADMIN_HTML.includes("X-Admin-Key"));
});
