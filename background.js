// ============================================================
// FocusLock — background service worker
// Webhook actions: uninstalled and Safe Search enablement
// ============================================================
importScripts("whitelist-utils.js", "secure-storage.js");

const WEBHOOK_URL =
  "https://hook.eu1.make.com/l9ddp7loojvvvstseokxuyl7efwh34gc";

const ALLOWED_WEBHOOK_ACTIONS = new Set(["uninstalled", "safesearch_on"]);

let cachedEntries = [];
let cachedSafeSearch = false;
let initPromise = null;

function buildWebhookUrl(action, extraParams = {}) {
  const url = new URL(WEBHOOK_URL);
  url.searchParams.set("action", action);
  url.searchParams.set("ts", new Date().toISOString());
  url.searchParams.set("version", chrome.runtime.getManifest().version);
  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined && v !== null && v !== "")
      url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function notify(action, extraParams = {}) {
  if (!ALLOWED_WEBHOOK_ACTIONS.has(action)) return;
  try {
    fetch(buildWebhookUrl(action, extraParams), { mode: "no-cors" }).catch(
      () => {},
    );
  } catch (_) {
    /* silent */
  }
}

async function refreshCache(whitelist, safeSearch) {
  const list =
    whitelist && whitelist.length ? whitelist : ["google.com", "github.com"];
  cachedEntries = WhitelistUtils.parseAll(list);
  cachedSafeSearch = !!safeSearch;
}

function isAllowedUrl(urlString) {
  return WhitelistUtils.isUrlAllowed(urlString, cachedEntries, {
    safeSearch: cachedSafeSearch,
  });
}

function blockedPageUrl(urlString) {
  const parsed = new URL(urlString);
  const query = WhitelistUtils.buildBlockedPageQuery(
    parsed.hostname,
    urlString,
  );
  return `${chrome.runtime.getURL("blocked.html")}?${query}`;
}

async function reloadNonWhitelistedTabs() {
  const tabs = await chrome.tabs.query({});
  const extensionPrefix = chrome.runtime.getURL("");

  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    if (/^(chrome|chrome-extension|edge|about|devtools):/i.test(tab.url))
      continue;
    if (tab.url.startsWith(extensionPrefix)) continue;
    if (isAllowedUrl(tab.url)) continue;

    try {
      await chrome.tabs.reload(tab.id);
    } catch (_) {
      /* tab may have closed */
    }
  }
}

async function updateRules(whitelist, safeSearch) {
  const entries = WhitelistUtils.parseAll(whitelist);
  await refreshCache(whitelist, safeSearch);

  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldRuleIds = oldRules.map((rule) => rule.id);
  const newRules = [];
  let ruleIdCounter = 1;

  if (!safeSearch) {
    const extensionUrl = chrome.runtime.getURL("blocked.html");
    newRules.push({
      id: ruleIdCounter++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { regexSubstitution: `${extensionUrl}?domain=\\1&url=\\0` },
      },
      condition: {
        regexFilter: "^https?://([^/]+).*",
        resourceTypes: ["main_frame"],
      },
    });
  }

  entries.forEach((entry) => {
    if (entry.type === "domain") {
      newRules.push({
        id: ruleIdCounter++,
        priority: 2,
        action: { type: "allow" },
        condition: {
          urlFilter: `||${entry.domain}`,
          resourceTypes: ["main_frame"],
        },
      });
    } else {
      newRules.push({
        id: ruleIdCounter++,
        priority: 3,
        action: { type: "allow" },
        condition: {
          urlFilter: entry.urlFilter,
          resourceTypes: ["main_frame"],
        },
      });
    }
  });

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldRuleIds,
      addRules: newRules,
    });
  } catch (error) {
    console.error("updateDynamicRules failed", {
      error,
      ruleCount: newRules.length,
      oldRuleIds,
      newRules,
    });
    throw error;
  }

  const contentScriptId = safeSearch ? "global-text-only" : "navigation-guard";

  try {
    await chrome.scripting.unregisterContentScripts({
      ids: ["global-text-only", "navigation-guard"],
    });
  } catch (error) {
    /* ignore */
  }

  try {
    if (safeSearch) {
      const excludePatterns = WhitelistUtils.toExcludePatterns(entries);
      const scriptConfig = {
        id: contentScriptId,
        matches: ["<all_urls>"],
        css: ["hide-media.css"],
        runAt: "document_start",
        allFrames: true,
      };
      if (excludePatterns.length > 0)
        scriptConfig.excludeMatches = excludePatterns;
      await chrome.scripting.registerContentScripts([scriptConfig]);
    } else {
      await chrome.scripting.registerContentScripts([
        {
          id: contentScriptId,
          matches: ["http://*/*", "https://*/*"],
          js: ["navigation-guard.js"],
          runAt: "document_start",
          allFrames: false,
        },
      ]);
    }
  } catch (error) {
    if (!/Duplicate script ID/i.test(error?.message || "")) {
      throw error;
    }
  }

  // Log successful application for debugging
  try {
    console.log("updateRules: applied", {
      entries: entries.length,
      safeSearch,
    });
  } catch (e) {
    /* ignore logging errors */
  }
}

