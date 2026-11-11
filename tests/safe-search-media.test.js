const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "hide-media.css"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
);
const whitelistUtils = fs.readFileSync(
  path.join(root, "whitelist-utils.js"),
  "utf8",
);

async function runBackgroundScenario(topLevelUrl, frameId) {
  const listeners = {};
  const cssCalls = [];
  let registeredContentScript;
  const noOpEvent = { addListener: () => {} };
  const context = {
    console,
    URL,
    URLSearchParams,
    Date,
    Number,
    Set,
    self: { addEventListener: () => {} },
    importScripts: () => {},
    SecureStorage: {
      migrateIfNeeded: async () => {},
      getWhitelist: async () => ["allowed.example"],
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener: (listener) => {
            listeners.onMessage = listener;
          },
        },
        onInstalled: noOpEvent,
        onStartup: noOpEvent,
        getURL: (file) => `chrome-extension://test/${file}`,
        getManifest: () => ({ version: "1.0" }),
        setUninstallURL: () => {},
      },
      webNavigation: {
        onHistoryStateUpdated: noOpEvent,
        onReferenceFragmentUpdated: noOpEvent,
      },
      storage: {
        local: {
          get: async () => ({ safeSearch: true }),
          set: async () => {},
          remove: async () => {},
        },
      },
      alarms: {
        create: () => {},
        clear: async () => {},
        onAlarm: noOpEvent,
      },
      tabs: { query: async () => [] },
      declarativeNetRequest: {
        getDynamicRules: async () => [],
        updateDynamicRules: async () => {},
      },
      scripting: {
        unregisterContentScripts: async () => {},
        registerContentScripts: async ([script]) => {
          registeredContentScript = script;
        },
        insertCSS: async (details) => cssCalls.push(["insert", details]),
        removeCSS: async (details) => cssCalls.push(["remove", details]),
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(whitelistUtils, context);
  vm.runInContext(background, context);

  const response = await new Promise((resolve) => {
    listeners.onMessage(
      { type: "APPLY_SAFESEARCH_FILTER" },
      { tab: { id: 17, url: topLevelUrl }, frameId },
      resolve,
    );
  });

  return { response, cssCalls, registeredContentScript };
}

(async () => {
  if (!css.includes("div.ob-rec-rtb-image")) {
    throw new Error("Expected Outbrain background-image ads to be hidden.");
  }
  if (
    !css.includes("form-signature-pad canvas.signatureCanvas") ||
    !css.includes('canvas[id^="signatureCanvas-"]') ||
    !/canvas\.signatureCanvas[\s\S]*?display:\s*block !important/.test(css)
  ) {
    throw new Error("Expected the reported signature canvas to remain visible and interactive.");
  }
  const imageBlockingRule = css.match(/img:not\([\s\S]*?\n\}/)?.[0];
  const checkboxIconException =
    '[class*="checkbox" i][class*="icon" i]';
  if (
    !imageBlockingRule?.includes(checkboxIconException) ||
    !imageBlockingRule.includes('src*="captcha"') ||
    !imageBlockingRule.includes("display: none !important")
  ) {
    throw new Error(
      "Expected checkbox icon images to be exempt while other images remain blocked.",
    );
  }
  if (
    manifest.content_scripts?.some((script) =>
      script.css?.includes("hide-media.css"),
    )
  ) {
    throw new Error("Expected media filtering to be controlled by Safe Search mode.");
  }

  const allowedPage = await runBackgroundScenario(
    "https://allowed.example/form",
    8,
  );
  if (!allowedPage.response.success || allowedPage.response.filtered) {
    throw new Error("Whitelisted top-level pages should leave every frame unfiltered.");
  }
  if (allowedPage.cssCalls[0]?.[0] !== "remove") {
    throw new Error("Expected stale media filters to be removed from allowed frames.");
  }
  if (
    allowedPage.registeredContentScript.css ||
    allowedPage.registeredContentScript.excludeMatches ||
    !allowedPage.registeredContentScript.allFrames
  ) {
    throw new Error("Expected per-frame filtering instead of frame-local CSS exclusions.");
  }

  const nonWhitelistedPage = await runBackgroundScenario(
    "https://other.example/form",
    8,
  );
  if (
    !nonWhitelistedPage.response.success ||
    !nonWhitelistedPage.response.filtered
  ) {
    throw new Error("Non-whitelisted pages should retain Safe Search media filtering.");
  }
  if (nonWhitelistedPage.cssCalls[0]?.[0] !== "insert") {
    throw new Error("Expected the media filter to be inserted in unwhitelisted frames.");
  }

  console.log("Safe Search media filtering regression tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
