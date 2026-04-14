// TabFlow Background Service Worker
// Tracks tab access recency using a Most Recently Used (MRU) list

const MRU_KEY = "tabflow_mru";

// Load MRU from storage
async function getMRU() {
  const result = await browser.storage.local.get(MRU_KEY);
  return result[MRU_KEY] || [];
}

// Save MRU to storage
async function saveMRU(mru) {
  await browser.storage.local.set({ [MRU_KEY]: mru });
}

// Push tab to front of MRU list (max 500 entries)
async function bumpTab(tabId) {
  let mru = await getMRU();
  mru = mru.filter((id) => id !== tabId);
  mru.unshift(tabId);
  if (mru.length > 500) mru = mru.slice(0, 500);
  await saveMRU(mru);
}

// Clean up closed tabs from MRU
async function removeTab(tabId) {
  let mru = await getMRU();
  mru = mru.filter((id) => id !== tabId);
  await saveMRU(mru);
}

// Track tab activations
browser.tabs.onActivated.addListener(({ tabId }) => {
  bumpTab(tabId);
});

// Track tab creation
browser.tabs.onCreated.addListener((tab) => {
  bumpTab(tab.id);
});

// Clean up on tab removal
browser.tabs.onRemoved.addListener((tabId) => {
  removeTab(tabId);
});

// Listen for keyboard command
browser.commands.onCommand.addListener(async (command) => {
  if (command === "open-tab-switcher") {
    const tabs = await browser.tabs.query({ currentWindow: true });
    const activeTab = tabs.find((t) => t.active);
    if (activeTab) {
      browser.tabs
        .sendMessage(activeTab.id, { type: "TABFLOW_OPEN" })
        .catch(() => {
          // If content script not ready, inject it
          browser.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ["content.js"],
          });
        });
    }
  }
});

// Handle messages from content script
browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === "GET_TABS") {
    const [allTabs, mru] = await Promise.all([
      browser.tabs.query({ currentWindow: true }),
      getMRU(),
    ]);

    // Sort by MRU order; tabs not in MRU go to end sorted by lastAccessed
    const mruIndex = (tab) => {
      const idx = mru.indexOf(tab.id);
      return idx === -1 ? Infinity : idx;
    };

    const sorted = [...allTabs].sort((a, b) => {
      const ai = mruIndex(a);
      const bi = mruIndex(b);
      if (ai !== bi) return ai - bi;
      return (b.lastAccessed || 0) - (a.lastAccessed || 0);
    });

    return { tabs: sorted, currentTabId: sender.tab?.id };
  }

  if (msg.type === "SWITCH_TAB") {
    await browser.tabs.update(msg.tabId, { active: true });
    await bumpTab(msg.tabId);
    return { ok: true };
  }

  if (msg.type === "CLOSE_TAB") {
    await browser.tabs.remove(msg.tabId);
    return { ok: true };
  }

  if (msg.type === "OPEN_SEARCH_TAB") {
    await browser.tabs.create({
      url: `https://www.google.com/search?q=${encodeURIComponent(msg.query)}`,
      active: true,
    });
    return { ok: true };
  }

  if (msg.type === "SHORTCUT_UPDATED") {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      try {
        await browser.tabs.sendMessage(tab.id, {
          type: "SHORTCUT_UPDATED",
          shortcut: msg.shortcut,
        });
      } catch {}
    }
    return { ok: true };
  }
});
