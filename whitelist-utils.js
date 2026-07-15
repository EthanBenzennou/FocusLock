// Shared whitelist parsing for FocusLock (domains + specific pages).
const WhitelistUtils = (() => {
  function buildBlockedPageQuery(domain, url) {
    const params = new URLSearchParams();
    if (domain) params.set("domain", domain);
    if (url) params.set("url", url);
    return params.toString();
  }

  function parseBlockedPageQuery(search) {
    const params = new URLSearchParams(
      search && search.startsWith("?") ? search.slice(1) : search || "",
    );

    const domain = (params.get("domain") || "").replace(/^www\./, "");
    const url = params.get("url") || "";

    return { domain, url };
  }

  function parseEntry(item) {
    let trimmed = item.trim();
    if (!trimmed) return null;

    // FIX: Decode messy URL strings (e.g. copied from the blocked page) so Chrome can read them
    try {
      if (trimmed.includes("%")) {
        trimmed = decodeURIComponent(trimmed);
      }
    } catch (e) {
      /* silent fail if it's not actually encoded */
    }

    let urlString = trimmed;
    if (!/^https?:\/\//i.test(urlString)) urlString = "https://" + urlString;

    try {
      const url = new URL(urlString);
      const domain = url.hostname.toLowerCase().replace(/^www\./, "");
      const pathWithoutHash = url.pathname + url.search;

      if (!domain || !/^[a-z0-9.-]+$/.test(domain)) return null;

      if (!pathWithoutHash || pathWithoutHash === "/") {
        return {
          type: "domain",
          domain,
          raw: trimmed,
          key: domain.toLowerCase(),
        };
      }

      const normalizedPath = pathWithoutHash.startsWith("/")
        ? pathWithoutHash
        : "/" + pathWithoutHash;
      return {
        type: "page",
        domain,
        path: normalizedPath,
        urlFilter: `||${domain}${normalizedPath}`,
        raw: trimmed,
        key: `${domain.toLowerCase()}${normalizedPath.toLowerCase()}`,
      };
    } catch (_) {
      const slashIndex = trimmed.indexOf("/");
      const domainPart = (
        slashIndex === -1 ? trimmed : trimmed.slice(0, slashIndex)
      )
        .toLowerCase()
        .replace(/^www\./, "");

      if (!/^[a-z0-9.-]+$/.test(domainPart)) return null;

      if (slashIndex === -1) {
        return {
          type: "domain",
          domain: domainPart,
          raw: trimmed,
          key: domainPart,
        };
      }

      const pathPart = trimmed.slice(slashIndex);
      const normalizedPath = pathPart.startsWith("/")
        ? pathPart
        : "/" + pathPart;
      return {
        type: "page",
        domain: domainPart,
        path: normalizedPath,
        urlFilter: `||${domainPart}${normalizedPath}`,
        raw: trimmed,
        key: `${domainPart}${normalizedPath.toLowerCase()}`,
      };
    }
  }

  function parseAll(items) {
    const seen = new Set();
    const entries = [];
    for (const item of items) {
      const parsed = parseEntry(item);
      if (!parsed || seen.has(parsed.key)) continue;
      seen.add(parsed.key);
      entries.push(parsed);
    }
    return entries;
  }

  function pageEntryFromUrl(urlString) {
    try {
      const url = new URL(urlString);
      const pathWithoutHash = url.pathname + url.search;
      if (!pathWithoutHash || pathWithoutHash === "/") return parseEntry(url.hostname);
      return parseEntry(url.hostname.replace(/^www\./, "") + pathWithoutHash);
    } catch (_) {
      return null;
    }
  }

  function domainEntryFromUrl(urlString) {
    try {
      const url = new URL(urlString);
      return parseEntry(url.hostname);
    } catch (_) {
      return null;
    }
  }

  function toExcludePatterns(entries) {
    const patterns = [];
    for (const entry of entries) {
      if (entry.type === "domain") {
        patterns.push(`*://${entry.domain}/*`);
        patterns.push(`*://*.${entry.domain}/*`);
      } else {
        patterns.push(`*://${entry.domain}${entry.path}`);
        patterns.push(`*://*.${entry.domain}${entry.path}`);
      }
    }
    return patterns;
  }

  function domainMatches(hostname, domain) {
    const host = hostname.toLowerCase().replace(/^www\./, "");
    return host === domain || host.endsWith("." + domain);
  }

  function pageMatches(url, entry) {
    const fullPath = (url.pathname + url.search).toLowerCase();
    const entryPath = entry.path.toLowerCase();
    if (fullPath === entryPath) return true;
    if (entryPath.includes("?")) return false;
    return (
      fullPath.startsWith(entryPath + "/") ||
      fullPath.startsWith(entryPath + "?")
    );
  }

  function isUrlAllowed(urlString, entries, options = {}) {
    if (options.safeSearch) return true;

    let url;
    try {
      url = new URL(urlString);
    } catch (_) {
      return false;
    }

    if (!/^https?:$/i.test(url.protocol)) return true;

    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

    for (const entry of entries) {
      if (entry.type === "domain" && domainMatches(hostname, entry.domain))
        return true;
    }

    for (const entry of entries) {
      if (
        entry.type === "page" &&
        domainMatches(hostname, entry.domain) &&
        pageMatches(url, entry)
      ) {
        return true;
      }
    }

    return false;
  }

  function parseDurationMinutes(input) {
    const text = String(input || "")
      .trim()
      .toLowerCase();
    if (!text) return null;

    const hourMatch = text.match(/^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
    if (hourMatch)
      return Math.max(1, Math.round(parseFloat(hourMatch[1]) * 60));

    const minuteMatch = text.match(
      /^(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)?\b/,
    );
    if (minuteMatch) return Math.max(1, Math.round(parseFloat(minuteMatch[1])));

    return null;
  }

  return {
    buildBlockedPageQuery,
    parseBlockedPageQuery,
    parseEntry,
    parseAll,
    pageEntryFromUrl,
    domainEntryFromUrl,
    toExcludePatterns,
    parseDurationMinutes,
    isUrlAllowed,
    domainMatches,
  };
})();
