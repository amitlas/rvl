// Admin page served at /admin. It contains no secrets: every action sends the
// admin key the owner types in, as a request header. The key stays in this tab's
// sessionStorage only. Key values are never shown, only the last 4 characters.

export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>rvl admin</title>
<style>
  body { font: 14px system-ui, sans-serif; max-width: 920px; margin: 24px auto; padding: 0 16px; }
  .card { border: 1px solid #ccc; border-radius: 8px; padding: 12px; margin: 12px 0; }
  .muted { color: #666; font-size: 12px; }
  .bad { color: #b91c1c; }
  .ok { color: #15803d; }
  input, select { padding: 4px 6px; margin: 2px; }
  button { margin: 2px; padding: 4px 10px; }
  .row { margin: 4px 0; }
</style>
</head>
<body>
<h2>rvl admin</h2>
<p class="row">
  <input id="adminKey" type="password" placeholder="admin key" size="40">
  <button id="connect">Connect</button>
  <span id="status" class="muted"></span>
</p>

<h3>Global keys (every approved client)</h3>
<div id="globals"></div>
<div class="card">
  <select id="gProvider"></select>
  <input id="gKey" type="password" placeholder="key" size="40">
  <input id="gHours" placeholder="hours (empty = no expiry)" size="22">
  <button id="gAdd">Add global key</button>
</div>

<h3>Clients</h3>
<div id="devices"></div>

<script>
var PROVIDERS = ["gemini", "groq", "openrouter", "openai", "anthropic"];
var adminKey = sessionStorage.getItem("rvlAdminKey") || "";

function $(id) { return document.getElementById(id); }

function el(tag, text, cls) {
  var e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function when(expires) {
  if (!expires) return "no expiry";
  return "until " + new Date(expires).toLocaleString();
}

function hoursOf(text) {
  var t = String(text || "").trim();
  return t ? Number(t) : undefined;
}

async function api(path, body) {
  var res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Admin-Key": adminKey },
    body: JSON.stringify(body || {})
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}

function action(label, fn) {
  var b = el("button", label);
  b.addEventListener("click", async function () {
    try { await fn(); await load(); } catch (err) { $("status").textContent = err.message; $("status").className = "bad"; }
  });
  return b;
}

function keyLine(provider, entry, onDelete) {
  var row = el("div", undefined, "row");
  row.appendChild(el("span", provider + "  ...." + entry.tail + "  (" + when(entry.expires) + ")"));
  row.appendChild(action("Delete", function () { return onDelete(provider); }));
  return row;
}

function renderGlobals(globals) {
  var box = $("globals");
  box.replaceChildren();
  var names = Object.keys(globals);
  if (names.length === 0) box.appendChild(el("div", "No global keys.", "muted"));
  names.forEach(function (p) {
    box.appendChild(keyLine(p, globals[p], function (prov) { return api("/admin/delglobal", { provider: prov }); }));
  });
}

function renderDevices(devices) {
  var box = $("devices");
  box.replaceChildren();
  var ids = Object.keys(devices);
  if (ids.length === 0) box.appendChild(el("div", "No clients yet. A client appears after it installs and checks.", "muted"));
  ids.forEach(function (id) {
    var d = devices[id];
    var card = el("div", undefined, "card");

    var head = el("div", undefined, "row");
    var name = el("input");
    name.value = d.name || "";
    name.size = 24;
    head.appendChild(name);
    head.appendChild(action("Save name", function () { return api("/admin/rename", { deviceId: id, name: name.value }); }));
    head.appendChild(el("span", "  status: " + d.status, d.status === "approved" ? "ok" : "bad"));
    head.appendChild(action("Approve", function () { return api("/admin/approve", { deviceId: id }); }));
    head.appendChild(action("Revoke", function () { return api("/admin/revoke", { deviceId: id }); }));
    card.appendChild(head);
    card.appendChild(el("div", "device id: " + id, "muted"));

    var keys = d.keys || {};
    var providers = Object.keys(keys);
    if (providers.length === 0) card.appendChild(el("div", "No client keys.", "muted"));
    providers.forEach(function (p) {
      card.appendChild(keyLine(p, keys[p], function (prov) { return api("/admin/delkey", { deviceId: id, provider: prov }); }));
    });

    var add = el("div", undefined, "row");
    var sel = el("select");
    PROVIDERS.forEach(function (p) { var o = el("option", p); o.value = p; sel.appendChild(o); });
    var key = el("input");
    key.type = "password";
    key.placeholder = "key";
    key.size = 30;
    var hours = el("input");
    hours.placeholder = "hours (empty = no expiry)";
    hours.size = 22;
    add.appendChild(sel);
    add.appendChild(key);
    add.appendChild(hours);
    add.appendChild(action("Add key", function () {
      return api("/admin/setkey", { deviceId: id, provider: sel.value, key: key.value, hours: hoursOf(hours.value) });
    }));
    card.appendChild(add);
    box.appendChild(card);
  });
}

async function load() {
  var data = await api("/admin/list", {});
  renderGlobals(data.globals || {});
  renderDevices(data.devices || {});
  $("status").textContent = "loaded " + new Date().toLocaleTimeString();
  $("status").className = "muted";
}

$("adminKey").value = adminKey;
PROVIDERS.forEach(function (p) { var o = el("option", p); o.value = p; $("gProvider").appendChild(o); });

$("connect").addEventListener("click", async function () {
  adminKey = $("adminKey").value.trim();
  sessionStorage.setItem("rvlAdminKey", adminKey);
  try { await load(); } catch (err) { $("status").textContent = err.message; $("status").className = "bad"; }
});

$("gAdd").addEventListener("click", async function () {
  try {
    await api("/admin/setglobal", { provider: $("gProvider").value, key: $("gKey").value, hours: hoursOf($("gHours").value) });
    $("gKey").value = "";
    await load();
  } catch (err) { $("status").textContent = err.message; $("status").className = "bad"; }
});

if (adminKey) load().catch(function (err) { $("status").textContent = err.message; $("status").className = "bad"; });
</script>
</body>
</html>
`;
