const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(
  path.join(__dirname, "..", "blocked.js"),
  "utf8",
);
const retryState = new Map();

async function runScenario(navigationType) {
  const handlers = new Map();
  const elements = new Map();
  let replacement;

  function makeElement(id) {
    const element = {
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
    performance: {
      getEntriesByType: () => [{ type: navigationType }],
    },
    sessionStorage: {
      getItem: (key) => retryState.get(key) || null,
      setItem: (key, value) => retryState.set(key, value),
      removeItem: (key) => retryState.delete(key),
    },
    window: {
      location: {
        search: "?domain=example.com&url=https%3A%2F%2Fexample.com%2Fpage",
        replace: (url) => {
          replacement = url;
        },
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
          get: async () => ({ safeSearch: false }),
        },
      },
    },
    WhitelistUtils: {
      parseBlockedPageQuery: () => ({
        domain: "example.com",
        url: "https://example.com/page",
      }),
    },
  };

  vm.createContext(context);
  vm.runInContext(code, context);
  await handlers.get("ready")();

  return { replacement, handlers };
}

(async () => {
  const initialLoad = await runScenario("navigate");
  if (initialLoad.replacement) {
    throw new Error("An initial blocked-page load should remain blocked");
  }

  const refresh = await runScenario("reload");
  if (refresh.replacement !== "https://example.com/page") {
    throw new Error("Refreshing a blocked page should retry its original URL");
  }

  const redirectedBackToBlockPage = await runScenario("reload");
  if (redirectedBackToBlockPage.replacement) {
    throw new Error("A strict-mode retry should not loop on the blocking page");
  }
  if (!redirectedBackToBlockPage.handlers.has("safesearch-btn:click")) {
    throw new Error("The blocked-page actions should remain available");
  }

  console.log("blocked-page refresh tests passed");
})();
