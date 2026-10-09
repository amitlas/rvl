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
3. Done. It works right away with no key (see below)

To update later: `git pull` in the folder, then the reload arrow on rvl's card
in `chrome://extensions`. Do not remove and re-add it: that deletes saved keys.

## AI providers

- **Pollinations** (default, free, no key, no sign-up, nothing to download):
  about one question per 30 seconds; rvl waits and retries by itself when
  asked faster. Less accurate than Gemini.
- **Free cloud providers** (more accurate, free key, no credit card):
  Google Gemini (aistudio.google.com/apikey), Groq (console.groq.com/keys),
  OpenRouter (openrouter.ai/keys). Add keys in rvl's settings and press
  **Save and test**.

- **Chrome built-in AI** (optional, on-device): only if you choose it in the
  settings and click **Download model**. It is a large download and needs
  about 22 GB free disk, so it never downloads by itself.

Fallback is automatic: the selected provider first, then its other models
(each has its own free quota), then the other providers with a key, and
Pollinations last. Keys stay in this browser only (`chrome.storage.local`).

## Chrome Web Store

Publishing (unlisted, one-click install link) is prepared in `store/`:
`sh scripts/package.sh` builds `dist/rvl.zip`, and `store/listing.md` has
every text field, the permission justifications and the privacy answers.
Privacy policy: [PRIVACY.md](PRIVACY.md).

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
