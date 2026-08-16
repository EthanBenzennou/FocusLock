# FocusLock

FocusLock is a Chrome extension that protects browsing by default with a strict whitelist, while offering a temporary Safe Search mode for text-only browsing when needed. It is designed for users who want a strong default block posture without losing access to some parts of the web during a limited session.

**Manifest:** V3  
**Type:** Chrome extension

---

## What the project does

### Strict whitelist firewall
- Every site is blocked unless it is explicitly allowed in the whitelist.
- Blocked requests are redirected to a custom interstitial page.
- The extension uses Chrome `declarativeNetRequest` to enforce the firewall at the browser level.
- SPA navigation and hash-based URL changes are also watched so disallowed client-side navigation does not bypass the firewall.

### Domain and page-level whitelist entries
The extension supports both:
- Whole domains, such as `github.com`
- Specific pages, such as `stackoverflow.com/questions/12345`

This allows you to allow either an entire site or just a single page as needed.

### Password-protected configuration
- Settings are locked behind a password.
- The default password is `admin`, but it should be changed immediately after first setup.
- Passwords are hashed with PBKDF2-SHA256 and stored with a salt.
- Whitelist entries are encrypted before being saved to `chrome.storage.local`.

### Safe Search mode
Safe Search temporarily removes the traffic limit by presenting a text-only browsing session instead of full browsing.

Features include:
- Temporary unblocking of the web while stripping images, videos, and GIFs globally
- Whitelisted sites excluded from media blocking
- User-selectable durations such as `15 mins`, `1 hour`, or `2 hours`
- A duration page that supports two modes:
  - Fresh session mode: starts a new Safe Search session
  - Extend session mode: adds time to the current Safe Search session
- A live timer header shown at the top of active pages
- Extend and Stop controls in the timer header
- Auto-expiration when the timer ends

The extension also keeps the current page in sync with refresh behavior:
- enabling Safe Search from the blocked page returns to the original tab and refreshes it
- extending Safe Search from the page timer stays on the same tab and refreshes it instead of opening a new tab
- stopping Safe Search behaves the same way as an automatic timeout, disabling the session and reloading the page

### Automatic expiry and recovery flow
When a Safe Search session expires:
- the timer is cleared
- Safe Search is disabled in storage
- the dynamic rules are re-applied
- non-whitelisted tabs are reloaded so they return to the blocked interstitial when appropriate

---

## Main project files

- `background.js` — service worker, rule management, timer lifecycle, Safe Search expiry handling, and message routing
- `blocked.html` / `blocked.js` — blocked-page UI and actions to whitelist or enter Safe Search
- `safe-search-duration.html` / `safe-search-duration.js` — duration prompt for starting or extending a Safe Search session
- `safe-search-inject.js` — injected page header with timer, Extend, and Stop controls
- `options.html` / `options.js` — settings UI, login flow, whitelist editing, and Safe Search controls
- `secure-storage.js` — encrypted storage layer and password management
- `whitelist-utils.js` — parsing and matching logic for whitelist entries and duration strings
- `manifest.json` — Chrome extension manifest
- `tests/` — regression tests covering parsing and Safe Search flows

---

## Installation

1. Open Chrome and go to `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the FocusLock folder.
5. Open the extension options page and sign in with the default password `admin`.
6. Change the password and save your whitelist settings.

---

## Usage

### Open the settings UI
- Click the extension icon in the toolbar, or
- Go to `chrome://extensions` and open FocusLock details to access the options page.

### Add sites to the whitelist
Put one entry per line in the whitelist field:

```text
github.com
google.com
wikipedia.org/wiki/Focus
news.ycombinator.com/item?id=12345
```

### When a site is blocked
The blocked page lets the user choose:
1. Whitelist Whole Domain
2. Whitelist This Page Only
3. Enable Safe Search Mode

### Safe Search flow
From the blocked page or the options panel:
- choose a duration
- confirm the password when prompted
- the extension updates the timer and refreshes the active page as needed
- the timer header shows the remaining time and offers Extend and Stop actions

### Stop Safe Search
Use the Stop button in the timer header to immediately deactivate Safe Search. This triggers the same cleanup and refresh flow as a natural timer expiry.

---

## Security model

FocusLock keeps sensitive data protected by design:
- password hashes are PBKDF2-derived with a per-user salt
- whitelist data is encrypted with AES-GCM before being stored
- legacy plaintext values are migrated automatically when needed
- the extension keeps the secure storage and rule logic in the background worker so enforcement remains reliable across browser restarts

---

## Testing

The repository includes regression tests for:
- whitelist URL parsing and blocked-page query handling
- Safe Search injection behavior
- mode-specific duration-page wording and session handling

Run the test suite from the project root:

```bash
node tests/url-param-parser.test.js && node tests/safe-search-inject.test.js && node tests/safe-search-duration-mode.test.js
```

---

## Notes

This project is intentionally opinionated: it defaults to locking the web down and only allows temporary exceptions when the user explicitly chooses them. The Safe Search session is designed to protect the user from distraction without permanently opening the entire internet.

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
