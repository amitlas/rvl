import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccess, getDeviceId, checkAccess, pullKeys } from "../src/remote-keys.js";

const reply = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

test("syncAccess sends the device id and returns keys when approved", async () => {
  let sent;
  const fetchFn = async (url, init) => { sent = { url, init }; return reply(200, { status: "approved", keys: { gemini: " g ", groq: "" } }); };
  const out = await syncAccess({ fetchFn, url: "https://x", deviceId: "d1" });
  assert.deepEqual(out, { status: "approved", keys: { gemini: ["g"] } });
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
  const out = await pullKeys({ fetchFn: async () => reply(200, { status: "approved", keys: { gemini: ["g"] } }), local, session, url: "https://x" });
  assert.deepEqual(out, { status: "approved", count: 1 });
  assert.deepEqual(session.m.remoteKeys, { gemini: ["g"] });
  await pullKeys({ fetchFn: async () => reply(403, { status: "pending" }), local, session, url: "https://x" });
  assert.equal(session.m.remoteKeys, undefined);
});
