(function () {
  if (window.__tabFlowActive) return;
  window.__tabFlowActive = false;

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
    const domain = new URL(tab.url || "http://x").hostname.toLowerCase();
    if (domain.startsWith(q)) return 900;

    const tp = title.indexOf(q);
    const up = url.indexOf(q);
    if (tp !== -1) return 800 - tp;
    if (up !== -1) return 700 - up;

    const words = title.split(/\W+/);
    if (words.some((w) => w.startsWith(q))) return 650;

    const ts = trigramSimilarity(q, title.slice(0, 80));
    const us = trigramSimilarity(q, domain);
    const best = Math.max(ts, us);
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

  // Highlight matched text
  function highlightMatch(text, query) {
    if (!query) return escHtml(text);
    const q = query.toLowerCase();
    const t = text || "";
    const idx = t.toLowerCase().indexOf(q);
    if (idx === -1) return escHtml(t);
    return (
      escHtml(t.slice(0, idx)) +
      `<mark>${escHtml(t.slice(idx, idx + q.length))}</mark>` +
      escHtml(t.slice(idx + q.length))
    );
  }

  function escHtml(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function getFavicon(tab) {
    if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
      return `<img class="tf-fav" src="${escHtml(tab.favIconUrl)}" alt=""
        onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span class=\\'tf-fav-fallback\\'>${escHtml((tab.title || "?")[0].toUpperCase())}</span>')">`;
    }
    return `<span class="tf-fav-fallback">${escHtml((tab.title || "?")[0].toUpperCase())}</span>`;
  }

  // DOM building
  let overlay, input, list;
  let allTabs = [];
  let filtered = [];
  let selected = 0;

  function createUI() {
    if (document.getElementById("tabflow-overlay")) return;

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
          <input id="tf-input" type="text" placeholder="Search tabs…" autocomplete="off" spellcheck="false" aria-autocomplete="list" aria-controls="tf-list"/>
          <kbd id="tf-esc-hint">ESC</kbd>
        </div>
        <div id="tf-divider"></div>
        <ul id="tf-list" role="listbox" aria-label="Tabs"></ul>
        <div id="tf-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> switch</span>
          <span><kbd>⌫</kbd> close tab</span>
          <span><kbd>Ctrl</kbd><kbd>↵</kbd> search web</span>
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

    input.addEventListener("input", () => render(input.value));

    overlay.addEventListener(
      "keydown",
      (e) => {
        e.stopImmediatePropagation();
        e.stopPropagation();

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            moveSel(1);
            break;
          case "ArrowUp":
            e.preventDefault();
            moveSel(-1);
            break;
          case "Enter":
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) openSearchTab(input.value.trim());
            else switchToSelected();
            break;
          case "Escape":
            e.preventDefault();
            close();
            break;
          case "Backspace":
            if (input.value === "" && filtered[selected]) {
              e.preventDefault();
              closeTab(filtered[selected].id);
            }
            break;
          case "Tab":
            e.preventDefault();
            moveSel(e.shiftKey ? -1 : 1);
            break;
        }
      },
      true,
    );

    overlay.addEventListener(
      "keyup",
      (e) => {
        e.stopImmediatePropagation();
        e.stopPropagation();
      },
      true,
    );
    overlay.addEventListener(
      "keypress",
      (e) => {
        e.stopImmediatePropagation();
        e.stopPropagation();
      },
      true,
    );

    document.addEventListener("focusin", _refocusGuard, true);
  }

  function _refocusGuard(e) {
    if (!window.__tabFlowActive) return;
    const panel = document.getElementById("tf-panel");
    if (panel && !panel.contains(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const inp = document.getElementById("tf-input");
      if (inp) inp.focus();
    }
  }

  function renderItem(tab, idx) {
    const query = input ? input.value : "";
    const isActive = tab.active;
    const isSelected = idx === selected;
    const domain = (() => {
      try {
        return new URL(tab.url).hostname.replace("www.", "");
      } catch {
        return "";
      }
    })();

    return `
      <li class="tf-item${isSelected ? " tf-selected" : ""}${isActive ? " tf-active" : ""}"
          role="option"
          aria-selected="${isSelected}"
          data-idx="${idx}"
          data-tabid="${tab.id}">
        <div class="tf-fav-wrap">${getFavicon(tab)}</div>
        <div class="tf-info">
          <div class="tf-title">${highlightMatch(tab.title || "Untitled", query)}</div>
          <div class="tf-url">${highlightMatch(domain, query)}</div>
        </div>
        ${isActive ? `<span class="tf-badge">current</span>` : ""}
        <button class="tf-close" data-tabid="${tab.id}" title="Close tab" aria-label="Close tab">✕</button>
      </li>
    `;
  }

  function render(query = "") {
    filtered = filterAndSort(allTabs, query);
    if (selected >= filtered.length) selected = 0;
    list.innerHTML = filtered.map((t, i) => renderItem(t, i)).join("");

    list.querySelectorAll(".tf-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".tf-close")) {
          closeTab(parseInt(e.target.closest(".tf-close").dataset.tabid));
          return;
        }
        const idx = parseInt(el.dataset.idx);
        selected = idx;
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

  async function switchToSelected() {
    const tab = filtered[selected];
    if (!tab) return;
    close();
    browser.runtime.sendMessage({ type: "SWITCH_TAB", tabId: tab.id });
  }

  async function closeTab(tabId) {
    await browser.runtime.sendMessage({ type: "CLOSE_TAB", tabId });
    allTabs = allTabs.filter((t) => t.id !== tabId);
    render(input ? input.value : "");
  }

  async function openSearchTab(query) {
    if (!query) return;
    close();
    browser.runtime.sendMessage({ type: "OPEN_SEARCH_TAB", query });
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
    document.removeEventListener("focusin", _refocusGuard, true);
    if (overlay) {
      overlay.classList.remove("tf-visible");
      setTimeout(() => {
        overlay.style.display = "none";
      }, 180);
    }
  }

  let openShortcut = {
    altKey: true,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    code: "Space",
  };
  browser.storage.local.get("openShortcut").then((r) => {
    if (r.openShortcut) openShortcut = r.openShortcut;
  });

  function matchesShortcut(e) {
    return (
      e.code === openShortcut.code &&
      !!e.altKey === !!openShortcut.altKey &&
      !!e.ctrlKey === !!openShortcut.ctrlKey &&
      !!e.shiftKey === !!openShortcut.shiftKey &&
      !!e.metaKey === !!openShortcut.metaKey
    );
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TABFLOW_OPEN") {
      if (window.__tabFlowActive) close();
      else open();
    }
    if (msg.type === "SHORTCUT_UPDATED") {
      openShortcut = msg.shortcut;
    }
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (matchesShortcut(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (window.__tabFlowActive) close();
        else open();
      }
    },
    true,
  );
})();
