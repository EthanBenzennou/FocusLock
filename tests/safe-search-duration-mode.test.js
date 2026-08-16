const fs = require('fs');
const path = require('path');
const vm = require('vm');

function runModeScenario(source) {
  const js = fs.readFileSync(path.join(__dirname, '..', 'safe-search-duration.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'safe-search-duration.html'), 'utf8');

  const elements = new Map();
  const onDomReady = [];

  function makeEl(id) {
    const el = {
      id,
      value: '',
      textContent: '',
      style: {},
      addEventListener: () => {},
      classList: { add: () => {}, remove: () => {} },
    };
    elements.set(id, el);
    return el;
  }

  makeEl('duration-input');
  makeEl('apply-btn');
  makeEl('cancel-btn');
  makeEl('duration-error');
  makeEl('mode-pill');
  makeEl('mode-title');
  makeEl('mode-subtitle');

  const context = {
    console,
    window: {
      location: { search: `?source=${source}&returnUrl=https%3A%2F%2Fexample.com%2Fpage` },
      close: () => {},
      locationObj: null,
    },
    document: {
      getElementById: (id) => elements.get(id) || null,
      addEventListener: (eventName, cb) => {
        if (eventName === 'DOMContentLoaded') onDomReady.push(cb);
      },
      title: '',
    },
    chrome: {
      storage: {
        local: {
          get: async () => ({ safeSearch: source === 'page', safeSearchExpiresAt: Date.now() + 60 * 1000, safeSearchDurationMinutes: 15, safeSearchDurationText: '15 mins' }),
          set: async () => {},
        },
      },
      runtime: {
        sendMessage: (_, cb) => cb && cb({ success: true }),
      },
      tabs: {
        query: async () => [],
        update: async () => {},
      },
    },
    WhitelistUtils: { parseDurationMinutes: (value) => {
      if (!value) return 0;
      const match = String(value).match(/(\d+)/);
      return match ? Number(match[1]) : 0;
    } },
    SecureStorage: { getWhitelist: async () => ['google.com'] },
    URLSearchParams,
  };

  vm.createContext(context);
  vm.runInContext(js, context);

  if (!onDomReady.length) {
    throw new Error('DOMContentLoaded listener not registered');
  }

  return (async () => {
    await onDomReady[0]();

    const titleEl = elements.get('mode-title');
    const pillEl = elements.get('mode-pill');
    const applyBtn = elements.get('apply-btn');

    if (!titleEl || !pillEl || !applyBtn) {
      throw new Error('Expected mode-specific elements to exist');
    }

    const htmlContainsModeIds = html.includes('id="mode-pill"') && html.includes('id="mode-title"') && html.includes('id="mode-subtitle"');
    if (!htmlContainsModeIds) {
      throw new Error('Expected HTML to expose mode-specific labels');
    }

    return { title: titleEl.textContent, pill: pillEl.textContent, apply: applyBtn.textContent };
  })();
}

(async () => {
  const fresh = await runModeScenario('blocked');
  if (fresh.title !== 'Start a fresh Safe Search session' || fresh.pill !== 'Fresh session') {
    throw new Error(`Unexpected fresh-session wording: ${JSON.stringify(fresh)}`);
  }

  const extend = await runModeScenario('page');
  if (extend.title !== 'Extend the current Safe Search session' || extend.apply !== 'Extend Safe Search') {
    throw new Error(`Unexpected extend-session wording: ${JSON.stringify(extend)}`);
  }

  console.log('mode-specific safe-search duration regression tests passed');
})();
