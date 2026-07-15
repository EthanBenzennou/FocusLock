const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(
  path.join(__dirname, "..", "whitelist-utils.js"),
  "utf8",
);
const context = {
  console,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
};
vm.createContext(context);
vm.runInContext(code, context);
vm.runInContext("globalThis.WhitelistUtils = WhitelistUtils;", context);

if (
  !context.WhitelistUtils ||
  typeof context.WhitelistUtils.parseBlockedPageQuery !== "function"
) {
  throw new Error("parseBlockedPageQuery is not implemented");
}

const result = context.WhitelistUtils.parseBlockedPageQuery(
  "?url=https%3A%2F%2Fexample.com%2Ffoo%3Fbar%3Dbaz&domain=example.com",
);

if (
  result.domain !== "example.com" ||
  result.url !== "https://example.com/foo?bar=baz"
) {
  throw new Error(`Unexpected parse result: ${JSON.stringify(result)}`);
}

console.log("url param parser regression test passed");
