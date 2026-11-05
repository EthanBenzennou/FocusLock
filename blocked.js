document.addEventListener("DOMContentLoaded", async () => {
  const { domain, url: originalUrl } = WhitelistUtils.parseBlockedPageQuery(
    window.location.search,
  );

  let displayDomain = domain || "";
  let pagePath = "";
  let resolvedUrl = originalUrl || `https://${domain}`;

  const { safeSearch } = await chrome.storage.local.get(["safeSearch"]);
  if (safeSearch) {
    try {
      const targetUrl = new URL(resolvedUrl);
      if (targetUrl.protocol === "http:" || targetUrl.protocol === "https:") {
        window.location.replace(targetUrl.href);
        return;
      }
    } catch (e) {
      // Keep the blocked page visible when its target URL is invalid.
    }
  }

  try {
    const u = new URL(resolvedUrl);
    displayDomain = u.hostname.replace(/^www\./, "");
    pagePath = u.pathname + u.search + u.hash;
  } catch (e) {
    // fallback
  }

  const isDomainOnly = !pagePath || pagePath === "/";

  document.getElementById("domain-name").textContent = isDomainOnly
    ? displayDomain
    : `${displayDomain}${pagePath}`;

  const messageEl = document.getElementById("message");
  const allowDomainBtn = document.getElementById("allow-domain-btn");
  const allowPageBtn = document.getElementById("allow-page-btn");
  const safeSearchBtn = document.getElementById("safesearch-btn");

  if (isDomainOnly) {
    messageEl.textContent = "This website is not on your whitelist:";
    allowDomainBtn.textContent = "Add Website to Whitelist";
    allowPageBtn.style.display = "none";
  } else {
    messageEl.textContent = "This page is not on your whitelist:";
    allowDomainBtn.textContent = "Allow Entire Website";
    allowPageBtn.textContent = "Allow This Specific Page";
    allowPageBtn.style.display = "block";
  }

  async function handleWhitelistAddition(entryToAdd) {
    const { passwordHash, passwordSalt } = await chrome.storage.local.get([
      "passwordHash",
      "passwordSalt",
    ]);
    const pwd = prompt(
      `Enter password to add ${entryToAdd} to your whitelist:`,
    );
    if (pwd === null) return;

    const ok = await SecureStorage.verifyPassword(
      pwd,
      passwordHash,
      passwordSalt,
    );
    if (!ok) {
      alert("Incorrect password.");
      return;
    }

    const currentWhitelist = await SecureStorage.getWhitelist();
    if (!currentWhitelist.includes(entryToAdd)) {
      currentWhitelist.push(entryToAdd);
      await SecureStorage.saveWhitelist(currentWhitelist);

      chrome.runtime.sendMessage(
        {
          type: "UPDATE_WHITELIST",
          whitelist: currentWhitelist,
          safeSearch: false,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            alert(
              "Could not update whitelist: " + chrome.runtime.lastError.message,
            );
            return;
          }
          if (response && response.success) {
            // Update the tab via the Chrome tabs API so the navigation occurs after rules were applied.
            try {
              chrome.tabs.update({ url: originalUrl }, () => {
                if (chrome.runtime.lastError) {
                  // fallback to normal navigation if tabs.update isn't available
                  window.location.href = originalUrl;
                }
              });
            } catch (e) {
              window.location.href = originalUrl;
            }
          } else {
            alert(
              "Failed to update whitelist: " +
                (response && response.error ? response.error : "unknown error"),
            );
          }
        },
      );
    } else {
      window.location.href = originalUrl;
    }
  }

  allowDomainBtn.addEventListener("click", () => {
    handleWhitelistAddition(displayDomain);
  });

  allowPageBtn.addEventListener("click", () => {
    handleWhitelistAddition(`${displayDomain}${pagePath}`);
  });

  safeSearchBtn.addEventListener("click", async () => {
    const { passwordHash, passwordSalt } = await chrome.storage.local.get([
      "passwordHash",
      "passwordSalt",
    ]);
    const pwd = prompt(
      "Enter password to temporarily open the web in safe mode:",
    );
    if (pwd === null) return;

    const ok = await SecureStorage.verifyPassword(
      pwd,
      passwordHash,
      passwordSalt,
    );
    if (!ok) {
      alert("Incorrect password.");
      return;
    }

    const { safeSearchDefaultDurationMinutes } =
      await chrome.storage.local.get(["safeSearchDefaultDurationMinutes"]);
    const minutes =
      Number.isInteger(safeSearchDefaultDurationMinutes) &&
      safeSearchDefaultDurationMinutes > 0
        ? safeSearchDefaultDurationMinutes
        : WhitelistUtils.DEFAULT_SAFE_SEARCH_DURATION_MINUTES;
    const expiresAt = Date.now() + minutes * 60 * 1000;
    const durationText = `${minutes} min${minutes === 1 ? "" : "s"}`;
    const targetUrl = originalUrl || resolvedUrl;

    await chrome.storage.local.set({
      safeSearch: true,
      safeSearchExpiresAt: expiresAt,
      safeSearchDurationMinutes: minutes,
      safeSearchDurationText: durationText,
    });

    chrome.runtime.sendMessage(
      {
        type: "UPDATE_WHITELIST",
        whitelist: await SecureStorage.getWhitelist(),
        safeSearch: true,
        safeSearchMinutes: minutes,
        safeSearchExpiresAt: expiresAt,
      },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          alert("Unable to enable Safe Search mode. Please try again.");
          return;
        }

        try {
          chrome.tabs.update({ url: targetUrl }, () => {
            if (chrome.runtime.lastError) window.location.href = targetUrl;
          });
        } catch (e) {
          window.location.href = targetUrl;
        }
      },
    );
  });
});
