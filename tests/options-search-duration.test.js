const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(
  path.join(__dirname, "..", "options.js"),
  "utf8",
);
const elements = new Map();
const handlers = new Map();
const stored = {
  safeSearch: false,
  safeSearchDefaultDurationMinutes: 60,
};
let updateMessage;
let createdTabUrl;

function makeElement(id) {
  const element = {
    id,
    value: "",
    checked: false,
    textContent: "",
    style: {},
    classList: {
      add: () => {},
      remove: () => {},
    },
    addEventListener: (eventName, handler) =>
      handlers.set(`${id}:${eventName}`, handler),
    click: () => handlers.get(`${id}:click`)(),
  };
  elements.set(id, element);
  return element;
}

[
  "login-section",
  "settings-section",
  "password-input",
  "login-btn",
  "login-error",
  "whitelist-input",
  "safesearch-toggle",
  "safesearch-default-duration",
  "safesearch-duration-error",
  "safesearch-duration-hint",
  "safesearch-remaining",
  "safesearch-extend-btn",
  "new-password",
  "save-btn",
].forEach(makeElement);

const context = {
  console,
  document: {
    getElementById: (id) => elements.get(id),
    addEventListener: (eventName, callback) => {
      if (eventName === "DOMContentLoaded") handlers.set("ready", callback);
    },
  },
  chrome: {
    storage: {
      local: {
        get: async (keys) =>
          Object.fromEntries(keys.map((key) => [key, stored[key]])),
        set: async (values) => Object.assign(stored, values),
      },
    },
    runtime: {
      getURL: (file) => `chrome-extension://focuslock/${file}`,
      sendMessage: (message) => {
        updateMessage = message;
      },
    },
    tabs: {
      create: async ({ url }) => {
        createdTabUrl = url;
      },
    },
  },
  SecureStorage: {
    initializeDefaults: async () => {},
    verifyPassword: async () => true,
    getWhitelist: async () => ["example.com"],
    saveWhitelist: async () => {},
    setPasswordHash: async () => {},
  },
  WhitelistUtils: { DEFAULT_SAFE_SEARCH_DURATION_MINUTES: 60 },
  setInterval: () => 1,
  clearInterval: () => {},
  alert: () => {},
};

vm.createContext(context);
vm.runInContext(code, context);

(async () => {
  await handlers.get("ready")();

  elements.get("password-input").value = "password";
  await elements.get("login-btn").click();

  elements.get("safesearch-default-duration").value = "45";
  elements.get("safesearch-toggle").checked = true;
  await elements.get("save-btn").click();

  if (stored.safeSearchDefaultDurationMinutes !== 45) {
    throw new Error("Settings did not persist the default duration");
  }
  if (
    updateMessage.safeSearch !== true ||
    updateMessage.safeSearchMinutes !== 45
  ) {
    throw new Error("Settings activation did not use the configured duration");
  }

  elements.get("password-input").value = "password";
  await elements.get("login-btn").click();
  if (elements.get("safesearch-extend-btn").style.display !== "block") {
    throw new Error("Extension action should be available for an active session");
  }
  await elements.get("safesearch-extend-btn").click();
  if (!createdTabUrl.endsWith("safe-search-duration.html?source=options")) {
    throw new Error("Extension action did not open the duration selector");
  }

  console.log("settings Safe Search duration tests passed");
})();
