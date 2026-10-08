// Injected on demand into the top frame. Defines window.__rvlShow, which
// draws a small box in the bottom-right corner. Re-injecting is harmless.
(() => {
  if (window.__rvlShow) return;

  const AUTO_HIDE_MS = 20000;
  let host = null;
  let hideTimer = null;

  function remove() {
    clearTimeout(hideTimer);
    host?.remove();
    host = null;
  }

  function onKey(e) {
    if (e.key === "Escape") remove();
  }
  document.addEventListener("keydown", onKey, true);

  window.__rvlShow = (state) => {
    remove();
    host = document.createElement("div");
    host.style.cssText = "all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;";
    const root = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    // Soft and calm: muted colors that follow the system light/dark theme,
    // and a gentle fade-in instead of an abrupt pop.
    style.textContent = `
      .box { font: 600 13px/1 system-ui, -apple-system, sans-serif;
             color: #3f3f46; background: #f4f4f5; border: 1px solid #e4e4e7;
             border-radius: 6px; padding: 5px 8px; max-width: 220px; cursor: pointer;
             unicode-bidi: plaintext; animation: rvl-fade 250ms ease-out; }
      .error { font-weight: 400; color: #b91c1c; }
      @media (prefers-color-scheme: dark) {
        .box { color: #d4d4d8; background: #27272a; border-color: #3f3f46; }
        .error { color: #fca5a5; }
      }
      @media (prefers-reduced-motion: reduce) { .box { animation: none; } }
      @keyframes rvl-fade { from { opacity: 0; } to { opacity: 1; } }`;
    root.appendChild(style);

    const box = document.createElement("div");
    box.className = "box";
    box.title = "Click to close";
    box.addEventListener("click", remove);

    if (state.kind === "loading") {
      box.textContent = "…";
    } else if (state.kind === "result") {
      // Only the option label; the reason is kept out to keep the box tiny.
      box.dir = "auto";
      box.textContent = state.answer;
    } else {
      box.classList.add("error");
      box.textContent = state.text || "Error";
    }

    root.appendChild(box);
    document.documentElement.appendChild(host);
    if (state.kind !== "loading") hideTimer = setTimeout(remove, AUTO_HIDE_MS);
  };
})();