async function loadAndApplyRules() {
  await SecureStorage.migrateIfNeeded();
  const whitelist = await SecureStorage.getWhitelist();
  const { safeSearch } = await chrome.storage.local.get(["safeSearch"]);

  console.log("loadAndApplyRules", {
    whitelistLength: whitelist.length,
    safeSearch: !!safeSearch,
  });

  if (!safeSearch) {
    await chrome.alarms.clear("disable-safesearch-timer");
  }

  await updateRules(
    whitelist.length ? whitelist : ["google.com", "github.com"],
    !!safeSearch,
  );
}

function startInitialization(forceReload = false) {
  if (forceReload || !initPromise) {
    initPromise = loadAndApplyRules().catch((error) => {
      console.error("Failed to initialize rules on startup:", error);
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

function ensureInitialized() {
  return initPromise ? initPromise : startInitialization();
}

async function ensureCacheReady() {
  try {
    await ensureInitialized();
  } catch (error) {
    console.error("ensureCacheReady init failed:", error);
    const whitelist = await SecureStorage.getWhitelist();
    await refreshCache(whitelist, cachedSafeSearch);
  }
}

async function handleSpaNavigation(details) {
  if (details.frameId !== 0) return;
  if (cachedSafeSearch) return;
  await ensureCacheReady();
  if (isAllowedUrl(details.url)) return;

  try {
    await chrome.tabs.update(details.tabId, {
      url: blockedPageUrl(details.url),
    });
  } catch (_) {
    /* ignore */
  }
}

function ensureUninstallURL() {
  const uninstallUrl = buildWebhookUrl("uninstalled");
  chrome.runtime.setUninstallURL(uninstallUrl);
}

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  ensureInitialized()
    .then(() => handleSpaNavigation(details))
    .catch((error) => console.error("Navigation guard init failed:", error));
});
chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
  ensureInitialized()
    .then(() => handleSpaNavigation(details))
    .catch((error) => console.error("Navigation guard init failed:", error));
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log("background event: onInstalled", details);
  ensureUninstallURL();
  SecureStorage.initializeDefaults().then(startInitialization);
});

chrome.runtime.onStartup.addListener(() => {
  console.log("background event: onStartup");
  ensureUninstallURL();
  startInitialization();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "UPDATE_WHITELIST") {
    if (message.safeSearch) {
      const minutes = message.safeSearchMinutes
        ? Math.max(1, Math.round(message.safeSearchMinutes))
        : 0;
      if (minutes > 0) {
        chrome.alarms.create("disable-safesearch-timer", {
          delayInMinutes: minutes,
        });
      } else {
        chrome.alarms.clear("disable-safesearch-timer");
      }
      notify("safesearch_on", { duration_minutes: minutes || 0 });
    } else {
      chrome.alarms.clear("disable-safesearch-timer");
    }
    (async () => {
      try {
        await ensureInitialized();
        await updateRules(message.whitelist, message.safeSearch);
        sendResponse({ success: true });
      } catch (err) {
        console.error("Failed to update rules:", err);
        sendResponse({ success: false, error: String(err) });
      }
    })();
    return true;
  }

  if (message.type === "CHECK_URL") {
    ensureInitialized()
      .then(() => {
        sendResponse({ allowed: isAllowedUrl(message.url) });
      })
      .catch((error) => {
        console.error("CHECK_URL init failed:", error);
        sendResponse({ allowed: false });
      });
    return true;
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "disable-safesearch-timer") return;

  try {
    const list = await SecureStorage.getWhitelist();
    await chrome.storage.local.set({ safeSearch: false });
    await updateRules(list, false);
    await reloadNonWhitelistedTabs();
  } catch (error) {
    console.error("Alarm handler failed:", error);
  }
});

self.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection in background service worker:", event.reason);
});

self.addEventListener("error", (event) => {
  console.error("Unhandled error in background service worker:", event.message, event.filename, event.lineno, event.colno, event.error);
});

// Ensure rules and cache are initialized whenever the service worker starts.
startInitialization().catch((error) => {
  console.error("Failed to initialize rules on startup:", error);
});
