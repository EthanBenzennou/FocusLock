const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'safe-search-inject.js'), 'utf8');

(async () => {
  const context = {
    console,
    setInterval: () => 1,
    clearInterval: () => {},
    Date,
    Number,
    encodeURIComponent,
    decodeURIComponent,
  };

  context.chrome = {
    runtime: { getURL: (p) => p },
    storage: {
      local: {
        get: () => Promise.resolve({ safeSearch: true, safeSearchExpiresAt: Date.now() + 60 * 1000 }),
      },
      onChanged: { addListener: () => {} },
    },
  };

  const created = [];
  const bodyChildren = [];
  const body = {
    style: {},
    firstChild: null,
    insertBefore: (node, ref) => {
      bodyChildren.push({ node, ref });
    },
    appendChild: (node) => {
      bodyChildren.push({ node, ref: null });
    },
  };
  context.document = {
    body,
    documentElement: { style: {}, appendChild: () => {} },
    getElementById: () => null,
    createElement: (tag) => {
      const el = {
        tagName: tag,
        style: {},
        id: null,
        appendChild: () => {},
        addEventListener: () => {},
        parentNode: { removeChild: () => {} },
      };
      created.push(el);
      return el;
    },
  };

  context.window = {
    addEventListener: () => {},
    open: () => {},
    location: { href: 'https://example.com' },
  };

  vm.createContext(context);

  try {
    vm.runInContext(code, context, { timeout: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (bodyChildren.length < 2) {
      throw new Error('Expected both the spacer and the fixed header to be inserted above the page content.');
    }

    const [spacerEntry, headerEntry] = bodyChildren;
    if (spacerEntry.node.style.height !== '42px') {
      throw new Error('Expected the spacer to reserve the header height.');
    }

    if (headerEntry.node.style.position !== 'fixed') {
      throw new Error('Expected the banner to stay fixed to the viewport.');
    }

    if (spacerEntry.node.id !== 'focuslock-timer-header-spacer') {
      throw new Error('Expected the spacer to be inserted before the page content.');
    }

    console.log('safe-search-inject VM smoke test passed');
  } catch (err) {
    console.error('safe-search-inject threw:', err && err.stack ? err.stack : err);
    throw err;
  }
})();
