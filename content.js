(function () {
  if (window.__tabFlowInjected) return;
  window.__tabFlowInjected = true;
  window.__tabFlowActive = false;

  // Search
  function buildTrigrams(str) {
    const s = ` ${str.toLowerCase()} `;
    const tg = new Set();
    for (let i = 0; i < s.length - 2; i++) tg.add(s.slice(i, i + 3));
    return tg;
  }

  function trigramSimilarity(a, b) {
    if (!a || !b) return 0;
    const ta = buildTrigrams(a);
    const tb = buildTrigrams(b);
    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared++;
    return (2 * shared) / (ta.size + tb.size);
  }

  function scoreTab(tab, query) {
    if (!query) return 1;
    const q = query.toLowerCase();
    const title = (tab.title || "").toLowerCase();
    const url = (tab.url || "").toLowerCase();
    if (title.startsWith(q)) return 1000 + (100 - title.length);
    const domain = (() => {
      try {
        return new URL(tab.url).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    if (domain.startsWith(q)) return 900;
    const tp = title.indexOf(q);
    const up = url.indexOf(q);
    if (tp !== -1) return 800 - tp;
    if (up !== -1) return 700 - up;
    if (title.split(/\W+/).some((w) => w.startsWith(q))) return 650;
    const best = Math.max(
      trigramSimilarity(q, title.slice(0, 80)),
      trigramSimilarity(q, domain),
    );
    if (best > 0.3) return best * 500;
    let qi = 0,
      score = 0;
    for (let i = 0; i < title.length && qi < q.length; i++) {
      if (title[i] === q[qi]) {
        qi++;
        score++;
      }
    }
    if (qi === q.length) return 100 + score;
    return -1;
  }

  function filterAndSort(tabs, query) {
    if (!query.trim()) return tabs;
    return tabs
      .map((t) => ({ tab: t, score: scoreTab(t, query.trim()) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ tab }) => tab);
  }

  //Helpers
  function escHtml(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function highlightMatch(text, query) {
    if (!query) return escHtml(text);
    const t = text || "";
    const idx = t.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escHtml(t);
    return (
      escHtml(t.slice(0, idx)) +
      `<mark>${escHtml(t.slice(idx, idx + query.length))}</mark>` +
      escHtml(t.slice(idx + query.length))
    );
  }

  function getFavicon(tab) {
    if (
      tab.favIconUrl &&
      !tab.favIconUrl.startsWith("chrome://") &&
      !tab.favIconUrl.startsWith("moz-extension://")
    ) {
      return `<img class="tf-fav" src="${escHtml(tab.favIconUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="tf-fav-fallback" style="display:none">${escHtml((tab.title || "?")[0].toUpperCase())}</span>`;
    }
    return `<span class="tf-fav-fallback">${escHtml((tab.title || "?")[0].toUpperCase())}</span>`;
  }

  //Shortcut label formatter
  function formatShortcut(s) {
    const parts = [];
    if (s.ctrlKey) parts.push("Ctrl");
    if (s.altKey) parts.push("Alt");
    if (s.shiftKey) parts.push("Shift");
    if (s.metaKey) parts.push("Meta");
    const codeMap = {
      Space: "Space",
      Escape: "Esc",
      Enter: "Enter",
      Tab: "Tab",
      Backspace: "Backspace",
      Delete: "Delete",
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
    };
    let key =
      codeMap[s.code] ||
      s.code
        .replace(/^Key/, "")
        .replace(/^Digit/, "")
        .replace(/^Numpad/, "Num");
    parts.push(key);
    return parts.join(" + ");
  }

  //State
  let overlay, input, list;
  let allTabs = [],
    filtered = [],
    selected = 0;

  //UI
  function createUI() {
    if (document.getElementById("tabflow-overlay")) {
      overlay = document.getElementById("tabflow-overlay");
      input = document.getElementById("tf-input");
      list = document.getElementById("tf-list");
      return;
    }

    overlay = document.createElement("div");
    overlay.id = "tabflow-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Tab Switcher");
    overlay.innerHTML = `
      <div id="tf-panel">
        <div id="tf-search-wrap">
          <svg id="tf-search-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M13 13l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <input id="tf-input" type="text" placeholder="Search tabs…" autocomplete="off" spellcheck="false"/>
          <button id="tf-settings-btn" title="Remap shortcut" aria-label="Settings">
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" width="15" height="15">
              <circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
          <kbd id="tf-esc-hint">ESC</kbd>
        </div>
        <div id="tf-divider"></div>
        <ul id="tf-list" role="listbox" aria-label="Tabs"></ul>
        <div id="tf-settings-panel" style="display:none">
          <div id="tf-settings-inner">
            <div class="tf-settings-title">Remap open shortcut</div>
            <div id="tf-shortcut-display" tabindex="0">
              <span id="tf-shortcut-label"></span>
              <span class="tf-shortcut-hint">click to record</span>
            </div>
            <div id="tf-recording-notice" style="display:none">Press shortcut… <span class="tf-dot"></span></div>
            <div class="tf-settings-rule">Must include Alt, Ctrl, or Shift. Press Esc to cancel.</div>
            <div class="tf-settings-btns">
              <button id="tf-settings-reset">Reset default</button>
              <button id="tf-settings-save">Save</button>
            </div>
            <div id="tf-settings-status"></div>
          </div>
        </div>
        <div id="tf-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> switch</span>
          <span><kbd>Ctrl+↵</kbd> web search</span>
          <span><kbd>⌫</kbd> close tab</span>
          <span><kbd>Esc</kbd> dismiss</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    input = document.getElementById("tf-input");
    list = document.getElementById("tf-list");

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });

    // Settings gear toggle
    const settingsBtn = document.getElementById("tf-settings-btn");
    const settingsPanel = document.getElementById("tf-settings-panel");
    const shortcutDisplay = document.getElementById("tf-shortcut-display");
    const shortcutLabel = document.getElementById("tf-shortcut-label");
    const recordingNotice = document.getElementById("tf-recording-notice");
    const settingsStatus = document.getElementById("tf-settings-status");
    let settingsRecording = false;
    let settingsPending = null;

    function updateShortcutLabel(s) {
      shortcutLabel.textContent = formatShortcut(s);
    }

    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = settingsPanel.style.display === "none";
      settingsPanel.style.display = open ? "block" : "none";
      list.style.display = open ? "none" : "";
      if (open) {
        settingsPending = null;
        settingsRecording = false;
        recordingNotice.style.display = "none";
        shortcutDisplay.classList.remove("tf-recording");
        updateShortcutLabel(openShortcut);
        settingsStatus.textContent = "";
      }
    });

    shortcutDisplay.addEventListener("click", () => {
      settingsRecording = true;
      settingsPending = null;
      shortcutDisplay.classList.add("tf-recording");
      recordingNotice.style.display = "flex";
      settingsStatus.textContent = "";
    });

    shortcutDisplay.addEventListener(
      "keydown",
      (e) => {
        if (!settingsRecording) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const MODS = new Set([
          "AltLeft",
          "AltRight",
          "ControlLeft",
          "ControlRight",
          "ShiftLeft",
          "ShiftRight",
          "MetaLeft",
          "MetaRight",
        ]);
        if (MODS.has(e.code)) return;
        if (e.code === "Escape" && !e.altKey && !e.ctrlKey && !e.shiftKey) {
          settingsRecording = false;
          shortcutDisplay.classList.remove("tf-recording");
          recordingNotice.style.display = "none";
          updateShortcutLabel(openShortcut);
          return;
        }
        if (!e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
          settingsStatus.textContent =
            "Need at least one modifier (Alt, Ctrl, Shift)";
          settingsStatus.style.color = "#ff453a";
          return;
        }
        settingsPending = {
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          code: e.code,
        };
        settingsRecording = false;
        shortcutDisplay.classList.remove("tf-recording");
        recordingNotice.style.display = "none";
        updateShortcutLabel(settingsPending);
        settingsStatus.textContent = "";
      },
      true,
    );

    document
      .getElementById("tf-settings-reset")
      .addEventListener("click", () => {
        settingsPending = {
          altKey: true,
          ctrlKey: false,
          shiftKey: false,
          metaKey: false,
          code: "Space",
        };
        updateShortcutLabel(settingsPending);
        settingsStatus.textContent = "";
      });

    document
      .getElementById("tf-settings-save")
      .addEventListener("click", async () => {
        const toSave = settingsPending || openShortcut;
        await browser.storage.local.set({ openShortcut: toSave });
        openShortcut = { ...toSave };
        settingsPending = null;
        settingsStatus.textContent = "Saved!";
        settingsStatus.style.color = "#30d158";
        setTimeout(() => {
          settingsStatus.textContent = "";
        }, 2000);
      });

    // Typing into input fires render (fallback for normal pages)
    input.addEventListener("input", () => render(input.value));
  }

  function renderItem(tab, idx) {
    const query = input ? input.value : "";
    const domain = (() => {
      try {
        return new URL(tab.url).hostname.replace("www.", "");
      } catch {
        return "";
      }
    })();
    return `
      <li class="tf-item${idx === selected ? " tf-selected" : ""}${tab.active ? " tf-active" : ""}"
          role="option" aria-selected="${idx === selected}" data-idx="${idx}" data-tabid="${tab.id}">
        <div class="tf-fav-wrap">${getFavicon(tab)}</div>
        <div class="tf-info">
          <div class="tf-title">${highlightMatch(tab.title || "Untitled", query)}</div>
          <div class="tf-url">${highlightMatch(domain, query)}</div>
        </div>
        ${tab.active ? `<span class="tf-badge">current</span>` : ""}
        <button class="tf-close" data-tabid="${tab.id}" title="Close tab" aria-label="Close tab">✕</button>
      </li>`;
  }

  function render(query = "") {
    filtered = filterAndSort(allTabs, query);
    if (selected >= filtered.length) selected = 0;
    list.innerHTML = filtered.map((t, i) => renderItem(t, i)).join("");

    list.querySelectorAll(".tf-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".tf-close")) return;
        selected = parseInt(el.dataset.idx);
        switchToSelected();
      });
      el.addEventListener("mouseenter", () => {
        selected = parseInt(el.dataset.idx);
        updateSelection();
      });
    });

    list.querySelectorAll(".tf-close").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(parseInt(btn.dataset.tabid));
      });
    });

    scrollToSelected();
  }

  function updateSelection() {
    list.querySelectorAll(".tf-item").forEach((el, i) => {
      el.classList.toggle("tf-selected", i === selected);
      el.setAttribute("aria-selected", i === selected);
    });
    scrollToSelected();
  }

  function moveSel(dir) {
    if (!filtered.length) return;
    selected = (selected + dir + filtered.length) % filtered.length;
    updateSelection();
  }

  function scrollToSelected() {
    const el = list.querySelector(".tf-selected");
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  //Actions
  async function switchToSelected() {
    const tab = filtered[selected];
    if (!tab) return;
    close();
    browser.runtime.sendMessage({ type: "SWITCH_TAB", tabId: tab.id });
  }

  async function openSearchTab(query) {
    if (!query) return;
    close();
    browser.runtime.sendMessage({ type: "OPEN_SEARCH_TAB", query });
  }

  async function closeTab(tabId) {
    await browser.runtime.sendMessage({ type: "CLOSE_TAB", tabId });
    allTabs = allTabs.filter((t) => t.id !== tabId);
    render(input ? input.value : "");
  }

  async function open() {
    if (window.__tabFlowActive) return;
    window.__tabFlowActive = true;
    createUI();
    overlay.style.display = "flex";
    const data = await browser.runtime.sendMessage({ type: "GET_TABS" });
    allTabs = data.tabs || [];
    selected = 0;
    input.value = "";
    render("");
    requestAnimationFrame(() => {
      overlay.classList.add("tf-visible");
      input.focus();
    });
  }

  function close() {
    if (!window.__tabFlowActive) return;
    window.__tabFlowActive = false;
    if (overlay) {
      overlay.classList.remove("tf-visible");
      setTimeout(() => {
        if (overlay) overlay.style.display = "none";
      }, 180);
    }
  }

  // Shortcut handling
  let openShortcut = {
    altKey: true,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    code: "Space",
  };

  browser.storage.local.get("openShortcut").then((result) => {
    if (result.openShortcut) openShortcut = result.openShortcut;
  });

  function matchesOpenShortcut(e) {
    return (
      e.code === openShortcut.code &&
      !!e.altKey === !!openShortcut.altKey &&
      !!e.ctrlKey === !!openShortcut.ctrlKey &&
      !!e.shiftKey === !!openShortcut.shiftKey &&
      !!e.metaKey === !!openShortcut.metaKey
    );
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (matchesOpenShortcut(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (window.__tabFlowActive) close();
        else open();
        return;
      }

      if (!window.__tabFlowActive) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          e.stopImmediatePropagation();
          close();
          break;

        case "ArrowDown":
          e.preventDefault();
          e.stopImmediatePropagation();
          moveSel(1);
          break;

        case "ArrowUp":
          e.preventDefault();
          e.stopImmediatePropagation();
          moveSel(-1);
          break;

        case "Tab":
          e.preventDefault();
          e.stopImmediatePropagation();
          moveSel(e.shiftKey ? -1 : 1);
          break;

        case "Enter":
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.ctrlKey || e.metaKey)
            openSearchTab(input ? input.value.trim() : "");
          else switchToSelected();
          break;

        case "Backspace":
          e.preventDefault();
          e.stopImmediatePropagation();
          if (input && input.value === "" && filtered[selected]) {
            closeTab(filtered[selected].id);
          } else if (input) {
            // Manually delete — needed on pages that preventDefault before us
            const v = input.value,
              s = input.selectionStart,
              end = input.selectionEnd;
            if (s !== end) {
              input.value = v.slice(0, s) + v.slice(end);
              input.setSelectionRange(s, s);
            } else if (s > 0) {
              input.value = v.slice(0, s - 1) + v.slice(s);
              input.setSelectionRange(s - 1, s - 1);
            }
            render(input.value);
          }
          break;

        default:
          e.preventDefault();
          e.stopImmediatePropagation();
          if (
            input &&
            e.key.length === 1 &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey
          ) {
            const v = input.value,
              s = input.selectionStart,
              end = input.selectionEnd;
            input.value = v.slice(0, s) + e.key + v.slice(end);
            input.setSelectionRange(s + 1, s + 1);
            render(input.value);
          }
          break;
      }
    },
    true,
  );

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TABFLOW_OPEN") {
      if (window.__tabFlowActive) close();
      else open();
    }
    if (msg.type === "SHORTCUT_UPDATED") {
      openShortcut = msg.shortcut;
    }
  });
})();
