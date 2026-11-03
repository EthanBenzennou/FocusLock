const fs = require("fs");
const path = require("path");
const vm = require("vm");

async function runActivationScenario(defaultDuration) {
  const code = fs.readFileSync(
    path.join(__dirname, "..", "blocked.js"),
    "utf8",
  );
  const handlers = new Map();
  const elements = new Map();
  const stored = { safeSearchDefaultDurationMinutes: defaultDuration };
  let updateMessage;
  let updatedUrl;
  let prompted = false;

  function makeElement(id) {
    const element = {
      id,
      textContent: "",
      style: {},
      addEventListener: (eventName, handler) =>
        handlers.set(`${id}:${eventName}`, handler),
    };
    elements.set(id, element);
    return element;
  }

  [
    "domain-name",
    "message",
    "allow-domain-btn",
    "allow-page-btn",
    "safesearch-btn",
  ].forEach(makeElement);

  const context = {
    console,
    URL,
    URLSearchParams,
    Date,
    window: {
      location: {
        search: "?domain=example.com&url=https%3A%2F%2Fexample.com%2Fpage",
        href: "",
      },
    },
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
        sendMessage: (message, callback) => {
          updateMessage = message;
          callback({ success: true });
        },
      },
      tabs: {
        update: (tab, callback) => {
          updatedUrl = tab.url;
          callback();
        },
      },
    },
    WhitelistUtils: {
      DEFAULT_SAFE_SEARCH_DURATION_MINUTES: 60,
      parseBlockedPageQuery: () => ({
        domain: "example.com",
        url: "https://example.com/page",
      }),
    },
    SecureStorage: {
      verifyPassword: async () => true,
      getWhitelist: async () => ["example.org"],
    },
    prompt: () => {
      prompted = true;
      return "password";
    },
    alert: (message) => {
      throw new Error(message);
    },
  };

  vm.createContext(context);
  vm.runInContext(code, context);
  await handlers.get("ready")();
  await handlers.get("safesearch-btn:click")();

  if (!prompted) throw new Error("Activation should still request the password");
  if (updateMessage.safeSearchMinutes !== (defaultDuration || 60)) {
    throw new Error(`Unexpected activation duration: ${updateMessage.safeSearchMinutes}`);
  }
  if (stored.safeSearch !== true || stored.safeSearchDurationMinutes !== (defaultDuration || 60)) {
    throw new Error("Activation did not persist the active Safe Search duration");
  }
  if (updatedUrl !== "https://example.com/page") {
    throw new Error(`Activation did not return to the blocked URL: ${updatedUrl}`);
  }
}

(async () => {
  await runActivationScenario(60);
  await runActivationScenario(25);
  await runActivationScenario(undefined);
  console.log("blocked-page Safe Search activation tests passed");
})();
