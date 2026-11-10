(function () {
  const HEADER_ID = "focuslock-timer-header";
  const SPACER_ID = "focuslock-timer-header-spacer";
  const HEADER_HEIGHT = 42;
  const OUTBRAIN_IMAGE_STYLE_ID = "focuslock-outbrain-image-filter";
  const OUTBRAIN_IMAGE_STYLE = `
    img[src^="https://images.outbrainimg.com/" i],
    img[src^="http://images.outbrainimg.com/" i],
    img[src^="//images.outbrainimg.com/" i] {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;

  function installOutbrainShadowImageFilter() {
    if (
      typeof MutationObserver !== "function" ||
      typeof document.querySelectorAll !== "function"
    ) {
      return;
    }

    const observedRoots = new WeakSet();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          scanForShadowRoots(node);
        }
      }
    });

    function scanForShadowRoots(root) {
      const elements = [];
      if (root?.nodeType === 1) elements.push(root);
      if (typeof root?.querySelectorAll === "function") {
        elements.push(...root.querySelectorAll("*"));
      }

      for (const element of elements) {
        const shadowRoot = element.shadowRoot;
        if (!shadowRoot || observedRoots.has(shadowRoot)) continue;

        observedRoots.add(shadowRoot);
        if (!shadowRoot.getElementById(OUTBRAIN_IMAGE_STYLE_ID)) {
          const style = document.createElement("style");
          style.id = OUTBRAIN_IMAGE_STYLE_ID;
          style.textContent = OUTBRAIN_IMAGE_STYLE;
          shadowRoot.appendChild(style);
        }
        observer.observe(shadowRoot, { childList: true, subtree: true });
        scanForShadowRoots(shadowRoot);
      }
    }

    observer.observe(document, { childList: true, subtree: true });
    scanForShadowRoots(document);
  }

  chrome.runtime.sendMessage(
    { type: "APPLY_SAFESEARCH_FILTER" },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "Failed to request Safe Search media filtering:",
          chrome.runtime.lastError.message,
        );
      } else if (!response?.success) {
        console.error(
          "Failed to apply Safe Search media filtering:",
          response?.error || "Unknown error",
        );
      } else if (response.filtered) {
        installOutbrainShadowImageFilter();
      }
    },
  );

  if (window.top !== window) return;

  function formatRemaining(ms) {
    if (ms <= 0) return "0s";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  function createHeader() {
    if (document.getElementById(HEADER_ID)) return;

    const body = document.body;
    if (!body) return;

    const spacer = document.createElement("div");
    spacer.id = SPACER_ID;
    spacer.style.display = "block";
    spacer.style.width = "100%";
    spacer.style.height = `${HEADER_HEIGHT}px`;
    spacer.style.pointerEvents = "none";

    const header = document.createElement("div");
    header.id = HEADER_ID;
    header.style.position = "fixed";
    header.style.top = "0";
    header.style.left = "0";
    header.style.right = "0";
    header.style.width = "100%";
    header.style.height = `${HEADER_HEIGHT}px`;
    header.style.zIndex = "2147483647";
    header.style.direction = "ltr";
    header.style.unicodeBidi = "isolate";
    header.style.fontFamily =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

    const shadow = header.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        direction: ltr;
        unicode-bidi: isolate;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      *, *::before, *::after {
        box-sizing: border-box;
        font-family: inherit;
        direction: ltr;
        unicode-bidi: isolate;
      }
      button {
        line-height: normal;
      }
    `;
    shadow.appendChild(style);

    const banner = document.createElement("div");
    shadow.appendChild(banner);

    banner.style.width = "100%";
    banner.style.height = "100%";
    banner.style.boxSizing = "border-box";
    banner.style.display = "flex";
    banner.style.alignItems = "center";
    banner.style.justifyContent = "space-between";
    banner.style.padding = "0 12px";
    banner.style.background = "rgba(0,0,0,0.85)";
    banner.style.color = "white";
    banner.style.fontSize = "13px";
    banner.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "10px";

    const title = document.createElement("span");
    title.textContent = "Safe Search active";
    title.style.fontWeight = "600";

    const timer = document.createElement("span");
    timer.id = "focuslock-timer-text";
    timer.style.marginLeft = "8px";

    left.appendChild(title);
    left.appendChild(timer);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";

    const extendBtn = document.createElement("button");
    extendBtn.textContent = "Extend";
    extendBtn.style.background = "#0052cc";
    extendBtn.style.color = "white";
    extendBtn.style.border = "none";
    extendBtn.style.padding = "6px 10px";
    extendBtn.style.borderRadius = "4px";
    extendBtn.style.cursor = "pointer";
    extendBtn.style.fontSize = "12px";

    extendBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      try {
        const pwd = prompt("Enter password to extend Safe Search:");
        if (pwd === null) return;
        chrome.runtime.sendMessage({ type: "VERIFY_PASSWORD", password: pwd }, (resp) => {
          if (!resp || !resp.ok) {
            alert("Incorrect password.");
            return;
          }
          const url = chrome.runtime.getURL("safe-search-duration.html") + "?source=page&returnUrl=" + encodeURIComponent(location.href);
          chrome.runtime.sendMessage({ type: "OPEN_DURATION_PAGE", url, replaceCurrent: true });
        });
      } catch (err) {
        try {
          chrome.runtime.openOptionsPage();
        } catch (e) {}
      }
    });

    const stopBtn = document.createElement("button");
    stopBtn.textContent = "Stop";
    stopBtn.style.background = "#dc2626";
    stopBtn.style.color = "white";
    stopBtn.style.border = "none";
    stopBtn.style.padding = "6px 10px";
    stopBtn.style.borderRadius = "4px";
    stopBtn.style.cursor = "pointer";
    stopBtn.style.fontSize = "12px";

    stopBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: "STOP_SAFESEARCH" });
    });

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Hide";
    closeBtn.style.background = "transparent";
    closeBtn.style.color = "white";
    closeBtn.style.border = "1px solid rgba(255,255,255,0.2)";
    closeBtn.style.padding = "6px 10px";
    closeBtn.style.borderRadius = "4px";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.fontSize = "12px";

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const el = document.getElementById(HEADER_ID);
      if (el) el.style.display = "none";
    });

    right.appendChild(extendBtn);
    right.appendChild(stopBtn);
    right.appendChild(closeBtn);

    banner.appendChild(left);
    banner.appendChild(right);

    body.insertBefore(spacer, body.firstChild || null);
    body.insertBefore(header, spacer.nextSibling || null);
  }

  function removeHeader() {
    const el = document.getElementById(HEADER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);

    const spacer = document.getElementById(SPACER_ID);
    if (spacer && spacer.parentNode) spacer.parentNode.removeChild(spacer);
  }

  async function updateHeader() {
    try {
      const stored = await chrome.storage.local.get(["safeSearch", "safeSearchExpiresAt"]);
      const safe = !!stored.safeSearch;
      const expiresAt = Number(stored.safeSearchExpiresAt) || 0;
      if (!safe || !expiresAt) {
        removeHeader();
        return;
      }
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        removeHeader();
        return;
      }
      createHeader();
      const textEl = document
        .getElementById(HEADER_ID)
        ?.shadowRoot.getElementById("focuslock-timer-text");
      if (textEl) textEl.textContent = ` — ${formatRemaining(remaining)}`;
    } catch (err) {
      // ignore
    }
  }

  let intervalId = null;
  (function start() {
    updateHeader();
    intervalId = setInterval(updateHeader, 1000);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.safeSearch || changes.safeSearchExpiresAt) updateHeader();
    });
    // cleanup when the page unloads
    window.addEventListener("beforeunload", () => {
      if (intervalId) clearInterval(intervalId);
    });
  })();
})();
