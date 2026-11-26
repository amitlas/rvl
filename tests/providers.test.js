import { toggleKeyVisibility, describeChain } from "../src/options-state.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstructions, buildRequest } from "../src/gemini.js";
import { buildChatRequest, extractJson, parseChatResponse, askOpenAICompatible } from "../src/openai.js";
import { PROVIDERS, ask, askChain, chainFromStorage, fetchModels, modelOptions, resolveSettings, settingsFromStorage } from "../src/providers.js";
import { describeTestResult } from "../src/keytest.js";

function providerOrder(chain) {
  return [...new Set(chain.map((c) => c.provider))];
}

function chatBody(content) {
  return { choices: [{ message: { content } }] };
}

test("buildChatRequest sends system instructions and the question", () => {
  const req = buildChatRequest("Q", "m");
  assert.equal(req.model, "m");
  assert.equal(req.messages[0].role, "system");
  assert.match(req.messages[0].content, /JSON/);
  assert.deepEqual(req.messages[1], { role: "user", content: "Q" });
});

test("extractJson accepts bare, fenced and embedded JSON", () => {
  assert.deepEqual(extractJson('{"answer":"B"}'), { answer: "B" });
  assert.deepEqual(extractJson('```json\n{"answer":"ג","reason":"r"}\n```'), { answer: "ג", reason: "r" });
  assert.deepEqual(extractJson('Sure: {"answer":"C"} done'), { answer: "C" });
  assert.equal(extractJson("no json here"), null);
});

test("parseChatResponse maps errors and parses answers", () => {
  assert.deepEqual(parseChatResponse(200, chatBody('{"answer":" A ","reason":"x"}')), { answer: "A", reason: "x", options: [] });
  assert.throws(() => parseChatResponse(401, {}), /Invalid API key/);
  assert.throws(() => parseChatResponse(429, {}), /quota/);
  assert.throws(() => parseChatResponse(500, { error: { message: "down" } }), /down/);
  assert.throws(() => parseChatResponse(200, { choices: [] }), /empty/);
  assert.throws(() => parseChatResponse(200, chatBody("B")), /unreadable/);
});

test("askOpenAICompatible posts to baseUrl/chat/completions with a Bearer key", async () => {
  let seen;
  const fetchFn = async (url, init) => { seen = { url, init }; return { status: 200, json: async () => chatBody('{"answer":"B"}') }; };
  const out = await askOpenAICompatible("Q", "KEY", { baseUrl: "https://x.test/v1", model: "m", fetchFn });
  assert.equal(out.answer, "B");
  assert.equal(seen.url, "https://x.test/v1/chat/completions");
  assert.equal(seen.init.headers.Authorization, "Bearer KEY");
  await assert.rejects(
    askOpenAICompatible("Q", "k", { baseUrl: "https://x.test", model: "m", fetchFn: async () => { throw new Error(); } }),
    /network/,
  );
});

test("ask routes gemini to the Gemini API and others to their base URL", async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    const body = url.includes("generativelanguage")
      ? { candidates: [{ content: { parts: [{ text: '{"answer":"A","reason":""}' }] } }] }
      : chatBody('{"answer":"A"}');
    return { status: 200, json: async () => body };
  };
  await ask("Q", { provider: "gemini", apiKey: "k" }, { fetchFn });
  await ask("Q", { provider: "groq", apiKey: "k" }, { fetchFn });
  await ask("Q", { provider: "openrouter", apiKey: "k" }, { fetchFn });
  assert.match(urls[0], /generativelanguage\.googleapis\.com.*gemini-flash-lite-latest:generateContent/);
  assert.equal(urls[1], `${PROVIDERS.groq.baseUrl}/chat/completions`);
  assert.equal(urls[2], `${PROVIDERS.openrouter.baseUrl}/chat/completions`);
});

test("resolveSettings falls back to the default provider and model", () => {
  assert.deepEqual(resolveSettings({ provider: "nope", apiKey: " k " }), {
    provider: "pollinations", apiKey: "k", model: "openai", allowMultiple: true,
  });
  assert.equal(resolveSettings({ provider: "groq", model: "" }).model, PROVIDERS.groq.defaultModel);
});

