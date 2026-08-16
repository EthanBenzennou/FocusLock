document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const source = params.get("source") || "options";
  const returnUrl = params.get("returnUrl") || "";
  const durationInput = document.getElementById("duration-input");
  const applyBtn = document.getElementById("apply-btn");
  const cancelBtn = document.getElementById("cancel-btn");

  const stored = await chrome.storage.local.get([
    "safeSearchDurationMinutes",
    "safeSearchDurationText",
  ]);
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

    await chrome.storage.local.set({
      safeSearch: true,
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
        },
        resolve,
      );
    });

    if (!response || !response.success) {
      errorEl.textContent =
        "Unable to enable Safe Search mode. Please try again.";
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
          // fallback: try to update active tab to the target url
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
