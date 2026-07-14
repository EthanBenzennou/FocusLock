// Secure storage for FocusLock — PBKDF2 password hashing + AES-GCM whitelist encryption.
// Passwords are never stored in plaintext. Whitelist is encrypted at rest; the background
// worker decrypts via an install-bound key so rules still apply on browser restart.
const SecureStorage = (() => {
  const PBKDF2_ITERATIONS = 310000;
  const INSTALL_PEPPER = 'focuslock-vault-2026';

  function toB64(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)));
  }

  function fromB64(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(password, salt, usages) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    );
  }

  async function deriveInstallKey() {
    const salt = new TextEncoder().encode(chrome.runtime.id + ':' + INSTALL_PEPPER);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(INSTALL_PEPPER + chrome.runtime.id),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const hash = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    return { hash: toB64(hash), salt: toB64(salt) };
  }

  async function verifyPassword(password, hashB64, saltB64) {
    const salt = fromB64(saltB64);
    const expected = fromB64(hashB64);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const actual = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const a = new Uint8Array(actual);
    const b = expected;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  async function generateVaultKey() {
    return crypto.getRandomValues(new Uint8Array(32));
  }

  async function encryptJSON(data, keyBytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      new TextEncoder().encode(JSON.stringify(data))
    );
    return { ciphertext: toB64(ciphertext), iv: toB64(iv) };
  }

  async function decryptJSON(ciphertextB64, ivB64, keyBytes) {
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64) },
      cryptoKey,
      fromB64(ciphertextB64)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  async function wrapVaultKeyForInstall(vaultKey) {
    const installKey = await deriveInstallKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, installKey, vaultKey);
    await chrome.storage.local.set({
      vaultKeyInstallEnc: toB64(wrapped),
      vaultKeyInstallIV: toB64(iv)
    });
  }

  async function unwrapVaultKeyFromInstall() {
    const data = await chrome.storage.local.get(['vaultKeyInstallEnc', 'vaultKeyInstallIV']);
    if (!data.vaultKeyInstallEnc || !data.vaultKeyInstallIV) return null;
    const installKey = await deriveInstallKey();
    const vaultKey = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(data.vaultKeyInstallIV) },
      installKey,
      fromB64(data.vaultKeyInstallEnc)
    );
    return new Uint8Array(vaultKey);
  }

  async function persistWhitelist(vaultKey, whitelist) {
    const { ciphertext, iv } = await encryptJSON(whitelist, vaultKey);
    await chrome.storage.local.set({ whitelistEnc: ciphertext, whitelistIV: iv });
  }

  async function getStored() {
    return chrome.storage.local.get([
      'password', 'passwordHash', 'passwordSalt',
      'whitelist', 'whitelistEnc', 'whitelistIV',
      'vaultKeyInstallEnc', 'safeSearch'
    ]);
  }

  async function migrateIfNeeded() {
    const data = await getStored();

    if (data.passwordHash) {
      if (!data.whitelistEnc && data.whitelist) {
        const vaultKey = (await unwrapVaultKeyFromInstall()) || (await generateVaultKey());
        await persistWhitelist(vaultKey, data.whitelist);
        if (!data.vaultKeyInstallEnc) await wrapVaultKeyForInstall(vaultKey);
        await chrome.storage.local.remove(['whitelist']);
      }
      return;
    }

    const legacyPassword = data.password || 'admin';
    const legacyWhitelist = data.whitelist || ['google.com'];
    const { hash, salt } = await hashPassword(legacyPassword);
    const vaultKey = await generateVaultKey();

    await persistWhitelist(vaultKey, legacyWhitelist);
    await wrapVaultKeyForInstall(vaultKey);
    await chrome.storage.local.set({
      passwordHash: hash,
      passwordSalt: salt,
      safeSearch: data.safeSearch ?? false
    });
    await chrome.storage.local.remove(['password', 'whitelist']);
  }

  async function initializeDefaults() {
    await migrateIfNeeded();
    const data = await getStored();
    if (!data.passwordHash) {
      const { hash, salt } = await hashPassword('admin');
      const vaultKey = await generateVaultKey();
      await persistWhitelist(vaultKey, ['google.com']);
      await wrapVaultKeyForInstall(vaultKey);
      await chrome.storage.local.set({
        passwordHash: hash,
        passwordSalt: salt,
        safeSearch: false
      });
    }
  }

  async function getWhitelist() {
    await migrateIfNeeded();
    const data = await getStored();
    if (!data.whitelistEnc || !data.whitelistIV) return [];
    const vaultKey = await unwrapVaultKeyFromInstall();
    if (!vaultKey) return [];
    return decryptJSON(data.whitelistEnc, data.whitelistIV, vaultKey);
  }

  async function saveWhitelist(whitelist) {
    await migrateIfNeeded();
    let vaultKey = await unwrapVaultKeyFromInstall();
    if (!vaultKey) {
      vaultKey = await generateVaultKey();
      await wrapVaultKeyForInstall(vaultKey);
    }
    await persistWhitelist(vaultKey, whitelist);
  }

  async function setPasswordHash(password) {
    const { hash, salt } = await hashPassword(password);
    await chrome.storage.local.set({ passwordHash: hash, passwordSalt: salt });
  }

  return {
    migrateIfNeeded,
    initializeDefaults,
    verifyPassword,
    getWhitelist,
    saveWhitelist,
    setPasswordHash
  };
})();