test("settingsFromStorage picks the selected provider's key and model", () => {
  const stored = { provider: "groq", keys: { gemini: "g", groq: "q" }, models: { groq: "custom" } };
  assert.deepEqual(settingsFromStorage(stored), { provider: "groq", apiKey: "q", model: "custom", allowMultiple: true });
  assert.equal(settingsFromStorage({}).apiKey, "");
});

test("settingsFromStorage still reads the 0.1 single-key layout", () => {
  assert.deepEqual(settingsFromStorage({ apiKey: "old", model: "" }), {
    provider: "gemini", apiKey: "old", model: PROVIDERS.gemini.defaultModel, allowMultiple: true,
  });
});

test("describeTestResult reports success, wrong-answer warning and failure", () => {
  assert.deepEqual(describeTestResult({ answer: "B", expected: "B" }), { ok: true, text: "Saved. Key works." });
  assert.equal(describeTestResult({ answer: "b. 4", expected: "B" }).ok, true);
  const wrong = describeTestResult({ answer: "C", expected: "B" });
  assert.equal(wrong.ok, true);
  assert.match(wrong.text, /answered "C"/);
  const failed = describeTestResult({ error: new Error("Invalid API key (check options)") });
  assert.equal(failed.ok, false);
  assert.match(failed.text, /test failed: Invalid API key/);
});

test("allowMultiple defaults to on and only an explicit false turns it off", () => {
  assert.equal(settingsFromStorage({}).allowMultiple, true);
  assert.equal(settingsFromStorage({ allowMultiple: true }).allowMultiple, true);
  assert.equal(settingsFromStorage({ allowMultiple: false }).allowMultiple, false);
});

test("instructions allow, but do not require, a second answer when allowMultiple is on", () => {
  const multi = buildInstructions({ allowMultiple: true });
  assert.match(multi, /One or two options may be correct/);
  assert.match(multi, /Check every option on its own/);
  assert.match(multi, /even when the question does not say so/);
  assert.match(multi, /Never return more than two/);
  assert.match(buildInstructions(), /One or two options may be correct/);
  const single = buildInstructions({ allowMultiple: false });
  assert.match(single, /single correct option/);
  assert.doesNotMatch(single, /One or two options may be correct/);
});

test("allowMultiple reaches both request formats", async () => {
  const geminiText = (o) => buildRequest("Q", o).systemInstruction.parts[0].text;
  assert.match(geminiText({ allowMultiple: false }), /single correct option/);
  assert.match(geminiText(), /One or two options may be correct/);
  assert.match(buildChatRequest("Q", "m", { allowMultiple: false }).messages[0].content, /single correct option/);
  assert.match(buildChatRequest("Q", "m").messages[0].content, /One or two options may be correct/);

  const bodies = [];
  const fetchFn = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { status: 200, json: async () => chatBody('{"answer":"A"}') };
  };
  await ask("Q", { provider: "groq", apiKey: "k", allowMultiple: false }, { fetchFn });
  assert.match(bodies[0].messages[0].content, /single correct option/);
});

test("chainFromStorage puts the selected provider first and skips providers without a key", () => {
  const chain = chainFromStorage({ provider: "groq", keys: { gemini: "g", groq: "q", openrouter: "" }, allowMultiple: false });
  assert.deepEqual(providerOrder(chain), ["groq", "gemini", "pollinations"]);
  assert.ok(chain.filter((c) => c.provider === "groq").every((c) => c.apiKey === "q"));
  assert.ok(chain.every((c) => c.allowMultiple === false));
  assert.deepEqual(providerOrder(chainFromStorage({ provider: "groq", keys: { openrouter: "o" } })), ["openrouter", "pollinations"]);
  assert.deepEqual(providerOrder(chainFromStorage({})), ["pollinations"]);
  assert.deepEqual(providerOrder(chainFromStorage({ apiKey: "old" })), ["gemini", "pollinations"]);
});

