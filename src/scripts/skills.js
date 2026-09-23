/**
 * Skills library page controller
 * =====================================================================
 * Drives /skills.html. Loaded from that page's {% block scripts_extra %}
 * alongside home.js, which owns the shared shell (left-nav collapse,
 * composer, persisted state) on every Seller Home surface.
 *
 * This lives in its own file rather than inside home.js — the prototype
 * this came from kept every surface's controller in one module, but the
 * shell script is shared by a dozen pages here, and the Skills page is
 * the only consumer of the ~1,000 lines below. Same reasoning as
 * learnings.js and tools_filter.js: a page-scoped controller, wired by
 * its own `data-sh-*` roots, that no-ops when those roots are absent.
 *
 * Four controllers, wired once by `bindSkills()`:
 *
 *   • Tab strip — a WAI-ARIA radiogroup (not tablist: the rows stay in
 *     place and only their visibility flips), with roving tabindex,
 *     Arrow/Home/End keyboard nav, `#tab=<id>` deep links synced both
 *     ways, live count pills, empty-state switching, and an aria-live
 *     announcement per switch.
 *   • Per-row overflow menu — single-open enforcement, Escape and
 *     outside-click dismissal, Arrow-Up/Down within the menu, and focus
 *     restored to the trigger on close.
 *   • Action router — routes `sh:skill-action` to the SLDS dialogs in
 *     _skills_dialogs.html (Edit / Schedule / Share open the shared
 *     placeholder; Duplicate clones the row; Delete confirms, then
 *     removes it). Every mutation is local DOM only: a reload restores
 *     the JSON-driven set, which is the intended prototype behavior.
 *
 * Row activation is left to the browser. Each row is a native <a>
 * pointing at /skill_detail.html?id=<id>, so Cmd-click, middle-click,
 * and Enter all work for free; the delegated handler only intercepts
 * `href="#"` rows to dispatch `sh:skill-open` instead of scrolling to
 * top.
 */
