// Keys come from the rvl-keys Worker. Each install has a random device id; the
// owner approves it there. Keys live in chrome.storage.session only.

export const REMOTE_KEYS_URL = "https://rvl-keys.lasry1.workers.dev";
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
