(function () {
  const HEADER_ID = "focuslock-timer-header";
  const HEADER_HEIGHT = 42;

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

    const header = document.createElement("div");
    header.id = HEADER_ID;
    header.style.position = "fixed";
    header.style.top = "0";
    header.style.left = "0";
    header.style.right = "0";
    header.style.height = `${HEADER_HEIGHT}px`;
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.padding = "0 12px";
    header.style.zIndex = "2147483647";
    header.style.background = "rgba(0,0,0,0.85)";
    header.style.color = "white";
    header.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    header.style.fontSize = "13px";
    header.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";

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
        // verify password via background
        chrome.runtime.sendMessage({ type: "VERIFY_PASSWORD", password: pwd }, (resp) => {
          if (!resp || !resp.ok) {
            alert("Incorrect password.");
            return;
          }
          const url = chrome.runtime.getURL("safe-search-duration.html") + "?source=page&returnUrl=" + encodeURIComponent(location.href);
          // ask background to open the duration page so we can operate with tabs API there
          chrome.runtime.sendMessage({ type: "OPEN_DURATION_PAGE", url });
        });
      } catch (err) {
        try {
          chrome.runtime.openOptionsPage();
        } catch (e) {}
      }
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
    right.appendChild(closeBtn);

    header.appendChild(left);
    header.appendChild(right);

    document.documentElement.appendChild(header);
  }

  function removeHeader() {
    const el = document.getElementById(HEADER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
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
      const textEl = document.getElementById("focuslock-timer-text");
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
