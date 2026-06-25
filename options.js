
document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.getElementById('login-section');
  const settingsSection = document.getElementById('settings-section');
  const passwordInput = document.getElementById('password-input');
  const loginBtn = document.getElementById('login-btn');
  const loginError = document.getElementById('login-error');
  
  const whitelistInput = document.getElementById('whitelist-input');
  const newPasswordInput = document.getElementById('new-password');
  const saveBtn = document.getElementById('save-btn');

  // Load defaults if this is the first time running
  chrome.storage.local.get(['password', 'whitelist'], (result) => {
    if (!result.password) chrome.storage.local.set({ password: 'admin' });
    if (!result.whitelist) chrome.storage.local.set({ whitelist: ['google.com'] });
  });

  // Handle Login
  loginBtn.addEventListener('click', () => {
    chrome.storage.local.get(['password'], (result) => {
      if (passwordInput.value === result.password) {
        loginSection.classList.add('hidden');
        settingsSection.classList.remove('hidden');
        loginError.classList.add('hidden');
        
        // Populate the text box with the current whitelist
        chrome.storage.local.get(['whitelist'], (data) => {
          whitelistInput.value = data.whitelist.join('\n');
        });
      } else {
        loginError.classList.remove('hidden');
      }
    });
  });

  // Handle Saving
  saveBtn.addEventListener('click', () => {
    // Clean up the text input into an array
    const newWhitelist = whitelistInput.value.split('\n').map(s => s.trim()).filter(Boolean);
    const updates = { whitelist: newWhitelist };
    
    // Update password if the user typed a new one
    if (newPasswordInput.value.trim() !== '') {
      updates.password = newPasswordInput.value.trim();
    }

    // Save to storage, then trigger the background script
    chrome.storage.local.set(updates, () => {
      chrome.runtime.sendMessage({ type: 'UPDATE_WHITELIST', whitelist: newWhitelist });
      
      // Instantly lock the UI again
      settingsSection.classList.add('hidden');
      loginSection.classList.remove('hidden');
      passwordInput.value = '';
      newPasswordInput.value = '';
      
      alert('Settings saved. FocusLock is armed.');
    });
  });
});
