import { test } from "node:test";
import assert from "node:assert/strict";
import {
  askGemini, buildRequest, cleanQuestion, parseResponse, DEFAULT_MODEL, MAX_QUESTION_CHARS,
} from "../src/gemini.js";

function okBody(obj) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] };
}

test("buildRequest puts the question in contents and asks for JSON answer/reason", () => {
  const req = buildRequest("Q?\nA. x\nB. y");
  assert.equal(req.contents[0].parts[0].text, "Q?\nA. x\nB. y");
  assert.equal(req.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(req.generationConfig.responseSchema.required, ["options", "answer", "reason"]);
  assert.equal(req.generationConfig.temperature, 0);
});

test("cleanQuestion trims, normalizes CRLF, caps length, tolerates null", () => {
  assert.equal(cleanQuestion("  a\r\nb  "), "a\nb");
  assert.equal(cleanQuestion(null), "");
  assert.equal(cleanQuestion("x".repeat(MAX_QUESTION_CHARS + 50)).length, MAX_QUESTION_CHARS);
});

test("parseResponse returns trimmed answer and reason", () => {
  assert.deepEqual(parseResponse(200, okBody({ answer: " B ", reason: " because " })), {
    answer: "B", reason: "because", options: [],
  });
});

test("parseResponse joins multi-part text", () => {
  const body = { candidates: [{ content: { parts: [{ text: '{"answer":"ג",' }, { text: '"reason":"r"}' }] } }] };
  assert.deepEqual(parseResponse(200, body), { answer: "ג", reason: "r", options: [] });
});

test("parseResponse maps 429 to a quota message", () => {
  assert.throws(() => parseResponse(429, {}), /quota/);
});

test("parseResponse maps bad key errors to an options hint", () => {
  const body = { error: { message: "API key not valid. Please pass a valid API key." } };
  assert.throws(() => parseResponse(400, body), /Invalid Gemini API key/);
});

test("parseResponse surfaces other API error messages", () => {
  assert.throws(() => parseResponse(500, { error: { message: "boom" } }), /boom/);
  assert.throws(() => parseResponse(503, null), /HTTP 503/);
});

test("parseResponse rejects blocked, empty and non-JSON answers", () => {
  assert.throws(() => parseResponse(200, { promptFeedback: { blockReason: "SAFETY" } }), /blocked.*SAFETY/);
  assert.throws(() => parseResponse(200, { candidates: [] }), /empty/);
  assert.throws(() => parseResponse(200, { candidates: [{ content: { parts: [{ text: "B" }] } }] }), /unreadable/);
  assert.throws(() => parseResponse(200, okBody({ answer: "  ", reason: "r" })), /empty/);
});

test("askGemini posts to the model URL with the key in a header, not the URL", async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = { url, init };
    return { status: 200, json: async () => okBody({ answer: "A", reason: "r" }) };
  };
  const out = await askGemini("Q", "KEY123", { fetchFn });
  assert.deepEqual(out, { answer: "A", reason: "r", options: [] });
  assert.match(seen.url, new RegExp(`/models/${DEFAULT_MODEL}:generateContent$`));
  assert.ok(!seen.url.includes("KEY123"));
  assert.equal(seen.init.headers["x-goog-api-key"], "KEY123");
  assert.equal(JSON.parse(seen.init.body).contents[0].parts[0].text, "Q");
});

test("askGemini uses a custom model", async () => {
  let url;
  const fetchFn = async (u) => { url = u; return { status: 200, json: async () => okBody({ answer: "A", reason: "" }) }; };
  await askGemini("Q", "k", { fetchFn, model: "gemini-2.5-flash-lite" });
  assert.match(url, /models\/gemini-2\.5-flash-lite:generateContent$/);
});

test("askGemini turns network failures and non-JSON bodies into readable errors", async () => {
  await assert.rejects(askGemini("Q", "k", { fetchFn: async () => { throw new TypeError("x"); } }), /network/);
  const badJson = async () => ({ status: 502, json: async () => { throw new SyntaxError("x"); } });
  await assert.rejects(askGemini("Q", "k", { fetchFn: badJson }), /HTTP 502/);
});

import { normalizeOptions } from "../src/gemini.js";

test("request asks for per-option verdicts before the answer", () => {
  const schema = buildRequest("Q").generationConfig.responseSchema;
  assert.deepEqual(schema.propertyOrdering, ["options", "answer", "reason"]);
  assert.ok(schema.required.includes("options"));
  assert.match(buildRequest("Q").systemInstruction.parts[0].text, /Judge each option on its own/);
});

test("parseResponse returns the per-option verdicts", () => {
  const body = okBody({ options: [{ label: "a", correct: false }, { label: "b", correct: true }], answer: "b", reason: "" });
  assert.deepEqual(parseResponse(200, body).options, [{ label: "a", correct: false }, { label: "b", correct: true }]);
  assert.deepEqual(parseResponse(200, okBody({ answer: "b", reason: "" })).options, []);
});

test("normalizeOptions drops malformed entries and treats non-true as false", () => {
  assert.deepEqual(normalizeOptions({ options: [{ label: " a ", correct: "yes" }, null, { correct: true }, { label: "c", correct: true }] }),
    [{ label: "a", correct: false }, { label: "c", correct: true }]);
  assert.deepEqual(normalizeOptions({ options: "x" }), []);
});
