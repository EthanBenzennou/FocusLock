document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const source = params.get("source") || "options";
  const returnUrl = params.get("returnUrl") || "";
  const durationInput = document.getElementById("duration-input");
  const applyBtn = document.getElementById("apply-btn");
  const cancelBtn = document.getElementById("cancel-btn");
  const modePill = document.getElementById("mode-pill");
  const modeTitle = document.getElementById("mode-title");
  const modeSubtitle = document.getElementById("mode-subtitle");

  const stored = await chrome.storage.local.get([
    "safeSearch",
    "safeSearchExpiresAt",
    "safeSearchDurationMinutes",
    "safeSearchDurationText",
  ]);

  const isExtendMode = source === "page" || !!stored.safeSearch;
  const mode = isExtendMode ? "extend" : "fresh";
  const modeConfig = {
    fresh: {
      pill: "Fresh session",
      title: "Start a fresh Safe Search session",
      subtitle:
        "Choose how long Safe Search should stay active before it turns off again.",
      button: "Enable Safe Search",
    },
    extend: {
      pill: "Extend session",
      title: "Extend the current Safe Search session",
      subtitle:
        "Choose how much time to add to the current Safe Search session.",
      button: "Extend Safe Search",
    },
  };

  if (modePill) modePill.textContent = modeConfig[mode].pill;
  if (modeTitle) modeTitle.textContent = modeConfig[mode].title;
  if (modeSubtitle) modeSubtitle.textContent = modeConfig[mode].subtitle;
  applyBtn.textContent = modeConfig[mode].button;

  if (stored.safeSearchDurationText) {
    durationInput.value = stored.safeSearchDurationText;
  }

  applyBtn.addEventListener("click", async () => {
    const rawValue = durationInput.value.trim();
    const minutes = WhitelistUtils.parseDurationMinutes(rawValue) || 0;
    const errorEl = document.getElementById("duration-error");

    if (!rawValue || minutes <= 0) {
      errorEl.textContent =
        "Please enter a valid duration such as 20 mins or 1 hour.";
      return;
    }

    errorEl.textContent = "";
    const textValue = rawValue;
    const now = Date.now();
    const currentExpiry = Number(stored.safeSearchExpiresAt) || 0;
    const nextExpiry =
      mode === "extend" && currentExpiry > now
        ? currentExpiry + minutes * 60 * 1000
        : now + minutes * 60 * 1000;

    await chrome.storage.local.set({
      safeSearch: true,
      safeSearchExpiresAt: nextExpiry,
      safeSearchDurationMinutes: minutes,
      safeSearchDurationText: textValue,
    });

    const currentWhitelist = await SecureStorage.getWhitelist();
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "UPDATE_WHITELIST",
          whitelist: currentWhitelist,
          safeSearch: true,
          safeSearchMinutes: minutes,
          safeSearchExpiresAt: nextExpiry,
        },
        resolve,
      );
    });

    if (!response || !response.success) {
      errorEl.textContent =
        mode === "extend"
          ? "Unable to extend Safe Search mode. Please try again."
          : "Unable to enable Safe Search mode. Please try again.";
      return;
    }

    if (returnUrl) {
      const targetUrl = decodeURIComponent(returnUrl);
      try {
        const tabs = await chrome.tabs.query({});
        const match = tabs.find((t) => t.url && t.url.startsWith(targetUrl));
        if (match && match.id) {
          await new Promise((resolve) => {
            chrome.tabs.update(match.id, { url: targetUrl }, () => resolve());
          });
        } else {
          await new Promise((resolve) => {
            chrome.tabs.update({ url: targetUrl }, () => resolve());
          });
        }
      } catch (e) {
        try {
          chrome.tabs.update({ url: targetUrl });
        } catch (_) {
          window.location.href = targetUrl;
        }
      }
    } else {
      window.close();
    }
  });

  cancelBtn.addEventListener("click", () => {
    window.close();
  });
});
