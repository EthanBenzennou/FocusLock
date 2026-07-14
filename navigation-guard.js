// Catches client-side URL changes (pushState/replaceState) that bypass network blocking.
(function () {
  if (window !== window.top) return;

  let lastUrl = location.href;
  let checking = false;

  function redirectToBlocked() {
    const blocked = chrome.runtime.getURL('blocked.html') +
      '?domain=' + encodeURIComponent(location.hostname) +
      '&url=' + encodeURIComponent(location.href);
    location.replace(blocked);
  }

  function checkCurrentUrl() {
    if (checking || location.href === lastUrl) return;
    lastUrl = location.href;
    checking = true;

    chrome.runtime.sendMessage({ type: 'CHECK_URL', url: location.href }, (response) => {
      checking = false;
      if (chrome.runtime.lastError) return;
      if (response && !response.allowed) redirectToBlocked();
    });
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

  window.addEventListener('popstate', checkCurrentUrl);
  window.addEventListener('hashchange', checkCurrentUrl);

  checkCurrentUrl();
})();
