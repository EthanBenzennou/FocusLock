const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'safe-search-inject.js'), 'utf8');

(async () => {
  let filterRequest;
  const observers = [];
  const timers = [];
  let storageChangeListener;
  let storedState = {
    safeSearch: true,
    safeSearchExpiresAt: Date.now() + 60 * 1000,
  };
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
        get: () => Promise.resolve(storedState),
      },
      onChanged: {
        addListener: (listener) => {
          storageChangeListener = listener;
        },
      },
    },
  };

  const created = [];
  const bodyChildren = [];
  const rootChildren = [];
  function makeStyle(initial = {}) {
    const values = new Map(
      Object.entries(initial).map(([key, value]) => [
        key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
        { value: String(value), priority: "" },
      ]),
    );
    return {
      setProperty(name, value, priority = "") {
        values.set(name, { value: String(value), priority });
        const key = name.replace(/-([a-z])/g, (_, letter) =>
          letter.toUpperCase(),
        );
        this[key] = String(value);
      },
      getPropertyValue: (name) => values.get(name)?.value || "",
      getPropertyPriority: (name) => values.get(name)?.priority || "",
      removeProperty: (name) => values.delete(name),
    };
  }
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
      style: makeStyle(),
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
    style: makeStyle({ paddingTop: "12px" }),
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
    removeChild: (node) => {
      const index = bodyChildren.findIndex((entry) => entry.node === node);
      if (index >= 0) bodyChildren.splice(index, 1);
      node.parentNode = null;
    },
  };
  const documentElement = {
    nodeType: 1,
    appendChild: (node) => {
      rootChildren.push(node);
      node.parentNode = documentElement;
    },
    removeChild: (node) => {
      const index = rootChildren.indexOf(node);
      if (index >= 0) rootChildren.splice(index, 1);
      node.parentNode = null;
    },
  };
  context.document = {
    nodeType: 9,
    body,
    documentElement,
    getElementById: (id) =>
      findById([...rootChildren, ...bodyChildren.map((entry) => entry.node)], id),
    createElement: makeElement,
    querySelectorAll: () => [existingHost],
  };

  context.window = {
    top: null,
    getComputedStyle: (element) => ({
      paddingTop: element.style.getPropertyValue("padding-top") || "0px",
    }),
    addEventListener: () => {},
    open: () => {},
    location: { href: 'https://example.com' },
  };
  context.window.top = context.window;

  vm.createContext(context);

  try {
    vm.runInContext(code, context, { timeout: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (rootChildren.length !== 1) {
      throw new Error('Expected the fixed Safe Search banner at the document root.');
    }

    const header = rootChildren[0];
    if (
      header.style.height !== "48px" ||
      header.style.getPropertyPriority("height") !== "important" ||
      header.style.getPropertyPriority("max-height") !== "important"
    ) {
      throw new Error('Expected a fixed 48px banner height protected from page CSS.');
    }

    if (
      header.style.position !== "fixed" ||
      header.style.getPropertyPriority("position") !== "important"
    ) {
      throw new Error('Expected the banner to stay fixed above page content.');
    }
    if (body.style.getPropertyValue("padding-top") !== "calc(12px + 48px)") {
      throw new Error("Expected the page to be offset below the banner.");
    }
    if (
      header.style.direction !== "ltr" ||
      !header.shadowRoot.children[0].textContent.includes(
        "direction: ltr",
      ) ||
      !header.shadowRoot.children[0].textContent.includes(
        "font-family:",
      )
    ) {
      throw new Error("Expected the banner to isolate its direction and font.");
    }
    if (
      !header.shadowRoot.getElementById("focuslock-timer-text")
    ) {
      throw new Error("Expected the timer to be rendered in the banner shadow root.");
    }
    if (header.id !== 'focuslock-timer-header') {
      throw new Error('Expected the banner to have a stable extension ID.');
    }
    if (filterRequest?.type !== 'APPLY_SAFESEARCH_FILTER') {
      throw new Error('Expected Safe Search to request per-frame media filtering.');
    }

    storedState = { safeSearch: false };
    storageChangeListener({ safeSearch: { newValue: false } }, "local");
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (rootChildren.length !== 0) {
      throw new Error("Disabling Safe Search should remove the banner.");
    }
    if (body.style.getPropertyValue("padding-top") !== "12px") {
      throw new Error("Removing the banner should restore the original page padding.");
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (allowedShadowRoot.getElementById('focuslock-outbrain-image-filter')) {
      throw new Error('Expected whitelisted frames to keep shadow-root media unfiltered.');
    }
    if (rootChildren.length !== 0) {
      throw new Error('Whitelisted pages should not show the Safe Search banner.');
    }

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
