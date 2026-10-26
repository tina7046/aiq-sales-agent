/**
 * Segment tabs — pill row plus a name modal.
 * Each tab stores its own HTML. Switching tabs asks the caller’s editor
 * to save and restore that HTML. The new-tab body and the storage key
 * come from the caller; nothing here is tied to a particular page.
 *
 *   initSegmentTabs(root, {
 *     storageKey: "segment-tabs-lab",
 *     editor: { getContent, setContent },
 *     newTabContent: "<p>New instructions</p>",
 *     initialTabs: [{ name: "Default", icon: "display_text", content: "..." }]
 *   })
 *
 * Events (on document):
 *   sh:segment-tabs-changed   { tabs, activeTabId, root }
 *   sh:segment-tab-activate   { tabId, root }  — callers dispatch this
 */

const ICON_BASE = "/aiq-sales-agent/assets/icons/utility-sprite/svg/symbols.svg";

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text == null ? "" : String(text);
  return d.innerHTML;
}

export function initSegmentTabs(root, options) {
  if (!root) return null;
  options = options || {};

  const editor = options.editor || {
    getContent: function () { return ""; },
    setContent: function () {}
  };
  const storageKey = options.storageKey || "sh:segment-tabs";
  const newTabContent = options.newTabContent != null
    ? String(options.newTabContent)
    : "<p></p>";

  const listEl = root.querySelector("[data-sh-segment-tabs-list]");
  const modal = root.querySelector("[data-sh-segment-tabs-modal]");
  const backdrop = root.querySelector("[data-sh-segment-tabs-backdrop]");
  const input = root.querySelector("[data-sh-segment-tabs-input]");
  const heading = root.querySelector("[data-sh-segment-tabs-heading]");
  const saveBtn = root.querySelector("[data-sh-segment-tabs-save]");
  const cancelBtn = root.querySelector("[data-sh-segment-tabs-cancel]");
  const closeBtn = root.querySelector("[data-sh-segment-tabs-close]");

  let tabs = [];
  let activeTabId = null;
  let nextId = 1;
  let editingTabId = null;
  // Cloud-logo reset clears storage and then reloads. beforeunload would
  // otherwise write the in-memory pills back and undo the reset.
  let persistEnabled = true;

  function uid() {
    return "tab_" + nextId++;
  }

  function defaultTabs() {
    const seed = Array.isArray(options.initialTabs) && options.initialTabs.length
      ? options.initialTabs
      : [{ name: "Default", icon: "display_text", content: newTabContent }];
    return seed.map(function (tab) {
      return {
        id: tab.id || uid(),
        name: tab.name || "Untitled",
        icon: tab.icon || "display_text",
        content: tab.content != null ? String(tab.content) : newTabContent
      };
    });
  }

  function saveActiveContent() {
    if (!activeTabId) return;
    const tab = tabs.find(function (t) { return t.id === activeTabId; });
    if (tab && typeof editor.getContent === "function") {
      tab.content = editor.getContent();
    }
  }

  function persistTabs() {
    if (!persistEnabled) return;
    saveActiveContent();
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        tabs: tabs,
        activeTabId: activeTabId,
        nextId: nextId
      }));
    } catch (err) { /* storage can be unavailable; the in-memory set still works */ }
  }

  function resetTabs() {
    persistEnabled = false;
    try { sessionStorage.removeItem(storageKey); } catch (err) {}
  }

  function dispatchChanged() {
    document.dispatchEvent(new CustomEvent("sh:segment-tabs-changed", {
      detail: {
        tabs: tabs.map(function (t) { return { id: t.id, name: t.name }; }),
        activeTabId: activeTabId,
        root: root
      }
    }));
  }

  function setEditorContent(html) {
    if (typeof editor.setContent === "function") editor.setContent(html || "");
  }

  function syncActivePill() {
    if (!listEl) return;
    listEl.querySelectorAll(":scope > [data-tab-id]").forEach(function (pill) {
      pill.classList.toggle(
        "sh-segment-tabs__pill--active",
        pill.getAttribute("data-tab-id") === activeTabId
      );
    });
    persistTabs();
    dispatchChanged();
  }

  function activateTab(id) {
    if (!id || id === activeTabId) return;
    saveActiveContent();
    activeTabId = id;
    const tab = tabs.find(function (t) { return t.id === id; });
    if (tab) setEditorContent(tab.content);
    // Toggle the active class in place. Rebuilding the row inside the
    // click removes the link under the pointer, and the rest of that
    // click can land on the first pill.
    syncActivePill();
  }

  function removeTab(id) {
    const idx = tabs.findIndex(function (t) { return t.id === id; });
    if (idx === -1) return;
    tabs.splice(idx, 1);
    if (activeTabId === id) {
      const next = tabs[Math.min(idx, tabs.length - 1)];
      activeTabId = next ? next.id : null;
      if (next) setEditorContent(next.content);
      else setEditorContent("");
    }
    renderTabs();
  }

  function closeAllDropdowns() {
    root.querySelectorAll(".sh-segment-tabs__overflow.slds-is-open")
      .forEach(function (el) { el.classList.remove("slds-is-open"); });
  }

  function buildPill(tab) {
    const isActive = tab.id === activeTabId;
    const isFirst = tabs[0] && tabs[0].id === tab.id;

    const pill = document.createElement("span");
    pill.className = "slds-pill slds-pill_link sh-segment-tabs__pill" +
      (isActive ? " sh-segment-tabs__pill--active" : "");
    pill.dataset.tabId = tab.id;

    pill.innerHTML =
      '<span class="slds-pill__icon_container slds-current-color">' +
        '<svg class="slds-icon slds-icon_xx-small" aria-hidden="true">' +
          '<use xlink:href="' + ICON_BASE + "#" + escapeHtml(tab.icon) + '"></use>' +
        "</svg>" +
      "</span>" +
      '<a href="#" class="slds-pill__action slds-m-horizontal_xx-small' +
        (isFirst ? " slds-p-right_small" : "") + '" title="' + escapeHtml(tab.name) + '">' +
        '<span class="slds-pill__label">' + escapeHtml(tab.name) + "</span>" +
      "</a>" +
      (isFirst ? "" :
        '<div class="slds-dropdown-trigger slds-dropdown-trigger_click sh-segment-tabs__overflow">' +
          '<button type="button" class="slds-button slds-button_icon slds-pill__remove" aria-haspopup="true" title="More options">' +
            '<svg class="slds-button__icon slds-icon-text-default" aria-hidden="true">' +
              '<use xlink:href="' + ICON_BASE + '#chevrondown"></use>' +
            "</svg>" +
            '<span class="slds-assistive-text">More options</span>' +
          "</button>" +
          '<div class="slds-dropdown slds-dropdown_right sh-segment-tabs__menu">' +
            '<ul class="slds-dropdown__list" role="menu" aria-label="More options">' +
              '<li class="slds-dropdown__item" role="presentation">' +
                '<a href="#" role="menuitem" tabindex="0" data-sh-segment-tabs-action="edit">' +
                  '<svg class="sh-segment-tabs__menu-icon" aria-hidden="true">' +
                    '<use xlink:href="' + ICON_BASE + '#edit"></use>' +
                  "</svg>" +
                  '<span title="Edit">Edit</span>' +
                "</a>" +
              "</li>" +
              '<li class="slds-dropdown__item" role="presentation">' +
                '<a href="#" role="menuitem" tabindex="-1" data-sh-segment-tabs-action="delete">' +
                  '<svg class="sh-segment-tabs__menu-icon" aria-hidden="true">' +
                    '<use xlink:href="' + ICON_BASE + '#delete"></use>' +
                  "</svg>" +
                  '<span title="Delete">Delete</span>' +
                "</a>" +
              "</li>" +
            "</ul>" +
          "</div>" +
        "</div>");

    const overflowBtn = pill.querySelector(".sh-segment-tabs__overflow > .slds-button");
    if (overflowBtn) {
      overflowBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        const trigger = overflowBtn.parentNode;
        const wasOpen = trigger.classList.contains("slds-is-open");
        closeAllDropdowns();
        if (!wasOpen) trigger.classList.add("slds-is-open");
      });
    }

    const editAction = pill.querySelector('[data-sh-segment-tabs-action="edit"]');
    if (editAction) {
      editAction.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeAllDropdowns();
        openModal(tab.id);
      });
    }

    const deleteAction = pill.querySelector('[data-sh-segment-tabs-action="delete"]');
    if (deleteAction) {
      deleteAction.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeAllDropdowns();
        removeTab(tab.id);
      });
    }

    return pill;
  }

  function buildAddPill() {
    const pill = document.createElement("span");
    pill.className = "slds-pill slds-pill_link sh-segment-tabs__pill sh-segment-tabs__pill--add slds-current-color";
    pill.innerHTML =
      '<a href="#" class="slds-pill__action" title="Add">' +
        '<svg class="slds-icon slds-icon_xx-small" aria-hidden="true">' +
          '<use xlink:href="' + ICON_BASE + '#add"></use>' +
        "</svg>" +
        '<span class="slds-assistive-text">Add</span>' +
      "</a>";

    return pill;
  }

  function renderTabs() {
    if (!listEl) return;
    listEl.innerHTML = "";
    listEl.appendChild(buildAddPill());
    tabs.forEach(function (tab) { listEl.appendChild(buildPill(tab)); });
    persistTabs();
    dispatchChanged();
  }

  function openModal(tabId) {
    editingTabId = tabId || null;
    if (!modal || !backdrop) return;

    const title = editingTabId ? "Edit instructions" : "Add Knowledge Profile";
    if (editingTabId) {
      const tab = tabs.find(function (t) { return t.id === editingTabId; });
      if (input) input.value = tab ? tab.name : "";
    } else if (input) {
      input.value = "";
    }
    if (heading) heading.textContent = title;
    modal.setAttribute("aria-label", title);
    if (saveBtn) saveBtn.textContent = editingTabId ? "Save" : "Start learning";
    clearPicklistSelection();

    modal.classList.remove("slds-hide");
    backdrop.classList.remove("slds-hide");
    modal.classList.add("slds-fade-in-open");
    backdrop.classList.add("slds-backdrop_open");
    updateSaveBtn();
    if (input) input.focus();
  }

  function closeModal() {
    editingTabId = null;
    if (!modal || !backdrop) return;
    modal.classList.remove("slds-fade-in-open");
    backdrop.classList.remove("slds-backdrop_open");
    modal.classList.add("slds-hide");
    backdrop.classList.add("slds-hide");
  }

  function updateSaveBtn() {
    if (input && saveBtn) saveBtn.disabled = !input.value.trim();
  }

  function handleSave() {
    const name = input ? input.value.trim() : "";
    if (!name) return;

    if (editingTabId) {
      const tab = tabs.find(function (t) { return t.id === editingTabId; });
      if (tab) tab.name = name;
      renderTabs();
      closeModal();
      return;
    }

    saveActiveContent();
    const created = {
      id: uid(),
      name: name,
      icon: "display_text",
      content: newTabContent
    };
    tabs.push(created);
    activeTabId = created.id;
    setEditorContent(created.content);
    renderTabs();
    closeModal();
    if (typeof options.onCreate === "function") {
      options.onCreate(created, selectedUserNames());
    }
  }

  function selectedUserNames() {
    const selected = root.querySelector("[data-sh-segment-tabs-selected]");
    if (!selected) return [];
    return Array.prototype.map.call(
      selected.querySelectorAll('[role="option"]'),
      function (option) {
        const label = option.querySelector(".slds-truncate");
        return (label ? label.textContent : option.textContent || "").trim();
      }
    ).filter(Boolean);
  }

  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (saveBtn) saveBtn.addEventListener("click", handleSave);
  if (input) {
    input.addEventListener("input", updateSaveBtn);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && input.value.trim()) handleSave();
    });
  }

  function picklistOptions(list) {
    return list ? list.querySelectorAll('[role="option"]') : [];
  }

  function clearPicklistSelection() {
    root.querySelectorAll("[data-sh-segment-tabs-available] [role='option'], [data-sh-segment-tabs-selected] [role='option']")
      .forEach(function (option) {
        option.setAttribute("aria-selected", "false");
      });
    updateMoveButtons();
  }

  function selectPicklistOption(list, option) {
    picklistOptions(list).forEach(function (el) {
      el.setAttribute("aria-selected", "false");
      el.tabIndex = -1;
    });
    option.setAttribute("aria-selected", "true");
    option.tabIndex = 0;
    updateMoveButtons();
  }

  function movePicklistItems(from, to) {
    if (!from || !to) return;
    const chosen = from.querySelectorAll('[role="option"][aria-selected="true"]');
    chosen.forEach(function (option) {
      option.setAttribute("aria-selected", "false");
      option.tabIndex = -1;
      const item = option.closest(".slds-listbox__item");
      if (item) to.appendChild(item);
    });
    const next = to.querySelector('[role="option"]');
    if (next && !to.querySelector('[tabindex="0"]')) next.tabIndex = 0;
    updateMoveButtons();
  }

  function updateMoveButtons() {
    const available = root.querySelector("[data-sh-segment-tabs-available]");
    const selected = root.querySelector("[data-sh-segment-tabs-selected]");
    const toSelected = root.querySelector("[data-sh-segment-tabs-move-selected]");
    const toAvailable = root.querySelector("[data-sh-segment-tabs-move-available]");
    if (toSelected && available) {
      toSelected.disabled = !available.querySelector('[role="option"][aria-selected="true"]');
    }
    if (toAvailable && selected) {
      toAvailable.disabled = !selected.querySelector('[role="option"][aria-selected="true"]');
    }
  }

  function bindPicklist() {
    const available = root.querySelector("[data-sh-segment-tabs-available]");
    const selected = root.querySelector("[data-sh-segment-tabs-selected]");
    const toSelected = root.querySelector("[data-sh-segment-tabs-move-selected]");
    const toAvailable = root.querySelector("[data-sh-segment-tabs-move-available]");
    if (!available || !selected) return;

    function onListClick(list, event) {
      const option = event.target.closest('[role="option"]');
      if (!option || !list.contains(option)) return;
      selectPicklistOption(list, option);
    }

    available.addEventListener("click", function (event) { onListClick(available, event); });
    selected.addEventListener("click", function (event) { onListClick(selected, event); });
    available.addEventListener("dblclick", function (event) {
      const option = event.target.closest('[role="option"]');
      if (!option || !available.contains(option)) return;
      selectPicklistOption(available, option);
      movePicklistItems(available, selected);
    });
    selected.addEventListener("dblclick", function (event) {
      const option = event.target.closest('[role="option"]');
      if (!option || !selected.contains(option)) return;
      selectPicklistOption(selected, option);
      movePicklistItems(selected, available);
    });
    if (toSelected) toSelected.addEventListener("click", function () { movePicklistItems(available, selected); });
    if (toAvailable) toAvailable.addEventListener("click", function () { movePicklistItems(selected, available); });
    updateMoveButtons();
  }

  bindPicklist();

  if (listEl && !listEl.dataset.shSegmentTabsBound) {
    listEl.dataset.shSegmentTabsBound = "true";
    listEl.addEventListener("click", function (e) {
      if (e.target.closest(".sh-segment-tabs__overflow")) return;
      const pill = e.target.closest(".slds-pill");
      if (!pill || pill.parentElement !== listEl) return;
      e.preventDefault();
      closeAllDropdowns();
      if (pill.dataset.tabId) activateTab(pill.dataset.tabId);
      else openModal();
    });
  }

  const saved = sessionStorage.getItem(storageKey);
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (data && Array.isArray(data.tabs) && data.tabs.length) {
        tabs = data.tabs;
        activeTabId = data.activeTabId;
        nextId = data.nextId || tabs.length + 1;
      }
    } catch (err) { /* fall through to the seed */ }
  }
  if (!tabs.length) {
    tabs = defaultTabs();
    activeTabId = tabs[0].id;
  }
  if (!tabs.some(function (t) { return t.id === activeTabId; })) {
    activeTabId = tabs[0].id;
  }

  const active = tabs.find(function (t) { return t.id === activeTabId; });
  setEditorContent(active ? active.content : newTabContent);
  renderTabs();

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".sh-segment-tabs__overflow")) closeAllDropdowns();
  });

  document.addEventListener("sh:segment-tab-activate", function (e) {
    const detail = e.detail || {};
    if (detail.root && detail.root !== root) return;
    const id = detail.tabId;
    if (id && id !== activeTabId && tabs.some(function (t) { return t.id === id; })) {
      activateTab(id);
    }
  });

  window.addEventListener("beforeunload", persistTabs);

  return {
    getTabs: function () {
      return tabs.map(function (t) { return { id: t.id, name: t.name }; });
    },
    getActiveTabId: function () { return activeTabId; },
    reset: resetTabs
  };
}
