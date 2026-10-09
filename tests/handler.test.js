import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRvl, bareLabel } from "../src/handler.js";

function fakeDeps(over = {}) {
  const shown = [];
  const asked = [];
  let optionsOpened = 0;
  const deps = {
    readSelection: async () => "Q?\nA. x\nB. y",
    getSettings: async () => ({ provider: "groq", apiKey: "k", model: "m" }),
    ask: async (q, settings) => { asked.push({ q, settings }); return { answer: "B", reason: "r" }; },
    show: async (s) => { shown.push(s); },
    openOptions: () => { optionsOpened++; },
    ...over,
  };
  return { deps, shown, asked, opened: () => optionsOpened };
}

test("shows loading then the answer, passing provider, key and model", async () => {
  const f = fakeDeps();
  await handleRvl({}, f.deps);
  assert.deepEqual(f.shown, [{ kind: "loading" }, { kind: "result", answer: "B", reason: "r" }]);
  assert.deepEqual(f.asked, [{ q: "Q?\nA. x\nB. y", settings: { provider: "groq", apiKey: "k", model: "m" } }]);
});

test("prefers the page selection (keeps line breaks) over selectionText", async () => {
  const f = fakeDeps();
  await handleRvl({ selectionText: "Q? A. x B. y" }, f.deps);
  assert.equal(f.asked[0].q, "Q?\nA. x\nB. y");
});

test("falls back to selectionText when the page selection is empty or unreadable", async () => {
  const empty = fakeDeps({ readSelection: async () => "" });
  await handleRvl({ selectionText: "flat Q" }, empty.deps);
  assert.equal(empty.asked[0].q, "flat Q");

  const blocked = fakeDeps({ readSelection: async () => { throw new Error("no access"); } });
  await handleRvl({ selectionText: "flat Q" }, blocked.deps);
  assert.equal(blocked.asked[0].q, "flat Q");
});

test("no selection at all shows an error and never calls the AI", async () => {
  const f = fakeDeps({ readSelection: async () => "   " });
  await handleRvl({}, f.deps);
  assert.deepEqual(f.shown, [{ kind: "error", text: "Select a question first" }]);
  assert.equal(f.asked.length, 0);
});

test("missing API key shows an error and opens options", async () => {
  const f = fakeDeps({ getSettings: async () => ({ provider: "gemini", apiKey: "", model: "m" }) });
  await handleRvl({}, f.deps);
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].kind, "error");
  assert.match(f.shown[0].text, /API key/);
  assert.equal(f.opened(), 1);
  assert.equal(f.asked.length, 0);
});

test("AI failure replaces the loading box with the error message", async () => {
  const f = fakeDeps({ ask: async () => { throw new Error("Gemini free-tier quota reached"); } });
  await handleRvl({}, f.deps);
  assert.deepEqual(f.shown, [{ kind: "loading" }, { kind: "error", text: "Gemini free-tier quota reached" }]);
});

test("manifest binds the rvl command to Ctrl+Z on Mac and Windows", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.commands.rvl.suggested_key, { default: "Ctrl+Z", mac: "MacCtrl+Z" });
});

test("manifest has a toolbar action and an options page so settings are reachable", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.action, "toolbar action missing");
  assert.equal(manifest.action.default_popup, undefined, "a popup would swallow the icon click");
  assert.equal(manifest.options_page, "options/options.html");
});

test("bareLabel strips punctuation around the option label", () => {
  assert.equal(bareLabel("B."), "B");
  assert.equal(bareLabel("(ג)"), "ג");
  assert.equal(bareLabel("3)"), "3");
  assert.equal(bareLabel(" A: "), "A");
  assert.equal(bareLabel("[d]"), "d");
  assert.equal(bareLabel("B"), "B");
  assert.equal(bareLabel("."), ".");
});

test("the shown answer has no trailing dot", async () => {
  const f = fakeDeps({ ask: async () => ({ answer: "ב.", reason: "r" }) });
  await handleRvl({}, f.deps);
  assert.equal(f.shown[1].answer, "ב");
});

test("bareLabel cleans each of several answers", () => {
  assert.equal(bareLabel("A., (C)"), "A, C");
  assert.equal(bareLabel("א, ג."), "א, ג");
  assert.equal(bareLabel("B and D"), "B, D");
});

