(function () {
  const HEADER_ID = "focuslock-timer-header";
  const HEADER_HEIGHT = 48;
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

  let shouldShowHeader = false;
  let bodyOffset = null;

  chrome.runtime.sendMessage(
    { type: "APPLY_SAFESEARCH_FILTER" },
    (response) => {
      if (window.top === window) {
        shouldShowHeader =
          !chrome.runtime.lastError &&
          response?.success === true &&
          response.filtered === true;
        updateHeader();
      }

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
    const root = document.documentElement;
    if (!body || !root) return;

    const computedPaddingTop = Number.parseFloat(
      window.getComputedStyle(body).paddingTop,
    );
    const originalPaddingTop = body.style.getPropertyValue("padding-top");
    const originalPaddingPriority =
      body.style.getPropertyPriority("padding-top");
    const appliedPaddingTop = `calc(${Number.isFinite(computedPaddingTop) ? computedPaddingTop : 0}px + ${HEADER_HEIGHT}px)`;

    const header = document.createElement("div");
    header.id = HEADER_ID;
    header.style.setProperty("all", "initial", "important");
    header.style.setProperty("position", "fixed", "important");
    header.style.setProperty("top", "0", "important");
    header.style.setProperty("left", "0", "important");
    header.style.setProperty("right", "0", "important");
    header.style.setProperty("width", "100%", "important");
    header.style.setProperty("height", `${HEADER_HEIGHT}px`, "important");
    header.style.setProperty("min-height", `${HEADER_HEIGHT}px`, "important");
    header.style.setProperty("max-height", `${HEADER_HEIGHT}px`, "important");
    header.style.setProperty("box-sizing", "border-box", "important");
    header.style.setProperty("display", "block", "important");
    header.style.setProperty("overflow", "hidden", "important");
    header.style.setProperty("margin", "0", "important");
    header.style.setProperty("padding", "0", "important");
    header.style.setProperty("border", "0", "important");
    header.style.setProperty("z-index", "2147483647", "important");
    header.style.setProperty("direction", "ltr", "important");
    header.style.setProperty("unicode-bidi", "isolate", "important");
    header.style.setProperty(
      "font-family",
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      "important",
    );

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
    banner.style.padding = "0 18px";
    banner.style.background = "rgba(20, 32, 54, 0.62)";
    banner.style.color = "white";
    banner.style.fontSize = "13px";
    banner.style.boxShadow = "0 3px 14px rgba(15, 23, 42, 0.2)";
    banner.style.backdropFilter = "blur(12px)";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "8px";

    const indicator = document.createElement("span");
    indicator.textContent = "●";
    indicator.style.color = "#7de0b0";
    indicator.style.fontSize = "10px";

    const title = document.createElement("span");
    title.textContent = "Safe Search active";
    title.style.fontWeight = "600";

    const timer = document.createElement("span");
    timer.id = "focuslock-timer-text";
    timer.style.marginLeft = "8px";

    left.appendChild(indicator);
    left.appendChild(title);
    left.appendChild(timer);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "9px";

    const extendBtn = document.createElement("button");
    extendBtn.textContent = "Extend";
    extendBtn.style.background = "#315ee8";
    extendBtn.style.color = "white";
    extendBtn.style.border = "none";
    extendBtn.style.padding = "7px 12px";
    extendBtn.style.borderRadius = "8px";
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
    stopBtn.style.background = "#c93636";
    stopBtn.style.color = "white";
    stopBtn.style.border = "1px solid #e05252";
    stopBtn.style.padding = "7px 12px";
    stopBtn.style.borderRadius = "8px";
    stopBtn.style.cursor = "pointer";
    stopBtn.style.fontSize = "12px";

    stopBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: "STOP_SAFESEARCH" });
    });

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Hide";
    closeBtn.style.background = "rgba(255,255,255,0.1)";
    closeBtn.style.color = "white";
    closeBtn.style.border = "1px solid rgba(255,255,255,0.2)";
    closeBtn.style.padding = "6px 10px";
    closeBtn.style.borderRadius = "4px";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.fontSize = "12px";

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const el = document.getElementById(HEADER_ID);
      if (el) el.style.setProperty("display", "none", "important");
      restoreBodyOffset();
    });

    right.appendChild(extendBtn);
    right.appendChild(stopBtn);
    right.appendChild(closeBtn);

    banner.appendChild(left);
    banner.appendChild(right);

    root.appendChild(header);
    body.style.setProperty("padding-top", appliedPaddingTop, "important");
    bodyOffset = {
      body,
      originalPaddingTop,
      originalPaddingPriority,
      appliedPaddingTop,
    };
  }

  function restoreBodyOffset() {
    if (!bodyOffset) return;

    const {
      body,
      originalPaddingTop,
      originalPaddingPriority,
      appliedPaddingTop,
    } = bodyOffset;
    if (
      body.style.getPropertyValue("padding-top") === appliedPaddingTop &&
      body.style.getPropertyPriority("padding-top") === "important"
    ) {
      if (originalPaddingTop) {
        body.style.setProperty(
          "padding-top",
          originalPaddingTop,
          originalPaddingPriority,
        );
      } else {
        body.style.removeProperty("padding-top");
      }
    }
    bodyOffset = null;
  }

  function removeHeader() {
    const el = document.getElementById(HEADER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    restoreBodyOffset();
  }

  async function updateHeader() {
    try {
      if (!shouldShowHeader) {
        removeHeader();
        return;
      }
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
