document.addEventListener('DOMContentLoaded', () => {
  const queryString = window.location.search;
  const urlParams = new URLSearchParams(queryString);
  const domain = urlParams.get('domain');

  const urlIndex = queryString.indexOf('&url=');
  const originalUrl = urlIndex !== -1 ? queryString.substring(urlIndex + 5) : `https://${domain}`;

  document.getElementById('blocked-url').textContent = originalUrl;

  const passwordModal = document.getElementById('password-modal');
  const passwordTitle = document.getElementById('password-modal-title');
  const passwordDesc = document.getElementById('password-modal-desc');
  const passwordInput = document.getElementById('modal-password');
  const passwordError = document.getElementById('password-modal-error');

  const safeSearchModal = document.getElementById('safesearch-modal');
  const safeSearchPassword = document.getElementById('safesearch-password');
  const safeSearchDuration = document.getElementById('safesearch-duration');
  const safeSearchError = document.getElementById('safesearch-modal-error');

  async function verifyPassword(pwd) {
    const { passwordHash, passwordSalt } = await chrome.storage.local.get(['passwordHash', 'passwordSalt']);
    return SecureStorage.verifyPassword(pwd, passwordHash, passwordSalt);
  }

  function openPasswordModal(title, description) {
    return new Promise((resolve) => {
      passwordTitle.textContent = title;
      passwordDesc.textContent = description;
      passwordInput.value = '';
      passwordError.classList.remove('visible');
      passwordError.textContent = 'Incorrect password.';
      passwordModal.classList.add('open');
      passwordInput.focus();

      function cleanup(result) {
        passwordModal.classList.remove('open');
        passwordModalCancel.removeEventListener('click', onCancel);
        passwordModalConfirm.removeEventListener('click', onConfirm);
        passwordInput.removeEventListener('keydown', onKeydown);
        resolve(result);
      }

      function onCancel() { cleanup(null); }
      async function onConfirm() {
        const pwd = passwordInput.value;
        if (!pwd) {
          passwordError.textContent = 'Please enter your password.';
          passwordError.classList.add('visible');
          return;
        }
        if (!(await verifyPassword(pwd))) {
          passwordError.textContent = 'Incorrect password.';
          passwordError.classList.add('visible');
          passwordInput.value = '';
          passwordInput.focus();
          return;
        }
        cleanup(pwd);
      }
      function onKeydown(e) {
        if (e.key === 'Enter') onConfirm();
        if (e.key === 'Escape') onCancel();
      }

      const passwordModalCancel = document.getElementById('password-modal-cancel');
      const passwordModalConfirm = document.getElementById('password-modal-confirm');
      passwordModalCancel.addEventListener('click', onCancel);
      passwordModalConfirm.addEventListener('click', onConfirm);
      passwordInput.addEventListener('keydown', onKeydown);
    });
  }

  async function addWhitelistEntry(entry) {
    const whitelist = await SecureStorage.getWhitelist();
    const parsed = WhitelistUtils.parseEntry(entry);
    if (!parsed) return;

    const keys = new Set(whitelist.map((item) => WhitelistUtils.parseEntry(item)?.key).filter(Boolean));
    if (!keys.has(parsed.key)) whitelist.push(parsed.raw);

    await SecureStorage.saveWhitelist(whitelist);
    chrome.runtime.sendMessage({ type: 'UPDATE_WHITELIST', whitelist, safeSearch: false }, () => {
      window.location.href = originalUrl;
    });
  }

  async function handleWhitelist(scope) {
    const isPage = scope === 'page';
    const pwd = await openPasswordModal(
      isPage ? 'Whitelist This Page' : 'Whitelist Whole Domain',
      isPage
        ? 'Enter your password to allow only this specific page.'
        : 'Enter your password to allow the entire domain.'
    );
    if (pwd === null) return;

    const entry = isPage
      ? WhitelistUtils.pageEntryFromUrl(originalUrl)
      : WhitelistUtils.domainEntryFromUrl(originalUrl);

    if (!entry) return alert('Could not parse this URL.');
    await addWhitelistEntry(entry.raw);
  }

  document.getElementById('whitelist-domain-btn').addEventListener('click', () => handleWhitelist('domain'));
  document.getElementById('whitelist-page-btn').addEventListener('click', () => handleWhitelist('page'));

  function openSafeSearchModal() {
    safeSearchPassword.value = '';
    safeSearchDuration.value = '';
    safeSearchError.classList.remove('visible');
    safeSearchError.textContent = '';
    safeSearchModal.classList.add('open');
    safeSearchPassword.focus();
  }

  function closeSafeSearchModal() {
    safeSearchModal.classList.remove('open');
  }

  document.getElementById('safesearch-btn').addEventListener('click', openSafeSearchModal);
  document.getElementById('safesearch-modal-cancel').addEventListener('click', closeSafeSearchModal);

  document.getElementById('safesearch-modal-confirm').addEventListener('click', async () => {
    const pwd = safeSearchPassword.value;
    const minutes = WhitelistUtils.parseDurationMinutes(safeSearchDuration.value);

    if (!pwd) {
      safeSearchError.textContent = 'Please enter your password.';
      safeSearchError.classList.add('visible');
      return;
    }
    if (!minutes) {
      safeSearchError.textContent = 'Enter a duration like "5 minutes", "10 mins", or "1 hour".';
      safeSearchError.classList.add('visible');
      return;
    }

    if (!(await verifyPassword(pwd))) {
      safeSearchError.textContent = 'Incorrect password.';
      safeSearchError.classList.add('visible');
      return;
    }

    const whitelist = await SecureStorage.getWhitelist();
    await chrome.storage.local.set({ safeSearch: true });
    chrome.runtime.sendMessage({
      type: 'UPDATE_WHITELIST',
      whitelist,
      safeSearch: true,
      safeSearchMinutes: minutes
    }, () => {
      window.location.href = originalUrl;
    });
  });

  safeSearchDuration.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('safesearch-modal-confirm').click();
  });
});
