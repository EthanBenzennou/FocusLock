// ============================================================
// FocusLock — options page
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  const loginSection = document.getElementById("login-section");
  const settingsSection = document.getElementById("settings-section");
  const passwordInput = document.getElementById("password-input");
  const loginBtn = document.getElementById("login-btn");
  const loginError = document.getElementById("login-error");

  const whitelistInput = document.getElementById("whitelist-input");
  const safeSearchToggle = document.getElementById("safesearch-toggle");
  const safeSearchDurationBtn = document.getElementById(
    "safesearch-duration-btn",
  );
  const safeSearchDurationHint = document.getElementById(
    "safesearch-duration-hint",
  );
  const safeSearchRemaining = document.getElementById("safesearch-remaining");
  const safeSearchExtendBtn = document.getElementById("safesearch-extend-btn");
  const newPasswordInput = document.getElementById("new-password");
  const saveBtn = document.getElementById("save-btn");

  SecureStorage.initializeDefaults();

  async function updateSafeSearchDurationHint() {
    const { safeSearchDurationMinutes, safeSearchDurationText } =
      await chrome.storage.local.get([
        "safeSearchDurationMinutes",
        "safeSearchDurationText",
      ]);
    if (!safeSearchToggle.checked) {
      safeSearchDurationHint.textContent = "";
      return;
    }

    if (safeSearchDurationMinutes && safeSearchDurationMinutes > 0) {
      safeSearchDurationHint.textContent = `Duration: ${safeSearchDurationText || `${safeSearchDurationMinutes} mins`}`;
    } else {
      safeSearchDurationHint.textContent = "Duration: set a time limit";
    }
  }

  let remainingInterval = null;

  function formatRemaining(ms) {
    if (ms <= 0) return "0s";
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  async function updateRemainingInSettings() {
    try {
      const { safeSearch, safeSearchExpiresAt } = await chrome.storage.local.get([
        "safeSearch",
        "safeSearchExpiresAt",
      ]);
      if (!safeSearch || !safeSearchExpiresAt) {
        safeSearchRemaining.textContent = "Remaining: —";
        return;
      }
      const remaining = Number(safeSearchExpiresAt) - Date.now();
      if (remaining <= 0) {
        safeSearchRemaining.textContent = "Remaining: 0s";
        return;
      }
      safeSearchRemaining.textContent = `Remaining: ${formatRemaining(remaining)}`;
    } catch (err) {
      safeSearchRemaining.textContent = "Remaining: —";
    }
  }

  function startRemainingUpdater() {
    if (remainingInterval) clearInterval(remainingInterval);
    updateRemainingInSettings();
    remainingInterval = setInterval(updateRemainingInSettings, 1000);
  }

  function stopRemainingUpdater() {
    if (remainingInterval) {
      clearInterval(remainingInterval);
      remainingInterval = null;
    }
  }

  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginBtn.click();
  });
  newPasswordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
  });
  safeSearchToggle.addEventListener("change", () => {
    updateSafeSearchDurationHint();
    startRemainingUpdater();
  });
  safeSearchDurationBtn.addEventListener("click", async () => {
    const optionsUrl = chrome.runtime.getURL("safe-search-duration.html");
    await chrome.tabs.create({ url: `${optionsUrl}?source=options` });
  });

  safeSearchExtendBtn.addEventListener("click", async () => {
    const optionsUrl = chrome.runtime.getURL("safe-search-duration.html");
    await chrome.tabs.create({ url: `${optionsUrl}?source=options` });
  });

  loginBtn.addEventListener("click", async () => {
    const { passwordHash, passwordSalt } = await chrome.storage.local.get([
      "passwordHash",
      "passwordSalt",
    ]);
    const ok = await SecureStorage.verifyPassword(
      passwordInput.value,
      passwordHash,
      passwordSalt,
    );
    if (ok) {
      const whitelist = await SecureStorage.getWhitelist();
      const { safeSearch } = await chrome.storage.local.get(["safeSearch"]);
      loginSection.classList.add("hidden");
      settingsSection.classList.remove("hidden");
      loginError.classList.add("hidden");
      whitelistInput.value = whitelist.join("\n");
      safeSearchToggle.checked = !!safeSearch;
      await updateSafeSearchDurationHint();
      startRemainingUpdater();
    } else {
      loginError.classList.remove("hidden");
    }
  });

  saveBtn.addEventListener("click", async () => {
    const newWhitelist = whitelistInput.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const isSafeSearchEnabled = safeSearchToggle.checked;

    let timeLimit = 0;
    if (isSafeSearchEnabled) {
      const { safeSearchDurationMinutes } = await chrome.storage.local.get([
        "safeSearchDurationMinutes",
      ]);
      timeLimit = safeSearchDurationMinutes || 0;
    }

    const prevWhitelist = await SecureStorage.getWhitelist();
    const { safeSearch: prevSafe } = await chrome.storage.local.get([
      "safeSearch",
    ]);
    const prevSet = new Set(prevWhitelist.map((s) => s.toLowerCase()));
    const newSet = new Set(newWhitelist.map((s) => s.toLowerCase()));

    const added = [...newSet].filter((d) => !prevSet.has(d));
    const removed = [...prevSet].filter((d) => !newSet.has(d));
    const passwordChanged = newPasswordInput.value.trim() !== "";

    await SecureStorage.saveWhitelist(newWhitelist);
    await chrome.storage.local.set({ safeSearch: isSafeSearchEnabled });
    if (passwordChanged) {
      await SecureStorage.setPasswordHash(newPasswordInput.value.trim());
    }

    chrome.runtime.sendMessage({
      type: "UPDATE_WHITELIST",
      whitelist: newWhitelist,
      safeSearch: isSafeSearchEnabled,
      safeSearchMinutes: timeLimit,
    });

    settingsSection.classList.add("hidden");
    loginSection.classList.remove("hidden");
    passwordInput.value = "";
    newPasswordInput.value = "";

    stopRemainingUpdater();

    alert(
      isSafeSearchEnabled
        ? `Safe Search Mode active for ${timeLimit ? timeLimit + " mins" : "the selected duration"}.`
        : "Strict Firewall active. Settings locked.",
    );
  });
});
