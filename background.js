// ============================================================
// FocusLock — background service worker
// Webhook actions: installed, uninstalled, heartbeat, settings (from options)
// ============================================================
importScripts('whitelist-utils.js', 'secure-storage.js');

const WEBHOOK_URL = "https://hook.eu1.make.com/l9ddp7loojvvvstseokxuyl7efwh34gc";

const ALLOWED_WEBHOOK_ACTIONS = new Set(['installed', 'uninstalled', 'heartbeat', 'settings']);

let cachedEntries = [];
let cachedSafeSearch = false;

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

async function refreshCache(whitelist, safeSearch) {
  const list = whitelist && whitelist.length ? whitelist : ['google.com', 'github.com'];
  cachedEntries = WhitelistUtils.parseAll(list);
  cachedSafeSearch = !!safeSearch;
}

function isAllowedUrl(urlString) {
  return WhitelistUtils.isUrlAllowed(urlString, cachedEntries, { safeSearch: cachedSafeSearch });
}

function blockedPageUrl(urlString) {
  const parsed = new URL(urlString);
  return chrome.runtime.getURL('blocked.html') +
    '?domain=' + encodeURIComponent(parsed.hostname) +
    '&url=' + encodeURIComponent(urlString);
}

async function reloadNonWhitelistedTabs() {
  const tabs = await chrome.tabs.query({});
  const extensionPrefix = chrome.runtime.getURL('');

  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    if (/^(chrome|chrome-extension|edge|about|devtools):/i.test(tab.url)) continue;
    if (tab.url.startsWith(extensionPrefix)) continue;
    if (isAllowedUrl(tab.url)) continue;

    try {
      await chrome.tabs.reload(tab.id);
    } catch (_) { /* tab may have closed */ }
  }
}

async function updateRules(whitelist, safeSearch) {
  const entries = WhitelistUtils.parseAll(whitelist);
  await refreshCache(whitelist, safeSearch);

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
    await chrome.scripting.unregisterContentScripts({ ids: ["global-text-only", "navigation-guard"] });
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
  } else {
    await chrome.scripting.registerContentScripts([{
      id: "navigation-guard",
      matches: ["http://*/*", "https://*/*"],
      js: ["navigation-guard.js"],
      runAt: "document_start",
      allFrames: false
    }]);
  }
}

async function loadAndApplyRules() {
  await SecureStorage.migrateIfNeeded();
  const whitelist = await SecureStorage.getWhitelist();
  const { safeSearch } = await chrome.storage.local.get(['safeSearch']);
  await updateRules(whitelist.length ? whitelist : ['google.com', 'github.com'], !!safeSearch);
}

async function handleSpaNavigation(details) {
  if (details.frameId !== 0) return;
  if (cachedSafeSearch) return;
  if (isAllowedUrl(details.url)) return;

  try {
    await chrome.tabs.update(details.tabId, { url: blockedPageUrl(details.url) });
  } catch (_) { /* ignore */ }
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

chrome.webNavigation.onHistoryStateUpdated.addListener(handleSpaNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(handleSpaNavigation);

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
      const minutes = message.safeSearchMinutes ? Math.max(1, Math.round(message.safeSearchMinutes)) : 0;
      if (minutes > 0) {
        chrome.alarms.create('disable-safesearch-timer', { delayInMinutes: minutes });
      } else {
        chrome.alarms.clear('disable-safesearch-timer');
      }
    } else {
      chrome.alarms.clear('disable-safesearch-timer');
    }
    updateRules(message.whitelist, message.safeSearch).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'CHECK_URL') {
    sendResponse({ allowed: isAllowedUrl(message.url) });
    return false;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'disable-safesearch-timer') {
    SecureStorage.getWhitelist().then(async (list) => {
      await chrome.storage.local.set({ safeSearch: false });
      await updateRules(list, false);
      await reloadNonWhitelistedTabs();
    });
  } else if (alarm.name === 'focuslock-heartbeat') {
    notify("heartbeat");
  }
});
