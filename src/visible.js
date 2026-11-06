// Text of the current frame that is inside the viewport right now, so a page
// with many questions sends only the one on screen. Passed as-is to
// chrome.scripting.executeScript, so it must not use anything from outside.
// doc/win are parameters only so tests can pass fakes.
export function visibleText(doc = document, win = window) {
  const height = win.innerHeight;
  const width = win.innerWidth;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  let out = "";
  let lastTop = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (!text) continue;
    const parent = node.parentElement;
    if (parent && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName)) continue;
    if (parent && win.getComputedStyle(parent).visibility === "hidden") continue;
    range.selectNodeContents(node);
    const rect = [...range.getClientRects()].find(
      (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < height && r.right > 0 && r.left < width,
    );
    if (!rect) continue;
    // A new visual line keeps the line break between the question and its options.
    if (out) out += lastTop !== null && Math.abs(rect.top - lastTop) > 2 ? "\n" : " ";
    out += text;
    lastTop = rect.top;
  }
  return out;
}
