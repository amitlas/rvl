import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRvl, bareLabel, FIRST_ONLY } from "../src/handler.js";

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

test("no selection falls back to the whole page text", async () => {
  const f = fakeDeps({ readSelection: async () => "  ", readPage: async () => "Page Q?\nA. x\nB. y" });
  await handleRvl({}, f.deps);
  assert.equal(f.asked[0].q, FIRST_ONLY + "Page Q?\nA. x\nB. y");
});

test("a selection means the page text is never read", async () => {
  let pageReads = 0;
  const f = fakeDeps({ readPage: async () => { pageReads++; return "whole page"; } });
  await handleRvl({}, f.deps);
  assert.equal(pageReads, 0);
  assert.equal(f.asked[0].q, "Q?\nA. x\nB. y");

  const ctx = fakeDeps({ readSelection: async () => "", readPage: async () => { pageReads++; return "whole page"; } });
  await handleRvl({ selectionText: "flat Q" }, ctx.deps);
  assert.equal(pageReads, 0);
  assert.equal(ctx.asked[0].q, "flat Q");
});

test("empty or unreadable page with no selection still shows the select error", async () => {
  const empty = fakeDeps({ readSelection: async () => "", readPage: async () => "  " });
  await handleRvl({}, empty.deps);
  assert.deepEqual(empty.shown, [{ kind: "error", text: "Select a question first" }]);
  assert.equal(empty.asked.length, 0);

  const blocked = fakeDeps({ readSelection: async () => "", readPage: async () => { throw new Error("no access"); } });
  await handleRvl({}, blocked.deps);
  assert.deepEqual(blocked.shown, [{ kind: "error", text: "Select a question first" }]);
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

test("hiding while loading drops the late answer, and a new run still works", async () => {
  let hidden = false;
  const f = fakeDeps({
    cancelled: () => hidden,
    ask: async () => { hidden = true; return { answer: "B", reason: "r" }; },
  });
  await handleRvl({}, f.deps);
  assert.deepEqual(f.shown, [{ kind: "loading" }]);

  const again = fakeDeps({ cancelled: () => false });
  await handleRvl({}, again.deps);
  assert.deepEqual(again.shown, [{ kind: "loading" }, { kind: "result", answer: "B", reason: "r" }]);
});

test("hiding while loading also drops a late error", async () => {
  let hidden = false;
  const f = fakeDeps({
    cancelled: () => hidden,
    ask: async () => { hidden = true; throw new Error("boom"); },
  });
  await handleRvl({}, f.deps);
  assert.deepEqual(f.shown, [{ kind: "loading" }]);
});

import { visibleText } from "../src/visible.js";

// Fake DOM: each node is {text, top, tag?, hidden?}; one line is 20px tall.
function fakePage(nodes, height = 100) {
  const textNodes = nodes.map((n) => ({
    nodeValue: n.text,
    parentElement: { tagName: n.tag ?? "DIV", hidden: !!n.hidden },
    top: n.top,
  }));
  const doc = {
    body: {},
    createTreeWalker: () => { let i = 0; return { nextNode: () => textNodes[i++] ?? null }; },
    createRange: () => {
      let node;
      return {
        selectNodeContents: (n) => { node = n; },
        getClientRects: () => [{ top: node.top, bottom: node.top + 20, left: 0, right: 50, width: 50, height: 20 }],
      };
    },
  };
  const win = { innerHeight: height, innerWidth: 800, getComputedStyle: (el) => ({ visibility: el.hidden ? "hidden" : "visible" }) };
  return visibleText(doc, win);
}

test("visibleText sends only the question inside the viewport", () => {
  const text = fakePage([
    { text: "Old Q above?", top: -60 },
    { text: "Q1?", top: 10 },
    { text: "A.", top: 40 }, { text: "x", top: 40 },
    { text: "B. y", top: 70 },
    { text: "Q2 below?", top: 300 },
  ]);
  assert.equal(text, "Q1?\nA. x\nB. y");
});

test("visibleText skips scripts, styles and visibility:hidden text", () => {
  const text = fakePage([
    { text: "var a = 1", top: 10, tag: "SCRIPT" },
    { text: ".x{}", top: 10, tag: "STYLE" },
    { text: "secret", top: 10, hidden: true },
    { text: "Q?", top: 10 },
  ]);
  assert.equal(text, "Q?");
});

test("chooseAnswer never shows option text, only a letter", () => {
  const options = [
    { label: "Mitochondria", correct: false },
    { label: "The nucleus holds DNA", correct: true },
  ];
  assert.equal(chooseAnswer({ answer: "The nucleus holds DNA", options }), "B");
  assert.equal(chooseAnswer({ answer: "x", options }, { hebrew: true }), "ב");
  // No verdicts: the quoted answer text is matched back to its option.
  const none = options.map((o) => ({ ...o, correct: false }));
  assert.equal(chooseAnswer({ answer: "The nucleus", options: none }), "B");
  assert.equal(chooseAnswer({ answer: "Some long answer text" }), "-");
  assert.equal(chooseAnswer({ answer: "?" }), "-");
});

test("handleRvl uses Hebrew position letters for a Hebrew question", async () => {
  const f = fakeDeps({
    readSelection: async () => "מה נכון?\nתא\nגרעין",
    ask: async () => ({ answer: "גרעין", reason: "r", options: [{ label: "תא", correct: false }, { label: "גרעין מכיל DNA", correct: true }] }),
  });
  await handleRvl({}, f.deps);
  assert.equal(f.shown[1].answer, "ב");
});

import { questionStatedCount } from "../src/handler.js";

test("questionStatedCount reads how many options the question asks for", () => {
  assert.equal(questionStatedCount("Choose two correct answers: a, b, c"), 2);
  assert.equal(questionStatedCount("select 3 of the following"), 3);
  assert.equal(questionStatedCount("Which two options are correct?"), 2);
  assert.equal(questionStatedCount("בחר שתיים מהתשובות הנכונות"), 2);
  assert.equal(questionStatedCount("סמן שלוש תשובות נכונות"), 3);
  assert.equal(questionStatedCount("Select all that apply"), Infinity);
  assert.equal(questionStatedCount("בחר את כל התשובות הנכונות"), Infinity);
  assert.equal(questionStatedCount("What is the capital of France?"), null);
});

test("chooseAnswer honors a count the question states, even with two answers off", () => {
  const three = ["A", "B", "C"].map((label) => ({ label, correct: true }));
  assert.equal(chooseAnswer({ answer: "A, B, C", options: three }, { allowMultiple: false, stated: 3 }), "A, B, C");
  assert.equal(chooseAnswer({ answer: "A, B, C", options: three }, { allowMultiple: true, stated: Infinity }), "A, B, C");
  assert.equal(chooseAnswer({ answer: "A, B, C", options: three }, { allowMultiple: true }), "A, B");
});

test("handleRvl passes the stated count from the question to the shown answer", async () => {
  const shown = [];
  await handleRvl({}, {
    readSelection: async () => "Select all that apply\nA. x\nB. y\nC. z",
    getSettings: async () => ({ provider: "gemini", apiKey: "k", allowMultiple: false }),
    ask: async () => ({
      answer: "A, B, C", reason: "r",
      options: [{ label: "A.", correct: true }, { label: "B.", correct: true }, { label: "C.", correct: true }],
    }),
    show: async (s) => { shown.push(s); },
    openOptions() {},
  });
  assert.equal(shown.at(-1).answer, "A, B, C");
});

test("page text (nothing selected) asks for the first question only", async () => {
  const f = fakeDeps({ readSelection: async () => "", readPage: async () => "Q1?\nA. x\nB. y\nQ2?\nA. p\nB. q" });
  await handleRvl({}, f.deps);
  assert.ok(f.asked[0].q.startsWith(FIRST_ONLY));
  assert.match(f.asked[0].q, /Q1\?/);
});

test("a selected question is sent without the first-only instruction", async () => {
  const f = fakeDeps();
  await handleRvl({}, f.deps);
  assert.equal(f.asked[0].q.includes("first multiple-choice question"), false);
});
