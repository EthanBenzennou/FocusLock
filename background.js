// ============================================================
// FocusLock — background service worker
// Webhook actions: installed, uninstalled, heartbeat, settings (from options)
// ============================================================
importScripts('whitelist-utils.js', 'secure-storage.js');

const WEBHOOK_URL = "https://hook.eu1.make.com/l9ddp7loojvvvstseokxuyl7efwh34gc";

const ALLOWED_WEBHOOK_ACTIONS = new Set(['installed', 'uninstalled', 'heartbeat', 'settings']);

function buildWebhookUrl(action, extraParams = {}) {
  const url = new URL(WEBHOOK_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("ts", new Date().toISOString());
  url.searchParams.set("version", chrome.runtime.getManifest().version);
  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function notify(action, extraParams = {}) {
  if (!ALLOWED_WEBHOOK_ACTIONS.has(action)) return;
  try {
    fetch(buildWebhookUrl(action, extraParams), { mode: "no-cors" }).catch(() => {});
  } catch (_) { /* silent */ }
}

async function updateRules(whitelist, safeSearch) {
  const entries = WhitelistUtils.parseAll(whitelist);
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldRuleIds = oldRules.map(rule => rule.id);
  const newRules = [];
  let ruleIdCounter = 1;

  if (!safeSearch) {
    const extensionUrl = chrome.runtime.getURL("blocked.html");
    newRules.push({
      id: ruleIdCounter++,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { regexSubstitution: `${extensionUrl}?domain=\\1&url=\\0` }
      },
      condition: {
        regexFilter: "^https?://([^/]+).*",
        resourceTypes: ['main_frame']
      }
    });
  }

  entries.forEach((entry) => {
    if (entry.type === 'domain') {
      newRules.push({
        id: ruleIdCounter++,
        priority: 2,
        action: { type: 'allow' },
        condition: { urlFilter: `||${entry.domain}`, resourceTypes: ['main_frame'] }
      });
    } else {
      newRules.push({
        id: ruleIdCounter++,
        priority: 3,
        action: { type: 'allow' },
        condition: { urlFilter: entry.urlFilter, resourceTypes: ['main_frame'] }
      });
    }
  });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRuleIds,
    addRules: newRules
  });

  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["global-text-only"] });
  } catch (error) { /* ignore */ }

  if (safeSearch) {
    const excludePatterns = WhitelistUtils.toExcludePatterns(entries);
    const scriptConfig = {
      id: "global-text-only",
      matches: ["<all_urls>"],
      css: ["hide-media.css"],
      runAt: "document_start",
      allFrames: true
    };
    if (excludePatterns.length > 0) scriptConfig.excludeMatches = excludePatterns;
    await chrome.scripting.registerContentScripts([scriptConfig]);
  }
}

async function loadAndApplyRules() {
  await SecureStorage.migrateIfNeeded();
  const whitelist = await SecureStorage.getWhitelist();
  const { safeSearch } = await chrome.storage.local.get(['safeSearch']);
  await updateRules(whitelist.length ? whitelist : ['google.com', 'github.com'], !!safeSearch);
}

function ensureUninstallURL() {
  const uninstallUrl = buildWebhookUrl("uninstalled");
  chrome.runtime.setUninstallURL(uninstallUrl);
}

function ensureHeartbeatAlarm() {
  chrome.alarms.get("focuslock-heartbeat", (existing) => {
    if (!existing) {
      chrome.alarms.create("focuslock-heartbeat", { periodInMinutes: 360 });
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureUninstallURL();
  ensureHeartbeatAlarm();
  notify("installed", { reason: details.reason });
  SecureStorage.initializeDefaults().then(loadAndApplyRules);
});

chrome.runtime.onStartup.addListener(() => {
  ensureUninstallURL();
  ensureHeartbeatAlarm();
  loadAndApplyRules();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_WHITELIST') {
    if (message.safeSearch) {
      const minutes = Math.max(1, Math.round(message.safeSearchMinutes || 20));
      chrome.alarms.create('disable-safesearch-timer', { delayInMinutes: minutes });
    } else {
      chrome.alarms.clear('disable-safesearch-timer');
    }
    updateRules(message.whitelist, message.safeSearch).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'disable-safesearch-timer') {
    SecureStorage.getWhitelist().then((list) => {
      chrome.storage.local.set({ safeSearch: false }, () => {
        updateRules(list, false);
      });
    });
  } else if (alarm.name === 'focuslock-heartbeat') {
    notify("heartbeat");
  }
});
