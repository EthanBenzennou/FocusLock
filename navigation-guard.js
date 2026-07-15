// Catches client-side URL changes (pushState/replaceState) that bypass network blocking.
(function () {
  if (window !== window.top) return;

  let lastUrl = location.href;
  let checking = false;

  function redirectToBlocked() {
    const query = WhitelistUtils.buildBlockedPageQuery(
      location.hostname,
      location.href,
    );
    const runtime =
      typeof chrome !== "undefined" && chrome.runtime
        ? chrome.runtime
        : typeof browser !== "undefined" && browser.runtime
        ? browser.runtime
        : null;
    const blockedUrl = runtime
      ? `${runtime.getURL("blocked.html")}?${query}`
      : `blocked.html?${query}`;
    location.replace(blockedUrl);
  }

  function checkCurrentUrl() {
    if (checking || location.href === lastUrl) return;
    lastUrl = location.href;
    checking = true;

    const runtime =
      typeof chrome !== "undefined" && chrome.runtime
        ? chrome.runtime
        : typeof browser !== "undefined" && browser.runtime
        ? browser.runtime
        : null;
    if (!runtime || typeof runtime.sendMessage !== "function") {
      console.error("Navigation guard: runtime.sendMessage unavailable");
      checking = false;
      return;
    }

    runtime.sendMessage(
      { type: "CHECK_URL", url: location.href },
      (response) => {
        checking = false;
        if (runtime.lastError) return;
        if (response && !response.allowed) redirectToBlocked();
      },
    );
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    checkCurrentUrl();
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    checkCurrentUrl();
  };

  window.addEventListener("popstate", checkCurrentUrl);
  window.addEventListener("hashchange", checkCurrentUrl);

  checkCurrentUrl();
})();
