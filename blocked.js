document.addEventListener('DOMContentLoaded', () => {
  const queryString = window.location.search;
  const urlParams = new URLSearchParams(queryString);
  const domain = urlParams.get('domain');
  
  // Robust extraction of the original blocked URL
  const urlIndex = queryString.indexOf('&url=');
  const originalUrl = urlIndex !== -1 ? queryString.substring(urlIndex + 5) : `https://${domain}`;

  document.getElementById('domain-name').textContent = domain;

  document.getElementById('unlock-btn').addEventListener('click', () => {
    const pwd = prompt("Enter password to add this domain to your whitelist:");
    if (pwd !== null) {
      chrome.storage.local.get(['password', 'whitelist'], (result) => {
        if (pwd === result.password) {
          const newWhitelist = result.whitelist || [];
          if (!newWhitelist.includes(domain)) {
            newWhitelist.push(domain);
          }
          chrome.storage.local.set({ whitelist: newWhitelist }, () => {
            chrome.runtime.sendMessage({ type: 'UPDATE_WHITELIST', whitelist: newWhitelist, safeSearch: false }, () => {
              window.location.href = originalUrl;
            });
          });
        } else {
          alert("Incorrect password. Site remains blocked.");
        }
      });
    }
  });

  document.getElementById('safesearch-btn').addEventListener('click', () => {
    const pwd = prompt("Enter password to temporarily open the web in text-only mode (20 mins):");
    if (pwd !== null) {
      chrome.storage.local.get(['password', 'whitelist'], (result) => {
        if (pwd === result.password) {
          const whitelist = result.whitelist || [];
          chrome.storage.local.set({ safeSearch: true }, () => {
            chrome.runtime.sendMessage({ type: 'UPDATE_WHITELIST', whitelist: whitelist, safeSearch: true }, () => {
              window.location.href = originalUrl;
            });
          });
        } else {
          alert("Incorrect password. Site remains blocked.");
        }
      });
    }
  });
});