function routedFetch(statusByHost) {
  const calls = [];
  const fetchFn = async (url) => {
    const host = new URL(url).host;
    calls.push(host);
    const status = statusByHost[host] ?? 200;
    const body = host.startsWith("generativelanguage")
      ? { candidates: [{ content: { parts: [{ text: '{"answer":"G","reason":""}' }] } }] }
      : chatBody(`{"answer":"${host[0].toUpperCase()}"}`);
    return { status, json: async () => (status === 200 ? body : {}) };
  };
  return { fetchFn, calls };
}

test("askChain falls back to the next provider when one runs out of quota", async () => {
  const chain = chainFromStorage({ provider: "gemini", keys: { gemini: "g", groq: "q" } });
  const { fetchFn, calls } = routedFetch({ "generativelanguage.googleapis.com": 429 });
  const out = await askChain("Q", chain, { fetchFn });
  assert.equal(out.answer, "A"); // from api.groq.com
  // Every Gemini model is tried (each has its own quota) before Groq.
  assert.equal(calls.filter((h) => h.startsWith("generativelanguage")).length, PROVIDERS.gemini.models.length);
  assert.equal(calls.at(-1), "api.groq.com");
});

test("askChain stops at the first provider that works", async () => {
  const chain = chainFromStorage({ provider: "gemini", keys: { gemini: "g", groq: "q" } });
  const { fetchFn, calls } = routedFetch({});
  assert.equal((await askChain("Q", chain, { fetchFn })).answer, "G");
  assert.deepEqual(calls, ["generativelanguage.googleapis.com"]);
});

test("askChain reports every failure when all providers fail", async () => {
  const chain = chainFromStorage({ provider: "gemini", keys: { gemini: "g", groq: "q", openrouter: "o" } });
  const { fetchFn } = routedFetch({ "generativelanguage.googleapis.com": 429, "api.groq.com": 401, "openrouter.ai": 500, "text.pollinations.ai": 503 });
  await assert.rejects(askChain("Q", chain, { fetchFn }), (err) => {
    assert.match(err.message, /^All providers failed/);
    assert.match(err.message, /gemini: .*quota/);
    assert.match(err.message, /groq: Invalid API key/);
    assert.match(err.message, /openrouter: /);
    assert.match(err.message, /pollinations: /);
    return true;
  });
});

test("askChain with one provider shows its own error unchanged", async () => {
  const chain = chainFromStorage({ provider: "gemini", keys: { gemini: "g" } }).filter((c) => c.provider === "gemini");
  const { fetchFn } = routedFetch({ "generativelanguage.googleapis.com": 429 });
  await assert.rejects(askChain("Q", chain, { fetchFn }), /Gemini free-tier quota reached/);
  await assert.rejects(askChain("Q", [], { fetchFn }), /Set an API key/);
});

import { normalizeStored, withEdit, withProvider } from "../src/options-state.js";

test("typing a key for one provider never drops another provider's key", () => {
  let s = normalizeStored({});
  s = withEdit(s, "gemini", { key: " AIzaX ", model: "" });
  s = withProvider(s, "groq"); // switch provider before saving anything else
  s = withEdit(s, "groq", { key: "gsk_Y", model: "" });
  assert.deepEqual(s.keys, { gemini: "AIzaX", groq: "gsk_Y" });
  assert.equal(s.provider, "groq");
  assert.deepEqual(providerOrder(chainFromStorage(s)), ["groq", "gemini", "pollinations"]);
});

test("normalizeStored keeps a 0.1 single Gemini key and defaults", () => {
  assert.deepEqual(normalizeStored({ apiKey: "old", model: "m" }), {
    provider: "gemini", keys: { gemini: "old" }, models: { gemini: "m" }, allowMultiple: true,
  });
  assert.equal(normalizeStored({ keys: { gemini: "new" }, apiKey: "old" }).keys.gemini, "new");
  assert.equal(normalizeStored({ provider: "bogus" }).provider, "pollinations");
  assert.equal(normalizeStored({ keys: { groq: "q" } }).provider, "groq");
  assert.equal(normalizeStored({ allowMultiple: false }).allowMultiple, false);
});

