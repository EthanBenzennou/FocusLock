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

  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginBtn.click();
  });
  newPasswordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
  });
  safeSearchToggle.addEventListener("change", () => {
    updateSafeSearchDurationHint();
  });
  safeSearchDurationBtn.addEventListener("click", async () => {
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

    alert(
      isSafeSearchEnabled
        ? `Safe Search Mode active for ${timeLimit ? timeLimit + " mins" : "the selected duration"}.`
        : "Strict Firewall active. Settings locked.",
    );
  });
});
