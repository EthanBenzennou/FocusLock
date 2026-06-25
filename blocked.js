document.addEventListener('DOMContentLoaded', () => {
  // Extract the domain and original URL from the address bar
  const queryString = window.location.search;
  const urlParams = new URLSearchParams(queryString);
  const domain = urlParams.get('domain');
  
  // Safely extract the full URL to redirect back to later
  const urlIndex = queryString.indexOf('&url=');
  const originalUrl = urlIndex !== -1 ? queryString.substring(urlIndex + 5) : `https://${domain}`;

  // Display the domain on the screen
  document.getElementById('domain-name').textContent = domain;

  // Handle the unlock button click
  document.getElementById('unlock-btn').addEventListener('click', () => {
    // Fire the native browser prompt for the password
    const pwd = prompt("Enter your FocusLock password to add this domain to your whitelist:");
    
    if (pwd !== null) { // null means they clicked Cancel
      chrome.storage.local.get(['password', 'whitelist'], (result) => {
        if (pwd === result.password) {
          
          // Add the new domain to the list
          const newWhitelist = result.whitelist || [];
          if (!newWhitelist.includes(domain)) {
            newWhitelist.push(domain);
          }
          
          // Save it and tell the background script to update the firewall rules
          chrome.storage.local.set({ whitelist: newWhitelist }, () => {
            chrome.runtime.sendMessage({ type: 'UPDATE_WHITELIST', whitelist: newWhitelist }, () => {
              // Once the rules are updated, send the user to their unlocked page
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
