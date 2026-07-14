# FocusLock Whitelist

A Chrome extension that blocks the entire web by default and only allows sites you explicitly whitelist. Settings are locked behind a password, with optional Safe Search mode for temporary, text-only browsing.

**Version:** 1.3  
**Manifest:** V3

---

## Features

### Strict whitelist firewall
- Every website is blocked unless it is on your whitelist.
- Blocked visits show a FocusLock interstitial with options to unlock or enable Safe Search.
- Rules are enforced with Chrome's `declarativeNetRequest` API.

### Domain and page-level whitelisting
You can allow an entire site or a single page:

| Type | Example | What it allows |
|------|---------|----------------|
| Whole domain | `github.com` | All pages on `github.com` |
| Specific page | `stackoverflow.com/questions/12345` | Only that exact URL path |

From the blocked page you can choose:
- **Whitelist Whole Domain**
- **Whitelist This Page Only**

### Password-protected settings
- Options are locked until you enter the correct password.
- Default password on first install: `admin` (change it immediately).
- Password prompts use hidden input (dots), not plain browser `prompt()` dialogs.

### Safe Search mode
- Temporarily unblocks the web but strips images, videos, and GIFs globally.
- Whitelisted sites are excluded from media blocking.
- Duration is customizable when enabling from the blocked page (e.g. `5 minutes`, `10 mins`, `1 hour`).
- Automatically turns off when the timer expires.
- When Safe Search ends, all **non-whitelisted** tabs are reloaded so temporarily opened pages get blocked again. Whitelisted tabs stay open.

### SPA / client-side navigation protection
Sites like YouTube change the URL without a full page load (via `pushState`). FocusLock watches for these in-page navigations and blocks the new URL if it is not whitelisted — even when only a specific page (not the whole domain) was allowed.

### Secure storage
Sensitive data is not stored in plaintext:
- **Password:** PBKDF2-SHA256 hash with salt (310,000 iterations)
- **Whitelist:** AES-256-GCM encrypted at rest

Legacy plaintext values are migrated automatically on first load after updating.

### Make.com webhook integration
The extension sends GET requests to a Make.com webhook for monitoring:

| Action | When |
|--------|------|
| `installed` | Extension installed or updated |
| `uninstalled` | Extension removed |
| `heartbeat` | Every 6 hours |
| `settings` | Settings saved from the options page |

Configure the webhook URL in `background.js` and `options.js`.

---

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `FocusLock` folder
5. Click the extension icon → **FocusLock Settings** to configure

---

## Usage

### Open settings
- Click the extension icon in the toolbar, or
- Go to `chrome://extensions` → FocusLock → **Details** → **Extension options**

### Manage whitelist
Enter one entry per line in the settings textarea:

```
github.com
google.com
wikipedia.org/wiki/Focus
news.ycombinator.com/item?id=12345
```

Click **Save Settings & Lock** when done.

### When a site is blocked
You'll see the FocusLock blocked page with three actions:

1. **Whitelist Whole Domain** — permanently allow the entire site (requires password)
2. **Whitelist This Page Only** — permanently allow only the current URL (requires password)
3. **Enable Safe Search Mode** — temporary text-only browsing for a duration you specify (requires password)

---

## How it works

```
┌─────────────┐     blocked request      ┌──────────────────┐
│   Browser   │ ───────────────────────► │   blocked.html   │
└─────────────┘                          └────────┬─────────┘
       ▲                                          │
       │ allow / redirect                         │ password + whitelist update
       │                                          ▼
┌──────┴──────┐     dynamic rules         ┌──────────────────┐
│  Any site   │ ◄──────────────────────── │  background.js   │
└─────────────┘                           └──────────────────┘
                                                    │
                                                    ▼
                                           chrome.storage.local
                                           (encrypted whitelist,
                                            hashed password)
```

### Blocking modes

**Strict Firewall (default)**  
A catch-all redirect rule sends non-whitelisted pages to `blocked.html`. Whitelist entries create higher-priority allow rules.

**Safe Search**  
The redirect rule is removed. A global content script injects `hide-media.css` to hide media, except on whitelisted domains/pages.

---

## Project structure

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest and permissions |
| `background.js` | Service worker: blocking rules, alarms, webhooks |
| `options.html` / `options.js` | Password-gated settings UI |
| `blocked.html` / `blocked.js` | Blocked-site interstitial with unlock modals |
| `secure-storage.js` | Password hashing and whitelist encryption |
| `whitelist-utils.js` | Domain/page parsing, URL matching, duration parsing |
| `navigation-guard.js` | Blocks in-page SPA navigations to non-whitelisted URLs |
| `hide-media.css` | CSS to hide images and video in Safe Search mode |

---

## Permissions

| Permission | Why |
|------------|-----|
| `declarativeNetRequest` | Block/allow URLs |
| `storage` | Save whitelist and password hash |
| `scripting` | Inject Safe Search CSS globally |
| `alarms` | Heartbeat and Safe Search timer |
| `<all_urls>` | Match and redirect any site |

---

## Security notes

- Change the default `admin` password after install.
- `chrome.storage.local` is encrypted/hashed, but a determined attacker with full extension access could still extract data. This is a practical improvement over plaintext, not bank-grade security.
- The Make.com webhook URL is visible in the extension source. Use it for notifications only, not secrets.

---

## Configuration

### Webhook URL
Replace `WEBHOOK_URL` in:
- `background.js`
- `options.js`

### Default whitelist
On first install, defaults are set in `secure-storage.js` (`google.com`). The background worker falls back to `google.com` and `github.com` if the whitelist is empty.

### Heartbeat interval
Set in `background.js` — default is every 6 hours (`periodInMinutes: 360`).

---

## License

No license specified. Add one if you plan to distribute this extension.
