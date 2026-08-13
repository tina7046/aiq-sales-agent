/**
 * Tools modal controller
 * =====================================================================
 * Ported from the inline `<script type="module">` at the bottom of
 * BB-AOP's `_tools_morph_modal.html`. Behaviour is 1:1 with the source;
 * the changes are structural only:
 *
 *   1. Lifted out of the template so the modal can mount on more than
 *      one page without compiling a copy of the controller into each.
 *   2. Its two Nunjucks-interpolated lookup tables (TOOL_ICON_MAP and
 *      TOOL_PANEL_TYPES) now come from a JSON config block the template
 *      emits — see `readConfig` below. Same data, no template coupling.
 *   3. Self-initializes only when `#morphModal` is on the page, matching
 *      this project's no-op-on-missing-root convention (home.js).
 *   4. `populateToolDetail` falls back to a synthesized detail panel
 *      when a card has no entry in tools-data.js, so a card added to
 *      `shared.toolsModal.tools` is clickable immediately instead of
 *      silently doing nothing. See SYNTHETIC_TABS.
 *
 * Requires GSAP 3.x on the global `gsap` (vendored at
 * /scripts/vendor/gsap.min.js) — load it before this module.
 *
 * ES module rather than this project's usual IIFE because MorphSurface
 * and AVAILABLE_TOOLS are both ES modules in the source and rewriting
 * them to globals would be a bigger deviation than importing them.
 * index.html already uses `<script type="module">` for the god-rays
 * shader, so the pattern is established here.
 */

import { MorphSurface } from "/scripts/morph-surface.js";
import { AVAILABLE_TOOLS } from "/scripts/tools-data.js";

// Panel widths in px, straight from the source. Panel 1 is the wide
// two-column card grid; everything downstream is a single reading
// column. Heights are measured at runtime, not declared.
//
// These are MAXIMUMS, not fixed sizes — see `widthFor`. The surface has
// to carry an explicit pixel width and height because that's what GSAP
// animates between as panels change; a percentage or `auto` has nothing
// to tween. But the source hardcoded them, so on a viewport narrower
// than 900px the dialog simply overflowed the screen.
const PANEL_WIDTH = {
  panel1: 900,
  panel2: 640,
  panel3: 640,
  panel4: 640,
};

// Breathing room kept between the surface and the viewport edges. The
// vertical figure matches the container's 3rem top and bottom margins
// and `.morph-panel`'s `max-height: calc(100vh - 6rem)`, so the JS and
// the stylesheet agree on where the surface has to stop.
const VIEWPORT_INSET_X = 32;
const VIEWPORT_INSET_Y = 96;

// Tabs used for a card that has no authored entry in tools-data.js.
// The source had no such fallback — clicking an unknown card was a
// no-op — but the whole point of this port is swapping the catalog, so
// an unrecognized id needs to still render something.
const SYNTHETIC_TABS = [
  {
    label: "Overview",
    description: "What this connection gives the agent access to.",
    example: "Use {{tool}} to enrich this account before I reach out.",
  },
];

/**
 * Read the catalog the template emitted as JSON. Returns the icon and
 * panel-type lookups the controller needs, keyed by tool id.
 */
function readConfig() {
  const node = document.getElementById("sh-tools-config");
  if (!node) return { tools: [] };
  try {
    return JSON.parse(node.textContent) || { tools: [] };
  } catch (e) {
    return { tools: [] };
  }
}

