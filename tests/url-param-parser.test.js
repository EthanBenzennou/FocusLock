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

const entries = context.WhitelistUtils.parseAll(["google.com"]);
if (!entries.length || entries[0].type !== "domain") {
  throw new Error(`Unexpected parseAll result: ${JSON.stringify(entries)}`);
}

if (
  !context.WhitelistUtils.isUrlAllowed(
    "https://mail.google.com/mail/u/0/#inbox",
    entries,
  )
) {
  throw new Error(
    "Domain whitelist should allow subdomain URLs with hash fragments",
  );
}

const pageEntries = context.WhitelistUtils.parseAll([
  "https://mail.google.com/mail/u/0/#inbox",
]);
if (pageEntries.length !== 1 || pageEntries[0].type !== "page") {
  throw new Error(
    `Unexpected page entry parse result: ${JSON.stringify(pageEntries)}`,
  );
}

if (
  !context.WhitelistUtils.isUrlAllowed(
    "https://mail.google.com/mail/u/0/#inbox",
    pageEntries,
  )
) {
  throw new Error("Page whitelist should allow the exact page URL");
}

console.log("url param parser regression test passed");