;(function () {
  function bindSkills (root) {
    var tabsRoot = root.querySelector('[data-sh-skills-tabs]')
    var gridRoot = root.querySelector('[data-sh-skill-grid]')
    var emptyTab = root.querySelector('[data-sh-skill-empty-tab]')
    var emptyFiltered = root.querySelector('[data-sh-skill-empty-filtered]')
    var statusRegion = root.querySelector('[data-sh-skills-status]')

    // Bail if the tab / grid DOM isn't fully rendered — a half-
    // hydrated shell is better ignored than crashed.
    if (!tabsRoot || !gridRoot) return

    var tabs = toArray(tabsRoot.querySelectorAll('[data-sh-skills-tab]'))
    if (!tabs.length) return

    // Build a per-tab ownership filter set once, at bind time —
    // cheaper than parsing the data-attribute on every switch and
    // shields us against a future re-render clobbering the attr.
    var tabOwnershipsById = {}
    tabs.forEach(function (tab) {
      var raw = tab.getAttribute('data-sh-skills-tab-ownerships') || ''
      // Empty string → empty list → "match all". Trim guards
      // against an authored trailing comma.
      var list = raw.split(',').map(function (s) { return s.trim() }).filter(function (s) { return s })
      var id = tab.getAttribute('data-sh-skills-tab')
      tabOwnershipsById[id] = list
    })

    // Which tab is active right now. Track independently of the
    // DOM so tab-click handlers can early-return on a no-op
    // reselect.
    var activeTabId = null
    tabs.some(function (tab) {
      if (tab.getAttribute('aria-checked') === 'true') {
        activeTabId = tab.getAttribute('data-sh-skills-tab')
        return true
      }
      return false
    })
    if (!activeTabId) {
      activeTabId = tabs[0].getAttribute('data-sh-skills-tab')
    }

    // Deep-linkable tab: `#tab=<id>` overrides the SSR default.
    // Read AFTER `activeTabId` is initialized so the paint-time
    // fallback is available if the hash names an unknown tab.
    var hashTabId = readTabFromHash()
    if (hashTabId && tabOwnershipsById[hashTabId] !== undefined) {
      activeTabId = hashTabId
    }

    // First paint: apply the resolved tab. `announce` is false so
    // we don't fire the aria-live region on load.
    activateTab(activeTabId, { announce: false, writeHash: false })

    tabsRoot.addEventListener('click', function (event) {
      var tab = closest(event.target, '[data-sh-skills-tab]')
      if (!tab || !tabsRoot.contains(tab)) return
      event.preventDefault()
      var nextId = tab.getAttribute('data-sh-skills-tab')
      if (nextId === activeTabId) return
      activateTab(nextId, { announce: true, writeHash: true, focusTab: true })
    })

    // Keyboard nav — WAI-ARIA radiogroup convention with
    // automatic activation. Same shape as bindScheduled.
    tabsRoot.addEventListener('keydown', function (event) {
      var currentIdx = tabs.indexOf(document.activeElement)
      if (currentIdx < 0) return

      var nextIdx = currentIdx
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIdx = (currentIdx + 1) % tabs.length
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIdx = (currentIdx - 1 + tabs.length) % tabs.length
          break
        case 'Home':
          nextIdx = 0
          break
        case 'End':
          nextIdx = tabs.length - 1
          break
        case ' ':
        case 'Spacebar':
        case 'Enter':
          event.preventDefault()
          activateTab(tabs[currentIdx].getAttribute('data-sh-skills-tab'),
            { announce: true, writeHash: true, focusTab: true })
          return
        default:
          return
      }
      event.preventDefault()
      activateTab(tabs[nextIdx].getAttribute('data-sh-skills-tab'),
        { announce: true, writeHash: true, focusTab: true })
    })

    // Browser Back / Forward: re-apply whatever tab the new hash
    // names. Guarded against feedback loops via the `activeTabId`
    // no-op check in `activateTab`.
    window.addEventListener('hashchange', function () {
      var id = readTabFromHash()
      if (id && tabOwnershipsById[id] !== undefined && id !== activeTabId) {
        activateTab(id, { announce: true, writeHash: false, focusTab: false })
      }
    })

    // ── SkillCard activation ──────────────────────────────────
    // The card body is a native <a>. `href` is "#" in the
    // prototype (no detail route yet), which the browser would
    // interpret as "scroll to top". Intercept the click, swallow
    // the default navigation, and dispatch `sh:skill-open` as a
    // stand-in event a future detail router can subscribe to.
    // Real hrefs (`skill.href` set in skills.json) fall through
    // untouched, so migrating any card to a real destination is a
    // one-line JSON edit.
    //
    // Delegated on `gridRoot` so runtime-added cards need no
    // per-card wiring. Only fires for the anchor itself — clicks
    // on the overflow trigger (sibling, `[data-sh-skill-menu-*]`)
    // don't bubble here because the trigger isn't a descendant of
    // any `[data-sh-skill-open]`.
    gridRoot.addEventListener('click', function (event) {
      var anchor = closest(event.target, '[data-sh-skill-open]')
      if (!anchor) return

      var href = anchor.getAttribute('href') || ''
      if (href === '#' || href === '' || href.charAt(0) === '#') {
        event.preventDefault()
        var item = closest(anchor, '[data-sh-skill-item]')
        var skillId = item ? item.getAttribute('data-sh-skill-id') : ''
        document.dispatchEvent(new CustomEvent('sh:skill-open', {
          detail: { skillId: skillId }
        }))
        // eslint-disable-next-line no-console
        console.info('[seller-home] skill open:', skillId || '(no id)')
      }
      // Real hrefs (starts with a path or absolute URL) fall
      // through — the browser navigates normally.
    })

    // Wire the overflow menu controller. Kept as a separate
    // controller because it has its own document-level listeners
    // (outside-click, keyboard) that shouldn't be re-registered
    // if bindSkills is ever re-invoked. Called once here.
    skillOverflowController(gridRoot)

    // Wire the overflow ACTION router (Edit / Schedule / Share /
    // Duplicate / Pause / Resume / Delete). The router subscribes
    // to `sh:skill-action` events emitted by the controller above,
    // and to `sh:skills-refresh` (re-runs tab counts + current-tab
    // filter after a card mutation).
    skillActionRouter(gridRoot)

    bindStatusChip(root)
    bindOwnershipChips(root)

    // Create Skill — navigate to the empty three-block canvas.
    // The button used to be a dead `data-sh-skills-create` hook;
    // the detail page now owns `?new=1` as the empty-state entry.
    var createBtn = root.querySelector('[data-sh-skills-create]')
    if (createBtn) {
      createBtn.addEventListener('click', function (event) {
        event.preventDefault()
        try {
          document.dispatchEvent(new CustomEvent('sh:skills-create', {
            detail: { source: 'landing' }
          }))
        } catch (_e) { /* CustomEvent unsupported? Skip. */ }
        window.location.href = window.SH.userUrl('/skill_detail.html?new=1')
      })
    }

    // Recompute the per-tab count pill values from the CURRENT
    // DOM. Called from the `sh:skills-refresh` handler below every
    // time the router adds or removes a card. Screen-reader
    // assistive text is refreshed alongside the visible count so
    // AT users hear the updated totals.
    function refreshTabCounts () {
      var liveCards = toArray(gridRoot.querySelectorAll('[data-sh-skill-item]'))
      tabs.forEach(function (tab) {
        var tabId = tab.getAttribute('data-sh-skills-tab')
        var ownerships = tabOwnershipsById[tabId] || []
        var count = 0
        liveCards.forEach(function (card) {
          var ownership = card.getAttribute('data-sh-skill-ownership') || ''
          if (ownerships.length === 0 || ownerships.indexOf(ownership) >= 0) count++
        })
        var pill = tab.querySelector('[data-sh-skills-tab-count]')
        if (pill) pill.textContent = String(count)
        var srText = tab.querySelector('.slds-assistive-text')
        if (srText) {
          srText.textContent = count + ' skill' + (count === 1 ? '' : 's')
        }
      })
    }

    // Refresh signal — the router fires this after any local
    // mutation (Duplicate adds, Delete removes). Recompute the
    // count pills and re-run the current tab's ownership filter
    // so newly-added / freshly-vanished cards land in the right
    // visibility bucket.
    document.addEventListener('sh:skills-refresh', function () {
      refreshTabCounts()
      applyFilters({ announce: false })
    })

    // Re-run the tab / ownership filter against the card list and
    // update visibility + empty-state + aria-live in one pass.
    // Called from activateTab() on every tab switch. The former
    // multi-facet variant (state + tools popover selections
    // combined with ownership by AND) was withdrawn 2026-07-31 in
    // favour of ownership-only filtering; card visibility is now
    // a single ownership check per card.
    //
    // Empty-state selection kept two-variant defensively —
    // `emptyFiltered` never fires today (no popover to activate
    // filters) but the branch is retained so reintroducing the
    // popover requires only re-adding the facet reads above the
    // `visible = ...` calculation, not a re-work of the visibility
    // + empty-state accounting.
    function applyFilters (opts) {
      opts = opts || {}
      var ownerships = tabOwnershipsById[activeTabId] || []

      // Re-query cards on every filter pass. The captured `cards`
      // array at binding time is stale after Duplicate (adds a
      // <li>) or Delete (removes one); a fresh nodeList costs one
      // DOM read and keeps counts / visibility honest without
      // needing a MutationObserver.
      var liveCards = toArray(gridRoot.querySelectorAll('[data-sh-skill-item]'))

      var visibleCount = 0
      var tabHasSkills = false
      liveCards.forEach(function (card) {
        var ownership = card.getAttribute('data-sh-skill-ownership') || ''
        var ownershipMatch = ownerships.length === 0 || ownerships.indexOf(ownership) >= 0

        if (ownershipMatch) tabHasSkills = true

        card.hidden = !ownershipMatch
        if (ownershipMatch) visibleCount++
      })

      // Empty-state selection:
      //   • tabHasSkills === false → tab has zero skills in the
      //     dataset (Shared with me on a fresh account). Render
      //     the authoring-oriented "tab" variant.
      //   • Otherwise + zero visible → unreachable today (no
      //     popover, no additional facets that can trim inside a
      //     non-empty tab). Kept wired so future filter facets
      //     drop in cleanly.
      var showTabEmpty = visibleCount === 0 && !tabHasSkills
      var showFilteredEmpty = visibleCount === 0 && tabHasSkills

      if (emptyTab) emptyTab.hidden = !showTabEmpty
      if (emptyFiltered) emptyFiltered.hidden = !showFilteredEmpty
      if (gridRoot) gridRoot.hidden = visibleCount === 0

      // Announce the new result count when a user gesture
      // triggered the recompute (not on first paint). Same
      // aria-live convention as bindScheduled — polite, atomic,
      // never fired on load.
      if (opts.announce && statusRegion) {
        var activeTab = tabs.filter(function (t) {
          return t.getAttribute('data-sh-skills-tab') === activeTabId
        })[0]
        statusRegion.textContent = skillsStatusText(visibleCount, activeTab)
      }
    }

    // ── Core activation routine ────────────────────────────────
    // Now a thin wrapper over `applyFilters` — the tab switch
    // updates ARIA state + active-tab class, then delegates the
    // card visibility + empty-state + announce work to the shared
    // filter runner so tab-switch and filter-change paths can't
    // fall out of sync.
    function activateTab (tabId, opts) {
      opts = opts || {}
      if (tabOwnershipsById[tabId] === undefined) return

      activeTabId = tabId

      // Your Skills (the first chip) is one column. Later chips use
      // the two-column grid.
      if (gridRoot.classList.contains('c-vf-cards')) {
        var firstTabId = tabs[0].getAttribute('data-sh-skills-tab')
        gridRoot.classList.toggle('c-vf-cards--single', tabId === firstTabId)
      }

      // Update tab visual + ARIA state. Roving tabindex per WAI-
      // ARIA — only the active tab is in the natural tab order.
      var activeTab = null
      tabs.forEach(function (tab) {
        var id = tab.getAttribute('data-sh-skills-tab')
        var isActive = id === tabId
        tab.classList.toggle('is-active', isActive)
        tab.setAttribute('aria-checked', isActive ? 'true' : 'false')
        tab.setAttribute('tabindex', isActive ? '0' : '-1')
        if (isActive) activeTab = tab
      })

      // Re-run every filter against the new tab. Bubble the
      // announce flag through so the tab-switch path fires the
      // aria-live region on user gestures but stays silent on
      // first paint + hashchange.
      applyFilters({ announce: !!opts.announce })

      // Move focus to the newly active tab when the switch came
      // from an intentional user gesture (click / keyboard). Skip
      // for hashchange + first-paint calls so we don't yank focus
      // during page navigation.
      if (opts.focusTab && activeTab) {
        activeTab.focus()
      }

      // URL hash sync — pushed via `location.hash =` on user
      // gestures so Back / Forward reach every state the user
      // visited. `hashchange` paths pass `writeHash: false` to
      // avoid re-write echoes.
      if (opts.writeHash) {
        var nextHash = '#tab=' + tabId
        if (location.hash !== nextHash) {
          location.hash = nextHash
        }
      }
    }

    // Read `?…#tab=<id>` → id, or null if not present. Duplicated
    // (not shared) with the Scheduled controller's helper because
    // the two functions live in different closures — extracting a
    // module-level helper is a Phase-8 refactor if the pattern
    // shows up on a third surface.
    function readTabFromHash () {
      var hash = (location.hash || '').replace(/^#/, '')
      if (!hash) return null
      var parts = hash.split('&')
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split('=')
        if (kv[0] === 'tab' && kv[1]) return decodeURIComponent(kv[1])
      }
      return null
    }
  }

  // aria-live phrasing for the Skills tab controller. Pure helper
  // so a future i18n phase can swap the string with an ICU /
  // MessageFormat runner. Picks up the active tab's visible label
  // so the announcement reads as "Showing 4 My Skills" (not "4
  // skills for tab id 'my_skills'").
  function skillsStatusText (count, activeTab) {
    var labelNode = activeTab && activeTab.querySelector('.seller-home__skills-tab-label')
    var label = labelNode ? (labelNode.textContent || '').trim() : ''
    if (count === 0) return 'No skills match this filter'
    return 'Showing ' + count + ' ' + (label ? label + ' ' : '') +
      'skill' + (count === 1 ? '' : 's')
  }

  // Per-card overflow menu controller for /skills.html. Structural
  // clone of `scheduledWorkflowOverflowController` — same open /
  // close / Escape / Arrow-Up / Arrow-Down / outside-click
  // semantics — with three Skills-specific concerns folded in:
  //
  //   1. `is-menu-open` class on the <li> wrapper. The chevron and
  //      overflow trigger are BOTH hidden by default and revealed
  //      via CSS on hover / focus-within of the <li>. When a menu
  //      opens the pointer often leaves the card briefly (to reach
  //      a menu item), which would collapse both affordances mid-
  //      interaction. Adding `is-menu-open` to the <li> keeps the
  //      reveal rules firing until the menu closes.
  //
  //   2. Card-activation isolation. The overflow trigger is a
  //      sibling of the card anchor (HTML forbids buttons inside
  //      <a>), so trigger clicks never bubble to the anchor
  //      NATURALLY — but the outside-click dismisser DOES fire on
  //      any document click. `[data-sh-skill-stop]` marks the
  //      whole menu subtree as an "inside" zone so that dismisser
  //      no-ops on trigger / item clicks.
  //
  //   3. Action dispatch. Menu-item clicks emit `sh:skill-action`
  //      with `{ action, skillId }`; a future action-router (or a
  //      confirmation modal for delete, etc.) subscribes without
  //      needing to know about the menu's internal state.
  //
  // State: single-open menu enforced via the `openMenu` /
  // `openTrigger` pair — opening a second menu closes the first,
  // matching SLDS' one-menu-at-a-time convention.
  function skillOverflowController (gridRoot) {
    var openMenu = null
    var openTrigger = null

    function setMenuState (trigger, menu, isOpen) {
      menu.hidden = !isOpen
      menu.classList.toggle('is-open', isOpen)
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false')

      // Toggle `is-menu-open` on the <li> so the CSS reveal for
      // chevron + trigger keeps firing while the menu is open.
      // `closest` is null-safe — a defensive guard against a
      // future markup churn that moves the trigger outside the
      // <li>.
      var item = closest(trigger, '[data-sh-skill-item]')
      if (item) item.classList.toggle('is-menu-open', isOpen)

      if (isOpen) {
        openMenu = menu
        openTrigger = trigger
      } else if (openMenu === menu) {
        openMenu = null
        openTrigger = null
      }
    }

    function closeOpenMenu (returnFocus) {
      if (!openMenu) return
      var trigger = openTrigger
      setMenuState(openTrigger, openMenu, false)
      if (returnFocus && trigger) trigger.focus()
    }

    gridRoot.addEventListener('click', function (event) {
      // Trigger click → toggle the menu. Sibling-of-anchor, so
      // trigger clicks don't bubble to the anchor at all (no
      // stopPropagation needed to protect card activation), but
      // we DO want them to NOT reach the outside-click dismisser
      // below — the `[data-sh-skill-stop]` container handles that.
      var trigger = closest(event.target, '[data-sh-skill-menu-trigger]')
      if (trigger) {
        event.preventDefault()

        var container = closest(trigger, '[data-sh-skill-menu]')
        var menu = container && container.querySelector('[data-sh-skill-menu-list]')
        if (!menu) return

        var willOpen = menu.hidden
        // Enforce single-open: close any other card's menu first.
        if (openMenu && openMenu !== menu) closeOpenMenu(false)
        setMenuState(trigger, menu, willOpen)

        // On open, focus the first menu item so keyboard users
        // land INSIDE the menu (matches SLDS 2 menu UX). No focus
        // move on close.
        if (willOpen) {
          var first = menu.querySelector('[data-sh-skill-action]')
          if (first) first.focus()
        }
        return
      }

      // Action click → dispatch, then close. `skillId` is read
      // from the <li> wrapper (not the anchor) so unlinked cards
      // still emit a correct id if a future revision adds
      // overflow menus to them too.
      var actionBtn = closest(event.target, '[data-sh-skill-action]')
      if (!actionBtn) return

      event.preventDefault()

      var actionId = actionBtn.getAttribute('data-sh-skill-action')
      var item = closest(actionBtn, '[data-sh-skill-item]')
      var skillId = item ? item.getAttribute('data-sh-skill-id') : ''

      // Capture the trigger BEFORE we close the menu — closing
      // clears `openTrigger`, and we still need it as the focus
      // fallback target if the action doesn't open a modal.
      //
      // Falls back to the clicked control itself for action buttons
      // that are NOT menu items — Version B's "Use Skill" button
      // carries this same hook while no menu is open, so `openTrigger`
      // is null there and a modal opened from it would have nowhere to
      // return focus on dismiss.
      var restoreTarget = openTrigger || actionBtn

      // Close FIRST, then dispatch. Restoring focus to the
      // trigger is the sensible default per the SkillCard spec
      // ("Restore focus to the overflow trigger after closing");
      // any action that opens a modal simply steals focus in its
      // own handler, superseding the trigger focus. That's a
      // cleaner contract than trying to guess here which actions
      // want to preserve trigger focus and which don't.
      closeOpenMenu(false)
      if (restoreTarget && typeof restoreTarget.focus === 'function') {
        restoreTarget.focus()
      }

      document.dispatchEvent(new CustomEvent('sh:skill-action', {
        detail: {
          action:  actionId,
          skillId: skillId,
          // Expose the trigger so action handlers (delete confirm
          // in particular) can restore focus after the trailing
          // modal dismisses. Kept optional — subscribers that
          // don't care don't have to inspect it.
          trigger: restoreTarget
        }
      }))
      // eslint-disable-next-line no-console
      console.info('[seller-home] skill action:', actionId,
        skillId ? '(' + skillId + ')' : '')
    })

    // Keyboard nav inside the open menu — same contract Scheduled
    // uses. Only engages when a menu is open; otherwise every
    // ArrowDown press on the page would cost a lookup.
    gridRoot.addEventListener('keydown', function (event) {
      if (!openMenu) return

      if (event.key === 'Escape') {
        event.preventDefault()
        closeOpenMenu(true)
        return
      }

      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (!openMenu.contains(document.activeElement) &&
          openTrigger !== document.activeElement) return

      var items = toArray(openMenu.querySelectorAll('[data-sh-skill-action]'))
      if (!items.length) return
      event.preventDefault()
      var idx = items.indexOf(document.activeElement)
      var nextIdx
      if (idx < 0) {
        nextIdx = event.key === 'ArrowDown' ? 0 : items.length - 1
      } else {
        nextIdx = event.key === 'ArrowDown'
          ? (idx + 1) % items.length
          : (idx - 1 + items.length) % items.length
      }
      items[nextIdx].focus()
    })

    // Outside-click dismiss. Cheap document-level listener guarded
    // by `!openMenu` so it no-ops when nothing is open. Clicks
    // inside the menu container (`[data-sh-skill-stop]`) are
    // treated as "inside" — that covers trigger + list + item
    // clicks with one selector.
    document.addEventListener('click', function (event) {
      if (!openMenu) return
      var inside = closest(event.target, '[data-sh-skill-stop]')
      if (inside && inside.contains(openMenu)) return
      closeOpenMenu(false)
    })
  }

  // ── Skills page — overflow action router + dialogs ─────────────
  //
  // Subscribes to `sh:skill-action` (emitted by the overflow menu
  // controller above) and routes each action to a small handler:
  //
  //   edit / schedule / share  → placeholder SLDS 2 modal, body
  //                              copy per-action
  //   duplicate                → deep-clone the <li>, append
  //                              "Copy" to the name, new id
  //   delete                   → destructive SLDS 2 modal; confirm
  //                              removes the <li> from the grid
  //
  // Historical note: Pause / Resume used to live in this switch as
  // well, mutating the card between running / paused / idle. Both
  // were removed on 2026-08-03 as part of the Skill / RecentChat
  // split — pausing a SKILL doesn't mean anything; the run-state
  // transitions belong to RecentChat (see recent_chats.json).
  //
  // Every mutating handler works ENTIRELY against the local DOM —
  // no backend calls, no `fetch()`, no `sessionStorage` — matching
  // the "Do not call backend services or imply that prototype
  // changes are persisted remotely" clause of the spec. A page
  // reload restores the original JSON-driven skill set, which is
  // the intended prototype behavior.
  //
  // The single-router / single-subscription pattern is intentional:
  // adding another action is a switch-case edit, and unsubscribing
  // is never needed because the router lives for the page lifetime.
  function skillActionRouter (gridRoot) {
    // Copy for `Duplicate` — synthesizes a suffix + new id. Kept
    // pointer-local so repeated duplicates never collide even
    // within a single session ("skill-name Copy", "skill-name
    // Copy 2", …).
    var duplicateCounter = 0

    // Placeholder-dialog body copy per action. One modal serves
    // Edit / Schedule / Share — the router writes the right title
    // + body into the modal at open time. Copy is intentionally
    // spare so real dialogs can slot in later without a stylesheet
    // shift.
    var placeholderCopy = {
      edit: {
        title: 'Edit skill',
        body:  'The skill editor will open here. This prototype doesn\u2019t ship the editor yet.'
      },
      schedule: {
        title: 'Schedule skill',
        body:  'The scheduling dialog will open here. This prototype doesn\u2019t ship scheduling yet.'
      },
      share: {
        title: 'Share skill',
        body:  'The share sheet will open here. This prototype doesn\u2019t ship sharing yet.'
      },
      // Version B's "Use Skill" button (Figma 11194:24333). Same copy
      // shape as the others, and the same reason: no chat surface
      // consumes a skill hand-off yet. See the `use_in_chat` case for
      // what ships alongside this dialog.
      use_in_chat: {
        title: 'Use skill',
        body:  'This skill will open in a new conversation with the skill attached. This prototype doesn\u2019t ship that hand-off yet.'
      }
    }

    document.addEventListener('sh:skill-action', function (event) {
      var detail = event.detail || {}
      var action = detail.action
      var skillId = detail.skillId
      var trigger = detail.trigger || null
      var item = skillId
        ? gridRoot.querySelector('[data-sh-skill-item][data-sh-skill-id="' + cssEscape(skillId) + '"]')
        : null
      if (!item) return

      switch (action) {
        case 'edit':
        case 'schedule':
        case 'share':
          openPlaceholderDialog(placeholderCopy[action], trigger)
          break
        // Version B's "Use Skill" button. Unlike the cases above this
        // one is NOT an overflow item — it is a button in the card's
        // action cluster carrying the same `data-sh-skill-action` hook,
        // so it arrives here through the same delegated path.
        //
        // Fires the semantic event FIRST so a future consumer can open
        // a real conversation with the skill attached without touching
        // this file, then falls back to the labeled placeholder. That
        // is the same two-step /skill_detail.html's own "Use in Chat"
        // button performs (see `wireUseInChat` in skill_detail.js) —
        // deliberately, so both surfaces behave identically and both
        // flip to the real navigation in one place each. A silent
        // navigation to a surface that ignores the skill would leave
        // the seller with no sign the hand-off worked.
        case 'use_in_chat':
          try {
            document.dispatchEvent(new CustomEvent('sh:skill-use-in-chat', {
              detail: { skillId: skillId }
            }))
          } catch (_e) { /* CustomEvent unsupported? Skip. */ }
          openPlaceholderDialog(placeholderCopy.use_in_chat, trigger)
          break
        case 'duplicate':
          duplicateSkillItem(item)
          break
        case 'delete':
          openDeleteDialog(item, trigger)
          break
        // NOTE: no `pause` / `resume` cases. Skill has no run
        // state, so pausing / resuming a Skill isn't a coherent
        // operation. When a RecentChat renderer lands, it will
        // own its own action router with those verbs. Do NOT
        // reintroduce pause / resume here without also
        // reintroducing the run-state fields on Skill — the two
        // pieces are load-bearing together.
      }
    })

    // ── Mutating helpers ──────────────────────────────────────────

    // Duplicate: deep-clone the <li>, freshen its skill id, append
    // a "Copy" suffix to the visible title. Inserts AFTER the
    // source so the duplicate reads as a sibling below the
    // original. Every clone gets a unique id so future selectors
    // (`sh:skill-action` targeting, tab counts, etc.) address the
    // right node.
    function duplicateSkillItem (source) {
      var clone = source.cloneNode(true)

      duplicateCounter += 1
      var srcId = source.getAttribute('data-sh-skill-id') || 'skill'
      var newId = srcId + '-copy-' + duplicateCounter
      clone.setAttribute('data-sh-skill-id', newId)

      // Re-key the menu container's id so the trigger's
      // aria-controls / menu id namespace still line up on the
      // clone. Belt-and-suspenders: even if two clones ended up
      // with identical ids, the menu would still open on click —
      // this is purely a11y hygiene.
      var menuList = clone.querySelector('[data-sh-skill-menu-list]')
      if (menuList) menuList.id = 'skill-' + newId + '-menu'
      var trigger = clone.querySelector('[data-sh-skill-menu-trigger]')
      if (trigger) trigger.setAttribute('aria-controls', 'skill-' + newId + '-menu')

      // Suffix the visible title AND the accessible-name attributes
      // that expose it (anchor's aria-label, description tooltip
      // stays as-is since it describes the SKILL not the title).
      var titleEl = clone.querySelector('.seller-home__skill-title')
      var newName = titleEl && titleEl.textContent
        ? (titleEl.textContent.trim() + ' Copy')
        : 'Skill Copy'
      if (titleEl) titleEl.textContent = newName

      var anchor = clone.querySelector('[data-sh-skill-open]')
      if (anchor) {
        // aria-label is always plain "Open skill, {name}" — there
        // is no state fragment to append. See the Skill /
        // RecentChat split note in `_skill_card_grid.html`.
        anchor.setAttribute('aria-label', 'Open skill, ' + newName)
      }
      var moreBtn = clone.querySelector('[data-sh-skill-menu-trigger]')
      if (moreBtn) moreBtn.setAttribute('aria-label', 'More actions for ' + newName)

      // Reset any interaction state that came along with the deep
      // clone — open menu is the only class we know can leak.
      clone.classList.remove('is-menu-open')

      // Ensure the menu's open state is reset on the clone.
      if (menuList) {
        menuList.hidden = true
        menuList.classList.remove('is-open')
      }
      if (trigger) trigger.setAttribute('aria-expanded', 'false')

      // Insert AFTER the source. `insertBefore` with `nextSibling`
      // handles the "source is the last child" case naturally
      // (nextSibling is null → appendChild-equivalent behavior).
      source.parentNode.insertBefore(clone, source.nextSibling)

      // Tab counts on the toolbar are computed from visible cards.
      // Refresh them + the current tab filter so the new clone
      // shows up under the right count and respects the current
      // selection.
      dispatchSkillsRefresh()
    }

    // Fire a `sh:skills-refresh` event that bindSkills subscribes
    // to. Keeps the router decoupled from the tab / filter
    // controller — the caller doesn't need to know that a refresh
    // happens to be `applyFilters()` internally.
    function dispatchSkillsRefresh () {
      document.dispatchEvent(new CustomEvent('sh:skills-refresh'))
    }

    // ── Dialogs ───────────────────────────────────────────────────
    // Both dialogs share the same open / close primitives; they
    // differ only in title / body copy and confirm behavior. The
    // primitives assume the SLDS 2 shell defined in
    // _skills_dialogs.html: `.slds-hide` toggles visibility, and
    // `.slds-fade-in-open` on the modal + `.slds-backdrop_open` on
    // the backdrop drive the fade.

    function openDialog (modalId, backdropId, initialFocusTarget) {
      var modal = document.getElementById(modalId)
      var backdrop = document.getElementById(backdropId)
      if (!modal || !backdrop) return null

      modal.classList.remove('slds-hide')
      modal.classList.add('slds-fade-in-open')
      backdrop.classList.remove('slds-hide')
      backdrop.classList.add('slds-backdrop_open')

      // Initial focus. If a specific element is requested (e.g.
      // Cancel button on the delete dialog), focus that; else fall
      // back to the dialog itself so screen readers hear the
      // aria-labelledby content on open.
      if (initialFocusTarget && typeof initialFocusTarget.focus === 'function') {
        initialFocusTarget.focus()
      } else if (typeof modal.focus === 'function') {
        modal.focus()
      }
      return modal
    }

    function closeDialog (modalId, backdropId, returnFocusTo) {
      var modal = document.getElementById(modalId)
      var backdrop = document.getElementById(backdropId)
      if (modal) {
        modal.classList.add('slds-hide')
        modal.classList.remove('slds-fade-in-open')
      }
      if (backdrop) {
        backdrop.classList.add('slds-hide')
        backdrop.classList.remove('slds-backdrop_open')
      }
      if (returnFocusTo && typeof returnFocusTo.focus === 'function') {
        returnFocusTo.focus()
      }
    }

    function openPlaceholderDialog (copy, returnFocusTo) {
      var titleEl = document.querySelector('[data-sh-skills-placeholder-title]')
      var bodyEl = document.querySelector('[data-sh-skills-placeholder-body]')
      if (titleEl) titleEl.textContent = copy.title
      if (bodyEl) bodyEl.textContent = copy.body

      openDialog('skills-placeholder-modal', 'skills-placeholder-backdrop', null)

      // Close-on-anything is wired via the delegated handler
      // below. Remember the trigger so Escape / X / Close all
      // restore focus to the overflow trigger.
      currentDialogTrigger = returnFocusTo || null
    }

    function openDeleteDialog (item, returnFocusTo) {
      currentDialogTrigger = returnFocusTo || null
      currentDeleteTarget = item

      // Focus the Cancel button by default (per spec: destructive
      // Enter-press safety). Delete button lives one tab away.
      var cancelBtn = document.querySelector(
        '#skills-delete-modal [data-sh-skills-dialog-close].slds-button_neutral'
      )
      openDialog('skills-delete-modal', 'skills-delete-backdrop', cancelBtn)
    }

    // Confirmed delete — pops the <li> from the grid, refreshes
    // tab counts / current-tab filter, closes the dialog. Focus
    // goes back to the next sibling card if one exists, else the
    // toolbar, else the trigger (which is now attached to a
    // detached DOM subtree; still safe to focus during teardown).
    function confirmDelete () {
      if (!currentDeleteTarget) return closeDialog('skills-delete-modal', 'skills-delete-backdrop', null)

      var nextSibling = currentDeleteTarget.nextElementSibling
      var prevSibling = currentDeleteTarget.previousElementSibling
      var refocusTarget = null
      if (nextSibling) refocusTarget = nextSibling.querySelector('[data-sh-skill-open]')
      if (!refocusTarget && prevSibling) refocusTarget = prevSibling.querySelector('[data-sh-skill-open]')

      var parent = currentDeleteTarget.parentNode
      if (parent) parent.removeChild(currentDeleteTarget)

      // Reset router state.
      currentDeleteTarget = null

      // Refresh tab-count + current-tab visibility so the deleted
      // card doesn't leave stale counts behind.
      dispatchSkillsRefresh()

      closeDialog('skills-delete-modal', 'skills-delete-backdrop', refocusTarget)
    }

    // Router-scoped state — set at dialog-open, read at dialog-
    // close. Kept as closure locals rather than module-scope so a
    // future multi-page prototype could re-instantiate the router
    // per page without cross-talk.
    var currentDialogTrigger = null
    var currentDeleteTarget = null

    // Delegated dialog handlers. One listener at document level
    // covers every dismiss control and the destructive-confirm.
    document.addEventListener('click', function (event) {
      var confirmBtn = closest(event.target, '[data-sh-skills-delete-confirm]')
      if (confirmBtn) {
        event.preventDefault()
        confirmDelete()
        return
      }

      var closeBtn = closest(event.target, '[data-sh-skills-dialog-close]')
      if (!closeBtn) return

      event.preventDefault()
      var modalHost = closest(closeBtn, '[data-sh-skills-dialog]')
      var kind = modalHost && modalHost.getAttribute('data-sh-skills-dialog')
      if (kind === 'delete') {
        currentDeleteTarget = null
        closeDialog('skills-delete-modal', 'skills-delete-backdrop', currentDialogTrigger)
      } else if (kind === 'placeholder') {
        closeDialog('skills-placeholder-modal', 'skills-placeholder-backdrop', currentDialogTrigger)
      }
      currentDialogTrigger = null
    })

    // Escape dismisses whichever dialog is open. Guarded to no-op
    // when no dialog is showing (`slds-hide` present on both), so
    // the plain `Escape` press elsewhere on the page still works.
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' && event.key !== 'Esc') return
      var placeholder = document.getElementById('skills-placeholder-modal')
      var deleteM = document.getElementById('skills-delete-modal')
      if (placeholder && !placeholder.classList.contains('slds-hide')) {
        event.preventDefault()
        closeDialog('skills-placeholder-modal', 'skills-placeholder-backdrop', currentDialogTrigger)
        currentDialogTrigger = null
      } else if (deleteM && !deleteM.classList.contains('slds-hide')) {
        event.preventDefault()
        currentDeleteTarget = null
        closeDialog('skills-delete-modal', 'skills-delete-backdrop', currentDialogTrigger)
        currentDialogTrigger = null
      }
    })

    // Backdrop click closes the dialog (SLDS 2 convention — the
    // backdrop is a click target, not just visual dimming).
    document.addEventListener('click', function (event) {
      var backdrop = closest(event.target, '[data-sh-skills-dialog-backdrop]')
      if (!backdrop) return
      var kind = backdrop.getAttribute('data-sh-skills-dialog-backdrop')
      if (kind === 'delete') {
        currentDeleteTarget = null
        closeDialog('skills-delete-modal', 'skills-delete-backdrop', currentDialogTrigger)
      } else if (kind === 'placeholder') {
        closeDialog('skills-placeholder-modal', 'skills-placeholder-backdrop', currentDialogTrigger)
      }
      currentDialogTrigger = null
    })

    // Focus-trap: wrap Tab / Shift+Tab inside the open dialog so a
    // keyboard user can't tab out to the browser chrome or the page
    // behind the backdrop while a modal is active. Minimal shape —
    // reads focusable descendants at each keypress rather than
    // caching, so a future dynamic modal body (e.g. a form the
    // placeholder dialog renders) needs no wiring changes.
    //
    // Runs BEFORE the browser applies its default Tab behavior; if
    // focus is anywhere inside the modal but on an element that
    // isn't first/last, we no-op and let the browser advance focus
    // naturally.
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab') return
      var openModal = getOpenSkillsDialog()
      if (!openModal) return

      var focusables = toArray(openModal.querySelectorAll(
        'a[href], area[href], button:not([disabled]), input:not([disabled]),' +
        ' select:not([disabled]), textarea:not([disabled]),' +
        ' [tabindex]:not([tabindex="-1"])'
      )).filter(function (el) {
        // Skip elements hidden via CSS or `hidden` attribute; those
        // aren't in the natural tab order and would trap focus on a
        // dead node.
        return !el.hasAttribute('hidden') &&
          el.offsetWidth > 0 && el.offsetHeight > 0
      })
      if (!focusables.length) return

      var first = focusables[0]
      var last = focusables[focusables.length - 1]
      var active = document.activeElement

      if (event.shiftKey && (active === first || !openModal.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !openModal.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    })

    // Return whichever dialog is currently visible, else null. Only
    // one is ever open at a time so a simple ternary suffices.
    function getOpenSkillsDialog () {
      var placeholder = document.getElementById('skills-placeholder-modal')
      var deleteM = document.getElementById('skills-delete-modal')
      if (placeholder && !placeholder.classList.contains('slds-hide')) return placeholder
      if (deleteM && !deleteM.classList.contains('slds-hide')) return deleteM
      return null
    }

    // ── Utilities ────────────────────────────────────────────────
    // NOTE: A `capitalize()` helper used to live here — it existed
    // solely to build the state fragment in the anchor's aria-label
    // ("Open skill, NAME, State"). That fragment is gone (see the
    // Skill / RecentChat split), and no other code path in this
    // controller needed the helper, so it was removed 2026-08-03.

    // Minimal CSS.escape polyfill for skill ids. IDs come from
    // JSON authorship (safe subset of ASCII), but a stray hyphen +
    // digit combination or a numeric-prefixed id would trip a
    // plain-string selector. `CSS.escape` handles both; the
    // fallback covers the (rare) execution paths where it's
    // missing (IE-family fossils; not a real production target
    // here but cheap defensive coverage).
    function cssEscape (s) {
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(s)
      }
      return String(s).replace(/([\0-\x1f\x7f]|^-?\d)|([\x80-\uFFFF]|[\-_a-zA-Z0-9])/g,
        function (m, p1) { return p1 ? '\\' + m : m })
    }
  }

  // Shared with me / Owned by me toggle between the blue chip and the
  // plain filter button. No filtering yet.
  function bindOwnershipChips (root) {
    var chips = root.querySelectorAll('[data-sh-ownership-chip]')
    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener('click', function () {
        var selected = chip.classList.contains('c-ve-chip')
        chip.classList.toggle('c-ve-chip', !selected)
        chip.classList.toggle('c-ve-filter-btn', selected)
        chip.setAttribute('aria-pressed', selected ? 'false' : 'true')
      })
    })
  }

  // Status starts as the filter button. Picking a statusLibrary label
  // swaps it for the blue chip; the close control puts the button back.
  function bindStatusChip (root) {
    var host = root.querySelector('[data-sh-status-filter]')
    var sortHost = root.querySelector('[data-sh-sort-filter]')
    var btn = host && host.querySelector('[data-sh-status-btn]')
    var chip = host && host.querySelector('[data-sh-status-chip]')
    var label = host && host.querySelector('[data-sh-status-chip-label]')
    var statusMenu = host && host.querySelector('[data-sh-status-menu]')
    var sortBtn = sortHost && sortHost.querySelector('[data-sh-sort-btn]')
    var sortMenu = sortHost && sortHost.querySelector('[data-sh-sort-menu]')

    function setMenu (menu, trigger, open) {
      if (!menu) return
      menu.hidden = !open
      if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false')
    }

    function closeMenus () {
      setMenu(statusMenu, btn, false)
      setMenu(sortMenu, sortBtn, false)
    }

    if (host) {
      host.addEventListener('click', function (event) {
        var option = closest(event.target, '[data-sh-status-option]')
        if (option && host.contains(option)) {
          event.preventDefault()
          var next = option.getAttribute('data-status-label') || option.textContent.trim()
          if (label) label.textContent = next
          if (btn) btn.hidden = true
          if (chip) {
            chip.hidden = false
            chip.focus()
          }
          closeMenus()
          return
        }

        var clear = closest(event.target, '[data-sh-status-clear]')
        if (clear && host.contains(clear)) {
          event.preventDefault()
          if (chip) chip.hidden = true
          if (btn) {
            btn.hidden = false
            btn.focus()
          }
          return
        }

        if (btn && (event.target === btn || btn.contains(event.target))) {
          event.preventDefault()
          var willOpen = statusMenu && statusMenu.hidden
          closeMenus()
          setMenu(statusMenu, btn, !!willOpen)
        }
      })
    }

    if (sortHost && sortBtn) {
      sortHost.addEventListener('click', function (event) {
        if (event.target !== sortBtn && !sortBtn.contains(event.target)) return
        event.preventDefault()
        var willOpen = sortMenu && sortMenu.hidden
        closeMenus()
        setMenu(sortMenu, sortBtn, !!willOpen)
      })
    }

    document.addEventListener('click', function (event) {
      if (host && host.contains(event.target)) return
      if (sortHost && sortHost.contains(event.target)) return
      closeMenus()
    })
  }

  // ── Utils ─────────────────────────────────────────────────────────
  // Older browsers' NodeList#forEach and Element#closest are fine
  // in every target browser this app supports, but keeping wrappers
  // makes the intent obvious and removes one place to remember
  // when polyfill-checking new-browser features.
  function toArray (nodeList) { return Array.prototype.slice.call(nodeList) }
  function closest (node, selector) {
    return node && node.closest ? node.closest(selector) : null
  }

  // ── Boot ──────────────────────────────────────────────────────────
  // Everything hangs off `[data-sh-skills-root]`, which only
  // /skills.html renders. The detail page carries its own root and its
  // own controller (skill_detail.js), so this exits immediately there
  // even though both pages ship the dialogs partial.
  function init () {
    var skillsRoot = document.querySelector('[data-sh-skills-root]')
    if (!skillsRoot) return
    bindSkills(skillsRoot)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
