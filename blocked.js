document.addEventListener("DOMContentLoaded", () => {
  const { domain, url: originalUrl } = WhitelistUtils.parseBlockedPageQuery(
    window.location.search,
  );

  let displayDomain = domain || "";
  let pagePath = "";
  let resolvedUrl = originalUrl || `https://${domain}`;

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
        () => {
          window.location.href = originalUrl;
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

    const durationInput = prompt(
      "Enter safe search duration (e.g. '20 mins', '1 hour'). Leave blank for infinite:",
    );
    if (durationInput === null) return;

    const minutes = WhitelistUtils.parseDurationMinutes(durationInput) || 0;

    const currentWhitelist = await SecureStorage.getWhitelist();
    await chrome.storage.local.set({ safeSearch: true });

    chrome.runtime.sendMessage(
      {
        type: "UPDATE_WHITELIST",
        whitelist: currentWhitelist,
        safeSearch: true,
        safeSearchMinutes: minutes,
      },
      () => {
        window.location.href = originalUrl;
      },
    );
  });
});
