/**
 * Chrome API Mock für Jest Tests
 * Simuliert chrome.storage.sync, chrome.storage.local, chrome.runtime
 */

function createStorageMock() {
  let store = {};
  return {
    _store: store,
    _reset(data = {}) { store = data; this._store = store; },

    get(keysOrDefaults) {
      return new Promise(resolve => {
        if (keysOrDefaults === null || keysOrDefaults === undefined) {
          resolve({ ...store });
          return;
        }
        if (Array.isArray(keysOrDefaults)) {
          const result = {};
          for (const key of keysOrDefaults) {
            if (key in store) result[key] = store[key];
          }
          resolve(result);
          return;
        }
        if (typeof keysOrDefaults === 'object') {
          const result = {};
          for (const [key, defaultVal] of Object.entries(keysOrDefaults)) {
            result[key] = key in store ? store[key] : defaultVal;
          }
          resolve(result);
          return;
        }
        // Single key string
        const result = {};
        if (keysOrDefaults in store) result[keysOrDefaults] = store[keysOrDefaults];
        resolve(result);
      });
    },

    set(items) {
      return new Promise(resolve => {
        Object.assign(store, items);
        // onChange Listener triggern
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { newValue: value, oldValue: store[key] };
        }
        if (chrome.storage._listeners) {
          chrome.storage._listeners.forEach(fn => fn(changes, 'sync'));
        }
        resolve();
      });
    },

    remove(keys) {
      return new Promise(resolve => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) {
          delete store[key];
        }
        resolve();
      });
    }
  };
}

function createChromeMock() {
  const syncStorage = createStorageMock();
  const localStorage = createStorageMock();

  return {
    storage: {
      sync: syncStorage,
      local: localStorage,
      _listeners: [],
      onChanged: {
        addListener(fn) {
          chrome.storage._listeners.push(fn);
        },
        removeListener(fn) {
          chrome.storage._listeners = chrome.storage._listeners.filter(l => l !== fn);
        }
      }
    },
    runtime: {
      id: 'test-extension-id',
      sendMessage: jest.fn().mockResolvedValue({ success: true }),
      onMessage: {
        addListener: jest.fn()
      },
      onInstalled: {
        addListener: jest.fn()
      },
      onStartup: {
        addListener: jest.fn()
      }
    },
    tabs: {
      query: jest.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
      sendMessage: jest.fn().mockResolvedValue({})
    },
    contextMenus: {
      create: jest.fn(),
      removeAll: jest.fn().mockResolvedValue()
    },
    sidePanel: {
      open: jest.fn().mockResolvedValue(),
      setPanelBehavior: jest.fn().mockResolvedValue()
    }
  };
}

// Global bereitstellen
global.chrome = createChromeMock();

module.exports = { createChromeMock, createStorageMock };