test("never shows more than two answers", async () => {
  const f = fakeDeps({ ask: async () => ({ answer: "A, B, C, D, E", reason: "" }) });
  await handleRvl({}, f.deps);
  assert.equal(f.shown[1].answer, "A, B");
});

test("shows only one answer when two are not allowed", async () => {
  const f = fakeDeps({
    getSettings: async () => ({ provider: "groq", apiKey: "k", model: "m", allowMultiple: false }),
    ask: async () => ({ answer: "A, C", reason: "" }),
  });
  await handleRvl({}, f.deps);
  assert.equal(f.shown[1].answer, "A");
});

test("the popup fades in softly and follows the system theme", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
  assert.match(css, /animation: rvl-fade/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

import { chooseAnswer } from "../src/handler.js";

test("chooseAnswer shows exactly the options judged correct", () => {
  const options = [
    { label: "a.", correct: false }, { label: "b.", correct: true },
    { label: "c.", correct: true }, { label: "d.", correct: false },
  ];
  // The answer field disagrees; the per-option verdicts win.
  assert.equal(chooseAnswer({ answer: "b", options }), "b, c");
  assert.equal(chooseAnswer({ answer: "c", options: options.map((o) => ({ ...o, correct: o.label === "c." })) }), "c");
});

test("chooseAnswer falls back to the answer field when verdicts are unusable", () => {
  assert.equal(chooseAnswer({ answer: "B." }), "B");
  const none = [{ label: "A", correct: false }, { label: "B", correct: false }];
  assert.equal(chooseAnswer({ answer: "B", options: none }), "B");
  const three = ["A", "B", "C"].map((label) => ({ label, correct: true }));
  assert.equal(chooseAnswer({ answer: "A, C, B", options: three }), "A, C");
});

test("chooseAnswer with two answers not allowed shows one", () => {
  const options = [{ label: "A", correct: true }, { label: "C", correct: true }];
  assert.equal(chooseAnswer({ answer: "A, C", options }, { allowMultiple: false }), "A");
  assert.equal(chooseAnswer({ answer: "C", options: [{ label: "C", correct: true }] }, { allowMultiple: false }), "C");
});

test("no key but a keyless provider still asks instead of stopping", async () => {
  const f = fakeDeps({ getSettings: async () => ({ provider: "chrome", apiKey: "", keyless: true, model: "gemini-nano" }) });
  await handleRvl({}, f.deps);
  assert.equal(f.asked.length, 1);
  assert.equal(f.opened(), 0);
  assert.equal(f.shown[1].kind, "result");
});

test("manifest icons exist at their declared sizes (store requirement)", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  for (const [size, path] of Object.entries(manifest.icons)) {
    const png = await readFile(new URL(`../${path}`, import.meta.url));
    // PNG IHDR: width and height are big-endian at bytes 16 and 20.
    assert.equal(png.readUInt32BE(16), Number(size), path);
    assert.equal(png.readUInt32BE(20), Number(size), path);
  }
  assert.ok(manifest.icons["128"], "the store needs a 128px icon");
});

test("the settings page discloses what is sent and links the privacy policy", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../options/options.html", import.meta.url), "utf8");
  assert.match(html, /selected text goes to the provider you chose/);
  assert.match(html, /PRIVACY\.md/);
});

test("the short download page redirects to the latest release zip", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  const target = "https://github.com/amitlas/rvl/releases/latest/download/rvl.zip";
  assert.ok(html.includes(`content="0; url=${target}"`));
  assert.ok(html.includes(`href="${target}"`));
});



test("other errors do not open settings", async () => {
  const f = fakeDeps({ ask: async () => { throw new Error("quota"); } });
  await handleRvl({}, f.deps);
  assert.equal(f.opened(), 0);
});

test("no code downloads or runs an on-device model", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.ok(!manifest.permissions.includes("offscreen"));
  for (const dir of ["../src/", "../options/"]) {
    for (const name of await readdir(new URL(dir, import.meta.url))) {
      const text = await readFile(new URL(dir + name, import.meta.url), "utf8");
      assert.doesNotMatch(text, /LanguageModel|Download model/, name);
    }
  }
});
