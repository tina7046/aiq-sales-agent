// ──────────────────────────────────────────────────────────────────────
// Seller Home — client-side behavior
// =====================================================================
// Owned by /home.html. Loaded from that page's {% block scripts_extra %}.
//
// Responsibilities today:
//   • Phase 1: left-nav collapse toggle (persisted to localStorage).
//   • Phase 2: Daily Briefing link activation — records which topic
//     the seller selected so a future phase can open the matching
//     detail pane. Uses event delegation on the briefing root so
//     the handler cost is constant regardless of how many links land
//     in the sentence.
//   • Phase 3: Chat composer — textarea autosize (up to a 8-line
//     max), Send-button empty-state toggle, Enter-to-submit +
//     Shift+Enter-for-newline keybinds, submit-to-local-mock-state
//     with a `sh:composer-submit` CustomEvent hook for future chat
//     services. Attachment upload and voice recording are OUT of
//     scope for Phase 3 — the Add / Voice / Quick action / Skills
//     buttons dispatch a generic `sh:composer-action` event so a
//     future phase can bind file-picker / MediaRecorder handlers
//     without touching this file.
//   • Phase 4: Ready to Review + Tasks — tablist (WAI-ARIA "tabs
//     with automatic activation": Left/Right + Home/End keyboard
//     nav, roving tabindex, panels toggled via the `hidden`
//     attribute), an inline overflow menu (Escape / click-outside
//     close, Arrow-Up/Down within menu), and delegated row-click
//     handling. Rows are workflow CARDS, not buttons: the visible
//     interactive element is the title `<a>` (keyboard entry via
//     Tab, activation via Enter), and any click within the
//     surrounding `<article>` bubbles to the section root where
//     we fire the row-select event. Rows dispatch
//     `sh:review-row-select`; menu items dispatch
//     `sh:review-overflow-action`; tab switches dispatch
//     `sh:review-tab-change`.
  //   • Phase 5: Knowledge doc list (rendered on /knowledge.html,
  //     no-ops on /home.html). Rows are native `<a>` elements, so
  //     click / Enter / Cmd-click routing already lives in the
  //     browser — we only add a `sh:knowledge-doc-open` CustomEvent
  //     so a future router can intercept, and a per-row overflow
  //     menu (⋮ → Download / Delete) using the same open / close /
  //     Escape / Arrow keys / outside-click semantics as the
  //     Ready-to-Review row menu. Actions dispatch
  //     `sh:knowledge-doc-action` with `{ action, docId }`.
  //   • Phase 5b: Knowledge search field (also /knowledge.html).
  //     Filters the doc list client-side against each row's
  //     `data-sh-knowledge-doc-name` + `data-sh-knowledge-doc-type`
  //     (trimmed, case-insensitive substring; either field can
  //     match). Toggles the `hidden` attribute on rows so keyboard
  //     focus never leaves the input, updates a visually-hidden
  //     `role="status"` + `aria-live="polite"` region with the
  //     result count only when the count actually changes (so we
  //     don't talk over the letters the user is typing), and
  //     swaps the list for a `[data-sh-knowledge-empty]` panel
  //     when the query drops every row.
  //   • Phase 6: Scheduled workflows tab controller (only present
  //     on /scheduled.html). Filter chips over one list — Arrow /
  //     Home / End keyboard nav across a `role="radiogroup"` with
  //     automatic activation, roving tabindex, `#tab=<id>` URL
  //     hash sync (deep-linkable + Back / Forward respect it),
  //     `aria-live="polite"` result-count announcements, and a
  //     per-row `⋮ → Edit / Pause / Resume / Duplicate / Delete`
  //     overflow menu that mirrors Knowledge's semantics. The
  //     filter icon-button emits `sh:scheduled-filter`; row menu
  //     actions emit `sh:workflow-action` with `{ action,
  //     workflowId }`.
//
// Kept as a plain IIFE — no framework, no shared state — so future
// phases can bolt their own scripts into the same file without
// collision.
//
// Persistence:
//   State lives in localStorage under 'sh:navCollapsed' so a user's
//   preference survives navigation and reloads. Values are strings
//   ('true'/'false') per localStorage's storage contract. On boot we
//   read the value BEFORE the first paint (see the try/catch below)
//   and apply the collapsed class synchronously to avoid a flash of
//   expanded state.
//
// A11y:
//   • The toggle button flips `aria-expanded` and `aria-label` so
//     assistive tech announces the state change.
//   • Nothing steals focus during the toggle; the button retains its
//     own focus so the user can double-tap to un-collapse.
//   • `prefers-reduced-motion` handling lives in CSS (the width
//     transition is disabled at the media-query level) — nothing to do
//     from JS.
// ──────────────────────────────────────────────────────────────────────

