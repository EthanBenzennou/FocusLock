// ============================================================
// FocusLock — background service worker
// Webhook: replace WEBHOOK_URL with your Make.com webhook URL.
// The extension sends a GET with ?action=... and event details.
// ============================================================
const WEBHOOK_URL = "https://hook.us1.make.com/rst9dds5x8xerdi1u5le4jtog9jdgv2f";

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
  try {
    fetch(buildWebhookUrl(action, extraParams), { mode: "no-cors" }).catch(() => {});
  } catch (_) { /* silent */ }
}

async function updateRules(whitelist, safeSearch) {
  const cleanWhitelist = whitelist.map(item => {
    try {
      let urlString = item.trim();
      if (!urlString.startsWith('http')) urlString = 'https://' + urlString;
      const hostname = new URL(urlString).hostname.toLowerCase();
      return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
    } catch (e) {
      return null;
    }
  }).filter(domain => domain && /^[a-z0-9.-]+$/.test(domain));

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

  cleanWhitelist.forEach((domain) => {
    newRules.push({
      id: ruleIdCounter++,
      priority: 2,
      action: { type: 'allow' },
      condition: { urlFilter: `||${domain}`, resourceTypes: ['main_frame'] }
    });
  });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRuleIds,
    addRules: newRules
  });

  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["global-text-only"] });
  } catch (error) { /* ignore */ }

  if (safeSearch) {
    const excludePatterns = [];
    cleanWhitelist.forEach(domain => {
      excludePatterns.push(`*://${domain}/*`);
      excludePatterns.push(`*://*.${domain}/*`);
    });
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

// --- Setup uninstall URL and heartbeat on both install and startup ---
function ensureUninstallURL() {
  const uninstallUrl = buildWebhookUrl("uninstalled");
  chrome.runtime.setUninstallURL(uninstallUrl);
}

function ensureHeartbeatAlarm() {
  chrome.alarms.get("focuslock-heartbeat", (existing) => {
    if (!existing) {
      // fire every 6 hours; Make.com "no heartbeat in 24h" scenario => email alert
      chrome.alarms.create("focuslock-heartbeat", { periodInMinutes: 360 });
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureUninstallURL();
  ensureHeartbeatAlarm();
  notify("installed", { reason: details.reason });

  chrome.storage.local.get(['whitelist', 'safeSearch'], (result) => {
    const list = result.whitelist || ['google.com', 'github.com'];
    const isSafe = result.safeSearch || false;
    updateRules(list, isSafe);
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureUninstallURL();
  ensureHeartbeatAlarm();
  notify("startup");
});

// --- Message handling from options page ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_WHITELIST') {
    if (message.safeSearch) {
      chrome.alarms.create('disable-safesearch-timer', { delayInMinutes: 20 });
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
    chrome.storage.local.get(['whitelist'], (result) => {
      const list = result.whitelist || [];
      chrome.storage.local.set({ safeSearch: false }, () => {
        updateRules(list, false);
        notify("safesearch_timeout");
      });
    });
  } else if (alarm.name === 'focuslock-heartbeat') {
    notify("heartbeat");
  }
});
