const MRU_KEY = "tabflow_mru";

async function getMRU() {
  const result = await browser.storage.local.get(MRU_KEY);
  return result[MRU_KEY] || [];
}

async function saveMRU(mru) {
  await browser.storage.local.set({ [MRU_KEY]: mru });
}

async function bumpTab(tabId) {
  let mru = await getMRU();
  mru = mru.filter((id) => id !== tabId);
  mru.unshift(tabId);
  if (mru.length > 500) mru = mru.slice(0, 500);
  await saveMRU(mru);
}

async function removeTab(tabId) {
  let mru = await getMRU();
  mru = mru.filter((id) => id !== tabId);
  await saveMRU(mru);
}

browser.tabs.onActivated.addListener(({ tabId }) => bumpTab(tabId));
browser.tabs.onCreated.addListener((tab) => bumpTab(tab.id));
browser.tabs.onRemoved.addListener((tabId) => removeTab(tabId));

async function openSwitcher() {
  const [activeTab] = await browser.tabs.query({
    currentWindow: true,
    active: true,
  });
  if (!activeTab) return;

  const url = activeTab.url || "";
  if (
    url.startsWith("about:") ||
    url.startsWith("moz-extension:") ||
    url.startsWith("resource:")
  ) {
    return;
  }

  try {
    await browser.tabs.sendMessage(activeTab.id, { type: "TABFLOW_OPEN" });
  } catch {
    try {
      await browser.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ["content.js"],
      });
      await browser.scripting.insertCSS({
        target: { tabId: activeTab.id },
        files: ["switcher.css"],
      });
      setTimeout(async () => {
        try {
          await browser.tabs.sendMessage(activeTab.id, {
            type: "TABFLOW_OPEN",
          });
        } catch {}
      }, 80);
    } catch (e) {
      console.error("TabFlow: inject failed", e);
    }
  }
}

browser.commands.onCommand.addListener((command) => {
  if (command === "open-tab-switcher") openSwitcher();
});

browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === "GET_TABS") {
    const [allTabs, mru] = await Promise.all([
      browser.tabs.query({ currentWindow: true }),
      getMRU(),
    ]);
    const mruIndex = (tab) => {
      const i = mru.indexOf(tab.id);
      return i === -1 ? Infinity : i;
    };
    const sorted = [...allTabs].sort((a, b) => {
      const d = mruIndex(a) - mruIndex(b);
      return d !== 0 ? d : (b.lastAccessed || 0) - (a.lastAccessed || 0);
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
    const tabs = await browser.tabs.query({ currentWindow: false });
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
