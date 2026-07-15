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
    chrome.runtime.sendMessage({
      type: "UPDATE_WHITELIST",
      whitelist: currentWhitelist,
      safeSearch: true,
      safeSearchMinutes: minutes,
    });

    if (source === "blocked" && returnUrl) {
      window.location.href = decodeURIComponent(returnUrl);
    } else {
      window.close();
    }
  });

  cancelBtn.addEventListener("click", () => {
    window.close();
  });
});