test("withProvider ignores unknown providers", () => {
  assert.equal(withProvider(normalizeStored({ provider: "groq" }), "nope").provider, "groq");
});

test("chain tries the chosen model first, then the provider's other models", () => {
  const geminiOnly = (c) => c.filter((x) => x.provider === "gemini");
  const chain = geminiOnly(chainFromStorage({ provider: "gemini", keys: { gemini: "g" }, models: { gemini: "gemini-2.5-flash" } }));
  assert.equal(chain[0].model, "gemini-2.5-flash");
  assert.deepEqual(chain.map((c) => c.model).sort(), [...PROVIDERS.gemini.models].sort());
  const auto = geminiOnly(chainFromStorage({ provider: "gemini", keys: { gemini: "g" } }));
  assert.deepEqual(auto.map((c) => c.model), PROVIDERS.gemini.models);
});

test("a model out of quota falls back to the next model of the same provider", async () => {
  const chain = chainFromStorage({ provider: "gemini", keys: { gemini: "g" } });
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    if (url.includes(`/${PROVIDERS.gemini.models[0]}:`)) return { status: 429, json: async () => ({}) };
    return { status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"answer":"B","reason":""}' }] } }] }) };
  };
  assert.equal((await askChain("Q", chain, { fetchFn })).answer, "B");
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes(`/${PROVIDERS.gemini.models[1]}:`));
});

test("a bad key skips the provider's other models", async () => {
  const chain = chainFromStorage({ provider: "groq", keys: { groq: "bad", gemini: "g" } });
  const { fetchFn, calls } = routedFetch({ "api.groq.com": 401 });
  assert.equal((await askChain("Q", chain, { fetchFn })).answer, "G");
  assert.deepEqual(calls, ["api.groq.com", "generativelanguage.googleapis.com"]);
});

