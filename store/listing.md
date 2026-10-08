# Chrome Web Store listing (copy into the Developer Dashboard)

## Name
rvl

## Summary (max 132 chars)
Select a multiple-choice question and see the correct option's letter in a small corner box. Free, works with no key.

## Description
Practice multiple-choice questions faster.

Select a question and its options on any page, then right-click "rvl" or press
Ctrl+Z. A small box in the bottom-right corner shows the letter of the correct
option (or two letters, when two options are correct and that setting is on).
Click the box or press Esc to close it.

- Works with no setup, using Chrome's built-in on-device AI (on supported computers)
- For better accuracy, add a free API key for Google Gemini, Groq or OpenRouter
- Automatic fallback across models and providers when one runs out of free quota
- Hebrew and English questions
- Keys stay in your browser. rvl has no server and collects nothing.

Privacy policy: https://github.com/amitlas/rvl/blob/main/PRIVACY.md

## Category
Education

## Visibility
Unlisted

## Single purpose (Privacy practices tab)
Show the correct option of a multiple-choice question the user selected on a page.

## Permission justifications
- contextMenus: adds the "rvl" item to the right-click menu for selected text.
- activeTab: reads the selected text and shows the answer box, only on the tab where the user invoked rvl.
- scripting: injects the small answer box and reads the selection, only after the user invokes rvl.
- storage: saves the user's settings (provider, API keys, model) locally.
- offscreen: runs Chrome's built-in on-device AI model when the service worker cannot.
- Host permissions (generativelanguage.googleapis.com, api.groq.com, openrouter.ai): send the selected question to the AI provider the user configured with their own key.

## Remote code
No. All code is in the package; providers only return text answers.

## Data usage (Privacy practices tab)
- Collected: "Website content" (the text the user selects, only when they invoke rvl), sent to the AI provider the user chose.
- Not collected: personally identifiable info, health, financial, authentication, personal communications, location, web history, user activity.
- Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.

## Assets
- Icon: icons/icon128.png
- Screenshot: store/screenshot-1.png (1280x800)
- Package: run `sh scripts/package.sh`, upload dist/rvl.zip
