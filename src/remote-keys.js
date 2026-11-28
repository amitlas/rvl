// Keys come from the rvl service on unishit-worker. Each install has a random device id; the
// owner approves it there. Keys live in chrome.storage.session only.

export const REMOTE_KEYS_URL = "https://unishit-worker.lasry1.workers.dev/rvl";
export const REMOTE_STORAGE_KEY = "remoteKeys";
const DEVICE_KEY = "deviceId";

// One random id per install, kept in chrome.storage.local.
export async function getDeviceId(storage = chrome.storage.local) {
  const { [DEVICE_KEY]: existing } = await storage.get(DEVICE_KEY);
  if (existing) return existing;
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await storage.set({ [DEVICE_KEY]: id });
  return id;
}

const cleanKeys = (keys = {}) => {
  const out = {};
  for (const [id, key] of Object.entries(keys)) {
    if (typeof key === "string" && key.trim()) out[id] = key.trim();
  }
  return out;
};

// Asks the Worker for this device's status. Returns {status, keys}; keys are
// present only when approved. An unknown device is registered and reported as
// pending. Throws only when the Worker cannot be reached or answers unexpectedly.
export async function syncAccess({ fetchFn = fetch, url = REMOTE_KEYS_URL, deviceId, name = "rvl" } = {}) {
  let res;
  try {
    res = await fetchFn(`${url}/keys`, { headers: { "X-Device-Id": deviceId } });
  } catch {
    throw new Error("network error");
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 200 && body.status === "approved") return { status: "approved", keys: cleanKeys(body.keys) };
  if (res.status === 403 && body.status === "unknown") {
    await fetchFn(`${url}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, name }),
    }).catch(() => {});
    return { status: "pending", keys: {} };
  }
  if (res.status === 403 && body.status) return { status: body.status, keys: {} };
  throw new Error(`server error ${res.status}`);
}

// Startup check: asks only for this device status (no keys). Stores the status
// in local storage. Keys already in session are dropped unless the device is approved.
export async function checkAccess({ fetchFn = fetch, local = chrome.storage.local, session = chrome.storage.session, url = REMOTE_KEYS_URL } = {}) {
  const deviceId = await getDeviceId(local);
  let res;
  try {
    res = await fetchFn(`${url}/status`, { headers: { "X-Device-Id": deviceId } });
  } catch {
    throw new Error("network error");
  }
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || !body.status) throw new Error(`server error ${res.status}`);
  if (body.status === "unknown") {
    await fetchFn(`${url}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId, name: "rvl" }),
    }).catch(() => {});
  }
  await local.set({ lastAccess: body.status });
  if (body.status !== "approved") await session.remove(REMOTE_STORAGE_KEY);
  return { status: body.status };
}

// Button: fetches the API keys for this device (approved only) into session storage.
export async function pullKeys({ fetchFn = fetch, local = chrome.storage.local, session = chrome.storage.session, url = REMOTE_KEYS_URL } = {}) {
  const deviceId = await getDeviceId(local);
  const { status, keys } = await syncAccess({ fetchFn, url, deviceId });
  await local.set({ lastAccess: status });
  if (status === "approved") await session.set({ [REMOTE_STORAGE_KEY]: keys });
  else await session.remove(REMOTE_STORAGE_KEY);
  return { status, count: Object.keys(keys).length };
}