test("fetchModels lists usable live models per provider, [] on failure", async () => {
  const gemini = async () => ({ status: 200, json: async () => ({ models: [
    { name: "models/gemini-9-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-9-flash-tts", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
  ] }) });
  assert.deepEqual(await fetchModels("gemini", "k", { fetchFn: gemini }), ["gemini-9-flash"]);

  const list = (ids) => async () => ({ status: 200, json: async () => ({ data: ids.map((id) => ({ id })) }) });
  assert.deepEqual(await fetchModels("openrouter", "k", { fetchFn: list(["a/b:free", "a/c"]) }), ["a/b:free"]);
  assert.deepEqual(await fetchModels("groq", "k", { fetchFn: list(["llama-x", "whisper-large-v3"]) }), ["llama-x"]);

  assert.deepEqual(await fetchModels("groq", "k", { fetchFn: async () => ({ status: 401, json: async () => ({}) }) }), []);
  assert.deepEqual(await fetchModels("groq", "k", { fetchFn: async () => { throw new Error(); } }), []);
  assert.deepEqual(await fetchModels("groq", "", { fetchFn: list(["x"]) }), []);
});

test("modelOptions keeps built-in models first and adds only new live ones", () => {
  const { builtIn, extra } = modelOptions("gemini", ["zeta", PROVIDERS.gemini.models[0], "alpha", "zeta"]);
  assert.deepEqual(builtIn, PROVIDERS.gemini.models);
  assert.deepEqual(extra, ["alpha", "zeta"]);
});



test("with no keys the keyless Pollinations is the default", () => {
  const chain = chainFromStorage({});
  assert.deepEqual(chain.map((c) => c.provider), ["pollinations"]);
  assert.equal(settingsFromStorage({}).provider, "pollinations");
});

test("the removed Chrome built-in AI never comes back, even if stored from an old version", () => {
  assert.equal(PROVIDERS.chrome, undefined);
  assert.equal(settingsFromStorage({ provider: "chrome" }).provider, "pollinations");
  assert.equal(normalizeStored({ provider: "chrome", keys: { gemini: "g" } }).provider, "gemini");
  assert.ok(!chainFromStorage({ provider: "chrome" }).some((c) => c.provider === "chrome"));
});

test("Pollinations is called without a key or Authorization header", async () => {
  let seen;
  const fetchFn = async (url, init) => { seen = { url, init }; return { status: 200, json: async () => chatBody('{"answer":"B"}') }; };
  assert.equal((await ask("Q", { provider: "pollinations" }, { fetchFn })).answer, "B");
  assert.equal(seen.url, "https://text.pollinations.ai/openai");
  assert.equal(seen.init.headers.Authorization, undefined);
  assert.equal(JSON.parse(seen.init.body).model, "openai");
});


test("askChain falls back to keyless Pollinations when every keyed provider fails", async () => {
  const chain = chainFromStorage({ provider: "gemini", keys: { gemini: "g" } });
  const { fetchFn, calls } = routedFetch({ "generativelanguage.googleapis.com": 429 });
  assert.equal((await askChain("Q", chain, { fetchFn })).answer, "T"); // "T" from text.pollinations.ai
  assert.equal(calls.at(-1), "text.pollinations.ai");
});







test("a 402 from the keyless service explains the limit", () => {
  assert.throws(() => parseChatResponse(402, {}), /Free no-key limit reached/);
});

test("keyless Pollinations retries its 402 limit, then succeeds", async () => {
  let calls = 0;
  const slept = [];
  const fetchFn = async () => {
    calls++;
    return calls < 3 ? { status: 402, json: async () => ({}) } : { status: 200, json: async () => chatBody('{"answer":"B"}') };
  };
  const out = await ask("Q", { provider: "pollinations" }, { fetchFn, sleep: async (ms) => { slept.push(ms); } });
  assert.equal(out.answer, "B");
  assert.equal(calls, 3);
  assert.deepEqual(slept, [10000, 10000]);
});

test("keyless Pollinations gives up after its retries with the limit message", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return { status: 402, json: async () => ({}) }; };
  await assert.rejects(ask("Q", { provider: "pollinations" }, { fetchFn, sleep: async () => {} }), /Free no-key limit reached/);
  assert.equal(calls, PROVIDERS.pollinations.retryOn402.tries);
});

test("keyed providers do not retry a 402", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return { status: 402, json: async () => ({}) }; };
  await assert.rejects(ask("Q", { provider: "groq", apiKey: "k" }, { fetchFn, sleep: async () => {} }), /limit/);
  assert.equal(calls, 1);
});



test("each provider tries its cheapest model first", () => {
  assert.equal(PROVIDERS.gemini.defaultModel, "gemini-flash-lite-latest");
  assert.ok(PROVIDERS.gemini.models.slice(0, 3).every((m) => m.includes("lite")));
  assert.equal(PROVIDERS.groq.defaultModel, "llama-3.1-8b-instant");
  assert.equal(PROVIDERS.openrouter.defaultModel, "google/gemma-4-26b-a4b-it:free");
  const chain = chainFromStorage({ provider: "gemini", keys: { gemini: "g" } });
  assert.equal(chain[0].model, "gemini-flash-lite-latest");
});

import { FREEZE_MS, freezeKey } from "../src/providers.js";

test("a model out of quota is frozen for an hour and then skipped without a request", async () => {
  const chain = chainFromStorage({ provider: "gemini", keys: { gemini: "g" } });
  const { fetchFn, calls } = routedFetch({ "generativelanguage.googleapis.com": 429 });
  const frozen = {};
  const lines = [];
  const opts = { fetchFn, frozen, now: 1000, onFreeze: (key, until) => { frozen[key] = until; }, log: (l) => lines.push(l) };
  await askChain("Q", chain, opts);
  assert.deepEqual(Object.keys(frozen), PROVIDERS.gemini.models.map((model) => freezeKey({ provider: "gemini", model })));
  assert.ok(Object.values(frozen).every((until) => until === 1000 + FREEZE_MS));
  assert.equal(lines.length, PROVIDERS.gemini.models.length);

  calls.length = 0;
  await askChain("Q", chain, { ...opts, now: 1000 + FREEZE_MS - 1 });
  assert.deepEqual(calls, ["text.pollinations.ai"]); // straight to the free one

  calls.length = 0;
  await askChain("Q", chain, { ...opts, now: 1000 + FREEZE_MS });
  assert.equal(calls[0], "generativelanguage.googleapis.com"); // hour over: asked again
});

