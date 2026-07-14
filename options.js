// ============================================================
// FocusLock — options page
// Webhook: only sends "settings" on save (no login/failure/granular events).
// ============================================================
const WEBHOOK_URL = "https://hook.eu1.make.com/l9ddp7loojvvvstseokxuyl7efwh34gc";

function sendSettingsWebhook(extraParams = {}) {
    try {
        const url = new URL(WEBHOOK_URL);
        url.searchParams.set("action", "settings");
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
    
    SecureStorage.initializeDefaults();
    
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });
    newPasswordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
    
    loginBtn.addEventListener('click', async () => {
        const { passwordHash, passwordSalt } = await chrome.storage.local.get(['passwordHash', 'passwordSalt']);
        const ok = await SecureStorage.verifyPassword(passwordInput.value, passwordHash, passwordSalt);
        if (ok) {
            const whitelist = await SecureStorage.getWhitelist();
            const { safeSearch } = await chrome.storage.local.get(['safeSearch']);
            loginSection.classList.add('hidden');
            settingsSection.classList.remove('hidden');
            loginError.classList.add('hidden');
            whitelistInput.value = whitelist.join('\n');
            safeSearchToggle.checked = !!safeSearch;
        } else {
            loginError.classList.remove('hidden');
        }
    });
    
    saveBtn.addEventListener('click', async () => {
        const newWhitelist = whitelistInput.value.split('\n').map(s => s.trim()).filter(Boolean);
        const isSafeSearchEnabled = safeSearchToggle.checked;
        
        // Trigger prompt just like the blocked page
        let timeLimit = 0;
        if (isSafeSearchEnabled) {
            const timeInput = prompt("Enter Safe Search time limit in minutes (leave blank for infinite):");
            if (timeInput === null) return; // If you hit Cancel, stop saving
            timeLimit = parseInt(timeInput, 10) || 0;
        }
        
        const prevWhitelist = await SecureStorage.getWhitelist();
        const { safeSearch: prevSafe } = await chrome.storage.local.get(['safeSearch']);
        const prevSet = new Set(prevWhitelist.map(s => s.toLowerCase()));
        const newSet = new Set(newWhitelist.map(s => s.toLowerCase()));

        const added = [...newSet].filter(d => !prevSet.has(d));
        const removed = [...prevSet].filter(d => !newSet.has(d));
        const passwordChanged = newPasswordInput.value.trim() !== '';

        await SecureStorage.saveWhitelist(newWhitelist);
        await chrome.storage.local.set({ safeSearch: isSafeSearchEnabled });
        if (passwordChanged) {
            await SecureStorage.setPasswordHash(newPasswordInput.value.trim());
        }

        chrome.runtime.sendMessage({
            type: 'UPDATE_WHITELIST',
            whitelist: newWhitelist,
            safeSearch: isSafeSearchEnabled,
            safeSearchMinutes: timeLimit
        });

        sendSettingsWebhook({
            added_count: added.length,
            removed_count: removed.length,
            password_changed: passwordChanged,
            safesearch_enabled: isSafeSearchEnabled,
            whitelist_count: newWhitelist.length
        });
            
        settingsSection.classList.add('hidden');
        loginSection.classList.remove('hidden');
        passwordInput.value = '';
        newPasswordInput.value = '';
            
        alert(isSafeSearchEnabled ? `Safe Search Mode active for ${timeLimit ? timeLimit + ' mins' : 'infinite'}.` : 'Strict Firewall active. Settings locked.');
    });
});
