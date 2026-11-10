const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'safe-search-inject.js'), 'utf8');

(async () => {
  let filterRequest;
  const observers = [];
  const timers = [];
  const context = {
    console,
    setInterval: (callback) => {
      timers.push(callback);
      return 1;
    },
    clearInterval: () => {},
    Date,
    Number,
    encodeURIComponent,
    decodeURIComponent,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.targets = [];
        observers.push(this);
      }

      observe(target, options) {
        this.targets.push({ target, options });
      }
    },
  };

  context.chrome = {
    runtime: {
      getURL: (p) => p,
      sendMessage: (message, callback) => {
        filterRequest = message;
        callback({ success: true, filtered: true });
      },
    },
    storage: {
      local: {
        get: () => Promise.resolve({ safeSearch: true, safeSearchExpiresAt: Date.now() + 60 * 1000 }),
      },
      onChanged: { addListener: () => {} },
    },
  };

  const created = [];
  const bodyChildren = [];
  function createShadowRoot(children = []) {
    const styles = [];
    return {
      nodeType: 11,
      children,
      styles,
      querySelectorAll: () => children,
      getElementById: (id) => styles.find((style) => style.id === id) || null,
      appendChild: (style) => styles.push(style),
    };
  }

  const existingShadowRoot = createShadowRoot();
  const existingHost = {
    nodeType: 1,
    shadowRoot: existingShadowRoot,
    querySelectorAll: () => [],
  };
  function findById(nodes, id) {
    for (const node of nodes) {
      if (node.id === id) return node;
      const nested = findById(node.children || [], id);
      if (nested) return nested;
    }
    return null;
  }

  function makeElement(tag) {
    const el = {
      tagName: tag,
      style: {},
      children: [],
      id: null,
      textContent: "",
      parentNode: null,
      appendChild: (child) => {
        el.children.push(child);
        child.parentNode = el;
      },
      addEventListener: () => {},
      attachShadow: () => {
        const root = {
          children: [],
          appendChild: (child) => root.children.push(child),
          getElementById: (id) => findById(root.children, id),
        };
        el.shadowRoot = root;
        return root;
      },
    };
    created.push(el);
    return el;
  }

  const body = {
    style: {},
    firstChild: null,
    insertBefore: (node, ref) => {
      const index = ref ? bodyChildren.findIndex((entry) => entry.node === ref) : -1;
      if (index < 0) bodyChildren.push({ node, ref });
      else bodyChildren.splice(index, 0, { node, ref });
      node.parentNode = body;
    },
    appendChild: (node) => {
      bodyChildren.push({ node, ref: null });
      node.parentNode = body;
    },
  };
  context.document = {
    nodeType: 9,
    body,
    documentElement: { style: {}, appendChild: () => {} },
    getElementById: (id) =>
      findById(bodyChildren.map((entry) => entry.node), id),
    createElement: makeElement,
    querySelectorAll: () => [existingHost],
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
    top: null,
    addEventListener: () => {},
    open: () => {},
    location: { href: 'https://example.com' },
  };
  context.window.top = context.window;

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
    if (
      headerEntry.node.style.direction !== "ltr" ||
      !headerEntry.node.shadowRoot.children[0].textContent.includes(
        "direction: ltr",
      ) ||
      !headerEntry.node.shadowRoot.children[0].textContent.includes(
        "font-family:",
      )
    ) {
      throw new Error("Expected the banner to isolate its direction and font.");
    }
    if (
      !headerEntry.node.shadowRoot.getElementById("focuslock-timer-text")
    ) {
      throw new Error("Expected the timer to be rendered in the banner shadow root.");
    }
    if (spacerEntry.node.id !== 'focuslock-timer-header-spacer') {
      throw new Error('Expected the spacer to be inserted before the page content.');
    }
    if (filterRequest?.type !== 'APPLY_SAFESEARCH_FILTER') {
      throw new Error('Expected Safe Search to request per-frame media filtering.');
    }

    const outbrainStyle = existingShadowRoot.getElementById(
      'focuslock-outbrain-image-filter',
    );
    if (
      !outbrainStyle ||
      !outbrainStyle.textContent.includes('images.outbrainimg.com') ||
      !outbrainStyle.textContent.includes('display: none !important')
    ) {
      throw new Error('Expected Outbrain images in existing open shadow roots to be hidden.');
    }
    const sourcePrefixes = Array.from(
      outbrainStyle.textContent.matchAll(/src\^="([^"]+)"/g),
      ([, prefix]) => prefix.toLowerCase(),
    );
    const matchesOutbrainImage = (src) =>
      sourcePrefixes.some((prefix) => src.toLowerCase().startsWith(prefix));
    if (
      !matchesOutbrainImage('https://images.outbrainimg.com/transform/v3/example-a.webp') ||
      !matchesOutbrainImage('https://images.outbrainimg.com/transform/v3/example-b.webp') ||
      !matchesOutbrainImage('//images.outbrainimg.com/transform/v3/example-c.webp') ||
      matchesOutbrainImage('https://example.com/transform/v3/example.webp')
    ) {
      throw new Error('Expected only Outbrain image URL forms to match the shadow-root filter.');
    }

    const addedShadowRoot = createShadowRoot();
    const addedHost = {
      nodeType: 1,
      shadowRoot: addedShadowRoot,
      querySelectorAll: () => [],
    };
    const documentObserver = observers.find((observer) =>
      observer.targets.some(({ target }) => target === context.document),
    );
    if (!documentObserver) {
      throw new Error('Expected Safe Search to observe for newly added shadow roots.');
    }
    documentObserver.callback([{ addedNodes: [addedHost] }]);
    if (!addedShadowRoot.getElementById('focuslock-outbrain-image-filter')) {
      throw new Error('Expected Outbrain images in newly added open shadow roots to be hidden.');
    }

    const allowedShadowRoot = createShadowRoot();
    const allowedHost = {
      nodeType: 1,
      shadowRoot: allowedShadowRoot,
      querySelectorAll: () => [],
    };
    context.document.querySelectorAll = () => [existingHost, allowedHost];
    context.chrome.runtime.sendMessage = (message, callback) => {
      callback({ success: true, filtered: false });
    };
    vm.runInContext(code, context, { timeout: 2000 });
    if (allowedShadowRoot.getElementById('focuslock-outbrain-image-filter')) {
      throw new Error('Expected whitelisted frames to keep shadow-root media unfiltered.');
    let nestedFrameRequest;
    const nestedContext = {
      ...context,
      window: { top: {} },
      chrome: {
        ...context.chrome,
        runtime: {
          ...context.chrome.runtime,
          sendMessage: (message, callback) => {
            nestedFrameRequest = message;
            callback({ success: true });
          },
        },
      },
      setInterval: () => {
        throw new Error("Nested frames should not start a banner timer.");
      },
    };
    vm.createContext(nestedContext);
    vm.runInContext(code, nestedContext, { timeout: 2000 });
    if (nestedFrameRequest?.type !== "APPLY_SAFESEARCH_FILTER") {
      throw new Error("Nested frames should still apply Safe Search media filtering.");
    }

    console.log('safe-search-inject VM smoke test passed');
  } catch (err) {
    console.error('safe-search-inject threw:', err && err.stack ? err.stack : err);
    throw err;
  }
})();