test("only quota freezes: a bad key or an outage does not, and the keyless provider never does", async () => {
  const chain = chainFromStorage({ provider: "groq", keys: { groq: "bad", openrouter: "o" } });
  const { fetchFn } = routedFetch({ "api.groq.com": 401, "openrouter.ai": 500, "text.pollinations.ai": 429 });
  const frozenKeys = [];
  await assert.rejects(askChain("Q", chain, { fetchFn, onFreeze: (key) => frozenKeys.push(key) }));
  assert.deepEqual(frozenKeys, []);
});

test("keyed providers get 5 seconds to answer, the slow keyless one 20", async () => {
  const waits = {};
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => ({ ms });
  try {
    const fetchFn = async (url, init) => {
      waits[new URL(url).host] = init.signal.ms;
      return { status: 500, json: async () => ({}) };
    };
    const chain = chainFromStorage({ provider: "gemini", keys: { gemini: "g", groq: "q" } });
    await assert.rejects(askChain("Q", chain, { fetchFn }));
  } finally {
    AbortSignal.timeout = realTimeout;
  }
  assert.deepEqual(waits, { "generativelanguage.googleapis.com": 5000, "api.groq.com": 5000, "text.pollinations.ai": 20000 });
});

import { askAnthropic, buildMessagesRequest, parseMessagesResponse } from "../src/anthropic.js";