function init() {
  // GSAP drives the morph; ShTabNav renders the detail panels' pill
  // bars. Both are classic scripts in _template.html / the page, so
  // they've run by the time this deferred module does — the guard is
  // for a page that mounts the modal without loading them.
  const modal = document.getElementById("morphModal");
  if (!modal || typeof window.gsap === "undefined" || !window.ShTabNav) return;

  const config = readConfig();

  const TOOL_ICON_MAP = {};
  const TOOL_PANEL_TYPES = {};
  config.tools.forEach((tool) => {
    TOOL_ICON_MAP[tool.id] = {
      icon: tool.icon,
      iconSrc: tool.iconSrc,
      iconSize: tool.iconSize,
      name: tool.name,
    };
    TOOL_PANEL_TYPES[tool.id] = tool.panelType;
  });

  // The featured (promo) tool. Its card carries the banner, which hides
  // once it's connected. Mirrors shared.toolsModal.featured.id.
  const FEATURED_ID = config.featuredId || "zoominfo_lookup";

  // Authored detail content, joined to the catalog by id. Tools present
  // in the catalog but absent here fall back to SYNTHETIC_TABS.
  const TOOL_DETAILS = {};
  AVAILABLE_TOOLS.forEach((tool) => {
    const iconInfo = TOOL_ICON_MAP[tool.id];
    if (!iconInfo) return;
    const resolvedTabs = (tool.tabs || []).map((tab) => ({
      ...tab,
      example: (tab.example || "").replace(/\{\{tool\}\}/g, tool.name),
    }));
    TOOL_DETAILS[tool.id] = {
      name: tool.name,
      icon: iconInfo.icon,
      iconSrc: iconInfo.iconSrc,
      iconSize: iconInfo.iconSize,
      useCase: tool.useCase || tool.description,
      tabs: resolvedTabs.slice(0, 5),
    };
  });

  /**
   * Detail content for a card with no authored entry, built from what
   * the catalog already knows about it.
   */
  function synthesizeDetail(toolId) {
    const iconInfo = TOOL_ICON_MAP[toolId];
    if (!iconInfo) return null;
    return {
      name: iconInfo.name,
      icon: iconInfo.icon,
      iconSrc: iconInfo.iconSrc,
      iconSize: iconInfo.iconSize,
      tabs: SYNTHETIC_TABS.map((tab) => ({
        ...tab,
        example: tab.example.replace(/\{\{tool\}\}/g, iconInfo.name),
      })),
    };
  }

  function getDetail(toolId) {
    return TOOL_DETAILS[toolId] || synthesizeDetail(toolId);
  }

  const surface = document.getElementById("morphSurface");
  const backdrop = document.getElementById("morphBackdrop");
  const panel1 = document.getElementById("panel1");
  const panel2 = document.getElementById("panel2");
  const panel3 = document.getElementById("panel3");
  const panel4 = document.getElementById("panel4");
  const closeBtn = document.getElementById("closeBtn");
  const cancelBtn = document.getElementById("cancelBtn1");
  const backBtn2 = document.getElementById("backBtn2");
  const backBtn3 = document.getElementById("backBtn3");
  const backBtn4 = document.getElementById("backBtn4");
  const disconnectBtn3 = document.getElementById("disconnectBtn3");
  const connectNowBtn = panel2.querySelector(".slds-button_brand");

  // Connected tools — the single source of truth for every tile's
  // Add/Added state, persisted as a JSON array of ids. Any tile can be
  // toggled, so an "added" tool can be disconnected and a "setup" tool
  // connected; the set holds whatever is currently connected regardless
  // of how the tool shipped.
  //
  // Storage access is wrapped because it throws when unavailable
  // (private mode, disabled cookies, `file://`); an unguarded throw at
  // init would take down the modal on every surface. Same defensive
  // pattern home.js uses.
  const CONNECTED_KEY = "sh_tool_connections";

  // Defaults, used only when nothing is persisted yet: every tool that
  // shipped "added", plus a legacy ZoomInfo flag a prior build may have
  // left behind.
  function seedConnected() {
    const ids = config.tools
      .filter((t) => t.state === "added")
      .map((t) => t.id);
    try {
      if (window.sessionStorage.getItem("zoominfo_connected") === "true" &&
          ids.indexOf("zoominfo_lookup") === -1) {
        ids.push("zoominfo_lookup");
      }
    } catch (e) { /* ignore */ }
    return ids;
  }
  function readConnected() {
    try {
      const raw = window.sessionStorage.getItem(CONNECTED_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch (e) { /* fall through to defaults */ }
    return new Set(seedConnected());
  }
  function writeConnected() {
    try {
      window.sessionStorage.setItem(CONNECTED_KEY, JSON.stringify(Array.from(connectedTools)));
    } catch (e) { /* storage unavailable — state stays in-memory only */ }
  }
  const connectedTools = readConnected();

  function isToolConnected(id) {
    return connectedTools.has(id);
  }

  const ADDED_BADGE_HTML =
    '<span class="slds-badge slds-theme_default">' +
      '<span class="slds-badge__icon slds-badge__icon_left">' +
        '<span class="slds-icon_container slds-icon-utility-check slds-current-color">' +
          '<svg class="slds-icon slds-icon_xx-small" aria-hidden="true">' +
            '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#check"></use>' +
          '</svg>' +
        '</span>' +
      '</span>Added' +
    '</span>';

  const ADD_BADGE_HTML =
    '<span class="slds-badge slds-theme_info">' +
      '<span class="slds-badge__icon slds-badge__icon_left">' +
        '<span class="slds-icon_container slds-current-color">' +
          '<svg class="slds-icon slds-icon_xx-small" aria-hidden="true">' +
            '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#add"></use>' +
          '</svg>' +
        '</span>' +
      '</span>Add' +
    '</span>';

  // Flip a tool's badge between Add and Added everywhere it appears —
  // the modal's panel 1 grid AND the Tools-page grid behind it, so both
  // stay in sync after a connect. The featured promo banner is tied to
  // the featured tool and hides once it's connected.
  function setCardConnected(id, connected) {
    const cards = document.querySelectorAll('[data-tool-id="' + id.replace(/"/g, '\\"') + '"]');
    for (let i = 0; i < cards.length; i++) {
      if (!cards[i].classList.contains("tool-card")) continue; // skip the featured Setup button
      const actions = cards[i].querySelector(".tool-card-actions");
      if (actions) actions.innerHTML = connected ? ADDED_BADGE_HTML : ADD_BADGE_HTML;
    }
    if (id === FEATURED_ID) {
      const promo = panel1.querySelector(".tool-promo-banner-container");
      if (promo) promo.style.display = connected ? "none" : "";
    }
  }

  // Sync every tile to the current connected set on load — not just the
  // connected ones, since a tool that shipped "added" may have been
  // disconnected in a prior session and must render "Add".
  config.tools.forEach((t) => setCardConnected(t.id, connectedTools.has(t.id)));

  /** A panel's width, never wider than the viewport allows. */
  function widthFor(key) {
    return Math.min(PANEL_WIDTH[key], window.innerWidth - VIEWPORT_INSET_X);
  }

  /**
   * Clamp a measured height to the viewport. The panel's own
   * `max-height` already caps how tall its content renders; this keeps
   * the surface we size around it from exceeding the same bound, which
   * is what stops a tall panel from running off screen.
   */
  function capHeight(h) {
    return Math.min(h, window.innerHeight - VIEWPORT_INSET_Y);
  }

  // Panels are absolutely stacked and hidden, so their natural height
  // can't be read directly. Briefly make one relative at its target
  // width, read offsetHeight, then restore every property touched.
  function measurePanel(panel, width) {
    const prev = {
      opacity: panel.style.opacity,
      ariaHidden: panel.getAttribute("aria-hidden"),
      position: panel.style.position,
    };
    panel.style.opacity = "1";
    panel.setAttribute("aria-hidden", "false");
    panel.style.position = "relative";
    panel.style.width = width + "px";
    surface.style.width = width + "px";
    surface.style.height = "auto";
    const h = panel.offsetHeight;
    panel.style.position = prev.position || "";
    panel.style.width = "";
    panel.style.opacity = prev.opacity;
    panel.setAttribute("aria-hidden", prev.ariaHidden);
    return capHeight(h);
  }

  let panel1Height = measurePanel(panel1, widthFor("panel1"));
  let panel2Height = measurePanel(panel2, widthFor("panel2"));
  let panel3Height = measurePanel(panel3, widthFor("panel3"));
  let panel4Height = measurePanel(panel4, widthFor("panel4"));
  surface.style.width = widthFor("panel1") + "px";
  surface.style.height = panel1Height + "px";

  const morph = new MorphSurface(surface, {
    states: {
      panel1: { height: panel1Height, width: widthFor("panel1") },
      panel2: { height: panel2Height, width: widthFor("panel2") },
      panel3: { height: panel3Height, width: widthFor("panel3") },
      panel4: { height: panel4Height, width: widthFor("panel4") },
    },
    duration: 0.5,
    ease: "power2.inOut",
    fadeInDuration: 0.15,
    fadeInEase: "power2.out",
    fadeOutDuration: 0.15,
    fadeOutEase: "power2.in",
  });

  let currentPanel = "panel1";
  let lastFocused = null;

  // How the modal was opened, which decides what "Back" means:
  //   • false — opened on the grid (panel 1), the composer's "View all"
  //     path. A detail panel was reached BY navigating from the grid,
  //     so Back returns to it.
  //   • true  — opened straight onto a tool (a Tools-page tile, via
  //     openToolsModalForTool). The grid was never shown here — it's
  //     sitting on the page behind the modal — so there's nothing to go
  //     back to and Back closes instead.
  let openedDirect = false;

  const allPanels = { panel1, panel2, panel3, panel4 };

  // The panel sizes are measured once at init. If the viewport has
  // since changed — loaded wide, then narrowed before the modal was
  // ever opened, or rotated on a tablet — those cached widths and
  // heights are stale and the dialog would open at the wrong size or
  // overflow. Re-sync against the current viewport on every open.
  //
  // Only the two static panels are re-measured here; panel 3 and 4 are
  // populated from a clicked tool and measured at that point, so
  // measuring them now (empty) would be wrong. Their widths are still
  // refreshed so the eventual morph targets the right column.
  function syncToViewport() {
    morph.states.panel1.width = widthFor("panel1");
    morph.states.panel2.width = widthFor("panel2");
    morph.states.panel3.width = widthFor("panel3");
    morph.states.panel4.width = widthFor("panel4");

    panel1Height = measurePanel(panel1, widthFor("panel1"));
    panel2Height = measurePanel(panel2, widthFor("panel2"));
    morph.states.panel1.height = panel1Height;
    morph.states.panel2.height = panel2Height;

    if (currentPanel === "panel1") {
      surface.style.width = widthFor("panel1") + "px";
      surface.style.height = panel1Height + "px";
    }
  }

  function openModal() {
    lastFocused = document.activeElement;
    syncToViewport();
    modal.classList.add("slds-fade-in-open");
    backdrop.classList.add("slds-backdrop_open");
    window.setTimeout(function () { modal.focus(); }, 0);
  }

  function closeModal() {
    modal.classList.remove("slds-fade-in-open");
    backdrop.classList.remove("slds-backdrop_open");

    if (currentPanel !== "panel1") {
      resetToPanel1();
    }

    // Return focus to whatever opened the modal. The source dropped
    // focus to <body> here; restoring it matches the rest of this
    // project's dialogs (see bindConnectionsModal in home.js).
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    lastFocused = null;
  }

  function resetToPanel1() {
    morph.kill();
    for (const [key, el] of Object.entries(allPanels)) {
      if (key === "panel1") {
        gsap.set(el, { opacity: 1 });
        el.querySelectorAll(".morph-fade").forEach((f) => gsap.set(f, { opacity: 1 }));
        el.setAttribute("aria-hidden", "false");
      } else {
        gsap.set(el, { opacity: 0 });
        el.querySelectorAll(".morph-fade").forEach((f) => gsap.set(f, { opacity: 0 }));
        el.setAttribute("aria-hidden", "true");
      }
    }
    surface.style.width = widthFor("panel1") + "px";
    surface.style.height = panel1Height + "px";
    morph.currentState = "panel1";
    currentPanel = "panel1";
  }

  // Jump straight to a panel with no animation — used when the modal
  // opens directly onto a tool rather than the grid.
  function setToPanel(panelKey) {
    morph.kill();
    for (const [key, el] of Object.entries(allPanels)) {
      if (key === panelKey) {
        gsap.set(el, { opacity: 1 });
        el.querySelectorAll(".morph-fade").forEach((f) => gsap.set(f, { opacity: 1 }));
        el.setAttribute("aria-hidden", "false");
      } else {
        gsap.set(el, { opacity: 0 });
        el.querySelectorAll(".morph-fade").forEach((f) => gsap.set(f, { opacity: 0 }));
        el.setAttribute("aria-hidden", "true");
      }
    }
    const w = widthFor(panelKey);
    const h = morph.states[panelKey].height;
    surface.style.width = w + "px";
    surface.style.height = h + "px";
    morph.currentState = panelKey;
    currentPanel = panelKey;
  }

  function morphFromTo(fromKey, toKey) {
    if (currentPanel === toKey) return;
    const fromEl = allPanels[fromKey];
    const toEl = allPanels[toKey];
    currentPanel = toKey;

    // Incoming content stays transparent until the surface has finished
    // resizing, so text never reflows mid-morph.
    const fadeEls = toEl.querySelectorAll(".morph-fade");
    fadeEls.forEach((el) => gsap.set(el, { opacity: 0 }));
    toEl.setAttribute("aria-hidden", "false");

    morph.fadeOut(fromEl);
    morph.morphTo(toKey, {
      onComplete: () => {
        fromEl.setAttribute("aria-hidden", "true");
        fadeEls.forEach((el) => morph.fadeIn(el));
      },
    });
    morph.fadeIn(toEl);
  }

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  /**
   * Paint a detail panel's header icon. The source only ever wrote an
   * `xlink:href` onto a fixed `<use>`, which can't render the bitmap
   * logos the connection catalog supplies — so the whole puck is
   * rebuilt to match whichever source the card carries, using the same
   * two branches as the card grid in the template.
   *
   * @param {string} containerId  "panel3Icon" | "panel4Icon"
   * @param {object} data         Detail record with icon / iconSrc.
   */
  function setPanelIcon(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (data.iconSrc) {
      container.className = "tool-icon-container tool-icon-container_image";
      container.innerHTML =
        '<img class="tool-icon-img" src="' + esc(data.iconSrc) + '" alt="" />';
      return;
    }

    container.className = "tool-icon-container";
    container.innerHTML =
      '<svg class="slds-icon tool-icon-fill ' + esc(data.iconSize || "slds-icon_x-small") + '" aria-hidden="true">' +
        '<use xlink:href="' + esc(data.icon || "") + '"></use>' +
      '</svg>';
  }

  const SPARKLE_SVG =
    '<svg class="slds-icon slds-icon-text-default" style="fill:#FFF; width:10px; height:10px;" aria-hidden="true">' +
    '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#sparkle"></use>' +
    '</svg>';

  function buildToolMentionHtml(toolName) {
    return '<span class="tool-mention">' +
      '<span class="tool-mention-icon-container">' + SPARKLE_SVG + '</span>' +
      '<span class="tool-mention-label">' + esc(toolName) + '</span>' +
      '</span>';
  }

  // Renders the example sentence with the tool's own name swapped for
  // an inline pill, so the copy shows how the mention reads in context.
  function renderExampleWithBadge(text, toolName) {
    const idx = text.indexOf(toolName);
    if (idx === -1) return esc(text);
    return esc(text.slice(0, idx)) + buildToolMentionHtml(toolName) + esc(text.slice(idx + toolName.length));
  }

  function renderGrid(data, containerId) {
    const container = document.getElementById(containerId || "panel3Tabs");
    container.innerHTML = "";

    const tabs = data.tabs;
    if (!tabs.length) return;

    // Pill bar comes from the global ShTabNav component rather than
    // being hand-rolled here — the source repeated this loop in four
    // files. Same markup and classes, plus keyboard support.
    const nav = window.ShTabNav.build(
      tabs.map((tab) => ({ label: tab.label })),
      {
        className: "slds-m-bottom_small",
        onChange: (d) => showTab(d.index),
      }
    );
    container.appendChild(nav);

    const detail = document.createElement("div");
    detail.className = "slds-grid tool-detail-tabs__body";
    container.appendChild(detail);

    function showTab(index) {
      const tab = tabs[index];
      detail.innerHTML = '';

      const left = document.createElement("div");
      left.className = "slds-col slds-size_1-of-2 slds-p-vertical_medium slds-p-right_medium";
      left.innerHTML =
        '<p class="slash-suggestion-detail-title">Description</p>' +
        '<p class="slash-suggestion-detail-description">' + esc(tab.description || '') + '</p>' +
        '<p class="slash-suggestion-detail-title slds-m-top_small">Example</p>' +
        '<p class="slash-suggestion-detail-description">' + esc(tab.example) + '</p>';

      const right = document.createElement("div");
      right.className = "slds-col slds-size_1-of-2";
      const card = document.createElement("div");
      card.className = "use-case-try-card slds-box slds-theme_default";
      card.innerHTML =
        '<p class="slash-suggestion-detail-title">Try it out</p>' +
        '<div class="use-case-try-card__example slds-box slds-theme_default slds-m-vertical_small">' +
          renderExampleWithBadge(tab.example, data.name) +
        '</div>';
      const btn = document.createElement("button");
      btn.className = "slds-button slds-button_brand";
      btn.textContent = "Use";
      btn.addEventListener("click", () => {
        // `insertExampleBullet` is BB-AOP's editor hook and has no
        // counterpart here yet. Emit an event so a future consumer can
        // pick the example up, and close either way.
        if (typeof window.insertExampleBullet === "function") {
          window.insertExampleBullet(tab.example, data.name);
        } else {
          document.dispatchEvent(new CustomEvent("sh:tools-use-example", {
            detail: { example: tab.example, toolName: data.name },
          }));
        }
        closeModal();
      });
      card.appendChild(btn);
      right.appendChild(card);

      detail.appendChild(left);
      detail.appendChild(right);
    }

    showTab(0);
  }

  // The tool a Connect Now click will connect, and the tool whose
  // detail is currently shown (for Disconnect).
  let pendingConnectId = null;
  let currentDetailId = null;

  // Fill the connect panel (panel 2) for a specific tool: its logo,
  // "Connect <Tool>" title, and a templated blurb. Generalizes what was
  // hardcoded ZoomInfo markup so every "setup" tool gets the same
  // connect screen. Measures the panel afterward since its height now
  // varies with the tool name/description.
  function populateConnectPanel(toolId) {
    const info = TOOL_ICON_MAP[toolId];
    if (!info) return null;
    pendingConnectId = toolId;

    const logo = document.getElementById("panel2Logo");
    if (logo) logo.style.backgroundImage = info.iconSrc ? "url('" + info.iconSrc + "')" : "";
    const title = document.getElementById("panel2Title");
    if (title) title.textContent = "Connect " + info.name;
    const desc = document.getElementById("panel2Desc");
    if (desc) {
      desc.textContent =
        "Connect " + info.name + " to your CRM to eliminate data decay and give your " +
        "prospecting agent a real-time intelligence layer. Your agent will reference " +
        info.name + " to research, qualify, and enrich prospects.";
    }

    panel2.style.visibility = "hidden";
    panel2.style.width = widthFor("panel2") + "px";
    panel2.style.height = "auto";
    panel2.style.opacity = "1";
    panel2.setAttribute("aria-hidden", "false");
    panel2.style.position = "relative";

    panel2Height = capHeight(panel2.offsetHeight);

    panel2.style.position = "";
    panel2.style.visibility = "";
    panel2.style.height = "";
    panel2.style.width = "";
    panel2.style.opacity = "0";
    panel2.setAttribute("aria-hidden", "true");

    morph.states.panel2.height = panel2Height;
    return info;
  }

  function populateToolDetail(toolId) {
    const data = getDetail(toolId);
    if (!data) return null;

    currentDetailId = toolId;
    document.getElementById("panel3Title").textContent = data.name;
    setPanelIcon("panel3Icon", data);

    // Disconnect only makes sense for a tool connected through the flow
    // (in the set) — not for one that permanently shipped "added".
    disconnectBtn3.style.display = connectedTools.has(toolId) ? "" : "none";

    renderGrid(data);

    // Measure the freshly-populated panel so the morph animates to the
    // right height. Capped to the viewport so a long detail can scroll
    // rather than overflow the screen.
    panel3.style.visibility = "hidden";
    panel3.style.width = widthFor("panel3") + "px";
    panel3.style.height = "auto";
    panel3.style.opacity = "1";
    panel3.setAttribute("aria-hidden", "false");
    panel3.style.position = "relative";

    panel3Height = capHeight(panel3.offsetHeight);

    panel3.style.position = "";
    panel3.style.visibility = "";
    panel3.style.height = "";
    panel3.style.width = "";
    panel3.style.opacity = "0";
    panel3.setAttribute("aria-hidden", "true");

    morph.states.panel3.height = panel3Height;
    return data;
  }

  // Single router for a tool click. An unconnected "setup" tool goes to
  // the connect panel; a connected one goes to its detail (or the
  // conversations config). `animate` uses the morph (from within the
  // grid); when false it snaps (opening the modal straight onto a tool).
  function navigateToTool(toolId, animate) {
    const from = currentPanel;
    if (!isToolConnected(toolId)) {
      if (!populateConnectPanel(toolId)) return;
      if (animate) morphFromTo(from, "panel2"); else setToPanel("panel2");
      return;
    }
    if (TOOL_PANEL_TYPES[toolId] === "conversations") {
      if (!populateConversationsPanel(toolId)) return;
      if (animate) morphFromTo(from, "panel4"); else setToPanel("panel4");
    } else {
      if (!populateToolDetail(toolId)) return;
      if (animate) morphFromTo(from, "panel3"); else setToPanel("panel3");
    }
  }

  function populateConversationsPanel(toolId) {
    const data = getDetail(toolId);
    if (!data) return null;

    document.getElementById("panel4Title").textContent = data.name;
    setPanelIcon("panel4Icon", data);

    renderGrid(data, "panel4Tabs");

    // Reset horizontal tabs to first tab
    const nav = document.getElementById("panel4Nav");
    const tabItems = nav.querySelectorAll(".slds-tabs_default__item");
    const tabPanels = ["conv-panel-0", "conv-panel-1", "conv-panel-2"];
    tabItems.forEach((li, i) => {
      const link = li.querySelector("a");
      if (i === 0) {
        li.classList.add("slds-is-active");
        link.setAttribute("aria-selected", "true");
        link.setAttribute("tabindex", "0");
      } else {
        li.classList.remove("slds-is-active");
        link.setAttribute("aria-selected", "false");
        link.setAttribute("tabindex", "-1");
      }
    });
    tabPanels.forEach((id, i) => {
      const el = document.getElementById(id);
      el.classList.remove("slds-show", "slds-hide");
      el.classList.add(i === 0 ? "slds-show" : "slds-hide");
    });

    panel4.style.visibility = "hidden";
    panel4.style.width = widthFor("panel4") + "px";
    panel4.style.height = "auto";
    panel4.style.opacity = "1";
    panel4.setAttribute("aria-hidden", "false");
    panel4.style.position = "relative";

    panel4Height = capHeight(panel4.offsetHeight);

    panel4.style.position = "";
    panel4.style.visibility = "";
    panel4.style.height = "";
    panel4.style.width = "";
    panel4.style.opacity = "0";
    panel4.setAttribute("aria-hidden", "true");

    morph.states.panel4.height = panel4Height;
    return data;
  }

  document.getElementById("panel4Nav").addEventListener("click", (e) => {
    const link = e.target.closest(".slds-tabs_default__link");
    if (!link) return;
    e.preventDefault();
    const nav = document.getElementById("panel4Nav");
    const targetId = link.getAttribute("aria-controls");

    nav.querySelectorAll(".slds-tabs_default__item").forEach((li) => {
      const a = li.querySelector("a");
      const isTarget = a === link;
      li.classList.toggle("slds-is-active", isTarget);
      a.setAttribute("aria-selected", isTarget ? "true" : "false");
      a.setAttribute("tabindex", isTarget ? "0" : "-1");
    });

    ["conv-panel-0", "conv-panel-1", "conv-panel-2"].forEach((id) => {
      const el = document.getElementById(id);
      el.classList.remove("slds-show", "slds-hide");
      el.classList.add(id === targetId ? "slds-show" : "slds-hide");
    });

    // Tabs have different heights — resize the surface to match rather
    // than letting the shorter ones leave dead space. Capped like every
    // other measurement so a tall tab can't push the surface past the
    // viewport.
    panel4Height = capHeight(panel4.offsetHeight);
    morph.states.panel4.height = panel4Height;
    surface.style.height = panel4Height + "px";
  });

  // A click anywhere on a tile — badge included — opens the modal.
  // Connecting and disconnecting happen inside it (Connect Now on the
  // connect panel, Disconnect on the detail panel).
  panel1.addEventListener("click", (e) => {
    const card = e.target.closest("[data-tool-id]");
    if (!card || !panel1.contains(card)) return;
    const toolId = card.getAttribute("data-tool-id");
    if (toolId) navigateToTool(toolId, true);
  });

  // The composer's "View all" opens on the grid, so Back returns to it.
  window.openToolsModal = function () {
    openedDirect = false;
    openModal();
  };

  window.openToolsModalForTool = function (toolId) {
    openedDirect = true;

    // Open FIRST, then populate + jump. The populate helpers measure
    // their panel by briefly laying it out, and a panel inside a closed
    // modal (`display: none`) measures as 0 — which would size the
    // surface to nothing and the modal would open empty. Opening here
    // first gives the measurement a laid-out modal to read; the panel
    // swap that follows is synchronous, so panel 1 never paints.
    openModal();
    navigateToTool(toolId, false);
  };

  // Tiles rendered OUTSIDE the modal — the Tools page grid — open the
  // modal straight to the clicked tool. The modal's own panel-1 cards
  // are handled by the delegate above and are excluded here by the
  // `modal.contains` guard, so the two paths never both fire. Delegated
  // on document because these tiles live on a different part of the
  // page than the modal and may be re-rendered by the category filter.
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-tool-id]");
    if (!trigger || modal.contains(trigger)) return;
    const toolId = trigger.getAttribute("data-tool-id");
    if (!toolId) return;
    e.preventDefault();
    window.openToolsModalForTool(toolId);
  });

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);

  // Back returns to the grid when the modal was opened on it, but closes
  // when the modal was opened straight onto this tool (a Tools-page
  // tile) — there was no grid step to return to.
  function goBack(fromPanel) {
    if (openedDirect) closeModal();
    else morphFromTo(fromPanel, "panel1");
  }
  backBtn2.addEventListener("click", () => goBack("panel2"));
  backBtn3.addEventListener("click", () => goBack("panel3"));
  backBtn4.addEventListener("click", () => goBack("panel4"));

  // Panel 1 changes height when the featured promo is hidden or shown,
  // so its cached height has to be retaken after a connect/disconnect.
  function remeasurePanel1() {
    panel1.style.visibility = "hidden";
    panel1.style.width = widthFor("panel1") + "px";
    panel1.style.height = "auto";
    panel1.style.opacity = "1";
    panel1.setAttribute("aria-hidden", "false");
    panel1.style.position = "relative";

    panel1Height = capHeight(panel1.offsetHeight);

    panel1.style.position = "";
    panel1.style.visibility = "";
    panel1.style.height = "";
    panel1.style.width = "";
    panel1.style.opacity = "0";
    panel1.setAttribute("aria-hidden", "true");

    morph.states.panel1.height = panel1Height;
  }

  connectNowBtn.addEventListener("click", () => {
    const id = pendingConnectId;
    if (!id) return;
    connectedTools.add(id);
    writeConnected();
    setCardConnected(id, true);
    remeasurePanel1();
    // Land on the tool's detail — the conversations config for that
    // panel type, the generic detail otherwise.
    if (TOOL_PANEL_TYPES[id] === "conversations") {
      populateConversationsPanel(id);
      morphFromTo("panel2", "panel4");
    } else {
      populateToolDetail(id);
      morphFromTo("panel2", "panel3");
    }
  });

  disconnectBtn3.addEventListener("click", () => {
    const id = currentDetailId;
    if (!id) return;
    connectedTools.delete(id);
    writeConnected();
    setCardConnected(id, false);
    disconnectBtn3.style.display = "none";
    remeasurePanel1();
    // Same rule as Back: close when opened straight onto the tool
    // (Tools-page tile), else return to the grid.
    if (openedDirect) closeModal();
    else morphFromTo("panel3", "panel1");
  });

  // Filtering the grid changes how tall panel 1 is, and the morph
  // surface animates to a cached height — so the cache has to be
  // retaken and the surface resized whenever cards are shown or
  // hidden. tools_filter.js owns the filtering; this just reacts.
  panel1.addEventListener("sh:tools-filtered", () => {
    // remeasurePanel1 parks the panel hidden when it's done — fine when
    // called from the connect flow mid-morph, wrong here, where panel 1
    // is the panel the user is looking at. Put it back.
    remeasurePanel1();
    if (currentPanel !== "panel1") return;

    gsap.set(panel1, { opacity: 1 });
    panel1.querySelectorAll(".morph-fade").forEach((f) => gsap.set(f, { opacity: 1 }));
    panel1.setAttribute("aria-hidden", "false");

    // Animate to the new height rather than snapping, so switching
    // categories reads as the same surface resizing — the language the
    // rest of the dialog already speaks. Quicker than a panel change
    // because nothing is being replaced, only re-flowed.
    morph.morphTo("panel1", { duration: 0.25 });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("slds-fade-in-open")) {
      closeModal();
    }
  });

  // Any trigger on the page opts in with this attribute — the composer
  // footer's "View all" is the first one. Routed through the public
  // opener so it opens on the grid with Back set to return there.
  document.querySelectorAll("[data-sh-tools-open]").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      window.openToolsModal();
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
