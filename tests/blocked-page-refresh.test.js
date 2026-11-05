const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(
  path.join(__dirname, "..", "blocked.js"),
  "utf8",
);

async function runScenario(safeSearch) {
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
          get: async () => ({ safeSearch }),
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
  const active = await runScenario(true);
  if (active.replacement !== "https://example.com/page") {
    throw new Error("Refreshing a blocked page should retry its URL in Safe Search");
  }

  const inactive = await runScenario(false);
  if (inactive.replacement) {
    throw new Error("A blocked page should remain visible when Safe Search is off");
  }
  if (!inactive.handlers.has("safesearch-btn:click")) {
    throw new Error("The blocked-page actions should remain available when blocked");
  }

  console.log("blocked-page refresh tests passed");
})();