test("Claude request: Messages API shape, browser header, no sampling parameters", async () => {
  const req = buildMessagesRequest("Q", "claude-opus-5-5", { allowMultiple: false });
  assert.equal(req.model, "claude-opus-5-5");
  assert.match(req.system, /single correct option/);
  assert.deepEqual(req.messages, [{ role: "user", content: "Q" }]);
  assert.equal(req.output_config.format.type, "json_schema");
  assert.equal(req.output_config.format.schema.additionalProperties, false);
  assert.ok(!("temperature" in req) && !("thinking" in req));

  let seen;
  const fetchFn = async (url, init) => {
    seen = { url, headers: init.headers };
    return { status: 200, json: async () => ({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"options":[{"label":"A","correct":false},{"label":"B","correct":true}],"answer":"B","reason":"r"}' }] }) };
  };
  const out = await ask("Q", { provider: "anthropic", apiKey: "k" }, { fetchFn });
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen.headers["x-api-key"], "k");
  assert.equal(seen.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.deepEqual(out, { answer: "B", reason: "r", options: [{ label: "A", correct: false }, { label: "B", correct: true }] });
});

test("Claude errors: bad key, refusal, and the status on every error", () => {
  assert.throws(() => parseMessagesResponse(401, {}), (e) => /API key/.test(e.message) && e.status === 401);
  assert.throws(() => parseMessagesResponse(402, { error: { message: "billing" } }), (e) => e.message === "billing" && e.status === 402);
  assert.throws(() => parseMessagesResponse(200, { stop_reason: "refusal", content: [] }), /declined/);
});

test("OpenAI is asked without a temperature, the free providers keep temperature 0", async () => {
  const bodies = {};
  const fetchFn = async (url, init) => {
    bodies[new URL(url).host] = JSON.parse(init.body);
    return { status: 200, json: async () => chatBody('{"answer":"A"}') };
  };
  await ask("Q", { provider: "openai", apiKey: "k" }, { fetchFn });
  await ask("Q", { provider: "groq", apiKey: "k" }, { fetchFn });
  assert.ok(!("temperature" in bodies["api.openai.com"]));
  assert.equal(bodies["api.openai.com"].model, PROVIDERS.openai.models[0]);
  assert.equal(bodies["api.groq.com"].temperature, 0);
});

test("each provider freezes on its own out-of-credit statuses and on nothing else", async () => {
  const frozenFor = async (provider, host, status) => {
    const chain = chainFromStorage({ provider, keys: { [provider]: "k" } }).filter((c) => c.provider === provider);
    const fetchFn = async () => ({ status, json: async () => ({}) });
    const keys = [];
    await assert.rejects(askChain("Q", chain, { fetchFn, onFreeze: (key) => keys.push(key) }));
    return keys.length > 0;
  };
  const expected = {
    gemini: { 429: true, 402: true, 500: false },
    groq: { 429: true, 402: false, 500: false },
    openrouter: { 429: true, 402: true, 403: false },
    openai: { 429: true, 402: false, 500: false },
    anthropic: { 429: true, 402: true, 400: false, 529: false },
  };
  for (const [provider, cases] of Object.entries(expected)) {
    for (const [status, frozen] of Object.entries(cases)) {
      assert.equal(await frozenFor(provider, "", Number(status)), frozen, `${provider} ${status}`);
    }
  }
});

test("the stated-count rule is in the instructions with and without multiple answers", () => {
  for (const allowMultiple of [true, false]) {
    assert.match(buildInstructions({ allowMultiple }), /says how many options to choose/);
  }
});

test("the key field toggles between hidden and visible", () => {
  assert.equal(toggleKeyVisibility("password"), "text");
  assert.equal(toggleKeyVisibility("text"), "password");
});

test("chainFromStorage puts the local key first, then the remote key, unless keepLocalKey is off", () => {
  const keysOf = (chain, id) => [...new Set(chain.filter((c) => c.provider === id).map((c) => c.apiKey))];
  const stored = { provider: "gemini", keys: { gemini: "L" } };
  assert.deepEqual(keysOf(chainFromStorage(stored, { gemini: "R" }), "gemini"), ["L", "R"]);
  assert.deepEqual(keysOf(chainFromStorage({ ...stored, keepLocalKey: false }, { gemini: "R" }), "gemini"), ["R", "L"]);
});

test("a remote key equal to the local key is not tried twice; keyless providers appear once", () => {
  const chain = chainFromStorage({ provider: "gemini", keys: { gemini: "L" } }, { gemini: "L" });
  assert.equal(chain.filter((c) => c.provider === "gemini" && c.source === "remote").length, 0);
  assert.equal(chain.filter((c) => c.provider === "pollinations").length, PROVIDERS.pollinations.models.length);
});

test("a working remote key is used when the local key for the same provider fails", async () => {
  const chain = chainFromStorage({ provider: "groq", keys: { groq: "bad" } }, { groq: "good" });
  const seen = [];
  const fetchFn = async (url, init) => {
    const auth = init.headers.Authorization;
    seen.push(auth);
    if (auth === "Bearer bad") return { status: 401, ok: false, json: async () => ({ error: { message: "Invalid API key" } }) };
    return { status: 200, ok: true, json: async () => chatBody('{"answer":"B","reason":""}') };
  };
  assert.equal((await askChain("Q", chain, { fetchFn })).answer, "B");
  assert.ok(seen.includes("Bearer good"));
});

test("a frozen local model is not frozen for the remote key of the same model", () => {
  assert.notEqual(freezeKey({ provider: "gemini", model: "m" }), freezeKey({ provider: "gemini", model: "m", source: "remote" }));
});

test("describeChain groups the chain into provider and key-source rows, in try order", () => {
  const chain = chainFromStorage({ provider: "groq", keys: { groq: "L" } }, { groq: "R", gemini: "G" });
  const rows = describeChain(chain);
  assert.deepEqual(rows.slice(0, 2).map((r) => `${r.provider}/${r.source}`), ["groq/local", "groq/remote"]);
  assert.equal(rows[0].models.length, PROVIDERS.groq.models.length);
  assert.equal(rows.at(-1).provider, "pollinations");
});
