# rvl

Chrome extension (Manifest V3). Select a multiple-choice question on any page,
then right-click **rvl** or press **Ctrl+Z** (the Control key, on Mac and
Windows). A small box in the bottom-right corner shows the correct option's
letter (or two letters, if two options are correct and that setting is on).
Click the box or press Esc to close it; it hides by itself after 20s.

## Install

```
git clone https://github.com/amitlas/rvl.git
```

1. Open `chrome://extensions` and turn on **Developer mode** (top right)
2. **Load unpacked** and pick the `rvl` folder
3. Done. It works with no key, using Chrome's built-in on-device AI (see below)

To update later: `git pull` in the folder, then the reload arrow on rvl's card
in `chrome://extensions`. Do not remove and re-add it: that deletes saved keys.

## AI providers

- **Chrome built-in AI** (default, no key): Gemini Nano running on your own
  computer. No key and no quota, but less accurate than the cloud models. It
  needs a recent Chrome, about 22 GB free disk and 16 GB RAM (or a GPU with
  more than 4 GB). The first time, open rvl's settings (click its toolbar
  icon) and press **Download model**.
- **Free cloud providers** (more accurate, free key, no credit card):
  Google Gemini (aistudio.google.com/apikey), Groq (console.groq.com/keys),
  OpenRouter (openrouter.ai/keys). Add keys in rvl's settings and press
  **Save and test**.

Fallback is automatic: the selected provider first, then its other models
(each has its own free quota), then the other providers with a key, and
Chrome built-in AI last. Keys stay in this browser only (`chrome.storage.local`).

## Shortcut

Default Ctrl+Z. On Windows that replaces Undo inside Chrome while rvl is on.
Change it from rvl's settings (the **Change** button opens
`chrome://extensions/shortcuts`). Chrome only allows a modifier plus a letter,
digit or a few named keys, and rejects Cmd+Option combinations.

## Layout

- `src/background.js` - context menu, keyboard command, chrome.* wiring
- `src/handler.js` - the flow (read selection, ask, choose what to show), no chrome.* calls
- `src/providers.js` - providers, models, fallback chain
- `src/gemini.js`, `src/openai.js`, `src/chromeai.js` - one per API
- `src/content.js` - the on-page box (shadow DOM, injected on demand)
- `offscreen/` - runs the built-in model if the service worker cannot
- `options/` - settings page

## Tests

```
npm test
```
