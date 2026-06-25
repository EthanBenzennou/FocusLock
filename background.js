async function updateRules(whitelist) {
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldRuleIds = oldRules.map(rule => rule.id);

  // Get the internal URL for your custom blocked page
  const extensionUrl = chrome.runtime.getURL("blocked.html");

  // Rule 1: Redirect everything to the blocked page, passing the domain and full URL
  const blockAllRule = {
    id: 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { regexSubstitution: `${extensionUrl}?domain=\\1&url=\\0` }
    },
    condition: {
      regexFilter: "^https?://([^/]+).*", // Matches HTTP/HTTPS and extracts the domain
      resourceTypes: ['main_frame']
    }
  };

  // Rule 2+: Allow the whitelisted domains
  const allowRules = whitelist.map((domain, index) => {
    return {
      id: index + 2,
      priority: 2,
      action: { type: 'allow' },
      condition: {
        urlFilter: `||${domain}*`,
        resourceTypes: ['main_frame']
      }
    };
  });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRuleIds,
    addRules: [blockAllRule, ...allowRules]
  });
}

// Listen for updates and send a response back when finished
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_WHITELIST') {
    updateRules(message.whitelist).then(() => {
      sendResponse({ success: true });
    });
    return true; // This tells Chrome to wait for our async response
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['whitelist'], (result) => {
    const list = result.whitelist || ['google.com', 'github.com'];
    updateRules(list);
  });
});
