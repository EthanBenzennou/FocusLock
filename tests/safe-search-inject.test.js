const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'safe-search-inject.js'), 'utf8');

const context = {
  console,
  setInterval,
  clearInterval,
  Date,
  Number,
  encodeURIComponent,
  decodeURIComponent,
};

// Minimal chrome stub to satisfy the content script
context.chrome = {
  runtime: { getURL: (p) => p },
  storage: {
    local: {
      get: (keys) => {
        // Return a future expiry so the script will create the header
        return Promise.resolve({ safeSearch: true, safeSearchExpiresAt: Date.now() + 60 * 1000 });
      },
    },
    onChanged: { addListener: () => {} },
  },
};

// Minimal DOM stubs
const created = [];
context.document = {
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
  documentElement: { appendChild: () => {} },
};

context.window = {
  addEventListener: () => {},
  open: () => {},
  location: { href: 'https://example.com' },
};

vm.createContext(context);

let threw = false;
try {
  vm.runInContext(code, context, { timeout: 2000 });
} catch (err) {
  threw = true;
  console.error('safe-search-inject threw:', err && err.stack ? err.stack : err);
}

if (threw) {
  throw new Error('safe-search-inject script failed to run in VM context');
}

console.log('safe-search-inject VM smoke test passed');