(function () {
  'use strict'

  // ── Storage helpers ─────────────────────────────────────────────
  // Wrapped so localStorage-disabled contexts (private browsing on
  // older Safari, sandboxed iframes) fail silently instead of throwing.
  var STORAGE_KEY = 'sh:navCollapsed'

  // Longest typed message carried in the composer's `?q=` handoff.
  // Well inside every browser's URL limit, and far past anything a
  // seller types into a one-line box.
  var COMPOSER_QUERY_MAX = 500

  function readCollapsed () {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'true'
    } catch (e) {
      return false
    }
  }

  function writeCollapsed (isCollapsed) {
    try {
      window.localStorage.setItem(STORAGE_KEY, isCollapsed ? 'true' : 'false')
    } catch (e) {
      // Silent — the toggle still works within the current tab.
    }
  }

  // ── Boot ────────────────────────────────────────────────────────
  function init () {
    var root = document.querySelector('[data-sh-root]')
    if (!root) return

    var toggle = root.querySelector('[data-sh-nav-toggle]')
    if (toggle) {
      // Apply persisted state before wiring the click handler so the
      // initial ARIA attrs match the DOM. `readCollapsed` returns
      // false for a fresh session, so the default is expanded —
      // matching the "Expanded Composed" Figma frame.
      applyState(root, toggle, readCollapsed())

      toggle.addEventListener('click', function (event) {
        event.preventDefault()
        var next = !root.classList.contains('seller-home--nav-collapsed')
        applyState(root, toggle, next)
        writeCollapsed(next)
      })
    }

    // Phase 2 — Daily Briefing link activation + insight popovers.
    var briefingRoot = root.querySelector('[data-sh-briefing-root]')
    if (briefingRoot) {
      bindBriefing(briefingRoot)
      bindBriefingPopovers(briefingRoot)
    }

    // Phase 3 — Chat composer.
    var composerRoot = root.querySelector('[data-sh-composer-root]')
    if (composerRoot) {
      bindComposer(composerRoot)
    }

    // Phase 4 — Ready to Review + Tasks.
    var readyRoot = root.querySelector('[data-sh-ready-root]')
    if (readyRoot) {
      bindReadyToReview(readyRoot)
    }

    // Phase 5 — Knowledge doc list (only present on /knowledge.html).
    // The controller is a no-op if the list root isn't in the DOM,
    // so this same home.js file works on both /home.html and
    // /knowledge.html without a per-page bootstrap fork.
    var knowledgeDocList = root.querySelector('[data-sh-knowledge-doc-list]')
    if (knowledgeDocList) {
      bindKnowledgeDocList(knowledgeDocList)
    }

    // Phase 5b — Knowledge search field (also /knowledge.html only).
    // Split from `bindKnowledgeDocList` on purpose: the search
    // controller owns the input + clear button + empty-state swap +
    // aria-live status region, while the list controller owns the
    // row-open + per-row overflow menu. Both bind against the same
    // list root but are otherwise fully independent — a future
    // consumer that renders the doc list without a search field
    // (e.g., an inline sidebar summary) can drop this second bind
    // without touching the list behavior.
    var knowledgeSearchField = root.querySelector('[data-sh-knowledge-search-field]')
    if (knowledgeSearchField && knowledgeDocList) {
      bindKnowledgeSearch(knowledgeSearchField, knowledgeDocList)
    }

    // Phase 6 — Scheduled workflows tab controller (only present on
    // /scheduled.html). Same no-op-on-missing-root convention every
    // other Seller Home controller uses, so one home.js file drives
    // every Seller Home surface without a per-page bootstrap fork.
    // The controller owns tab switching, keyboard nav across the
    // radiogroup, URL-hash sync, aria-live announcements, the
    // filter icon-button dispatch, and per-row overflow menus.
    var scheduledRoot = document.querySelector('[data-sh-scheduled-root]')
    if (scheduledRoot) {
      bindScheduled(scheduledRoot)
    }
  }

  // ── Briefing ────────────────────────────────────────────────────
  // Event delegation on the briefing root so we don't attach a
  // handler per link. Each interactive phrase carries
  // `data-sh-briefing-topic="<slug>"`; the slug is the only contract
  // Phase 2 needs — a future phase can look it up in a topic
  // registry (opens a detail pane, filters the pipeline, etc.).
  //
  // Selected topic is exposed two ways so downstream code can wire
  // in without touching this file:
  //   1. `sh:briefing-topic-select` CustomEvent on document, with
  //      `detail: { topic, source: 'briefing' }`. Preferred hook
  //      for future orchestration code.
  //   2. `console.info` fallback for developers inspecting the
  //      prototype directly. Kept as `info` (not `log`) so it's
  //      distinguishable from generic noise but not filtered out by
  //      default DevTools levels.
  //
  // Enter and Space are handled by the browser's default button
  // activation — nothing to wire up here. We only listen for `click`
  // so both mouse and keyboard activation flow through the same path.
  function bindBriefing (briefingRoot) {
    briefingRoot.addEventListener('click', function (event) {
      var link = event.target && event.target.closest
        ? event.target.closest('[data-sh-briefing-topic]')
        : null
      if (!link || !briefingRoot.contains(link)) return

      var topic = link.getAttribute('data-sh-briefing-topic')
      if (!topic) return

      // Local state — kept intentionally minimal until a real
      // consumer arrives. Attribute on the briefing root so future
      // CSS can style the "last-selected" state without JS having
      // to touch each link. Namespaced (`data-sh-*`) so it doesn't
      // collide with any framework attrs.
      briefingRoot.setAttribute('data-sh-briefing-active-topic', topic)

      document.dispatchEvent(new CustomEvent('sh:briefing-topic-select', {
        detail: { topic: topic, source: 'briefing' }
      }))

      // eslint-disable-next-line no-console
      console.info('[seller-home] briefing topic selected:', topic)
    })
  }

  // ── Briefing insight popovers ─────────────────────────────────
  // Hover / focus / tap disclosure that opens below a Daily Briefing
  // sentence link and exposes deeper context (see the
  // `briefingInsightPopover` macro in
  // src/views/_home_briefing_insight_popover.html for the render).
  //
  // One controller per page; every popover is a `[data-sh-briefing-
  // popover]` inside the briefing section, matched to its trigger by
  // `data-sh-briefing-popover-for === data-sh-briefing-topic`.
  //
  // Interaction contract (mirrors SLDS Popover + native <details>):
  //   • mouseenter trigger → open after a 60 ms intent delay.
  //   • mouseleave trigger → schedule close after 180 ms.
  //   • mouseenter popover → cancel the pending close (this is the
  //                          "cursor bridge" from trigger to
  //                          popover that prevents flicker).
  //   • mouseleave popover → schedule close after 180 ms.
  //   • focus trigger      → open immediately (keyboard users don't
  //                          need a settle delay).
  //   • blur trigger       → close ONLY when focus moves outside
  //                          both the trigger and the popover, so
  //                          Tab into the popover keeps it open.
  //   • click trigger      → toggle (also fires the existing
  //                          `sh:briefing-topic-select` handler via
  //                          the delegated listener above — this
  //                          controller doesn't stopPropagation, so
  //                          both behaviors stack).
  //   • ESC anywhere while open → close, return focus to trigger.
  //   • Click outside      → close (no focus return).
  //   • Close button       → close, return focus to trigger.
  //   • Action buttons     → dispatch `sh:briefing-popover-action`
  //                          with { topicId, action }, close (no
  //                          focus return — the user has committed).
  //
  // Positioning: each popover is `position: absolute` inside the
  // briefing section (which is `position: relative`). On every open
  // we compute the trigger's `getBoundingClientRect()` in the
  // section's coordinate space, set `top` = triggerBottom + 10 px
  // (leaves room for the nub) and `left` = triggerLeft. If the
  // popover would extend past the viewport's right edge (minus a
  // 16 px gutter), it shifts left by the overshoot amount. The nub
  // then re-centers on the trigger via an inline `left` on the
  // `.seller-home__briefing-popover-nub` element so the tip
  // continues to point at the link even after a viewport shift.
  //
  // Only one popover open at a time; opening a second closes the
  // first automatically (no explicit dismissal needed).
  function bindBriefingPopovers (briefingRoot) {
    var popovers = toArray(briefingRoot.querySelectorAll('[data-sh-briefing-popover]'))
    if (!popovers.length) return

    var OPEN_INTENT_MS = 60
    var CLOSE_INTENT_MS = 180
    var NUB_GAP_PX = 10        // vertical space between trigger bottom and popover top
    var VIEWPORT_GUTTER_PX = 16 // min space kept between popover right and viewport right

    var openId = null
    var openTimer = null
    var closeTimer = null

    // Map topicId → { trigger, popover, close, actions[], nub }
    var entries = {}
    popovers.forEach(function (popover) {
      var topicId = popover.getAttribute('data-sh-briefing-popover-for')
      if (!topicId) return
      var trigger = briefingRoot.querySelector(
        '[data-sh-briefing-topic="' + topicId + '"]'
      )
      if (!trigger) return

      var entry = {
        topicId:  topicId,
        trigger:  trigger,
        popover:  popover,
        nub:      popover.querySelector('.seller-home__briefing-popover-nub'),
        close:    popover.querySelector('[data-sh-briefing-popover-close]'),
        actions:  toArray(popover.querySelectorAll('[data-sh-briefing-popover-action]'))
      }
      entries[topicId] = entry

      // Wire the trigger's aria attributes here (rather than in the
      // template) so a topic without popover data just renders a
      // plain briefing link — no dangling aria-controls / aria-
      // expanded pointing at a non-existent dialog.
      trigger.setAttribute('aria-haspopup', 'dialog')
      trigger.setAttribute('aria-controls', popover.id)
      trigger.setAttribute('aria-expanded', 'false')

      // Hover intent — enter with 60 ms delay, leave with 180 ms.
      // `pointerType === 'touch'` events don't fire enter/leave the
      // way mouse does, so touch is handled by the click toggle below.
      trigger.addEventListener('mouseenter', function () {
        cancelClose()
        scheduleOpen(topicId)
      })
      trigger.addEventListener('mouseleave', function () {
        cancelOpen()
        scheduleClose(topicId)
      })

      // Keyboard focus opens immediately (no intent delay — Tab
      // shouldn't feel laggy).
      trigger.addEventListener('focus', function () {
        cancelOpen()
        cancelClose()
        openPopover(topicId)
      })

      // Blur: close only if focus is leaving the trigger AND won't
      // land inside the popover (Tab into the popover keeps it
      // open, matching SLDS Popover semantics).
      trigger.addEventListener('blur', function (event) {
        var next = event.relatedTarget
        if (next && popover.contains(next)) return
        // Small delay so mouse users who click the trigger to focus
        // it don't immediately race the click-toggle logic below.
        scheduleClose(topicId)
      })

      // Click toggles. Doesn't stopPropagation, so the delegated
      // `sh:briefing-topic-select` handler in bindBriefing still
      // fires — the popover disclosure is additive to the existing
      // link semantic.
      trigger.addEventListener('click', function (event) {
        event.preventDefault()
        cancelOpen()
        cancelClose()
        if (openId === topicId) {
          closePopover(true)
        } else {
          openPopover(topicId)
        }
      })

      // Popover hover — the cursor-bridge that lets the user move
      // from trigger to popover without flicker.
      popover.addEventListener('mouseenter', function () {
        cancelClose()
      })
      popover.addEventListener('mouseleave', function () {
        scheduleClose(topicId)
      })

      // Focus-out on the popover: close if focus is leaving to
      // somewhere outside both the popover and the trigger.
      popover.addEventListener('focusout', function (event) {
        var next = event.relatedTarget
        if (!next) return
        if (popover.contains(next) || next === trigger) return
        scheduleClose(topicId)
      })

      // Close button.
      if (entry.close) {
        entry.close.addEventListener('click', function (event) {
          event.preventDefault()
          closePopover(true)
        })
      }

      // Footer actions — dispatch event, then close.
      entry.actions.forEach(function (btn) {
        btn.addEventListener('click', function (event) {
          event.preventDefault()
          var action = btn.getAttribute('data-sh-briefing-popover-action')
          document.dispatchEvent(new CustomEvent('sh:briefing-popover-action', {
            detail: { topicId: topicId, action: action, source: 'briefing' }
          }))
          // eslint-disable-next-line no-console
          console.info('[seller-home] briefing popover action:',
            topicId, action)
          closePopover(false)
        })
      })
    })

    // Escape anywhere while open closes and returns focus to trigger.
    document.addEventListener('keydown', function (event) {
      if (!openId) return
      if (event.key !== 'Escape') return
      event.preventDefault()
      closePopover(true)
    })

    // Click outside closes. Cheap document-level listener guarded by
    // `!openId` so it no-ops when nothing is open.
    document.addEventListener('click', function (event) {
      if (!openId) return
      var entry = entries[openId]
      if (!entry) return
      if (entry.trigger.contains(event.target)) return
      if (entry.popover.contains(event.target)) return
      closePopover(false)
    })

    // Reposition on scroll / resize while a popover is open so the
    // nub keeps pointing at the trigger as the page shifts. The
    // section itself scrolls (main region is a scroll container),
    // so we listen on the scroll container up the tree — using
    // capture so nested scrollables also trigger repositioning.
    window.addEventListener('resize', function () {
      if (!openId) return
      positionPopover(entries[openId])
    })
    document.addEventListener('scroll', function () {
      if (!openId) return
      positionPopover(entries[openId])
    }, true)

    function scheduleOpen (topicId) {
      cancelOpen()
      openTimer = setTimeout(function () {
        openTimer = null
        openPopover(topicId)
      }, OPEN_INTENT_MS)
    }

    function cancelOpen () {
      if (openTimer != null) {
        clearTimeout(openTimer)
        openTimer = null
      }
    }

    function scheduleClose (topicId) {
      cancelClose()
      closeTimer = setTimeout(function () {
        closeTimer = null
        if (openId === topicId) closePopover(false)
      }, CLOSE_INTENT_MS)
    }

    function cancelClose () {
      if (closeTimer != null) {
        clearTimeout(closeTimer)
        closeTimer = null
      }
    }

    function openPopover (topicId) {
      var entry = entries[topicId]
      if (!entry) return
      // Opening a second popover closes the first — SLDS behavior.
      if (openId && openId !== topicId) closePopover(false)
      entry.popover.hidden = false
      entry.trigger.setAttribute('aria-expanded', 'true')
      openId = topicId
      // Position AFTER unhiding so the popover has an offsetWidth to
      // measure against (a hidden element reports 0 for offsetWidth
      // in most browsers, which breaks the overflow calc).
      positionPopover(entry)
      document.dispatchEvent(new CustomEvent('sh:briefing-popover-open', {
        detail: { topicId: topicId, source: 'briefing' }
      }))
    }

    function closePopover (returnFocus) {
      if (!openId) return
      var entry = entries[openId]
      var trigger = entry && entry.trigger
      if (entry) {
        entry.popover.hidden = true
        entry.trigger.setAttribute('aria-expanded', 'false')
      }
      var closedId = openId
      openId = null
      if (returnFocus && trigger) trigger.focus()
      document.dispatchEvent(new CustomEvent('sh:briefing-popover-close', {
        detail: { topicId: closedId, source: 'briefing' }
      }))
    }

    // Position the popover below the trigger, keeping it inside the
    // viewport horizontally. Nub `left` is re-anchored to the
    // trigger's horizontal center so it points at the link even
    // when the popover has shifted to avoid overflow.
    function positionPopover (entry) {
      if (!entry) return
      var triggerRect = entry.trigger.getBoundingClientRect()
      var rootRect = briefingRoot.getBoundingClientRect()

      var top = triggerRect.bottom - rootRect.top + NUB_GAP_PX
      var left = triggerRect.left - rootRect.left

      // Overflow check — measure the popover's actual rendered width
      // (respects the CSS max-width clamp on narrow viewports) and
      // shift left if it would extend past the viewport's right edge.
      var popWidth = entry.popover.offsetWidth
      var popRightViewport = triggerRect.left + popWidth
      var maxRight = window.innerWidth - VIEWPORT_GUTTER_PX
      if (popRightViewport > maxRight) {
        left -= (popRightViewport - maxRight)
      }
      // Also guard the left edge — never let the popover go past the
      // viewport's left gutter.
      var leftViewport = rootRect.left + left
      if (leftViewport < VIEWPORT_GUTTER_PX) {
        left += (VIEWPORT_GUTTER_PX - leftViewport)
      }

      entry.popover.style.top = top + 'px'
      entry.popover.style.left = left + 'px'

      // Nub tip aligned with trigger's horizontal center. `entry.nub`
      // is 10 px wide (see .seller-home__briefing-popover-nub in
      // home.scss) so we subtract 5 to center. Guarded so a future
      // theme that changes the nub width still lands roughly right.
      if (entry.nub) {
        var nubHalfWidth = entry.nub.offsetWidth / 2 || 5
        var triggerCenterX = triggerRect.left + triggerRect.width / 2
        var popoverLeftViewport = rootRect.left + left
        var nubLeft = triggerCenterX - popoverLeftViewport - nubHalfWidth
        // Clamp so the nub stays visually attached to the popover
        // even in extreme overflow-shift cases.
        var minNubLeft = 12
        var maxNubLeft = popWidth - 12 - (nubHalfWidth * 2)
        if (nubLeft < minNubLeft) nubLeft = minNubLeft
        if (nubLeft > maxNubLeft) nubLeft = maxNubLeft
        entry.nub.style.left = nubLeft + 'px'
      }
    }
  }

  // ── State projection ───────────────────────────────────────────
  // Single source of truth for the two DOM mutations that need to stay
  // in lockstep: the container's collapsed modifier class + the
  // toggle's ARIA attrs. Anything else (label truncation, icon
  // centering, width animation) is driven by CSS off the modifier.
  function applyState (root, toggle, isCollapsed) {
    root.classList.toggle('seller-home--nav-collapsed', isCollapsed)
    // The `--nav-expanded` opt-in class is used by the responsive
    // media-query in home.scss to override the auto-collapse below
    // 40rem when the user has explicitly expanded the nav.
    root.classList.toggle('seller-home--nav-expanded', !isCollapsed)

    toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true')
    toggle.setAttribute(
      'aria-label',
      isCollapsed ? 'Expand navigation' : 'Collapse navigation'
    )
  }

  // ── Composer ────────────────────────────────────────────────────
  // Mock chat surface for Phase 3. Owns four concerns:
  //   1. Textarea autosize on `input` — reset height then re-measure
  //      against `scrollHeight`, capped to the CSS-declared max.
  //      When we hit the cap the CSS `overflow-y: auto` takes over
  //      so scrolling stays inside the textarea (not the page).
  //   2. Send-button empty-state — the disabled attribute is
  //      toggled based on the trimmed value so pure-whitespace
  //      input never enables Send. Also drives the icon color via
  //      `.seller-home__composer-send:not([disabled])` in home.scss.
  //   3. Enter / Shift+Enter — Enter submits (browser default for
  //      textareas is to insert a newline; we invert). Shift+Enter
  //      falls through to browser default → newline.
  //   4. Submit — capture text into an in-memory array on the
  //      composer root (`__shComposerHistory`), dispatch a
  //      `sh:composer-submit` CustomEvent, clear the textarea, and
  //      restore focus. Future phases can subscribe to the event
  //      and forward to a real chat service.
  //
  // The extra toolbar buttons (Add / Quick action / Skills / Voice)
  // are stub actions — they dispatch `sh:composer-action` with the
  // clicked `data-sh-composer-action` id. Attachment / voice
  // infrastructure is deliberately not started here.
  function bindComposer (composerRoot) {
    var form = composerRoot.querySelector('[data-sh-composer-form]')
    var textarea = composerRoot.querySelector('[data-sh-composer-textarea]')
    var sendBtn = composerRoot.querySelector('[data-sh-composer-send]')
    if (!form || !textarea || !sendBtn) return

    // Per-composer mock history. Kept on the DOM node (not module
    // scope) so multiple composers on one page — a future
    // possibility — each track their own state without collision.
    // Namespaced with `__sh` so it's obviously prototype-only.
    composerRoot.__shComposerHistory = []

    autosize(textarea)
    updateSendState(textarea, sendBtn)

    // Placeholder typewriter — starts here so it can observe the same
    // `input` events the send-state updater watches. The typewriter
    // gets to add its own `input` listener first (see bindPlaceholder
    // Typewriter) so it halts BEFORE this one fires, which means the
    // static placeholder isn't left in an ambiguous half-typed state
    // when the user starts typing.
    bindPlaceholderTypewriter(textarea)

    textarea.addEventListener('input', function () {
      autosize(textarea)
      updateSendState(textarea, sendBtn)
    })

    // Enter → submit, Shift+Enter → newline (browser default).
    // Also handled: IME composition — during multi-key input for
    // CJK etc., Enter is committing a candidate, NOT sending. We
    // check `event.isComposing` (and the widely-supported
    // `keyCode === 229` fallback) to skip submission in that case.
    textarea.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return
      if (event.shiftKey) return
      if (event.isComposing || event.keyCode === 229) return
      event.preventDefault()
      // Use `requestSubmit` so the browser fires a real `submit`
      // event (which invokes the handler below). Not all form
      // controls support `.submit()` — `requestSubmit()` does, and
      // it respects the button's disabled state.
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit()
      } else {
        // Safari <16 fallback — synthesize the submit event.
        var synthetic = new Event('submit', { cancelable: true, bubbles: true })
        form.dispatchEvent(synthetic)
      }
    })

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var raw = textarea.value
      var text = raw == null ? '' : raw.trim()
      if (!text) return

      composerRoot.__shComposerHistory.push({
        text: text,
        submittedAt: new Date().toISOString()
      })

      document.dispatchEvent(new CustomEvent('sh:composer-submit', {
        detail: { text: text, source: 'composer' }
      }))

      // eslint-disable-next-line no-console
      console.info(
        '[seller-home] composer submit (' +
          composerRoot.__shComposerHistory.length + ' total):',
        text
      )

      // Hand off to the conversation surface when this composer has
      // somewhere to send. The event above fires first either way, so
      // a listener still sees every submission.
      //
      // The page is about to unload, so the textarea is deliberately
      // NOT cleared: a blocked or slow navigation leaves the seller
      // looking at the words they just typed rather than an empty box.
      var target = composerTarget(composerRoot, text)
      if (target) {
        window.location.assign(target)
        return
      }

      textarea.value = ''
      autosize(textarea)
      updateSendState(textarea, sendBtn)
      textarea.focus()
    })

    // Peripheral action buttons — stub for now, hooks reserved for
    // future phases (file picker, MediaRecorder, quick-action menu,
    // skills chooser). Same event-delegation pattern as briefing
    // links so adding more actions doesn't require new listeners.
    composerRoot.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest
        ? event.target.closest('[data-sh-composer-action]')
        : null
      if (!btn || !composerRoot.contains(btn)) return
      var actionId = btn.getAttribute('data-sh-composer-action')
      if (!actionId) return

      document.dispatchEvent(new CustomEvent('sh:composer-action', {
        detail: { action: actionId, source: 'composer' }
      }))

      // eslint-disable-next-line no-console
      console.info('[seller-home] composer action:', actionId)
    })
  }

  // Placeholder typewriter. Types out each sample prompt from
  // `data-sh-composer-prompts` character-by-character on the
  // textarea's `placeholder` attribute, holds at the end, deletes
  // back to empty, and moves to the next prompt. Loops forever.
  //
  // Halt conditions (any one wins, permanently):
  //   • `prefers-reduced-motion: reduce` — animation never starts.
  //     The SSR-painted static placeholder stays as-is; users who
  //     ask for less motion get a clean, unchanging prompt.
  //   • The user types real content into the textarea (input event
  //     with non-empty value). Halting on `input` — not `focus` —
  //     is deliberate: sellers often focus the textarea just to
  //     read the samples before deciding whether to type. Cutting
  //     the animation short on focus would be jumpy.
  //   • The `data-sh-composer-prompts` attribute is missing, empty,
  //     or unparseable — the animation is a no-op and the static
  //     placeholder stays.
  //
  // Timing constants chosen by feel:
  //   • ~55 ms/char while typing → ~18 cps, close to a fast human
  //     typing pace. Fast enough to feel responsive, slow enough
  //     to read.
  //   • ~30 ms/char while deleting → snappier than typing; matches
  //     how backspace-holds behave in real editors.
  //   • 5000 ms hold at the end of each prompt → the fully-typed
  //     sample sits visible for a full 5 s so sellers have time to
  //     read a longer suggestion before it deletes and moves on.
  //   • 300 ms inter-prompt pause after fully deleting → a short
  //     empty-textarea punctuation between prompts. The bulk of the
  //     "one prompt at a time" pacing lives in HOLD_MS above; this
  //     just prevents the next prompt from starting to type the
  //     instant the last character is deleted.
  //   • 300 ms initial delay on page load → the first prompt kicks
  //     in quickly instead of leaving the SSR-painted static
  //     placeholder visible for the same beat as the inter-prompt
  //     pause. Kept separate from PAUSE_BETWEEN_MS so the two can
  //     be tuned independently.
  function bindPlaceholderTypewriter (textarea) {
    var raw = textarea.getAttribute('data-sh-composer-prompts')
    if (!raw) return

    var prompts
    try { prompts = JSON.parse(raw) } catch (e) { return }
    if (!Array.isArray(prompts) || prompts.length === 0) return

    // Reduced-motion respect. Users who set the OS flag see the
    // static SSR-painted placeholder and get NO animation at all.
    // We don't try to be clever and skip only the deletion phase or
    // similar — reduced-motion means "don't distract me", and a
    // constantly-changing placeholder is a distraction.
    if (window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    var TYPE_MS = 55
    var DELETE_MS = 30
    var HOLD_MS = 5000
    var PAUSE_BETWEEN_MS = 300
    var INITIAL_DELAY_MS = 300

    var promptIdx = 0
    var charIdx = 0
    var mode = 'typing'
    var timerId = null
    var stopped = false

    function tick () {
      if (stopped) return
      var current = prompts[promptIdx]

      if (mode === 'typing') {
        if (charIdx < current.length) {
          charIdx += 1
          textarea.placeholder = current.slice(0, charIdx)
          timerId = setTimeout(tick, TYPE_MS)
        } else {
          mode = 'holding'
          timerId = setTimeout(tick, HOLD_MS)
        }
      } else if (mode === 'holding') {
        mode = 'deleting'
        timerId = setTimeout(tick, DELETE_MS)
      } else if (mode === 'deleting') {
        if (charIdx > 0) {
          charIdx -= 1
          textarea.placeholder = current.slice(0, charIdx)
          timerId = setTimeout(tick, DELETE_MS)
        } else {
          promptIdx = (promptIdx + 1) % prompts.length
          mode = 'typing'
          timerId = setTimeout(tick, PAUSE_BETWEEN_MS)
        }
      }
    }

    function stop () {
      if (stopped) return
      stopped = true
      if (timerId != null) clearTimeout(timerId)
    }

    // Halt on real user input. `input` fires for typing, paste,
    // drop, and IME commit; checking `.value.length` filters out
    // the "user hit Backspace on an empty textarea" case (which
    // shouldn't kill the animation). Once stopped, we also clear
    // the placeholder — the textarea now has real user content,
    // so the placeholder is invisible anyway; clearing prevents
    // any stale mid-animation string from flashing back if the
    // user later deletes their input.
    textarea.addEventListener('input', function onInput () {
      if (textarea.value.length === 0) return
      textarea.removeEventListener('input', onInput)
      stop()
      textarea.placeholder = ''
    })

    // Start from an empty placeholder so the first prompt appears
    // to type in from scratch, rather than "replacing" the SSR-
    // painted static placeholder mid-view. There's a brief flash
    // where the SSR placeholder shows before this runs — that's
    // acceptable and even nice-feeling (the user sees a hint
    // before the animation kicks in). `INITIAL_DELAY_MS` (not
    // `PAUSE_BETWEEN_MS`) so the page's first prompt starts
    // quickly regardless of how long the inter-prompt gap is.
    textarea.placeholder = ''
    timerId = setTimeout(tick, INITIAL_DELAY_MS)
  }

  // Textarea autosize — cheap, layout-only. Runs on every input
  // event; each call is ~1 layout pass on the textarea alone.
  //
  // Height reset to `auto` is required before reading
  // `scrollHeight` — otherwise scrollHeight equals the current
  // height (locked by the previous inline style) and the textarea
  // never shrinks when the user deletes lines.
  //
  // The visible cap lives in CSS (`max-height` on the textarea);
  // we don't need to enforce it in JS because inline `height` is
  // clamped by `max-height` at the rendering step. Overflow-y
  // handles scroll once the cap is reached.
  function autosize (textarea) {
    textarea.style.height = 'auto'
    textarea.style.height = textarea.scrollHeight + 'px'
  }

  // Send-button empty-state. Disabled means:
  //   • The submit form event won't fire on Enter (browser blocks
  //     submission with a disabled submit button).
  //   • Screen readers announce "dimmed" / "disabled".
  //   • Icon color drops to `--slds-g-color-disabled-container-2`
  //     via the CSS `[disabled]` selector on `.slds-button__icon`.
  //
  // Trim before checking so pure-whitespace input (spaces, tabs,
  // newlines) never enables Send. Matches the intent — "enable
  // after non-whitespace text".
  function updateSendState (textarea, sendBtn) {
    var hasText = textarea.value.trim().length > 0
    sendBtn.disabled = !hasText
    sendBtn.setAttribute('aria-disabled', hasText ? 'false' : 'true')
  }

  // Build the URL Send navigates to, or null when this composer has no
  // `data-sh-composer-target` (in which case submitting stays local).
  //
  // The typed text rides along as `q` so the conversation page can open
  // on the seller's own words. It's capped before encoding because a
  // pasted wall of text would otherwise blow past what browsers and
  // servers accept in a URL; the conversation only shows the first line
  // of it anyway.
  function composerTarget (composerRoot, text) {
    var target = composerRoot.getAttribute('data-sh-composer-target')
    if (!target) return null
    var query = String(text).slice(0, COMPOSER_QUERY_MAX)
    return target +
      (target.indexOf('?') === -1 ? '?' : '&') +
      'q=' + encodeURIComponent(query)
  }

  // ══════════════════════════════════════════════════════════════════
  // Ready to Review + Tasks
  // ──────────────────────────────────────────────────────────────────
  // Everything is wired lazily off the section root — three
  // independent surfaces (tablist, overflow menu, row list) so the
  // helpers below stay independently testable if any of them ever
  // grows in scope.
  //
  //   ready-tabs      → tablistController(tabs, panels)
  //   ready-overflow  → overflowController(trigger, menu)
  //   ready-list      → delegated row-click handler
  // ══════════════════════════════════════════════════════════════════
  function bindReadyToReview (readyRoot) {
    var tabs = toArray(readyRoot.querySelectorAll('[data-sh-ready-tab]'))
    var panels = toArray(readyRoot.querySelectorAll('[data-sh-ready-panel]'))
    if (tabs.length && panels.length) {
      tablistController(tabs, panels)
    }

    var overflow = readyRoot.querySelector('[data-sh-ready-overflow]')
    if (overflow) {
      overflowController(overflow)
    }

    // Per-row overflow menu (⋮) — one controller for every card in
    // the panel, event-delegated off the section root so cards added
    // by a future dynamic render pick up the behavior automatically.
    perRowOverflowController(readyRoot)

    // Row activation — delegated to the section root so future
    // dynamically-added rows / tabs work without re-binding.
    //
    // Rows are `<article>` workflow cards (not buttons). Two ways to
    // activate a row:
    //
    //   1. Mouse click anywhere on the card. Bubbles up to the
    //      section root; we find the enclosing `[data-sh-review-row]`
    //      and fire the event.
    //   2. Keyboard: the card's title `<a>` is the focusable entry
    //      point. Enter triggers the anchor's default click; the
    //      click also bubbles to the section root and matches the
    //      same delegate.
    //
    // If the title link was involved (either mouse click ON it, or
    // keyboard Enter on it), we `preventDefault()` so the `href="#"`
    // doesn't scroll the page to the top. That's the only reason
    // we bother identifying the link — the row-select event fires
    // regardless.
    //
    // Future nested action buttons inside a card (Dismiss, Snooze,
    // ⋮ menu…) should tag themselves with `[data-sh-review-row-stop]`
    // and call `event.stopPropagation()` in their own handlers to
    // opt out of the card-level activation.
    readyRoot.addEventListener('click', function (event) {
      // Per-row overflow menu owns its own click handling (see
      // perRowOverflowController below). We opt those clicks out of
      // the card-select delegate here so clicking the kebab or a
      // menu item never fires a phantom row-select / navigates the
      // card. `data-sh-review-row-stop` is the shared opt-out marker
      // — future nested controls (Snooze, Assign, inline actions)
      // can adopt the same attribute to inherit this behavior.
      if (closest(event.target, '[data-sh-review-row-stop]')) return

      var row = closest(event.target, '[data-sh-review-row]')
      if (!row) return

      // Rows that link to a real conversation route (title anchor
      // href !== '#') let the browser handle navigation natively —
      // that's what preserves back-button + scroll-restoration on
      // return to Seller Home. We only preventDefault on placeholder
      // `#` hrefs so those clicks don't jump-scroll the page.
      //
      // `closest` from the event target picks up clicks that landed
      // ANYWHERE inside the card: on the title link directly, OR on
      // the stretched ::after overlay (whose click bubbles up as if
      // it originated on the anchor). Either way we've got the link.
      var link = closest(event.target, '[data-sh-review-row-link]')
      if (link) {
        var href = link.getAttribute('href') || ''
        if (href === '' || href === '#') {
          event.preventDefault()
        }
        // else: real URL — let the browser navigate.
      }

      var rowId = row.getAttribute('data-sh-review-row')
      var workflowId = row.getAttribute('data-sh-review-workflow') || null

      document.dispatchEvent(new CustomEvent('sh:review-row-select', {
        detail: { rowId: rowId, workflowId: workflowId, source: 'ready' }
      }))
      // eslint-disable-next-line no-console
      console.info('[seller-home] review row selected:', rowId,
        workflowId ? '(workflow: ' + workflowId + ')' : ''
      )
    })
  }

  // ── Tablist controller ────────────────────────────────────────────
  // WAI-ARIA "tabs with automatic activation": Left/Right cycle,
  // Home/End jump to ends. Roving tabindex is kept in sync with
  // `aria-selected` + the `.is-active` visual class so the three
  // sources of truth can't drift.
  function tablistController (tabs, panels) {
    var tablist = tabs[0].parentNode

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { activate(tab) })
    })

    tablist.addEventListener('keydown', function (event) {
      var idx = tabs.indexOf(document.activeElement)
      if (idx < 0) return
      var nextIdx = null
      switch (event.key) {
        case 'ArrowLeft':  nextIdx = (idx - 1 + tabs.length) % tabs.length; break
        case 'ArrowRight': nextIdx = (idx + 1) % tabs.length; break
        case 'Home':       nextIdx = 0; break
        case 'End':        nextIdx = tabs.length - 1; break
        default: return
      }
      event.preventDefault()
      var next = tabs[nextIdx]
      activate(next)
      next.focus()
    })

    function activate (target) {
      var targetId = target.getAttribute('data-sh-ready-tab')
      tabs.forEach(function (tab) {
        var on = tab === target
        tab.classList.toggle('is-active', on)
        tab.setAttribute('aria-selected', on ? 'true' : 'false')
        tab.setAttribute('tabindex', on ? '0' : '-1')
      })
      panels.forEach(function (panel) {
        var on = panel.getAttribute('data-sh-ready-panel') === targetId
        panel.classList.toggle('is-visible', on)
        panel.hidden = !on
      })
      document.dispatchEvent(new CustomEvent('sh:review-tab-change', {
        detail: { tabId: targetId, source: 'ready' }
      }))
    }
  }

  // ── Overflow menu controller ──────────────────────────────────────
  // Open on trigger click; close on Escape, click-outside, and
  // menu-item activation. Arrow-Up/Down inside the menu cycles
  // focus. Open state = `menu.hidden === false`.
  function overflowController (root) {
    var trigger = root.querySelector('[data-sh-ready-overflow-trigger]')
    var menu = root.querySelector('[data-sh-ready-overflow-menu]')
    if (!trigger || !menu) return
    var items = toArray(menu.querySelectorAll('[data-sh-ready-overflow-action]'))

    trigger.addEventListener('click', function (event) {
      event.stopPropagation()
      var willOpen = menu.hidden
      setOpen(willOpen)
      if (willOpen && items.length) items[0].focus()
    })

    trigger.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault()
        setOpen(false)
      }
    })

    menu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        trigger.focus()
        return
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      var idx = items.indexOf(document.activeElement)
      if (idx < 0) return
      event.preventDefault()
      var nextIdx = event.key === 'ArrowDown'
        ? (idx + 1) % items.length
        : (idx - 1 + items.length) % items.length
      items[nextIdx].focus()
    })

    items.forEach(function (item) {
      item.addEventListener('click', function () {
        var actionId = item.getAttribute('data-sh-ready-overflow-action')
        document.dispatchEvent(new CustomEvent('sh:review-overflow-action', {
          detail: { action: actionId, source: 'ready' }
        }))
        // eslint-disable-next-line no-console
        console.info('[seller-home] review overflow action:', actionId)
        setOpen(false)
        trigger.focus()
      })
    })

    // Outside-click dismiss — cheap document-level listener guarded
    // by `menu.hidden` so it no-ops when nothing is open.
    document.addEventListener('click', function (event) {
      if (menu.hidden) return
      if (root.contains(event.target)) return
      setOpen(false)
    })

    function setOpen (isOpen) {
      menu.hidden = !isOpen
      menu.classList.toggle('is-open', isOpen)
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
    }
  }

  // ── Per-row overflow menu controller ──────────────────────────────
  // One controller for the whole panel, event-delegated off the section
  // root so N cards pay for zero-per-card listeners and any future
  // dynamically-rendered card picks up the behavior automatically.
  //
  // Interaction contract (matches SLDS 2 menu component):
  //   • Click trigger  → toggle its menu. Only ONE menu can be open at
  //                      a time; opening a second one closes the first.
  //                      First menuitem receives focus on open.
  //   • Click item     → dispatch `sh:review-row-action`, close the
  //                      menu, and — for `dismiss` — animate the card
  //                      collapsing out of the list.
  //   • Escape         → close, focus returns to the trigger.
  //   • ArrowUp/Down   → cycle focus within the open menu (wraps).
  //   • Click-outside  → close (no focus return, matches native menus).
  //
  // State is a single {menu, trigger} pair kept in this closure. That's
  // enough because SLDS menus are strictly one-at-a-time; if we ever
  // grow a multi-open surface, promote this to a Map keyed by menu id.
  //
  // Card-level click-through opt-out lives on the delegated row-select
  // handler above (`[data-sh-review-row-stop]` check), not here — one
  // fewer stopPropagation call and it applies uniformly to any nested
  // control that opts in.
  function perRowOverflowController (readyRoot) {
    var openMenu = null
    var openTrigger = null

    function setMenuState (trigger, menu, isOpen) {
      menu.hidden = !isOpen
      menu.classList.toggle('is-open', isOpen)
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
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

    readyRoot.addEventListener('click', function (event) {
      var trigger = closest(event.target, '[data-sh-review-row-menu-trigger]')
      if (trigger) {
        var container = closest(trigger, '[data-sh-review-row-menu]')
        var menu = container && container.querySelector('[data-sh-review-row-menu-list]')
        if (!menu) return

        var willOpen = menu.hidden
        // Close any other row's menu before opening this one — SLDS
        // menus are one-at-a-time and having two open at once would
        // trap the outside-click-to-close pattern.
        if (openMenu && openMenu !== menu) closeOpenMenu(false)
        setMenuState(trigger, menu, willOpen)
        if (willOpen) {
          var first = menu.querySelector('[data-sh-review-row-menu-action]')
          if (first) first.focus()
        }
        return
      }

      var actionBtn = closest(event.target, '[data-sh-review-row-menu-action]')
      if (!actionBtn) return

      var actionId = actionBtn.getAttribute('data-sh-review-row-menu-action')
      var row = closest(actionBtn, '[data-sh-review-row]')
      var rowId = row && row.getAttribute('data-sh-review-row')
      var listItem = closest(actionBtn, '[data-sh-ready-list-item]')

      // Dispatch BEFORE mutating the DOM so a future subscriber can
      // inspect the row / li node from the event target if needed.
      document.dispatchEvent(new CustomEvent('sh:review-row-action', {
        detail: { action: actionId, rowId: rowId, source: 'ready' }
      }))
      // eslint-disable-next-line no-console
      console.info('[seller-home] review row action:', actionId,
        rowId ? '(' + rowId + ')' : '')

      // Close without returning focus to the trigger — the card is
      // either about to disappear (dismiss) or the user has made a
      // decision and expects to move on. Returning focus into a
      // fading card would be jarring.
      closeOpenMenu(false)

      if (actionId === 'dismiss' && listItem) {
        dismissListItem(listItem)
      }
    })

    readyRoot.addEventListener('keydown', function (event) {
      if (!openMenu) return

      if (event.key === 'Escape') {
        event.preventDefault()
        closeOpenMenu(true)
        return
      }

      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      // Only intercept arrows when focus is inside the open menu (or
      // still on the trigger) — otherwise the section's tablist /
      // page arrow keys would be stolen from unrelated surfaces.
      if (!openMenu.contains(document.activeElement) &&
          openTrigger !== document.activeElement) return

      var items = toArray(openMenu.querySelectorAll('[data-sh-review-row-menu-action]'))
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

    // Outside-click dismiss. Cheap document-level listener guarded by
    // `!openMenu` so it no-ops when nothing is open. `closest` on the
    // event target catches clicks anywhere inside the open menu's
    // container (trigger, menu panel, items) — those are handled by
    // the delegated click listener above.
    document.addEventListener('click', function (event) {
      if (!openMenu) return
      var container = closest(event.target, '[data-sh-review-row-menu]')
      if (container && container.contains(openMenu)) return
      closeOpenMenu(false)
    })
  }

  // ── Row dismissal animation ───────────────────────────────────────
  // Collapses the list `<li>` to zero height + zero opacity over
  // ~220 ms, then removes it from the DOM. Sibling rows reflow upward
  // via the parent flex column throughout the collapse, so the visual
  // matches Gmail / Salesforce list dismissals.
  //
  // The measured `offsetHeight` is pinned as inline `max-height`
  // BEFORE flipping the `.is-dismissing` class — the class introduces
  // the transition + a target `max-height: 0px`, and we need a
  // concrete start value for the transition to run against. A single
  // forced reflow between the two writes guarantees the "from"
  // value is committed to the render tree before the "to" value lands.
  //
  // Both `transitionend` and a `setTimeout` fallback remove the node:
  // most browsers fire transitionend reliably, but reduced-motion,
  // display:none races, and old Safari WebKit versions can suppress
  // it. The timeout is slightly longer than the longest transition
  // (220 ms) so the animation always finishes before removal.
  function dismissListItem (li) {
    var height = li.offsetHeight
    li.style.maxHeight = height + 'px'
    // Force reflow so the pre-collapse max-height "sticks" before the
    // class flip introduces the transition + target value on the same
    // property. Without this, browsers batch the two writes and the
    // element jumps straight to 0 with no animation.
    void li.offsetHeight
    li.classList.add('is-dismissing')
    requestAnimationFrame(function () {
      li.style.maxHeight = '0px'
    })

    var removed = false
    function remove () {
      if (removed) return
      removed = true
      li.removeEventListener('transitionend', onEnd)
      if (li.parentNode) li.parentNode.removeChild(li)
    }
    function onEnd (event) {
      // Wait for max-height specifically — opacity + margin finish
      // sooner and would remove the item mid-collapse.
      if (event.propertyName !== 'max-height') return
      remove()
    }
    li.addEventListener('transitionend', onEnd)
    setTimeout(remove, 300)
  }

  // ── Phase 5: Knowledge doc list ───────────────────────────────────
  // Rows are native `<a>` elements — the browser owns click / Enter /
  // Space / focus / middle-click / Cmd-click, so this module only
  // needs to:
  //   1. Emit `sh:knowledge-doc-open` on row activation so a future
  //      router can `preventDefault()` and take over navigation.
  //   2. Manage the per-row overflow menu (⋮). Behavior mirrors the
  //      Ready-to-Review row menu (open / close, Escape, Arrow-
  //      Up/Down inside the panel, click-outside dismiss, action
  //      dispatch as `sh:knowledge-doc-action`).
  //
  // All handlers are delegated on the list root so future rows added
  // at runtime (e.g. search-results, virtualized list) inherit the
  // behavior without a per-row re-bind.
  function bindKnowledgeDocList (listRoot) {
    // Row-open path. `click` fires on left-click and on Enter/Space
    // activation of the anchor (browsers synthesize a click for both
    // keyboard activations of `<a>`), so a single listener covers
    // mouse + keyboard without a separate `keydown` handler.
    //
    // Guarded by:
    //   • middle-button / modifier-key clicks fall through to the
    //     browser (`event.defaultPrevented` unchanged) so
    //     Cmd/Ctrl-click still opens in a new tab.
    //   • Clicks inside the overflow menu wrapper (`[data-sh-
    //     knowledge-doc-stop]`) are treated as "not a row-open
    //     click" so the menu's own buttons work without racing the
    //     row's event.
    listRoot.addEventListener('click', function (event) {
      if (closest(event.target, '[data-sh-knowledge-doc-stop]')) return

      var anchor = closest(event.target, '[data-sh-knowledge-doc]')
      if (!anchor) return

      var docId = anchor.getAttribute('data-sh-knowledge-doc-id') || ''
      var href = anchor.getAttribute('href') || ''

      // Dispatch BEFORE deciding whether to navigate so a future
      // subscriber can `preventDefault()` on the CustomEvent and
      // block the anchor. `cancelable: true` is what makes the
      // preventDefault contract meaningful.
      var openEvent = new CustomEvent('sh:knowledge-doc-open', {
        detail: { docId: docId, href: href },
        cancelable: true,
        bubbles: true
      })
      var proceed = anchor.dispatchEvent(openEvent)

      // eslint-disable-next-line no-console
      console.info('[seller-home] knowledge doc open:', docId || '(no id)', href ? '→ ' + href : '(no href)')

      // If a subscriber cancelled the CustomEvent, also cancel the
      // anchor's native navigation. Also cancel if the anchor has an
      // empty / placeholder href — otherwise the browser jumps to
      // `#` and scrolls the page to the top.
      if (!proceed || href === '' || href === '#') {
        event.preventDefault()
      }
    })

    // Delegated overflow-menu controller. Kept as a local closure so
    // the open/close state (single menu open at a time) stays scoped
    // to this list root — a hypothetical second list on the same
    // page (e.g., a search results panel) would get its own scoped
    // controller via a second bind.
    knowledgeDocOverflowController(listRoot)
  }

  // Per-row overflow menu controller — parallels
  // `perRowOverflowController` for Ready-to-Review. Kept as its own
  // function so the two controllers can diverge in the future
  // (different action semantics, different keyboard shortcuts)
  // without cross-referencing.
  //
  // State: single-open menu enforced via the `openMenu` / `openTrigger`
  // pair. Opening a second menu closes the first, matching SLDS'
  // one-menu-at-a-time convention and avoiding trapped focus.
  function knowledgeDocOverflowController (listRoot) {
    var openMenu = null
    var openTrigger = null

    function setMenuState (trigger, menu, isOpen) {
      menu.hidden = !isOpen
      menu.classList.toggle('is-open', isOpen)
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
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

    listRoot.addEventListener('click', function (event) {
      // Trigger click → toggle the menu.
      var trigger = closest(event.target, '[data-sh-knowledge-doc-menu-trigger]')
      if (trigger) {
        // Stop this event from also being interpreted as a row-open
        // click by the sibling listener above. The listeners run in
        // registration order on the same element, so
        // `stopImmediatePropagation` here prevents the row-open
        // handler from firing on the SAME target.
        event.stopPropagation()
        event.preventDefault()

        var container = closest(trigger, '[data-sh-knowledge-doc-menu]')
        var menu = container && container.querySelector('[data-sh-knowledge-doc-menu-list]')
        if (!menu) return

        var willOpen = menu.hidden
        if (openMenu && openMenu !== menu) closeOpenMenu(false)
        setMenuState(trigger, menu, willOpen)
        if (willOpen) {
          var first = menu.querySelector('[data-sh-knowledge-doc-action]')
          if (first) first.focus()
        }
        return
      }

      // Action click → dispatch, then close the menu.
      var actionBtn = closest(event.target, '[data-sh-knowledge-doc-action]')
      if (!actionBtn) return

      event.stopPropagation()
      event.preventDefault()

      var actionId = actionBtn.getAttribute('data-sh-knowledge-doc-action')
      var row = closest(actionBtn, '[data-sh-knowledge-doc-item]')
      var rowAnchor = row && row.querySelector('[data-sh-knowledge-doc]')
      var docId = rowAnchor ? rowAnchor.getAttribute('data-sh-knowledge-doc-id') : ''

      document.dispatchEvent(new CustomEvent('sh:knowledge-doc-action', {
        detail: { action: actionId, docId: docId }
      }))
      // eslint-disable-next-line no-console
      console.info('[seller-home] knowledge doc action:', actionId,
        docId ? '(' + docId + ')' : '')

      // Close without returning focus to the trigger — after a
      // Download / Delete the user's mental model has already moved
      // to the next task, and returning focus to a menu button that
      // just closed would feel jarring.
      closeOpenMenu(false)
    })

    // Keyboard nav inside the open menu — Escape closes and returns
    // focus, ArrowUp/Down cycles focus across menu items. Only
    // engages when a menu is open so we don't intercept the doc-
    // list's own tab-order navigation.
    listRoot.addEventListener('keydown', function (event) {
      if (!openMenu) return

      if (event.key === 'Escape') {
        event.preventDefault()
        closeOpenMenu(true)
        return
      }

      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (!openMenu.contains(document.activeElement) &&
          openTrigger !== document.activeElement) return

      var items = toArray(openMenu.querySelectorAll('[data-sh-knowledge-doc-action]'))
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
    // by `!openMenu` so it no-ops when nothing is open. Any click
    // inside the same menu wrapper is treated as "inside" — this
    // catches the trigger + menu panel + items.
    document.addEventListener('click', function (event) {
      if (!openMenu) return
      var container = closest(event.target, '[data-sh-knowledge-doc-menu]')
      if (container && container.contains(openMenu)) return
      closeOpenMenu(false)
    })
  }

  // ── Scheduled workflows tab controller ──────────────────────────
  // Client-side controller for /scheduled.html. Wires:
  //
  //   • [data-sh-scheduled-tabs]         → radiogroup wrapper
  //   • [data-sh-scheduled-tab]          → each filter chip (radio)
  //   • [data-sh-workflow-item]s         → workflow rows; each carries
  //                                        data-sh-workflow-status
  //                                        which the filter matches
  //   • [data-sh-scheduled-empty]        → "no workflows match" panel
  //   • [data-sh-scheduled-status]       → visually-hidden aria-live
  //                                        region (announces the new
  //                                        result count on switch)
  //   • [data-sh-scheduled-filter]       → right-anchored icon button;
  //                                        emits `sh:scheduled-filter`
  //                                        for a future consumer.
  //
  // Contract:
  //   • Server-side paints the first-active tab from
  //     `tabs.defaultTabId` in scheduled.json. On load, if
  //     `location.hash` matches `#tab=<id>` for a known tab, that
  //     value wins (deep-linkable filter). Otherwise the SSR default
  //     stands.
  //   • Tab activation is IMMEDIATE (WAI-ARIA "automatic activation"
  //     model): Arrow-Left / Arrow-Right / Home / End move focus AND
  //     activate the newly focused tab in one gesture, matching the
  //     radiogroup pattern and Ready-to-Review's tab convention.
  //     Space / Enter also activate the focused tab (defensive; the
  //     focus-move already activates).
  //   • Row visibility is toggled via the `hidden` attribute keyed
  //     off each row's `data-sh-workflow-status`. Never re-orders,
  //     never re-renders — the row's DOM identity is preserved across
  //     tab switches so a future consumer of `sh:workflow-*` events
  //     doesn't lose references. `tabs.items[i].statuses` empty means
  //     "match every workflow" (that's the "All" tab).
  //   • Empty state ([data-sh-scheduled-empty]) is toggled in tandem
  //     with the list so the region never shows placeholder rows.
  //   • aria-live status is written only when the tab actually
  //     changes (not on every navigate) so a screen reader user
  //     doesn't hear repeats.
  //   • URL hash sync is bidirectional: activation writes
  //     `#tab=<id>` (Back / Forward respect it), and a hashchange
  //     event re-activates the matching tab so browser navigation
  //     stays in sync.
  //
  // Not in scope: server-side filtering, batch actions, drag-to-
  // reorder. Row detail-view opens are a separate future increment;
  // every row today is authored with `linked: false` so activation
  // is a no-op.
  function bindScheduled (root) {
    var tabsRoot = root.querySelector('[data-sh-scheduled-tabs]')
    var listRegion = root.querySelector('[data-sh-scheduled-list-region]')
    var listRoot = root.querySelector('[data-sh-scheduled-workflow-list]')
    var emptyPanel = root.querySelector('[data-sh-scheduled-empty]')
    var statusRegion = root.querySelector('[data-sh-scheduled-status]')
    var filterBtn = root.querySelector('[data-sh-scheduled-filter]')

    // Overflow menu controller is independent of the tab controller
    // — bind it up front so per-row menus work even if the tab
    // wiring below early-returns due to malformed markup.
    if (listRoot) {
      scheduledWorkflowOverflowController(listRoot)
    }

    // Filter icon-button — just a dispatcher today. A future filter
    // menu can bind on the event without changes here.
    if (filterBtn) {
      filterBtn.addEventListener('click', function (event) {
        event.preventDefault()
        document.dispatchEvent(new CustomEvent('sh:scheduled-filter', {
          detail: { source: 'toolbar' }
        }))
        // eslint-disable-next-line no-console
        console.info('[seller-home] scheduled filter dispatched')
      })
    }

    // Bail if the tab / list / row DOM isn't fully rendered — a
    // half-hydrated shell is better ignored than crashed.
    if (!tabsRoot || !listRoot) return

    var tabs = toArray(tabsRoot.querySelectorAll('[data-sh-scheduled-tab]'))
    if (!tabs.length) return

    // Build a per-tab status filter set once, at bind time — cheaper
    // than parsing the data-attribute on every switch and shields us
    // against a future re-render clobbering the attribute.
    var tabStatusesById = {}
    tabs.forEach(function (tab) {
      var raw = tab.getAttribute('data-sh-scheduled-tab-statuses') || ''
      // Empty string → empty list → "match all". Trim guards against
      // an authored trailing comma.
      var list = raw.split(',').map(function (s) { return s.trim() }).filter(function (s) { return s })
      var id = tab.getAttribute('data-sh-scheduled-tab')
      tabStatusesById[id] = list
    })

    // Cache the row NodeList once. A hypothetical future incremental
    // list-render can call `refreshRows()` (exposed via the returned
    // object) but the prototype's list is static so we don't ship a
    // MutationObserver.
    var rows = toArray(listRoot.querySelectorAll('[data-sh-workflow-item]'))

    // Which tab is active right now. Track independently of the DOM
    // so tab-click handlers can early-return on a no-op reselect.
    var activeTabId = null
    tabs.some(function (tab) {
      if (tab.getAttribute('aria-checked') === 'true') {
        activeTabId = tab.getAttribute('data-sh-scheduled-tab')
        return true
      }
      return false
    })
    if (!activeTabId) {
      activeTabId = tabs[0].getAttribute('data-sh-scheduled-tab')
    }

    // Deep-linkable tab: `#tab=<id>` overrides the SSR default. We
    // read this AFTER `activeTabId` is initialized so the paint-time
    // fallback is available if the hash names an unknown tab.
    var hashTabId = readTabFromHash()
    if (hashTabId && tabStatusesById[hashTabId] !== undefined) {
      activeTabId = hashTabId
    }

    // First paint: apply the resolved tab (either SSR default or
    // hash override) so the filter matches the highlight. `announce`
    // is false so we don't fire the aria-live region on load — the
    // spec asks for update-driven announcements only.
    activateTab(activeTabId, { announce: false, writeHash: false })

    tabsRoot.addEventListener('click', function (event) {
      var tab = closest(event.target, '[data-sh-scheduled-tab]')
      if (!tab || !tabsRoot.contains(tab)) return
      event.preventDefault()
      var nextId = tab.getAttribute('data-sh-scheduled-tab')
      if (nextId === activeTabId) return
      activateTab(nextId, { announce: true, writeHash: true, focusTab: true })
    })

    // Keyboard nav — WAI-ARIA radiogroup convention with automatic
    // activation: Arrow-Left / Right cycle focus + activate; Home /
    // End jump to the first / last tab; Space / Enter activate the
    // focused tab defensively (focus-move already activated, but a
    // sighted user pressing Space on a chip should still be a
    // no-op-if-already-active rather than a "nothing happened"
    // moment). Only fires when focus is inside the tab group so it
    // never intercepts the list's own tab-order navigation.
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
        case 'Spacebar': // legacy IE / older Edge — cheap to keep
        case 'Enter':
          event.preventDefault()
          activateTab(tabs[currentIdx].getAttribute('data-sh-scheduled-tab'),
            { announce: true, writeHash: true, focusTab: true })
          return
        default:
          return
      }
      event.preventDefault()
      activateTab(tabs[nextIdx].getAttribute('data-sh-scheduled-tab'),
        { announce: true, writeHash: true, focusTab: true })
    })

    // Browser Back / Forward: re-apply whatever tab the new hash
    // names. Guarded against feedback loops via the `activeTabId`
    // no-op check in `activateTab`.
    window.addEventListener('hashchange', function () {
      var id = readTabFromHash()
      if (id && tabStatusesById[id] !== undefined && id !== activeTabId) {
        activateTab(id, { announce: true, writeHash: false, focusTab: false })
      }
    })

    // ── Core activation routine ────────────────────────────────
    // Single choke-point. Applying every state change here (rather
    // than sprinkling `aria-checked` / `hidden` writes across the
    // handlers above) means the click / keyboard / hashchange paths
    // can never fall out of sync.
    function activateTab (tabId, opts) {
      opts = opts || {}
      var statuses = tabStatusesById[tabId]
      if (statuses === undefined) return

      activeTabId = tabId

      // Update tab visual + ARIA state. Roving tabindex per WAI-
      // ARIA — only the active tab is in the natural tab order.
      var activeTab = null
      tabs.forEach(function (tab) {
        var id = tab.getAttribute('data-sh-scheduled-tab')
        var isActive = id === tabId
        tab.classList.toggle('is-active', isActive)
        tab.setAttribute('aria-checked', isActive ? 'true' : 'false')
        tab.setAttribute('tabindex', isActive ? '0' : '-1')
        if (isActive) activeTab = tab
      })

      // Filter rows. Empty statuses list = "match all" (that's the
      // "All" tab); otherwise the row's status must be in the list.
      var visibleCount = 0
      rows.forEach(function (row) {
        var status = row.getAttribute('data-sh-workflow-status') || ''
        var visible = statuses.length === 0 || statuses.indexOf(status) >= 0
        row.hidden = !visible
        if (visible) visibleCount++
      })

      // Empty state — swap in when zero rows pass the filter. Kept
      // as a sibling of the list rather than a nested child so the
      // list's own aria-labelledby / accessible name isn't disturbed
      // by the "no matches" copy.
      if (emptyPanel) emptyPanel.hidden = visibleCount > 0
      if (listRoot) listRoot.hidden = visibleCount === 0

      // Move focus to the newly active tab when the switch came
      // from an intentional user gesture (click / keyboard). Skip
      // for hashchange + first-paint calls so we don't yank focus
      // during page navigation.
      if (opts.focusTab && activeTab) {
        activeTab.focus()
      }

      // Announce the new result count. Skipped on first-paint so
      // AT users don't hear the count the instant the page loads.
      if (opts.announce && statusRegion) {
        statusRegion.textContent = scheduledStatusText(visibleCount, activeTab)
      }

      // URL hash sync — replaceState avoids polluting history when
      // the filter was set programmatically (e.g. from `hashchange`
      // itself). Explicit tab-click / keyboard gestures still push
      // via `location.hash =` so Back / Forward reach every state
      // the user visited.
      if (opts.writeHash) {
        var nextHash = '#tab=' + tabId
        // Guard: don't rewrite if the hash already matches (avoids
        // a `hashchange` echo).
        if (location.hash !== nextHash) {
          location.hash = nextHash
        }
      }
    }

    // Read `?…#tab=<id>` → id, or null if not present. Kept as a
    // separate helper so a future consumer (e.g. a deep-link
    // service) can call it without duplicating the parse.
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

  // aria-live phrasing for the Scheduled tab controller. Pure
  // helper so a future i18n phase can swap the string with an ICU
  // / MessageFormat runner. Picks up the active tab's visible label
  // so the announcement reads as "Showing 5 Scheduled workflows"
  // (not "5 workflows for tab id 'scheduled'").
  function scheduledStatusText (count, activeTab) {
    var labelNode = activeTab && activeTab.querySelector('.seller-home__scheduled-tab-label')
    var label = labelNode ? (labelNode.textContent || '').trim() : ''
    if (count === 0) return 'No workflows match this filter'
    return 'Showing ' + count + ' ' + (label ? label + ' ' : '') +
      'workflow' + (count === 1 ? '' : 's')
  }

  // Per-row overflow menu controller for /scheduled.html. Cloned
  // from `knowledgeDocOverflowController` — same open / close /
  // Escape / Arrow-Up / Arrow-Down / outside-click semantics. Kept
  // separate so the two controllers can diverge in the future
  // (different action dispatch payloads, different keyboard
  // shortcuts) without cross-referencing.
  //
  // State: single-open menu enforced via the `openMenu` /
  // `openTrigger` pair — opening a second menu closes the first,
  // matching SLDS' one-menu-at-a-time convention.
  function scheduledWorkflowOverflowController (listRoot) {
    var openMenu = null
    var openTrigger = null

    function setMenuState (trigger, menu, isOpen) {
      menu.hidden = !isOpen
      menu.classList.toggle('is-open', isOpen)
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
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

    listRoot.addEventListener('click', function (event) {
      // Trigger click → toggle the menu. Guarded via
      // `[data-sh-workflow-stop]` on the menu wrapper so the
      // parent row's click handler (a future detail-view opener)
      // doesn't race with the menu open.
      var trigger = closest(event.target, '[data-sh-workflow-menu-trigger]')
      if (trigger) {
        event.stopPropagation()
        event.preventDefault()

        var container = closest(trigger, '[data-sh-workflow-menu]')
        var menu = container && container.querySelector('[data-sh-workflow-menu-list]')
        if (!menu) return

        var willOpen = menu.hidden
        if (openMenu && openMenu !== menu) closeOpenMenu(false)
        setMenuState(trigger, menu, willOpen)
        if (willOpen) {
          var first = menu.querySelector('[data-sh-workflow-action]')
          if (first) first.focus()
        }
        return
      }

      // Action click → dispatch, then close the menu. `workflowId`
      // is read from the row wrapper (not the anchor / div body,
      // which may not exist on unlinked rows) so unlinked rows
      // still emit the correct id.
      var actionBtn = closest(event.target, '[data-sh-workflow-action]')
      if (!actionBtn) return

      event.stopPropagation()
      event.preventDefault()

      var actionId = actionBtn.getAttribute('data-sh-workflow-action')
      var row = closest(actionBtn, '[data-sh-workflow-item]')
      var workflowId = row ? row.getAttribute('data-sh-workflow-id') : ''

      document.dispatchEvent(new CustomEvent('sh:workflow-action', {
        detail: { action: actionId, workflowId: workflowId }
      }))
      // eslint-disable-next-line no-console
      console.info('[seller-home] workflow action:', actionId,
        workflowId ? '(' + workflowId + ')' : '')

      closeOpenMenu(false)
    })

    // Keyboard nav inside the open menu — same contract Knowledge
    // uses. Only engages when a menu is open.
    listRoot.addEventListener('keydown', function (event) {
      if (!openMenu) return

      if (event.key === 'Escape') {
        event.preventDefault()
        closeOpenMenu(true)
        return
      }

      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (!openMenu.contains(document.activeElement) &&
          openTrigger !== document.activeElement) return

      var items = toArray(openMenu.querySelectorAll('[data-sh-workflow-action]'))
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
    // by `!openMenu` so it no-ops when nothing is open.
    document.addEventListener('click', function (event) {
      if (!openMenu) return
      var container = closest(event.target, '[data-sh-workflow-menu]')
      if (container && container.contains(openMenu)) return
      closeOpenMenu(false)
    })
  }

  // ── Knowledge search ────────────────────────────────────────────
  // Client-side filter for the /knowledge.html doc list. Wires a
  // single controller across four pieces of markup:
  //
  //   • [data-sh-knowledge-search]         → the <input type="search">
  //   • [data-sh-knowledge-search-clear]   → the trailing × button
  //   • [data-sh-knowledge-search-status]  → visually-hidden aria-live
  //                                          region (result-count for
  //                                          screen readers)
  //   • [data-sh-knowledge-doc-item]s      → each row exposes its
  //                                          name + type via data-
  //                                          attributes so we filter
  //                                          without rescanning text
  //                                          content
  //   • [data-sh-knowledge-empty]          → the "no matches" panel
  //                                          swapped in when every
  //                                          row is filtered out
  //
  // Contract:
  //   • Query is trimmed (leading + trailing whitespace) so a
  //     stray space at the end doesn't render an unhelpful "no
  //     matches" state.
  //   • Empty query → all rows visible + empty state hidden. This
  //     matches "Restore all documents when the query is cleared".
  //   • Matching is case-insensitive substring against `name` OR
  //     `type` per row (Figma spec: "Also support matching the
  //     document type").
  //   • The input is never re-rendered / replaced. Filtering only
  //     toggles the `hidden` attribute on rows, so keyboard focus
  //     stays in the field across every keystroke.
  //   • aria-live region updates ONLY when the visible count
  //     actually changes — otherwise a screen reader would re-
  //     announce the same "3 documents" text on every keystroke.
  //   • No submit button, no debounce — the filter is O(rows) and
  //     the row count is small enough that per-keystroke rebuilds
  //     are imperceptible.
  //
  // Not in scope: sorting, advanced filters, status filters, table-
  // like column controls. The Phase-4 spec explicitly rules those
  // out; this function is intentionally a "flat name-or-type
  // substring filter" and nothing more.
  function bindKnowledgeSearch (fieldRoot, listRoot) {
    var input = fieldRoot.querySelector('[data-sh-knowledge-search]')
    var clearBtn = fieldRoot.querySelector('[data-sh-knowledge-search-clear]')
    var status = fieldRoot.querySelector('[data-sh-knowledge-search-status]')
    if (!input) return

    // Empty state lives inside the list partial (sibling of the ul),
    // not the search field, so we resolve it against the shared
    // ancestor rather than either subtree.
    var emptyState = null
    var listParent = listRoot.parentNode
    if (listParent) {
      emptyState = listParent.querySelector('[data-sh-knowledge-empty]')
    }

    // Snapshot rows once at bind time. `bindKnowledgeSearch` runs
    // after the doc list is in the DOM, and Phase 4 has no
    // append-at-runtime path — a future virtualized list would
    // re-query on demand or dispatch a "list changed" event we'd
    // listen for. Kept as a live `toArray` copy so the caller
    // can still add rows and re-invoke this bind if that ever
    // changes.
    var rows = toArray(listRoot.querySelectorAll('[data-sh-knowledge-doc-item]'))
    var totalCount = rows.length
    // Track the last announced count so we don't re-fire the live
    // region for identical results (see contract above).
    var lastAnnouncedCount = null

    function normalize (value) {
      return (value == null ? '' : String(value)).toLowerCase()
    }

    function applyFilter (rawQuery) {
      // Trim so trailing whitespace never zeroes out results.
      var query = (rawQuery == null ? '' : String(rawQuery)).trim().toLowerCase()
      var visibleCount = 0

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        var visible
        if (!query) {
          // Empty query → restore all documents (spec).
          visible = true
        } else {
          var name = normalize(row.getAttribute('data-sh-knowledge-doc-name'))
          var type = normalize(row.getAttribute('data-sh-knowledge-doc-type'))
          visible = name.indexOf(query) !== -1 || type.indexOf(query) !== -1
        }

        // Only mutate the DOM when the visibility actually changes —
        // spares the browser a needless attribute write per row per
        // keystroke on large lists.
        if (visible) {
          if (row.hasAttribute('hidden')) row.removeAttribute('hidden')
          visibleCount++
        } else if (!row.hasAttribute('hidden')) {
          row.setAttribute('hidden', '')
        }
      }

      // Toggle the empty state + swap out the list surface when the
      // query filters out every row. `hidden` on the list keeps its
      // 8-px gap collapsed so the empty state sits flush under the
      // search field.
      if (emptyState) {
        if (visibleCount === 0 && query) {
          emptyState.hidden = false
          listRoot.hidden = true
        } else {
          emptyState.hidden = true
          listRoot.hidden = false
        }
      }

      // Clear button surfaces only when the input has content. Uses
      // the raw (untrimmed) value so a solo-space query still shows
      // the clear affordance — the user wants to be able to remove
      // whatever they typed, even if it doesn't currently filter.
      if (clearBtn) {
        var hasValue = rawQuery != null && String(rawQuery).length > 0
        clearBtn.hidden = !hasValue
      }

      // Announce the count only when it changes. `role="status"` +
      // `aria-live="polite"` means the message is queued between
      // typing bursts; setting the same text on every keystroke
      // would let some engines re-announce, interrupting typing.
      if (status && visibleCount !== lastAnnouncedCount) {
        lastAnnouncedCount = visibleCount
        status.textContent = knowledgeSearchStatusText(visibleCount, totalCount, query)
      }
    }

    // Bind on `input` (not `change`) so filtering happens as the
    // user types — matches the spec's "Filter the document list
    // locally as the user types" requirement.
    input.addEventListener('input', function () {
      applyFilter(input.value)
    })

    // Some browsers fire `search` (not `input`) when the user hits
    // the built-in ESC-to-clear on `type="search"`. Handle both so
    // keyboard-clear stays in sync with our own clear button.
    input.addEventListener('search', function () {
      applyFilter(input.value)
    })

    if (clearBtn) {
      clearBtn.addEventListener('click', function (event) {
        event.preventDefault()
        input.value = ''
        applyFilter('')
        // Keyboard focus stays in the field across a clear (spec:
        // "Keep keyboard focus in the field while results update").
        input.focus()
      })
    }

    // Seed the "last announced count" so the first keystroke that
    // filters the list produces a genuine delta announcement.
    // Deliberately DO NOT set the live region's text on load — an
    // `aria-live="polite"` node populated at bind time can be
    // (mis-)announced by some screen readers as "N documents" the
    // instant the page renders, and the spec only asks for update-
    // driven announcements. Result-count text is set the first
    // time the user actually types.
    lastAnnouncedCount = totalCount
  }

  // Result-count phrasing for the aria-live region. Kept as a pure
  // helper so a future i18n phase can swap this out with an ICU /
  // MessageFormat runner without touching the controller. Message
  // varies by state:
  //   • query empty                 → "N documents"
  //   • query non-empty, no match   → "No knowledge found"
  //   • query non-empty, some match → "N of M documents"
  function knowledgeSearchStatusText (visibleCount, totalCount, query) {
    if (!query) {
      return visibleCount + ' document' + (visibleCount === 1 ? '' : 's')
    }
    if (visibleCount === 0) {
      return 'No knowledge found'
    }
    return visibleCount + ' of ' + totalCount +
      ' document' + (totalCount === 1 ? '' : 's')
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
