// Keys pulled from the rvl-keys Worker when the owner presses the pull shortcut.
// They are kept in chrome.storage.session only, so they are gone when Chrome closes.

// Set to the Worker's URL after `wrangler deploy`.
export const REMOTE_KEYS_URL = "https://rvl-keys.workers.dev/keys";
// Shared identifier, not a secret: anyone who unpacks the extension can read it.
export const RVL_CLIENT_ID = "rvl-c-7f3a9e2b41d85c06e8a1f4b9d2c73e50";
export const REMOTE_STORAGE_KEY = "remoteKeys";

// Returns {provider: key} from the Worker. Throws an Error with a short reason
// on any failure; the caller decides what the user sees.
export async function pullRemoteKeys({ fetchFn = fetch, url = REMOTE_KEYS_URL, clientId = RVL_CLIENT_ID } = {}) {
  let res;
  try {
    res = await fetchFn(url, { headers: { "X-Client-Id": clientId } });
  } catch {
    throw new Error("network error");
  }
  if (res.status === 401 || res.status === 403) throw new Error("client id rejected");
  if (!res.ok) throw new Error(`server error ${res.status}`);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error("bad response");
  }
  const keys = {};
  for (const [id, key] of Object.entries(body?.keys ?? {})) {
    if (typeof key === "string" && key.trim()) keys[id] = key.trim();
  }
  if (Object.keys(keys).length === 0) throw new Error("no keys on server");
  return keys;
}
