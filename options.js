// ============================================================
// FocusLock — options page
// Sends granular webhook events so Make.com can email you with
// EXACTLY what changed (added/removed domains, password change,
// safe-search toggle).
// ============================================================
const WEBHOOK_URL = "https://hook.us1.make.com/rst9dds5x8xerdi1u5le4jtog9jdgv2f";

function sendEvent(action, extraParams = {}) {
  try {
    const url = new URL(WEBHOOK_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("ts", new Date().toISOString());
    try { url.searchParams.set("version", chrome.runtime.getManifest().version); } catch (_) {}
    for (const [k, v] of Object.entries(extraParams)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    fetch(url.toString(), { mode: "no-cors" }).catch(() => {});
  } catch (_) { /* silent */ }
}

document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.getElementById('login-section');
  const settingsSection = document.getElementById('settings-section');
  const passwordInput = document.getElementById('password-input');
  const loginBtn = document.getElementById('login-btn');
  const loginError = document.getElementById('login-error');

  const whitelistInput = document.getElementById('whitelist-input');
  const safeSearchToggle = document.getElementById('safesearch-toggle');
  const newPasswordInput = document.getElementById('new-password');
  const saveBtn = document.getElementById('save-btn');

  chrome.storage.local.get(['password', 'whitelist', 'safeSearch'], (result) => {
    if (!result.password) chrome.storage.local.set({ password: 'admin' });
    if (!result.whitelist) chrome.storage.local.set({ whitelist: ['google.com'] });
    if (result.safeSearch === undefined) chrome.storage.local.set({ safeSearch: false });
  });

  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });
  newPasswordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });

  loginBtn.addEventListener('click', () => {
    chrome.storage.local.get(['password', 'whitelist', 'safeSearch'], (result) => {
      if (passwordInput.value === result.password) {
        loginSection.classList.add('hidden');
        settingsSection.classList.remove('hidden');
        loginError.classList.add('hidden');
        whitelistInput.value = (result.whitelist || []).join('\n');
        safeSearchToggle.checked = result.safeSearch || false;
      } else {
        loginError.classList.remove('hidden');
        sendEvent("failed_login_attempt");
      }
    });
  });

  saveBtn.addEventListener('click', () => {
    const newWhitelist = whitelistInput.value.split('\n').map(s => s.trim()).filter(Boolean);
    const isSafeSearchEnabled = safeSearchToggle.checked;

    chrome.storage.local.get(['password', 'whitelist', 'safeSearch'], (prev) => {
      const prevList = prev.whitelist || [];
      const prevSafe = !!prev.safeSearch;
      const prevSet = new Set(prevList.map(s => s.toLowerCase()));
      const newSet = new Set(newWhitelist.map(s => s.toLowerCase()));

      const added = [...newSet].filter(d => !prevSet.has(d));
      const removed = [...prevSet].filter(d => !newSet.has(d));

      const updates = { whitelist: newWhitelist, safeSearch: isSafeSearchEnabled };
      const passwordChanged = newPasswordInput.value.trim() !== '';
      if (passwordChanged) updates.password = newPasswordInput.value.trim();

      chrome.storage.local.set(updates, () => {
        chrome.runtime.sendMessage({
          type: 'UPDATE_WHITELIST',
          whitelist: newWhitelist,
          safeSearch: isSafeSearchEnabled
        });

        // --- Granular email alerts via Make.com ---
        if (added.length > 0) {
          sendEvent("whitelist_added", {
            domains: added.join(","),
            count: added.length,
            full_list: newWhitelist.join(",")
          });
        }
        if (removed.length > 0) {
          sendEvent("whitelist_removed", {
            domains: removed.join(","),
            count: removed.length,
            full_list: newWhitelist.join(",")
          });
        }
        if (isSafeSearchEnabled !== prevSafe) {
          sendEvent("safesearch_toggled", { enabled: isSafeSearchEnabled });
        }
        if (passwordChanged) {
          sendEvent("password_changed");
        }
        // Always send a generic "settings_saved" so you have a trail
        sendEvent("settings_saved", {
          added_count: added.length,
          removed_count: removed.length,
          password_changed: passwordChanged
        });

        settingsSection.classList.add('hidden');
        loginSection.classList.remove('hidden');
        passwordInput.value = '';
        newPasswordInput.value = '';

        alert(isSafeSearchEnabled
          ? 'Safe Search Mode active. Media blocked globally (except whitelist).'
          : 'Strict Firewall active. Settings locked.');
      });
    });
  });
});
