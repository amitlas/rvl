# rvl privacy policy

Last updated: 2026-10-09

rvl is a Chrome extension that shows which option of a multiple-choice
question is correct. This page explains exactly what data it handles.

## What rvl sends, and to whom

Only when you use rvl (right-click **rvl**, or press its keyboard shortcut),
it reads the text you have selected on the current page and sends it to one
AI provider to get the answer:

- **Chrome built-in AI** (the default): the text is processed by Google's
  on-device model inside Chrome on your own computer. It is not sent over the
  network by rvl.
- **Google Gemini API**, **Groq** or **OpenRouter**: only if you added your
  own API key for that provider in rvl's settings. The selected text is sent
  over HTTPS directly from your browser to that provider, under that
  provider's own terms and privacy policy:
  - Google: https://ai.google.dev/gemini-api/terms
  - Groq: https://groq.com/privacy-policy
  - OpenRouter: https://openrouter.ai/privacy

rvl does not read pages you do not use it on, and it does not send anything
else: no browsing history, no URLs, no personal information.

## What rvl stores

Your settings (chosen provider, API keys, model, and the "two answers"
option) are stored in your browser with `chrome.storage.local`. They never
leave your computer except that each API key is sent to its own provider as
part of a request.

## What rvl does not do

- No server of its own: the developer receives no data at all.
- No analytics, tracking, advertising, or selling or sharing of data.
- No use of data for any purpose other than answering the question you
  selected.

The use of information received from Google APIs complies with the Chrome
Web Store User Data Policy, including the Limited Use requirements.

## Contact

Questions: open an issue at https://github.com/amitlas/rvl/issues
