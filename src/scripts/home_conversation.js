// ──────────────────────────────────────────────────────────────────────
// Seller Home — Conversation drill-in behavior
// =====================================================================
// Owned by /home_conversation.html. Loaded from that page's
// {% block scripts_extra %} AFTER home.js so the left-nav collapse
// toggle is already wired by the time this file runs.
//
// Responsibilities
// ----------------
//   • URL + header: read `?id=<conversationId>` from `location.search`
//     to pick which thread this is (falling back to the build's
//     default), title the header, and highlight the matching recent in
//     the left nav. The URL is the sole source of truth for both.
//   • Arriving from Seller Home: that page's composer sends the typed
//     text over as `?q=`. It titles the thread and is echoed as the
//     seller's opening message, so a canned conversation reads as an
//     answer to what they actually asked.
//   • Prospect table: wire the X in each row, which takes a prospect
//     out of the batch and puts it back. Rows are not selectable and
//     not focusable — see the binder for what that replaced. Kept
//     independent so the table works as a standalone list even
//     without a review controller attached.
//   • Expanding a table: the button on a workflow-activity chip moves
//     the table it names into the page's expanded-table dialog and back
//     out again on close. It's a move, not a copy — see
//     `bindTableExpand` for why that matters.
//   • Cadence card: mounted from home_conversation_cadence.js, which
//     owns the drafted sequences. Wired here only so build-time and
//     runtime-injected messages go through one code path.
//   • Outreach review (DORMANT): the per-review SelectionManager that
//     drove the old one-draft-at-a-time surface. The cadence card
//     replaced it; the controller stays so the review can be brought
//     back from data (see `_reviewParked` in index.json).
//   • Approve-all dialog: SLDS 2 modal with focus trap +
//     Escape/backdrop close + focus restore. Also dormant with the
//     review — the cadence card ships its own.
//   • Composer: autosize, Enter-to-send, simulated voice input (mic →
//     waveform → hardcoded transcript), and the scripted-turn queue
//     (send → thinking indicator → hardcoded reply). See
//     `bindConvComposer`. On conv-001, a confirmed voice send also
//     rewrites Marcus Chen's Email 1 via `ShCadence.applyVoiceRevision`.
//   • Opening sequence: on load, play the conversation's staged
//     messages in on a timer instead of painting the finished thread,
//     so arriving here looks like the agent working. Same beat player
//     the send interaction uses.
//   • Choosing the thread: the build renders EVERY conversation in the
//     registry into `<template>`s tagged `data-sh-conv-for="<id>"`,
//     because a static page can't know the URL. This file takes the
//     set matching the active id and clones it into the thread; the
//     rest stay inert.
//
// Communication model
// -------------------
// Selection sync flows through the DOM event `sh:conv-row-select`
// (payload: { rowId, source: 'table'|'review' }). Both ends of it are
// currently quiet: the table stopped selecting rows on click, and the
// review that dispatched on Prev/Next is parked. The cadence card
// still fires it, and still subscribes, so a restored selection model
// binds to a live channel rather than a new one.
//
// Every listener treats the event as authoritative — no direct calls
// between views, so a future third consumer (analytics, detail pane)
// can subscribe without needing a reference to either module.
//
// Review-decision changes flow through `sh:review-decision`
// (payload: { rowId?, decision: 'approve'|'request_changes'|
// 'approve_all', feedback? }). Kept as a separate event name so a
// listener that only cares about selection changes doesn't get
// spammed on approval churn.
//
// What this file INTENTIONALLY does NOT do yet:
//   • Send anywhere. The composer plays back a scripted queue from
//     the page data; there is no request, no streaming, and no
//     generated content.
//   • Fetch data — the conversations map is inlined as JSON by
//     Nunjucks at build time and read from `[data-sh-conversations]`.
//   • Manage history / scroll restoration — the drill-in uses
//     native `<a href>` navigation, so the browser handles
//     back-button + scroll-restoration for free.
// ──────────────────────────────────────────────────────────────────────

(function () {
  'use strict'

  // ── Config ──────────────────────────────────────────────────────
  var SELECTORS = {
    root:         '[data-sh-conv-root]',
    title:        '[data-sh-conv-title]',
    recentLinks:  '[data-sh-recent-conv]',
    // Prospect table (embedded in an agent message):
    //   `convTable`  — the wrapper carrying `data-sh-conv-table`.
    //   `convRow`    — the <tr> elements. Not selectable; the id on each
    //                  is how a decision finds its prospect.
    //   `convReject` — the X in the Prospect cell, the row's only
    //                  control. There was a `convAccept` beside it until
    //                  the table became opt-out.
    convTable:    '[data-sh-conv-table]',
    convRow:      '[data-sh-conv-row]',
    convReject:   '[data-sh-conv-reject]',
    // Signal cells. The template renders every signal as a badge and
    // `fitSignalBadges` decides how many survive; `signalMore` is the
    // "+N more" that reports the rest.
    signalCell:   '[data-sh-signal-fit]',
    signalBadge:  '.ptl-signal-badge',
    signalMore:   '[data-sh-signal-more]',
    // Expanding a table into the large dialog. The trigger lives
    // on a workflow-activity chip and carries the id of the table it
    // opens; the dialog is a page-level singleton whose content area is
    // the host the table is MOVED into. See `bindTableExpand`.
    convExpand:      '[data-sh-conv-expand]',
    tableModal:      '[data-sh-conv-table-modal]',
    tableModalBack:  '[data-sh-conv-table-modal-backdrop]',
    tableModalHost:  '[data-sh-conv-table-modal-host]',
    tableModalTitle: '[data-sh-conv-table-modal-title]',
    tableModalMeta:  '[data-sh-conv-table-modal-status]',
    tableModalClose: '[data-sh-conv-table-modal-close]',
    tableModalDone:  '[data-sh-conv-table-modal-done]',
    // Outreach review (rendered by _home_outreach_review.html):
    reviewRoot:   '[data-sh-review-root]',
    // Confirmation dialog for "Approve all" (sibling of the review):
    reviewDialog:    '[data-sh-review-dialog]',
    reviewBackdrop:  '[data-sh-review-dialog-backdrop]',
    // Composer + the scripted send/reply demo:
    //   `thread`      — the scroll surface (scrolled to on new content).
    //   `threadInner` — the <ol role="log"> new messages append into.
    //   `*Template`   — inert markup cloned in at send time.
    thread:           '[data-sh-conv-thread]',
    threadInner:      '[data-sh-conv-thread-inner]',
    threadEmpty:      '.seller-home__conv-thread-empty',
    composer:         '[data-sh-conv-composer]',
    composerInput:    '[data-sh-conv-composer-input]',
    composerSend:     '[data-sh-conv-composer-send]',
    composerMic:       '[data-sh-conv-composer-mic]',
    composerRecording: '[data-sh-conv-composer-recording]',
    composerWaveform:  '[data-sh-conv-composer-waveform]',
    composerMicStop:   '[data-sh-conv-composer-mic-stop]',
    composerMicConfirm: '[data-sh-conv-composer-mic-confirm]',
    userTemplate:     '[data-sh-conv-user-template]',
    thinkingTemplate: '[data-sh-conv-thinking-template]',
    thinkingItem:     '[data-sh-conv-thinking]',
    // The Schedule flow's reply, and the pieces JS fills in a clone of
    // it. Unlike a scripted turn, the copy arrives from the state
    // machine at send time — see `runScheduleTurn`.
    scheduleTemplate:     '[data-sh-conv-schedule-template]',
    scheduleChipTemplate: '[data-sh-conv-schedule-chip-template]',
    scheduleSummary:      '[data-sh-conv-summary]',
    scheduleSummaryValue: '[data-sh-conv-summary-value]',
    scheduleChips:        '[data-sh-conv-chips]',
    scheduleChip:         '[data-sh-conv-chip]',
    // Per-conversation templates. Every conversation in the registry
    // renders its own set, so these are always narrowed by the active
    // id (see `scopedSelector`) before being queried.
    inlineTemplate:   '[data-sh-conv-inline]',
    stageTemplate:    '[data-sh-conv-stage]',
    turnTemplate:     '[data-sh-conv-turn]',
    // Clickable bullet in a "suggested next steps" message:
    suggestion:       '[data-sh-conv-suggestion]'
  }
  // Conversations whose opening has already played, this session.
  //
  // What separates a thread that should unfold from one that should
  // simply be there is whether you have opened it before — not whether
  // you arrived with a question. Opening "Found new prospects" for the
  // first time is the agent doing the work, so it thinks and writes;
  // coming back to it afterwards is reading your own history, so it is
  // just there.
  //
  // sessionStorage, and cleared by home.js alongside Recents whenever the
  // demo restarts (the Home tab's reset, or a refresh) — so a restart
  // genuinely replays every conversation from scratch.
  var CONV_SEEN_KEY = 'sh:convSeen'

  function sk (key) {
    return (window.SH && typeof window.SH.storageKey === 'function')
      ? window.SH.storageKey(key)
      : key
  }

  function readSeenConversations () {
    try {
      var raw = window.sessionStorage.getItem(sk(CONV_SEEN_KEY))
      if (!raw) return []
      var parsed = JSON.parse(raw)
      return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : []
    } catch (e) {
      // Unreadable — treat as never seen, which replays rather than
      // silently skipping the reveal.
      return []
    }
  }

  function hasPlayedOpening (convId) {
    if (!convId) return false
    var seen = readSeenConversations()
    for (var i = 0; i < seen.length; i++) {
      if (seen[i] === convId) return true
    }
    return false
  }

  function markOpeningPlayed (convId) {
    if (!convId) return
    try {
      var seen = readSeenConversations()
      for (var i = 0; i < seen.length; i++) {
        if (seen[i] === convId) return
      }
      seen.push(convId)
      window.sessionStorage.setItem(sk(CONV_SEEN_KEY), JSON.stringify(seen))
    } catch (e) {
      // Silent — worst case the thread replays its opening next time.
    }
  }

  // Class the review section toggles when the confirmation dialog
  // opens (mirrors SLDS `slds-fade-in-open` semantically).
  var DIALOG_OPEN_CLASS = 'is-open'
  // The real SLDS pair, used by the expanded-table dialog: `.slds-modal`
  // and `.slds-backdrop` both ship invisible and these are what the
  // design system expects JS to add. (The review's dialog above predates
  // it and paints its own open state — hence two spellings of "open".)
  var MODAL_OPEN_CLASS    = 'slds-fade-in-open'
  var BACKDROP_OPEN_CLASS = 'slds-backdrop_open'
  // transitions.dev's modal hook (06-modal.md), on the dialog container
  // inside `.slds-modal`. The `is-open` / `is-closing` classes it takes
  // are only ever used compounded with `.t-modal`, so they don't collide
  // with DIALOG_OPEN_CLASS above.
  var MODAL_TRANSITION    = '.t-modal'
  // Class the composer carries while a scripted turn is in flight.
  var BUSY_CLASS = 'is-busy'
  // Composer is capturing a simulated voice input: toolbar hidden,
  // waveform + Stop / Check showing.
  var RECORDING_CLASS = 'is-recording'
  // Hardcoded transcript inserted when the seller confirms a recording.
  // Overridden per conversation by `voiceInput.transcript`.
  var DEFAULT_VOICE_TRANSCRIPT = 'Hunter, I actually met Maya who\'s a coworker of Marcus at Dreamforce, and she wanted to stay close to this evaluation. Can we mention her in the email?'
  // Short beat after a confirmed voice send, before the cadence card
  // starts its own regenerating stencil.
  var VOICE_THINKING_MS = 1200
  // Skill chip inside the composer. Also the hook the CSS styles and
  // the marker the text serializer uses to tell a chip apart from the
  // seller's own typing, so it lives here rather than inline.
  var PILL_CLASS = 'seller-home__conv-composer-pill'
  // Chip glyph, built with DOM calls rather than a markup string so a
  // skill name can never become an injection path. These two paths are
  // the same glyph the skill chips on /skills.html use, so the
  // composer's chip and the on-page ones stay identical. Module scope
  // because the composer seeds a chip during binding, before a
  // function-scoped `var` would have been assigned.
  var SVG_NS = 'http://www.w3.org/2000/svg'
  var PILL_ICON_PATHS = [
    {
      transform: 'translate(0.616 0.9232)',
      evenodd: true,
      d: 'M11.4591 0C12.434 0 13.2409 0.758083 13.3017 1.73107L13.8242 10.0922H13.8462C14.3702 10.0922 14.7692 10.5235 14.7692 11.0231V12.277C14.7692 13.2992 13.9569 14.1538 12.9231 14.1538H5.23077V14.153C5.21938 14.1532 5.20797 14.1538 5.19652 14.1538C4.19111 14.1538 3.39997 13.3304 3.38523 12.3402L2.92969 4.61538H0.923077C0.413277 4.61538 0 4.20212 0 3.69231V1.84615C0 0.826551 0.826551 0 1.84615 0H11.4591ZM7.0084 12.3119C7.0084 12.5253 6.97191 12.731 6.90535 12.9231H12.9231C13.2487 12.9231 13.5384 12.6482 13.5385 12.277V11.323H7.0084V12.3119ZM3.88643 1.23077C3.95646 1.42473 3.99597 1.63301 3.99911 1.84916L4.61418 12.2758L4.61538 12.2939V12.3119C4.61538 12.6638 4.88978 12.923 5.19652 12.9231C5.50326 12.9231 5.77763 12.6638 5.77763 12.3119V11.0231C5.77763 10.5235 6.17674 10.0923 6.70071 10.0922H12.591L12.0733 1.80769C12.053 1.4834 11.7841 1.23077 11.4591 1.23077H3.88643ZM1.84615 1.23077C1.50629 1.23077 1.23077 1.50629 1.23077 1.84615V3.38462H2.85726L2.77043 1.91316L2.76923 1.89513V1.8768C2.76917 1.50559 2.47945 1.23077 2.15385 1.23077H1.84615Z'
    },
    {
      transform: 'translate(5.8464 3.6928)',
      evenodd: false,
      d: 'M2.80839 0.135688C2.89334 -0.0416965 3.14762 -0.0461579 3.23867 0.128181L3.8826 1.36166C4.07491 1.73298 4.3835 2.03049 4.76153 2.2096L6.01722 2.80997C6.19473 2.89483 6.1991 3.14889 6.02473 3.23993L4.79067 3.88387C4.41913 4.07609 4.12131 4.38437 3.94211 4.76218L3.34143 6.01729C3.25651 6.1947 3.00223 6.19917 2.91116 6.0248L2.26691 4.79132C2.07463 4.42006 1.7663 4.12249 1.38833 3.94338L0.135619 3.3427C-0.0416732 3.25778 -0.046135 3.00409 0.128111 2.91304L1.36217 2.2691C1.73371 2.07689 2.03147 1.76535 2.21073 1.3908L2.80839 0.135688Z'
    }
  ]
  // Fallback thinking duration when a turn omits `thinkingMs` (or
  // ships an unparseable one).
  var DEFAULT_THINKING_MS = 2000
  // The Schedule flow's own beat. A scripted turn's 2 s stands in for
  // work the demo isn't doing; the state machine really does answer
  // immediately, so this is short — just long enough for the working
  // row to read as a beat rather than a flicker.
  var SCHEDULE_THINKING_MS = 600
  // Custom-event names. Kept as string constants so future
  // consumers can subscribe without importing this module.
  var EVT_ROW_SELECT = 'sh:conv-row-select'
  var EVT_DECISION   = 'sh:review-decision'
  // Raised by a row's Accept / Reject button. The outreach review
  // listens for it and applies the same per-prospect status its own
  // buttons would, so a decision made in the table shows up in the
  // review's progress count, status pill, and completion state.
  var EVT_TABLE_DECISION = 'sh:conv-row-decision'
  // Class + ARIA attributes applied to the recent whose
  // `data-sh-recent-conv` matches the URL's `?id=`. Same class name
  // `.is-active` used by the primary nav so styling stays in one
  // place (`.seller-home__nav-recent.is-active` in home.scss).
  var ACTIVE_CLASS = 'is-active'
  var ARIA_CURRENT = 'aria-current'
  // Attribute on `[data-sh-conv-root]` holding the entity-encoded
  // JSON blob of conversation entries.
  var ATTR_CONVERSATIONS = 'data-sh-conversations'
  // Conversation to open when the URL names none (or names one the
  // registry doesn't have), so a bare /home_conversation.html still
  // lands on a thread.
  var ATTR_DEFAULT_CONV  = 'data-sh-conv-default'
  // Conversation ids are authored, not user input, and they end up
  // inside an attribute selector — so anything that isn't a plain
  // slug is rejected rather than escaped.
  var ID_PATTERN = /^[a-zA-Z0-9_-]+$/
  // Longest `?q=` echoed into the thread. Matches the cap the Seller
  // Home composer applies before it navigates; enforced again here
  // because the URL can be edited by hand.
  var QUERY_MAX = 500

  // Breathing room left above an anchored message when a reply scrolls
  // it to the top of the thread, so it doesn't sit flush against the
  // edge and read as clipped.
  var SCROLL_ANCHOR_GUTTER = 12

  // ── Utilities ───────────────────────────────────────────────────
  // Parse the `?id=<value>` from the current URL. Wrapped in
  // try/catch because URLSearchParams throws on malformed input in
  // some legacy browsers we still support on the demo surface;
  // returning null lets the caller fall back to `defaultConversationId`.
  function readConversationIdFromUrl () {
    try {
      var params = new URLSearchParams(window.location.search)
      var raw = params.get('id')
      if (!raw) return null
      var trimmed = String(raw).trim()
      if (!ID_PATTERN.test(trimmed)) return null
      return trimmed
    } catch (e) {
      return null
    }
  }

  // Parse `?q=<text>` — what the seller typed into the Seller Home
  // composer before it sent them here. Echoed into the thread as
  // their opening message and used as the header title, so arriving
  // from Home reads as one continuous conversation rather than a
  // canned thread that happens to answer.
  //
  // Absent on the Ready to Review drill-in, which is why that thread
  // still opens straight on the agent.
  function readQueryFromUrl () {
    try {
      var params = new URLSearchParams(window.location.search)
      var raw = params.get('q')
      if (!raw) return null
      var trimmed = String(raw).trim().slice(0, QUERY_MAX)
      return trimmed || null
    } catch (e) {
      return null
    }
  }

  // Narrow a template selector to one conversation's set.
  function scopedSelector (selector, id) {
    return selector + '[data-sh-conv-for="' + id + '"]'
  }

  // Parse the inlined conversations JSON blob. Empty object return
  // on any failure so the caller can safely `map[id]` without a
  // guard.
  function readConversationsMap (root) {
    if (!root) return {}
    var raw = root.getAttribute(ATTR_CONVERSATIONS)
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch (e) {
      return {}
    }
  }

  // Dispatch a bubbling CustomEvent from `sourceEl`. Wrapped so
  // legacy browsers that lack `new CustomEvent(...)` (very few
  // remain) fail silently instead of throwing.
  function dispatch (sourceEl, name, detail) {
    try {
      var evt = new CustomEvent(name, { bubbles: true, detail: detail || {} })
      sourceEl.dispatchEvent(evt)
    } catch (e) { /* legacy browser: no-op */ }
  }

  // ── Boot ────────────────────────────────────────────────────────
  function init () {
    var root = document.querySelector(SELECTORS.root)
    if (!root) return

    var map = readConversationsMap(root)

    // Which thread this is. The URL wins; a missing or unknown id
    // falls back to the build's default so the page always opens on
    // something rather than an empty shell.
    var id = readConversationIdFromUrl()
    var has = function (key) {
      return !!key && Object.prototype.hasOwnProperty.call(map, key)
    }

    // An id the registry doesn't know may still name a scheduling draft
    // held client-side (the Schedule button mints one and links here).
    // Resolve that BEFORE the default-conversation fallback below, which
    // would otherwise drop the seller into an unrelated thread.
    var draft = null
    if (!has(id) && id && window.SellerHomeScheduling &&
        typeof window.SellerHomeScheduling.readDraft === 'function') {
      draft = window.SellerHomeScheduling.readDraft(id)
    }

    // A draft has no build-time thread or reply script, so it opens as a
    // genuinely empty conversation: leaving `id` null keeps the stage and
    // turn lookups empty, which leaves the thread on its placeholder and
    // puts the composer in echo-only mode. That is the correct shape for
    // a conversation the seller is starting right now.
    var draftId = draft ? id : null
    if (draft) {
      id = null
      root.setAttribute('data-sh-conversation-id', draft.id)
    } else {
      if (!has(id)) id = root.getAttribute(ATTR_DEFAULT_CONV)
      if (!has(id) || !ID_PATTERN.test(id)) id = null
      if (id) root.setAttribute('data-sh-conversation-id', id)
    }

    var entry = id ? map[id] : null

    // What the seller typed on Seller Home, if they arrived that way.
    var query = readQueryFromUrl()

    // Their own words title the thread when they wrote them — the
    // conversation's authored title is the fallback for every other
    // way in, and a draft carries its own ("Schedule <skill>").
    var heading = query || (entry && entry.title) || (draft && draft.title)
    var titleEl = root.querySelector(SELECTORS.title)
    if (heading && titleEl) {
      titleEl.textContent = heading
      titleEl.setAttribute('title', heading)
    }
    // A draft's thread isn't in the build, so the served <title> is the
    // generic one. Match the tab to the header for it — the other paths
    // already agree, and rewriting theirs would be a behaviour change.
    if (draft && heading) {
      try { document.title = heading } catch (e) { /* noop */ }
    }

    // Recent highlight + intercept redundant clicks. Keyed on the
    // conversation in the URL, which for a draft is `draftId` — `id` is
    // deliberately null there, and passing that would strip the
    // highlight off the row the seller just arrived on.
    var openId = draftId || id
    applyActiveRecent(openId)
    bindRecentClicks(openId)

    // Wire the tables + reviews the server rendered. The same
    // function runs again on anything cloned in later, so build-time
    // and runtime content get identical behavior.
    bindMessageContent(document, map)

    // The expand-a-table path. Bound once for the page rather
    // than per message: there's one dialog, and the trigger is found by
    // delegation, so a chip cloned in mid-thread needs no re-wiring.
    bindTableExpand()

    // Workflow drill-in. `switchPanel` first, so the layout is in its
    // final state before anything measures or focuses inside it; the
    // binders then run against every panel, including the hidden ones,
    // which costs nothing and means a later reveal needs no re-wiring.
    switchPanel(openId, entry)
    var panels = document.querySelectorAll('[data-sh-workflow-panel]')
    for (var p = 0; p < panels.length; p++) bindWorkflowSidePanel(panels[p])
    bindReopenPanel()

    // Run History dropdown, on the same terms as the panels above:
    // reveal the one belonging to this conversation, then bind every
    // menu including the hidden ones so a later reveal needs no
    // re-wiring.
    switchRunHistory(openId)
    var runMenuEls = document.querySelectorAll('[data-sh-run-menu]')
    for (var r = 0; r < runMenuEls.length; r++) bindRunHistoryMenu(runMenuEls[r])
    bindRunHistoryGlobals()

    // Composer: autosize, Enter-to-send, and the scripted reply queue.
    // It owns the thread mutations and the busy state, so the opening
    // sequence plays through the handle it returns rather than
    // reaching into the thread itself.
    var conv = bindConvComposer(root, map, id, draftId)
    if (conv) conv.playOpening(query)
  }

  // Attach the interactive behaviors that live INSIDE an agent
  // message, for every one found in `scope`. Called once for the
  // document at boot and again per injected reply — which is why
  // neither binder may assume it's the only one on the page.
  function bindMessageContent (scope, convMap) {
    if (!scope || !scope.querySelectorAll) return

    // Prospect tables: the per-row X, and nothing else.
    var tables = scope.querySelectorAll(SELECTORS.convTable)
    for (var t = 0; t < tables.length; t++) bindProspectTable(tables[t])

    // Cadence cards: the drafted sequence of touches per prospect.
    // Owns its own file — it subscribes to the same
    // `sh:conv-row-decision` / `sh:review-decision` events the table
    // speaks, so nothing here needs to know what it does with them.
    if (window.ShCadence) window.ShCadence.mount(scope)

    // Outreach reviews: dormant. The cadence card replaced the
    // single-draft review, so this loop finds nothing — left in place
    // (with its controller below) so restoring the review is a data
    // and template change rather than a rewrite. See `_reviewParked`
    // in index.json.
    var reviews = scope.querySelectorAll(SELECTORS.reviewRoot)
    for (var r = 0; r < reviews.length; r++) {
      bindOutreachReview(reviews[r], convMap)
    }
  }

  // ── Recent-links highlight (unchanged from prior phase) ─────────
  function applyActiveRecent (id) {
    var links = document.querySelectorAll(SELECTORS.recentLinks)
    for (var i = 0; i < links.length; i++) {
      var link = links[i]
      var isMatch = !!id && link.getAttribute('data-sh-recent-conv') === id
      if (isMatch) {
        link.classList.add(ACTIVE_CLASS)
        link.setAttribute(ARIA_CURRENT, 'page')
      } else {
        link.classList.remove(ACTIVE_CLASS)
        link.removeAttribute(ARIA_CURRENT)
      }
    }
  }

  function bindRecentClicks (activeId) {
    if (!activeId) return
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest
        ? event.target.closest(SELECTORS.recentLinks)
        : null
      if (!link) return
      var linkId = link.getAttribute('data-sh-recent-conv')
      if (linkId === activeId) event.preventDefault()
    })
  }

  // ──────────────────────────────────────────────────────────────
  // Composer + scripted reply queue
  // ──────────────────────────────────────────────────────────────
  // One send plays one scripted turn:
  //
  //   type → Send → echo the seller's message
  //               → thinking indicator (turn's `thinkingMs`)
  //               → append the turn's pre-rendered reply
  //
  // The opening sequence is the same motion without the echo, played
  // on load instead of on send — so both go through `playBeat` and
  // there's one definition of what "the agent is working" looks like.
  // Returns a handle so `init` can start it; see `playOpening`.
  //
  // Every piece of markup involved is rendered by Nunjucks into an
  // inert <template> (see home_conversation.html) and cloned in here,
  // so a reply goes through the same macros as the SSR thread and can
  // carry anything a message can — including a prospect table and its
  // outreach review, which get wired on insertion.
  //
  // Turns are consumed in DOM order, one per send. When the queue runs
  // out, sending still echoes the seller's message but no reply comes
  // back — the demo ends rather than looping stale content (which
  // would also collide on the `data-sh-conv-msg` ids).
  //
  // Nothing here talks to a server. Text the seller types is written
  // with `textContent`, so it's data in every path.
  // `scheduleDraftId`, when set, names a scheduling draft in
  // `SellerHomeScheduling` rather than a build-time conversation. It is
  // the source of the composer's opening prompt and is retired on the
  // first send; see the prefill block below and `submit`.
  function bindConvComposer (root, convMap, convId, scheduleDraftId) {
    var form        = root.querySelector(SELECTORS.composer)
    var input       = root.querySelector(SELECTORS.composerInput)
    var send        = root.querySelector(SELECTORS.composerSend)
    var mic         = root.querySelector(SELECTORS.composerMic)
    var recordingEl = root.querySelector(SELECTORS.composerRecording)
    var waveformEl  = root.querySelector(SELECTORS.composerWaveform)
    var micStop     = root.querySelector(SELECTORS.composerMicStop)
    var micConfirm  = root.querySelector(SELECTORS.composerMicConfirm)
    var thread      = root.querySelector(SELECTORS.thread)
    var threadInner = root.querySelector(SELECTORS.threadInner)
    if (!form || !input || !send || !thread || !threadInner) return

    var userTpl     = root.querySelector(SELECTORS.userTemplate)
    var thinkingTpl = root.querySelector(SELECTORS.thinkingTemplate)
    var scheduleTpl     = root.querySelector(SELECTORS.scheduleTemplate)
    var scheduleChipTpl = root.querySelector(SELECTORS.scheduleChipTemplate)

    // Every conversation in the registry rendered its own templates,
    // so each lookup below is narrowed to the active one. An unknown
    // id matches nothing: the thread keeps its placeholder and Send
    // only echoes — a dead demo rather than a broken page.
    var inlineTpl = convId
      ? root.querySelector(scopedSelector(SELECTORS.inlineTemplate, convId))
      : null

    // The reply queue, in document order.
    var turns = []
    if (convId) {
      var turnNodes = root.querySelectorAll(
        scopedSelector(SELECTORS.turnTemplate, convId)
      )
      for (var i = 0; i < turnNodes.length; i++) turns.push(turnNodes[i])
    }

    // The opening sequence, likewise — play order is document order.
    var stages = []
    if (convId) {
      var stageNodes = root.querySelectorAll(
        scopedSelector(SELECTORS.stageTemplate, convId)
      )
      for (var s = 0; s < stageNodes.length; s++) stages.push(stageNodes[s])
    }

    var convEntry = (convMap && convId && convMap[convId]) || null
    var voiceInput = (convEntry && convEntry.voiceInput) || null
    var voiceTranscript = (voiceInput && voiceInput.transcript) || DEFAULT_VOICE_TRANSCRIPT

    var state = {
      nextTurn: 0,   // index into `turns`
      sent: 0,       // how many messages the seller has sent
      busy: false,   // a turn is mid-flight
      recording: false,
      // Check was pressed this session; the next Send applies the
      // cadence voice revision even if the seller edits the transcript.
      voicePending: false
    }
    var waveformApi = null

    autosize()
    refreshEmptyState()
    updateSendState()

    // ── Scheduling prefill ───────────────────────────────────
    // Arriving from a skill's Schedule button, the composer opens
    // pre-loaded with "Schedule <chip> everyday at 8am." so the seller
    // can read it, edit it, or send it as-is.
    //
    // The read is idempotent and the draft is only cleared on the first
    // send, so a reload before sending restores the prompt in place
    // rather than dropping the seller into an empty composer.
    //
    // Skipped when the composer already holds something: a browser that
    // restored form state across a refresh, or anything the seller
    // managed to type first, outranks the prefill.
    if (scheduleDraftId && window.SellerHomeScheduling &&
        typeof window.SellerHomeScheduling.readComposerDraft === 'function' &&
        !hasPill() && !getComposerText().trim()) {
      var prefill = window.SellerHomeScheduling.readComposerDraft(scheduleDraftId)
      if (prefill) {
        seedComposer(prefill.prefix, prefill.pills, prefill.text)
        // Deferred a frame so the caret lands after any focus the rest
        // of boot is still competing for.
        window.requestAnimationFrame(function () { caretToEnd() })
      }
    }

    input.addEventListener('input', function () {
      autosize()
      refreshEmptyState()
      updateSendState()
    })

    // Enter → send, Shift+Enter → newline. During IME composition Enter
    // is committing a candidate, NOT sending, so bail on `isComposing`
    // (plus the `keyCode === 229` fallback for engines that don't set
    // it).
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        if (event.isComposing || event.keyCode === 229) return
        if (state.recording) {
          event.preventDefault()
          return
        }
        if (event.shiftKey) {
          // Insert a real newline. Left to the browser, contenteditable
          // wraps the caret in a <div>, which breaks both the visual
          // rhythm and the <br> → '\n' pass in getComposerText.
          event.preventDefault()
          insertPlainText('\n')
          refreshEmptyState()
          updateSendState()
          return
        }
        event.preventDefault()
        // Prefer `requestSubmit` so a real `submit` event fires and any
        // other listener on the form still sees it; fall back to the
        // handler directly on engines that lack it (Safari < 16).
        if (typeof form.requestSubmit === 'function') form.requestSubmit()
        else submit()
        return
      }

      // A chip deletes in one press from either side of the caret.
      var bare = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
      if (bare && (event.key === 'Backspace' || event.key === 'Delete')) {
        var pill = findAdjacentPill(event.key === 'Backspace' ? -1 : 1)
        if (pill) {
          event.preventDefault()
          removePill(pill)
          refreshEmptyState()
          updateSendState()
        }
      }
    })

    // Force plain-text paste, so copying from a rich source (a doc, a
    // web page) can't drop styled markup into the composer. Safari is
    // already covered by `-webkit-user-modify` in the stylesheet;
    // Chromium ignores that and needs this.
    input.addEventListener('paste', function (event) {
      if (!event.clipboardData) return
      event.preventDefault()
      insertPlainText(event.clipboardData.getData('text/plain') || '')
      refreshEmptyState()
      updateSendState()
    })

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      submit()
    })

    // ── Simulated voice input ────────────────────────────────
    // Mic starts a recording chrome (waveform + Stop / Check). Stop
    // cancels. Check dumps the hardcoded transcript into the composer
    // and restores the toolbar; the seller still has to press Send.
    if (mic) {
      mic.addEventListener('click', function () {
        if (state.busy || state.recording) return
        startRecording()
      })
    }
    if (micStop) {
      micStop.addEventListener('click', function () {
        stopRecording(false)
      })
    }
    if (micConfirm) {
      micConfirm.addEventListener('click', function () {
        stopRecording(true)
      })
    }
    form.addEventListener('keydown', function (event) {
      if (!state.recording) return
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault()
        stopRecording(false)
      }
    })

    // Record names in a data table are real anchors so they get the
    // browser's own hover / focus / active states and a tab stop. They
    // have nowhere to go, though — there's no deal record in the
    // prototype — so their click is swallowed here rather than letting
    // `href="#"` push a hash onto the URL and jump the thread to the
    // top. Same arrangement home.js uses for an unlinked review card.
    //
    // Delegated from the thread so a table that arrives inside a stage
    // or a scripted reply is covered without re-binding.
    threadInner.addEventListener('click', function (event) {
      var link = event.target && event.target.closest
        ? event.target.closest('[data-sh-conv-record-link]')
        : null
      if (link && (link.getAttribute('href') || '#') === '#') {
        event.preventDefault()
      }
    })

    // Suggested next steps load the composer instead of sending. The
    // seller can edit the wording, and a demo driver decides when the
    // reply fires. Delegated from the thread so suggestions that
    // arrive inside a scripted reply work without re-binding.
    threadInner.addEventListener('click', function (event) {
      var button = event.target && event.target.closest
        ? event.target.closest(SELECTORS.suggestion)
        : null
      if (!button) return
      var prompt = button.getAttribute('data-sh-conv-suggestion-prompt') ||
        (button.textContent || '').trim()
      if (!prompt) return
      setComposerText(prompt)
      autosize()
      updateSendState()
      // Caret to the end so typing continues the sentence rather than
      // overwriting a selection.
      caretToEnd()
    })

    // A chip under a scheduling reply is the opposite bargain: it IS
    // the reply, so clicking one sends it. Same path as typing the
    // label and pressing Send — one send route, so the busy guard, the
    // echo, and the state machine all behave identically either way.
    threadInner.addEventListener('click', function (event) {
      var chip = event.target && event.target.closest
        ? event.target.closest(SELECTORS.scheduleChip)
        : null
      if (!chip || chip.disabled) return
      event.preventDefault()
      // A turn already in flight owns the thread; let it land first.
      if (state.busy) return
      var label = chip.getAttribute('data-sh-conv-chip') ||
        (chip.textContent || '').trim()
      if (!label) return
      // Spent, so the strip stops inviting a second click — the button
      // component paints the greyed-out state, and disabling also drops
      // it from the tab order. It stays in the thread rather than being
      // removed: this is a transcript, and a chip that vanishes reads as
      // a glitch.
      //
      // Set before the send rather than after: `state.busy` already
      // covers the double-click race, but a click that looks dead for
      // the length of a beat doesn't.
      chip.disabled = true
      setComposerText(label)
      updateSendState()
      submit()
    })

    function submit () {
      // Guard rather than trust the button's disabled state — Enter
      // and `requestSubmit` can both reach here around it.
      if (state.busy || state.recording) return
      var text = getComposerText().trim()
      if (!text) return

      var pendingVoice = state.voicePending
      state.voicePending = false

      state.sent++
      removeEmptyPlaceholder()
      var userItem = appendUserMessage(text)

      clearComposer()
      autosize()

      // Retire the prefill once the seller has actually sent something.
      // Until this point a reload is meant to restore the prompt, so the
      // draft is cleared here rather than when it is read.
      if (scheduleDraftId && window.SellerHomeScheduling &&
          typeof window.SellerHomeScheduling.clearComposerDraft === 'function') {
        window.SellerHomeScheduling.clearComposerDraft(scheduleDraftId)
      }

      // A scheduling draft has no scripted turns: its replies are
      // decided per send by the state machine, which reads what the
      // seller just said and answers with the next question, a summary
      // to confirm, or the confirmation itself.
      if (scheduleDraftId && scheduleResponder()) {
        runScheduleTurn(text, userItem)
        return
      }

      // Confirmed mic send: same success toast (and delay) as Approve.
      if (pendingVoice) {
        setTimeout(function () {
          if (window._shShowToast) window._shShowToast('Memory saved')
        }, 800)
      }

      // Confirmed voice demo: echo the seller, then rewrite Marcus's
      // Email 1. Gated on `voiceInput.targetProspectId` so other
      // threads keep their empty-queue echo.
      if (pendingVoice && voiceInput && voiceInput.targetProspectId) {
        runVoiceRevision(userItem)
        return
      }

      var turnTpl = turns[state.nextTurn] || null
      if (!turnTpl) {
        // Queue exhausted — the echo is the whole interaction, and it's
        // one line, so the end of the feed and the top of the newest
        // message are the same place.
        updateSendState()
        scrollToLatest()
        return
      }
      state.nextTurn++
      // The seller's own question anchors the reply: it stays put at the
      // top while the answer builds underneath it.
      runTurn(turnTpl, userItem)
    }

    // Thinking beat, then swap Marcus Email 1 for the authored
    // `voiceRevision`. The cadence module owns the card animation.
    function runVoiceRevision (anchor) {
      setBusy(true)
      var indicator = appendThinking('Updating Email 1\u2026')
      var settle = anchor
        ? function () { scrollAnchorToTop(anchor) }
        : scrollToLatest
      settle()

      window.setTimeout(function () {
        if (indicator && indicator.parentNode) {
          indicator.parentNode.removeChild(indicator)
        }
        if (window.ShCadence && typeof window.ShCadence.applyVoiceRevision === 'function') {
          window.ShCadence.applyVoiceRevision({
            prospectId: voiceInput.targetProspectId,
            stepIndex: voiceInput.targetStepIndex || 0
          })
        }
        settle()
        setBusy(false)
        if (typeof input.focus === 'function') input.focus()
      }, VOICE_THINKING_MS)
    }

    function startRecording () {
      if (state.recording) return
      setRecording(true)
      window.requestAnimationFrame(function () { mountWaveform() })
    }

    function stopRecording (confirm) {
      if (!state.recording) return
      destroyWaveform()
      setRecording(false)
      if (confirm) {
        state.voicePending = true
        setComposerText(voiceTranscript)
        autosize()
        updateSendState()
        caretToEnd()
      } else {
        updateSendState()
      }
    }

    function setRecording (isRecording) {
      state.recording = !!isRecording
      form.classList.toggle(RECORDING_CLASS, state.recording)
      if (recordingEl) {
        if (state.recording) recordingEl.removeAttribute('hidden')
        else recordingEl.setAttribute('hidden', '')
      }
      input.setAttribute('contenteditable', state.recording ? 'false' : 'true')
      input.setAttribute('aria-disabled', state.recording ? 'true' : 'false')
      if (mic) mic.setAttribute('aria-pressed', state.recording ? 'true' : 'false')
      updateSendState()
    }

    function mountWaveform () {
      destroyWaveform()
      if (!waveformEl || !window.ShLiveWaveform || typeof window.ShLiveWaveform.mount !== 'function') return
      var reduced = prefersReducedMotion()
      waveformApi = window.ShLiveWaveform.mount(waveformEl, {
        height: 32,
        barWidth: 3,
        barGap: 2,
        barRadius: 1.5,
        fadeEdges: true,
        mode: 'scrolling',
        active: !reduced,
        processing: reduced,
        onError: function () {
          if (waveformApi) waveformApi.setProcessing(true)
        }
      })
    }

    function destroyWaveform () {
      if (waveformApi && typeof waveformApi.destroy === 'function') {
        waveformApi.destroy()
      }
      waveformApi = null
      if (waveformEl) {
        while (waveformEl.firstChild) waveformEl.removeChild(waveformEl.firstChild)
      }
    }

    // One beat of the agent working: show the indicator for the
    // template's own duration, then swap it for that template's
    // content. The timer is the entire "agent" — there's no work to
    // wait on, so a single setTimeout is the honest implementation.
    //
    // Timing and copy ride on the template as `data-sh-conv-thinking-*`
    // so they stay data. Both the opening stages and the scripted
    // replies carry that pair, which is what lets one function play
    // either.
    // `anchor`, when given, is the message the viewport should sit on
    // for the whole beat — see scrollAnchorToTop. Both scrolls use the
    // same anchor: pulling the indicator out shifts everything below it
    // up by its height, so the second call is what actually lands the
    // anchor at the top once the reply is in place.
    function playBeat (tpl, done, anchor) {
      var label = tpl.getAttribute('data-sh-conv-thinking-label') || ''
      var delay = parseInt(tpl.getAttribute('data-sh-conv-thinking-ms'), 10)
      if (!isFinite(delay) || delay < 0) delay = DEFAULT_THINKING_MS

      var indicator = appendThinking(label)
      var settle = anchor
        ? function () { scrollAnchorToTop(anchor) }
        : scrollToLatest

      settle()

      window.setTimeout(function () {
        if (indicator && indicator.parentNode) {
          indicator.parentNode.removeChild(indicator)
        }
        // `done` runs after the stream, not after the append — it is what
        // unlocks the composer, and handing the caret back mid-sentence
        // invites a send into the middle of the agent's reply.
        appendTemplate(tpl, convMap, {
          stream: true,
          scroll: settle,
          onDone: function () {
            settle()
            if (done) done()
          }
        })
      }, delay)
    }

    function runTurn (turnTpl, anchor) {
      setBusy(true)
      playBeat(turnTpl, function () {
        setBusy(false)
        // Hand the caret back so a follow-up doesn't need a click.
        if (typeof input.focus === 'function') input.focus()
      }, anchor)
    }

    // ── The Schedule flow's turn ─────────────────────────────────
    // `playBeat`'s shape — working row, pause, reply, and both scrolls
    // on the same anchor — over a reply that doesn't exist until the
    // state machine builds it. Kept beside `playBeat` rather than
    // taught to it: there's no template to clone per turn, a payload
    // to fill instead, and a failure mode a scripted turn can't have.
    function runScheduleTurn (userText, anchor) {
      var respond = scheduleResponder()
      if (!respond) return

      setBusy(true)
      // No label argument — the template's own copy is the right
      // wording for this beat too, and one working row for every kind
      // of turn is the point of that template.
      var indicator = appendThinking('')
      var settle = anchor
        ? function () { scrollAnchorToTop(anchor) }
        : scrollToLatest

      settle()

      window.setTimeout(function () {
        if (indicator && indicator.parentNode) {
          indicator.parentNode.removeChild(indicator)
        }
        var reply
        try {
          reply = respond(scheduleDraftId, userText)
        } catch (e) {
          // The state machine reads and writes localStorage, which
          // throws outright in a locked-down browser. Say so in the
          // thread rather than leaving the seller looking at their own
          // message with nothing under it.
          reply = { text: 'Something went wrong setting up the schedule.' }
        }
        var item = appendScheduleReply(reply)
        streamNode(item, settle, function () {
          settle()
          setBusy(false)
          if (typeof input.focus === 'function') input.focus()
        })
      }, SCHEDULE_THINKING_MS)
    }

    // The state-machine step, or null when schedule_conversation.js
    // isn't on the page. Resolved per call rather than held from bind
    // time so script order can't decide whether the flow works.
    function scheduleResponder () {
      var api = window.SellerHomeScheduling
      if (!api || typeof api.advanceScheduling !== 'function') return null
      return api.advanceScheduling
    }

    // Fill a clone of the schedule template from the state machine's
    // `{ text, summary?, chips? }`. Slots the turn has nothing for stay
    // hidden, so asking a question renders as one paragraph while
    // proposing a schedule renders as prose over a summary and chips.
    function appendScheduleReply (reply) {
      var frag = cloneTemplate(scheduleTpl)
      if (!frag) return null
      var id = 'msg-live-schedule-' + state.sent

      var item = frag.querySelector('[data-sh-conv-item]')
      if (item) item.setAttribute('data-sh-conv-item', id)
      var msg = frag.querySelector('[data-sh-conv-msg]')
      if (msg) msg.setAttribute('data-sh-conv-msg', id)

      var text = reply && reply.text ? String(reply.text) : ''
      var textEl = frag.querySelector('[data-sh-conv-msg-text]')
      if (textEl && text) {
        textEl.textContent = text
        textEl.removeAttribute('hidden')
      }

      fillScheduleSummary(frag, reply && reply.summary)
      fillScheduleChips(frag, reply && reply.chips)

      threadInner.appendChild(frag)
      return item
    }

    // Reveal the summary rows this turn has values for. The card stays
    // hidden when none of them do, so an empty payload can't paint an
    // empty box.
    function fillScheduleSummary (frag, summary) {
      var card = frag.querySelector(SELECTORS.scheduleSummary)
      if (!card || !summary) return

      var keys = ['skill', 'cadence', 'time', 'timezone']
      var shown = 0
      for (var i = 0; i < keys.length; i++) {
        var value = summary[keys[i]] ? String(summary[keys[i]]) : ''
        if (!value) continue
        // Term and value both, or the row leaves a gap in its column.
        var halves = card.querySelectorAll(
          '[data-sh-conv-summary-row="' + keys[i] + '"]'
        )
        for (var h = 0; h < halves.length; h++) {
          halves[h].removeAttribute('hidden')
          if (halves[h].hasAttribute('data-sh-conv-summary-value')) {
            halves[h].textContent = value
          }
        }
        shown++
      }
      if (shown) card.removeAttribute('hidden')
    }

    // One chip per suggested reply, cloned from the chip template. The
    // label goes on the attribute as well as in the button so the
    // delegated handler reads what was authored rather than whatever
    // the browser made of the text node.
    function fillScheduleChips (frag, chips) {
      var strip = frag.querySelector(SELECTORS.scheduleChips)
      if (!strip || !chips || !chips.length) return

      var added = 0
      for (var i = 0; i < chips.length; i++) {
        var label = chips[i] == null ? '' : String(chips[i])
        if (!label) continue
        var chipFrag = cloneTemplate(scheduleChipTpl)
        var button = chipFrag ? chipFrag.querySelector(SELECTORS.scheduleChip) : null
        if (!button) continue
        button.textContent = label
        button.setAttribute('data-sh-conv-chip', label)
        strip.appendChild(chipFrag)
        added++
      }
      if (added) strip.removeAttribute('hidden')
    }

    // Open the thread: paint what doesn't wait, echo the seller's
    // question if they brought one, then play the stages in — each
    // one thinks, then drops its messages.
    //
    // Send is held until the last stage lands, so a seller who types
    // during the sequence can't have a reply arrive before the answer
    // it responds to.
    //
    // `query` is the text typed into the Seller Home composer, handed
    // over in the URL. Echoing it first is the whole trick: the agent
    // then appears to be answering them, using content that was
    // written long before they typed anything.
    //
    // Focus is deliberately left alone at the end — this runs on load,
    // and pulling the caret into the composer would yank a screen
    // reader out of the thread it's announcing.
    function playOpening (query) {
      paintInline()

      if (query) {
        removeEmptyPlaceholder()
        state.sent++
        appendUserMessage(query)
      }

      if (!stages.length) {
        jumpToLatest()
        return
      }

      removeEmptyPlaceholder()

      // First time in — or arriving with a question — is the agent doing
      // the work: it thinks, then writes the reply out. Coming back to a
      // thread already opened this session is reading history, so it
      // paints at once with no thinking row and no streaming, because an
      // agent does not sit and re-think what it already answered.
      //
      // Marked before playing, not after: navigating away mid-reveal and
      // returning should land on the finished thread, not restart it.
      var live = !!query || !hasPlayedOpening(convId)
      markOpeningPlayed(convId)

      if (!live) {
        for (var i = 0; i < stages.length; i++) {
          appendTemplate(stages[i], convMap)
        }
        jumpToLatest()
        return
      }

      setBusy(true)

      // A conversation whose opening carries a `trace` plays the reusable
      // ThinkingTrace as its single thinking phase (connect tools, then load
      // skills, then fold into a completed header). Once it collapses the
      // answer streams in stage by stage, with no per-stage thinking rows.
      var openingCfg = (convMap && convMap[convId] && convMap[convId].opening) || null
      var traceCfg = openingCfg && openingCfg.trace
      if (traceCfg && window.ThinkingTrace && typeof window.ThinkingTrace.mount === 'function') {
        var traceLi = document.createElement('li')
        traceLi.className = 'seller-home__conv-thread-item'
        var traceHost = document.createElement('div')
        traceLi.appendChild(traceHost)
        threadInner.appendChild(traceLi)
        scrollToLatest()
        window.ThinkingTrace.mount(traceHost, {
          completedLabel: traceCfg.completedLabel,
          steps: traceCfg.steps,
          timings: traceCfg.timings,
          controls: false,
          autoCollapse: true,
          onComplete: function () { revealStages(0) }
        })
        return
      }

      if (openingCfg && openingCfg.skipThinking) {
        revealStages(0)
        return
      }

      next(0)

      // Normal path: each stage thinks, then drops its messages.
      function next (i) {
        if (i >= stages.length) {
          setBusy(false)
          return
        }
        playBeat(stages[i], function () { next(i + 1) })
      }

      // skipThinking streams the same way, with no thinking row in front.
      function revealStages (i) {
        if (i >= stages.length) {
          setBusy(false)
          return
        }
        appendTemplate(stages[i], convMap, {
          stream: true,
          scroll: scrollToLatest,
          onDone: function () { revealStages(i + 1) }
        })
      }
    }

    // Messages no stage claims. They belong to the thread the moment
    // it opens, so they go in without a beat in front of them.
    // A conversation that stages everything still renders this
    // template — empty but for the whitespace between Nunjucks tags —
    // so the check is for a real element, not for child nodes.
    function paintInline () {
      if (!inlineTpl || !inlineTpl.content) return
      if (!inlineTpl.content.querySelector('*')) return
      removeEmptyPlaceholder()
      appendTemplate(inlineTpl, convMap)
    }

    // ── Thread mutations ─────────────────────────────────────
    // Clone the echo pill and write the typed string into it. Ids are
    // stamped per send so each message keeps a unique
    // `data-sh-conv-msg` hook.
    function appendUserMessage (text) {
      var frag = cloneTemplate(userTpl)
      if (!frag) return null
      var id = 'msg-live-user-' + state.sent

      var textEl = frag.querySelector('[data-sh-conv-msg-text]')
      if (textEl) textEl.textContent = text
      var item = frag.querySelector('[data-sh-conv-item]')
      if (item) item.setAttribute('data-sh-conv-item', id)
      var msg = frag.querySelector('[data-sh-conv-msg]')
      if (msg) msg.setAttribute('data-sh-conv-msg', id)

      threadInner.appendChild(frag)
      return item
    }

    // One template serves every turn — the label is rewritten from
    // the turn's own copy before the row goes in.
    function appendThinking (label) {
      var frag = cloneTemplate(thinkingTpl)
      if (!frag) return null
      if (label) {
        var labelEl = frag.querySelector('[data-sh-conv-thinking-label]')
        if (labelEl) labelEl.textContent = label
      }
      var item = frag.querySelector(SELECTORS.thinkingItem)
      threadInner.appendChild(frag)
      return item
    }

    // Append a pre-rendered block — an opening stage or a scripted
    // reply — and wire whatever came with it.
    //
    // Collect the top-level elements BEFORE inserting: an appended
    // fragment is left empty, so this is the only chance to hold
    // references for binding.
    // `opts.stream` reveals the reply the way the agent would write it —
    // prose word by word, table rows cascading — via ShStream. History
    // never passes it: a thread you are re-opening should already be
    // there, not type itself out again.
    //
    // Binding waits for the stream to finish. Units rest at
    // `display:none` until reached, and anything that measures itself on
    // bind (a sparkline, ShCadence.mount) reads zero inside a hidden box.
    function appendTemplate (tpl, map, opts) {
      opts = opts || {}
      var frag = cloneTemplate(tpl)
      if (!frag) { if (opts.onDone) opts.onDone(); return }
      var added = []
      for (var n = 0; n < frag.childNodes.length; n++) {
        var node = frag.childNodes[n]
        if (node.nodeType === 1) added.push(node)
      }
      threadInner.appendChild(frag)

      function finish () {
        for (var a = 0; a < added.length; a++) bindMessageContent(added[a], map)
        if (opts.onDone) opts.onDone()
      }

      if (opts.stream && window.ShStream) {
        window.ShStream.reveal(added, {
          scroll: opts.scroll || scrollToLatest,
          onDone: finish
        })
        return
      }

      finish()
    }

    // Reveal an already-appended node the same way, for the replies that
    // are built rather than cloned (the Schedule flow). Falls through to
    // `done` when the module isn't on the page.
    function streamNode (node, scroll, done) {
      if (node && window.ShStream) {
        window.ShStream.reveal(node, { scroll: scroll, onDone: done })
        return
      }
      if (done) done()
    }

    // No-op if the empty row is already gone (it is no longer in the
    // markup). Kept so every append path can still call it.
    function removeEmptyPlaceholder () {
      var empty = threadInner.querySelector(SELECTORS.threadEmpty)
      if (empty && empty.parentNode) empty.parentNode.removeChild(empty)
    }

    // ── Composer state ───────────────────────────────────────
    // Mid-turn the input stays typeable (the seller can line up a
    // follow-up) but Send is held disabled, so two turns can't
    // overlap and land out of order.
    function setBusy (isBusy) {
      state.busy = isBusy
      if (isBusy) form.classList.add(BUSY_CLASS)
      else        form.classList.remove(BUSY_CLASS)
      // Tells AT the log is mid-update, so a verbose screen reader
      // doesn't narrate a half-built reply.
      threadInner.setAttribute('aria-busy', isBusy ? 'true' : 'false')
      updateSendState()
    }

    // ── Composer contents ────────────────────────────────────
    // The input is a contenteditable holding text nodes and atomic
    // skill chips, so there is no `.value` to read. Everything below
    // is the replacement for it: read, write, clear, and the empty
    // test that drives the placeholder.
    function isPillEl (node) {
      return !!node &&
        node.nodeType === 1 &&
        !!node.classList &&
        node.classList.contains(PILL_CLASS)
    }

    function hasPill () {
      return !!input.querySelector('.' + PILL_CLASS)
    }

    // Whether a serialized chip needs a space appended to stand in for
    // the visual gap its `margin-right` draws. Nothing following, or
    // something already starting with whitespace, needs no help.
    function needsSpaceAfterPill (pill) {
      var next = pill.nextSibling
      if (!next) return false
      if (next.nodeType === 3) return !/^[\s\u00a0]/.test(next.nodeValue || '')
      if (next.nodeType === 1 && next.tagName === 'BR') return false
      return true
    }

    // Serialize the composer to plain text in document order, with each
    // chip contributing its skill name. The chip label has to be part
    // of the string: it carries the subject of the sentence, so a
    // message echoed without it would read "Schedule everyday at 8am."
    // and lose the skill entirely.
    function getComposerText () {
      var out = ''
      for (var i = 0; i < input.childNodes.length; i++) {
        var node = input.childNodes[i]
        if (node.nodeType === 3) {
          out += node.nodeValue
        } else if (node.nodeType === 1) {
          if (isPillEl(node)) {
            out += node.getAttribute('data-skill-name') || node.textContent || ''
            // The gap after a chip is drawn by its `margin-right`, not by
            // a space in the DOM, so serializing has to supply one or the
            // label collides with the next word ("Snapshoteveryday").
            // Only when what follows doesn't already start with space.
            if (needsSpaceAfterPill(node)) out += ' '
          } else if (node.tagName === 'BR') {
            // Matches how a textarea serialized a Shift+Enter break.
            out += '\n'
          } else {
            // Inline formatting a browser injected despite the paste
            // handler — take the text and drop the markup.
            out += node.textContent || ''
          }
        }
      }
      // Non-breaking spaces are contenteditable's way of holding a
      // trailing gap open; they would survive `.trim()` and read as
      // content, so fold them back to ordinary spaces first.
      return out.replace(/\u00a0/g, ' ').replace(/\r/g, '')
    }

    function clearComposer () {
      while (input.firstChild) input.removeChild(input.firstChild)
      refreshEmptyState()
    }

    function setComposerText (text) {
      clearComposer()
      if (text) input.appendChild(document.createTextNode(String(text)))
      refreshEmptyState()
    }

    // Toggles the class the stylesheet hangs the placeholder off.
    function refreshEmptyState () {
      if (hasPill() || getComposerText().trim()) input.classList.remove('is-empty')
      else input.classList.add('is-empty')
    }

    function updateSendState () {
      // Send stays visually enabled while idle. Empty submit is still
      // a no-op in `submit()`. Busy / recording still lock it so two
      // turns cannot overlap and the recording chrome owns the row.
      send.disabled = state.busy || state.recording
      if (mic) mic.disabled = state.busy || state.recording
    }

    // The composer is a contenteditable, which grows on its own; the
    // stylesheet's `max-height` caps it and hands off to internal
    // scrolling. Kept as a no-op so the call sites below still read as
    // "content changed, resize" and a future swap back to a sized
    // element has one place to land.
    function autosize () { /* contenteditable auto-grows */ }

    // ── Caret + insertion ────────────────────────────────────
    function caretToEnd () {
      try {
        input.focus()
        var sel = window.getSelection()
        var range = document.createRange()
        range.selectNodeContents(input)
        range.collapse(false)   // to the END of the contents
        sel.removeAllRanges()
        sel.addRange(range)
      } catch (e) {
        // Older engines: leaving focus alone is an acceptable outcome.
        if (typeof input.focus === 'function') input.focus()
      }
    }

    // Insert text at the caret as plain text. Used by the paste handler
    // and by Shift+Enter, both of which would otherwise let the browser
    // put styled markup or a wrapper <div> into the composer.
    function insertPlainText (text) {
      var sel = window.getSelection ? window.getSelection() : null
      if (!sel || !sel.rangeCount) {
        input.appendChild(document.createTextNode(text))
        caretToEnd()
        return
      }
      var range = sel.getRangeAt(0)
      if (!input.contains(range.commonAncestorContainer)) {
        input.appendChild(document.createTextNode(text))
        caretToEnd()
        return
      }
      range.deleteContents()
      var node = document.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.setEndAfter(node)
      sel.removeAllRanges()
      sel.addRange(range)
    }

    // ── Skill chips ──────────────────────────────────────────
    function buildPillIcon () {
      var svg = document.createElementNS(SVG_NS, 'svg')
      svg.setAttribute('class', PILL_CLASS + '-icon')
      svg.setAttribute('viewBox', '0 0 16 16')
      svg.setAttribute('fill', 'currentColor')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('focusable', 'false')
      for (var i = 0; i < PILL_ICON_PATHS.length; i++) {
        var spec = PILL_ICON_PATHS[i]
        var g = document.createElementNS(SVG_NS, 'g')
        g.setAttribute('transform', spec.transform)
        var path = document.createElementNS(SVG_NS, 'path')
        path.setAttribute('d', spec.d)
        if (spec.evenodd) {
          path.setAttribute('fill-rule', 'evenodd')
          path.setAttribute('clip-rule', 'evenodd')
        }
        g.appendChild(path)
        svg.appendChild(g)
      }
      return svg
    }

    // `contenteditable="false"` is what makes the chip atomic: the
    // caret steps over it as one unit and cannot land inside the label.
    // Removal is therefore keyboard-driven (see the Backspace / Delete
    // branch in the keydown handler) rather than via a close button.
    function buildPill (ref) {
      var name = (ref && ref.name) ? String(ref.name) : ''
      var pill = document.createElement('span')
      pill.className = PILL_CLASS
      pill.setAttribute('contenteditable', 'false')
      pill.setAttribute('data-skill-id', (ref && ref.skillId) ? String(ref.skillId) : '')
      pill.setAttribute('data-skill-name', name)
      pill.setAttribute('role', 'group')
      pill.setAttribute('aria-label', 'Skill: ' + name)

      pill.appendChild(buildPillIcon())

      var label = document.createElement('span')
      label.className = PILL_CLASS + '-label'
      label.textContent = name
      pill.appendChild(label)

      return pill
    }

    // Lay out the composer as prefix text, then chips, then suffix
    // text. Wipes first so a re-seed (a reload mid-edit) replaces the
    // prompt instead of stacking a second copy after it.
    function seedComposer (prefix, pills, suffix) {
      clearComposer()
      if (prefix) input.appendChild(document.createTextNode(String(prefix)))
      if (pills) {
        for (var i = 0; i < pills.length; i++) input.appendChild(buildPill(pills[i]))
      }
      // No separating space: the chip's own `margin-right` supplies the
      // gap, and a space here would stack with it and read as a double.
      if (suffix) input.appendChild(document.createTextNode(String(suffix)))
      refreshEmptyState()
      updateSendState()
    }

    // Which chip, if any, the caret is resting against — looking behind
    // it for Backspace (direction -1) and ahead for Delete (+1).
    // Browsers disagree on deleting a `contenteditable=false` node (some
    // remove it, some select it first), so the composer decides instead.
    function findAdjacentPill (direction) {
      var sel = window.getSelection ? window.getSelection() : null
      if (!sel || !sel.rangeCount) return null
      var range = sel.getRangeAt(0)
      if (!range.collapsed) return null
      if (!input.contains(range.startContainer)) return null

      var container = range.startContainer
      var offset = range.startOffset
      var target = null

      if (container === input) {
        // Caret sits between children: the offset IS a child index.
        target = input.childNodes[direction < 0 ? offset - 1 : offset] || null
      } else if (container.nodeType === 3) {
        // Caret sits inside a text node: only an offset at the very
        // edge puts it against a sibling.
        if (direction < 0 && offset === 0) target = container.previousSibling
        else if (direction > 0 && offset === container.length) target = container.nextSibling
      }
      return isPillEl(target) ? target : null
    }

    // Drop the caret into the gap the chip occupied. Without setting the
    // range explicitly the selection can be left inside the detached
    // node, which strands the caret and swallows the next keystroke.
    function removePill (pill) {
      var parent = pill.parentNode
      if (!parent) return
      var before = pill.previousSibling
      parent.removeChild(pill)
      try {
        var sel = window.getSelection()
        var range = document.createRange()
        if (before && before.nodeType === 3) {
          var end = before.nodeValue ? before.nodeValue.length : 0
          range.setStart(before, end)
          range.setEnd(before, end)
        } else if (before) {
          range.setStartAfter(before)
          range.setEndAfter(before)
        } else {
          range.setStart(input, 0)
          range.setEnd(input, 0)
        }
        sel.removeAllRanges()
        sel.addRange(range)
        input.focus()
      } catch (e) { /* best-effort caret restore */ }
    }

    function scrollThreadTo (top, instant) {
      try {
        thread.scrollTo({
          top: top,
          behavior: (instant || prefersReducedMotion()) ? 'auto' : 'smooth'
        })
      } catch (e) {
        // Older browsers: scrollTo doesn't accept options.
        thread.scrollTop = top
      }
    }

    function scrollToLatest () {
      scrollThreadTo(thread.scrollHeight)
    }

    // Instant jump to the newest message, for the first paint of a thread
    // opened as history. A run-based feed can be dozens of runs tall, and
    // a smooth scroll from the top would animate down through every one on
    // open; reading history should just land at the latest at once.
    function jumpToLatest () {
      scrollThreadTo(thread.scrollHeight, true)
    }

    // Bring `anchor`'s top edge up to the top of the thread's viewport.
    //
    // This is what a scripted reply uses instead of scrollToLatest. A
    // reply can be several screens tall — the cadence card answering
    // "draft the emails" runs one block per prospect — and scrolling to
    // the BOTTOM of the feed drops the seller at its far end, with the
    // whole answer above them and nothing to read below. Anchoring the
    // question they just asked keeps it on screen and lets the answer
    // fill in underneath, from the top.
    //
    // The opening sequence deliberately keeps scrollToLatest: its last
    // stage ends on the suggested next steps, and those are meant to be
    // what's on screen once the thread finishes loading.
    function scrollAnchorToTop (anchor) {
      if (!anchor || typeof anchor.getBoundingClientRect !== 'function') {
        return scrollToLatest()
      }

      var offset = anchor.getBoundingClientRect().top -
        thread.getBoundingClientRect().top
      var top = thread.scrollTop + offset - SCROLL_ANCHOR_GUTTER

      // Nothing can be pulled higher than the last screenful. The
      // browser would clamp this itself, but doing it here stops a
      // smooth scroll from easing toward a position it can't reach.
      var max = thread.scrollHeight - thread.clientHeight
      if (top > max) top = max
      if (top < 0) top = 0

      scrollThreadTo(top)
    }

    return { playOpening: playOpening }
  }

  // Clone a <template>'s content. Returns null when the template is
  // missing or the browser predates `HTMLTemplateElement`, so callers
  // degrade to "nothing appended" instead of throwing mid-interaction.
  function cloneTemplate (tpl) {
    if (!tpl || !tpl.content || typeof tpl.content.cloneNode !== 'function') {
      return null
    }
    return tpl.content.cloneNode(true)
  }

  function prefersReducedMotion () {
    if (!window.matchMedia) return false
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch (e) {
      return false
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Prospect table binder
  // ──────────────────────────────────────────────────────────────
  // Owns:
  //   • The X in each Prospect cell, which takes a prospect out of the
  //     batch and puts it back.
  //   • Reflecting review status onto the row (approved /
  //     changes_requested) via `data-sh-review-status`.
  //
  // What it no longer owns is row selection, and three things went with
  // it: the roving tabindex and its Arrow / Home / End nav, the
  // `.is-selected` class, and `aria-selected` on every row. The table's
  // rows were selectable so the cadence card's stepper could follow the
  // one you clicked; the blue that painted read as a selection with
  // nothing on the page to justify it, so the behaviour went rather
  // than just the paint — a row that announces itself as selected with
  // nothing on screen to match is worse than either state.
  //
  // The consequences, both accepted: clicking a row does nothing at
  // all, and the cadence card no longer follows the table (its own
  // Prev / Next still page the roster, and it still fires
  // `sh:conv-row-select` at nobody — harmless, and what a restored
  // selection model would bind to again).
  function bindProspectTable (table) {
    if (!table) return
    var rows = table.querySelectorAll(SELECTORS.convRow)
    if (!rows.length) return

    // NodeList → array for readable index math.
    var rowList = []
    for (var i = 0; i < rows.length; i++) rowList.push(rows[i])

    // One click handler for the whole table, and the X is the only
    // thing in a row that answers it. The guard that used to let clicks
    // on the email / phone links through went with selection: with
    // nothing to select, those links are just links.
    table.addEventListener('click', function (event) {
      var target = event.target
      if (!target || !target.closest) return
      handleDecisionClick(target, table)
    })

    // React to per-prospect decisions by updating the row's
    // `data-sh-review-status` — the SCSS `[data-sh-review-status]`
    // rules paint the leading stripe from there.
    document.addEventListener(EVT_DECISION, function (event) {
      var d = event.detail || {}
      if (d.decision === 'approve_all') {
        // Mark every row as approved. This is the only way a row
        // reaches `approved` now that the per-row Accept is gone.
        for (var i = 0; i < rowList.length; i++) {
          rowList[i].setAttribute('data-sh-review-status', 'approved')
        }
        return
      }
      if (!d.rowId) return
      var row = table.querySelector('[data-sh-conv-row][data-sh-conv-row-id="' + d.rowId + '"]')
      if (!row) return
      if (d.decision === 'approve') paintRowStatus(row, 'approved')
      else if (d.decision === 'request_changes') paintRowStatus(row, 'changes_requested')
    })

    fitSignalBadges(table)
  }

  // ── Signal badges ───────────────────────────────────────────────
  // Shows as many signal badges as the cell's line budget allows and
  // collapses the rest into "+N more".
  //
  // Runtime rather than template because it's a question about rendered
  // width: "290+ SDRs" and "New Head of Enterprise Americas (Katie
  // Layng)" are one badge each and four times apart in size, so no
  // count decided up front is right for both. A fixed cap made every
  // row as sparse as the wordiest one. The template renders all of
  // them; this decides which stay.
  function fitSignalBadges (scope) {
    var cells = (scope || document).querySelectorAll(SELECTORS.signalCell)
    for (var i = 0; i < cells.length; i++) fitOneSignalCell(cells[i])
  }

  // The Signal column is a fixed 18rem, so the fit doesn't actually
  // move with the window today — this is here for when it isn't, and
  // because the alternative failure is silent and wrong rather than
  // visibly broken. Debounced: a drag fires this continuously and each
  // pass measures every cell.
  var refitTimer = null
  window.addEventListener('resize', function () {
    if (refitTimer) window.clearTimeout(refitTimer)
    refitTimer = window.setTimeout(function () {
      refitTimer = null
      fitSignalBadges()
    }, 150)
  })

  function fitOneSignalCell (cell) {
    var badges = cell.querySelectorAll(SELECTORS.signalBadge)
    if (!badges.length) return
    var more = cell.querySelector(SELECTORS.signalMore)

    // Start from everything showing, so a re-fit isn't biased by what
    // the last one hid — on a re-fit the cell may have got wider, and
    // a badge hidden at the old width has to be allowed back.
    var i
    for (i = 0; i < badges.length; i++) badges[i].hidden = false
    if (more) more.hidden = true

    // Put the clip back, because the budget is read off it below and a
    // re-fit arrives with `is-fitted` already set from the first pass —
    // at which point `max-height` computes to `none`, the budget parses
    // as NaN, and the fitter bails having just un-hidden everything.
    // Silent and wrong: the cell keeps every badge and simply grows.
    // That's every resize and every open of the expand modal.
    cell.classList.remove('is-fitted')

    // The budget, in pixels, read off the pre-JS clip the stylesheet
    // put there — which is why this happens BEFORE `is-fitted` drops
    // it. Taking it from the DOM rather than recomputing it here keeps
    // `--ptl-signal-lines` the only place the number is written down.
    var budget = parseFloat(window.getComputedStyle(cell).maxHeight)
    // The clip is missing or `none`: nothing to fit against, so show
    // everything rather than guess at a height and hide good content.
    if (!budget) { cell.classList.add('is-fitted'); return }

    // Drops the clip. From here the fitter is what bounds the height,
    // and it does it by hiding whole badges — the clip would cut one
    // in half.
    cell.classList.add('is-fitted')

    // Height rather than a count of flex lines, because a badge whose
    // label is too long for the column wraps to two lines inside its
    // own pill: three such badges are three lines by any count and
    // twice the height they're supposed to be. Measuring the box is
    // the only reading that can't be fooled by that.
    if (cell.getBoundingClientRect().height <= budget) return

    // Over budget, so a counter is coming and it takes room on the last
    // line. Reveal it BEFORE choosing what to drop, or the last badge
    // kept would be one the counter then pushes over the edge.
    //
    // Reserve it at its widest — every badge but one hidden — so the
    // width can only shrink as the real count is settled. Sizing it
    // from a placeholder and growing later would re-wrap the line the
    // fitter just finished measuring.
    if (more) {
      more.hidden = false
      more.textContent = '+' + (badges.length - 1) + ' more'
    }

    // Hide from the end until it fits. Re-measured each time rather
    // than computed, because removing one badge can pull the next line
    // up whole and change the answer by more than one item.
    var shown = badges.length
    while (shown > 1 && cell.getBoundingClientRect().height > budget) {
      shown--
      badges[shown].hidden = true
    }

    if (more) more.textContent = '+' + (badges.length - shown) + ' more'
  }

  // ── Row decisions ───────────────────────────────────────────────
  // The X writes the row's status and announces it, and the cadence
  // card's own Request-changes takes the opposite path (card →
  // `sh:review-decision` → row), so both surfaces converge on the same
  // per-prospect state whichever one the seller uses.
  //
  // It TOGGLES: clicking the X on a row that's already out puts it
  // back, so a mis-click is recoverable without a second control. That
  // matters more here than it did with an Accept / Reject pair, where
  // the other button was the way back.
  function handleDecisionClick (target, table) {
    var button = target.closest(SELECTORS.convReject)
    if (!button) return false

    var row = button.closest(SELECTORS.convRow)
    if (!row || !table.contains(row)) return false

    var out = row.getAttribute('data-sh-review-status') !== 'changes_requested'
    paintRowStatus(row, out ? 'changes_requested' : null)
    dispatch(row, EVT_TABLE_DECISION, {
      rowId:  row.getAttribute('data-sh-conv-row-id') || null,
      status: out ? 'changes_requested' : 'not_reviewed'
    })
    return true
  }

  // Reflect a decision in the row's DOM: the status attribute the
  // SCSS paints the leading stripe from, plus the pressed state of the
  // X. A null status clears both, which is the toggle-back case.
  // Deliberately silent — callers decide whether the change also needs
  // to be announced.
  function paintRowStatus (row, status) {
    if (status) row.setAttribute('data-sh-review-status', status)
    else row.removeAttribute('data-sh-review-status')
    var rejectBtn = row.querySelector(SELECTORS.convReject)
    if (rejectBtn) rejectBtn.setAttribute('aria-pressed', status === 'changes_requested' ? 'true' : 'false')
  }

  // ──────────────────────────────────────────────────────────────
  // Expand a table into a dialog
  // ──────────────────────────────────────────────────────────────
  // A workflow-activity chip can carry a button naming one of the
  // thread's tables (`expandsTable` in the JSON). Pressing it MOVES that
  // table out of the thread and into the dialog at the bottom of
  // home_conversation.html; closing moves it back.
  //
  // The dialog gets a CLONE, not the table itself. Moving the real node
  // out and back was the old design (one node, one source of truth), but
  // re-inserting a node on close made the thread re-lay-out its copy —
  // it read as the prospect list "reloading" every time the dialog shut.
  // Leaving the thread's own table untouched is the fix: nothing about it
  // changes when the dialog opens or closes, so there is nothing to
  // reload.
  //
  // The clone stays live: its reject Xs are wired, so a drop still fires
  // the `sh:conv-row-decision` the cadence card listens for. It starts
  // from the thread table's current state (cloneNode copies each row's
  // `data-sh-review-status`), and on close any drops made in the dialog
  // are written back to the thread table by row id — so the two copies
  // never disagree even though they're two nodes.
  //
  // Only one table can be expanded at a time, so a single dialog and a
  // single clone are sufficient.
  function bindTableExpand () {
    var modal    = document.querySelector(SELECTORS.tableModal)
    var backdrop = document.querySelector(SELECTORS.tableModalBack)
    if (!modal || !backdrop) return

    var host  = modal.querySelector(SELECTORS.tableModalHost)
    var title = modal.querySelector(SELECTORS.tableModalTitle)
    var meta  = modal.querySelector(SELECTORS.tableModalMeta)
    if (!host) return

    // The box that actually animates — transitions.dev's `t-modal`
    // (06-modal.md), on the container rather than the section. See the
    // snippet in home_conversation.scss for why.
    var container = modal.querySelector(MODAL_TRANSITION)

    // Read the close duration off the same custom property the CSS
    // uses, so retuning the token moves both the animation and the
    // cleanup that waits on it. The fallback matches the snippet's
    // default in case the stylesheet hasn't loaded.
    var closeMs = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')
    ) || 150

    // Per-open state: the CLONE currently in the dialog, the thread
    // table it was cloned from (drops are written back to it on close),
    // the trigger to hand focus back to, and the trap handler to unbind.
    var expanded    = null
    var source      = null
    var lastFocused = null
    var trapHandler = null
    // Non-null only while the close animation is playing. It's both the
    // handle for the cleanup and the flag that a close is in flight.
    var closeTimer  = null

    function open (button) {
      // Already open — ignore a second trigger rather than stacking a
      // second clone in the dialog.
      if (expanded) return

      var tableId = button.getAttribute('data-sh-conv-expand')
      // Authored id going into an attribute selector: same rule as
      // conversation ids, reject anything that isn't a plain slug.
      if (!tableId || !ID_PATTERN.test(tableId)) return

      var table = document.querySelector('[data-sh-conv-table="' + tableId + '"]')
      if (!table || !table.parentNode) return

      // Title from the table's own accessible name (`table.ariaLabel`
      // in the JSON), so the dialog says what it's showing without a
      // second copy of that string. The count comes from the chip.
      var inner = table.querySelector('table[aria-label]')
      var label = inner && inner.getAttribute('aria-label')
      if (title && label) title.textContent = label
      if (meta) meta.textContent = button.getAttribute('data-sh-conv-expand-meta') || ''

      // Clone into the dialog; the thread's table stays exactly where it
      // is. `cloneNode(true)` copies each row's current
      // `data-sh-review-status`, so a prospect already dropped in the
      // thread shows dropped here too.
      source = table
      var clone = table.cloneNode(true)

      // A clone re-entering the document restarts any CSS animation it
      // still carries — drop the streaming-reveal class so the rows
      // don't re-deal themselves as the dialog opens.
      if (clone.classList) clone.classList.remove('sh-stream-rows')
      var streamNodes = clone.querySelectorAll('.sh-stream-rows')
      for (var sn = 0; sn < streamNodes.length; sn++) {
        streamNodes[sn].classList.remove('sh-stream-rows')
      }
      var streamRows = clone.querySelectorAll('tbody tr')
      for (var srx = 0; srx < streamRows.length; srx++) {
        streamRows[srx].style.animationDelay = ''
      }

      host.innerHTML = ''
      host.appendChild(clone)
      expanded = clone

      // Wire the clone's reject Xs — just the click, not the full
      // `bindProspectTable`, whose document-level review listener would
      // leak one per open on a node discarded at close. A drop still
      // fires `sh:conv-row-decision`, so the cadence card reacts, and the
      // thread table catches up from `finishClose`.
      clone.addEventListener('click', function (event) {
        var t = event.target
        if (t && t.closest) handleDecisionClick(t, clone)
      })

      // The Signal column is a fixed 18rem in both places, so the fit
      // the clone copied from the thread still holds. Re-run anyway: one
      // pass over 37 cells, and the dialog can't then be where a future
      // width change first clips a badge.
      fitSignalBadges(clone)

      lastFocused = button

      // Reveal first, animate second. Both surfaces come out of
      // `display: none`, and a transition can't start from a box that
      // was never laid out — so the `hidden` removals and the open
      // classes have to be separated by a forced reflow. Without the
      // `void` read the browser folds the two style changes into one
      // recalc and the dialog just appears at full size.
      modal.removeAttribute('hidden')
      backdrop.removeAttribute('hidden')
      // Defensive: if a previous close was cut short, the container
      // would still be holding the closing scale and this open would
      // start from there instead of from `--modal-scale`.
      if (container) container.classList.remove('is-closing')
      void modal.offsetHeight

      modal.classList.add(MODAL_OPEN_CLASS)
      backdrop.classList.add(BACKDROP_OPEN_CLASS)
      if (container) container.classList.add('is-open')

      // setTimeout(0) so the browser's own default focus (the dialog
      // becoming visible) doesn't land after ours — same reason the
      // review's dialog defers it.
      var closeBtn = modal.querySelector(SELECTORS.tableModalClose)
      setTimeout(function () {
        if (closeBtn) closeBtn.focus()
        else modal.focus()
      }, 0)

      trapHandler = createTrapHandler(modal, close)
      document.addEventListener('keydown', trapHandler)
    }

    // Close runs in two halves, because the dialog is still on screen
    // for the length of its animation. This half is everything that
    // must happen at the click: the keyboard goes back to the page, and
    // the two surfaces start moving.
    function close () {
      // A second Escape or click while the close is already playing
      // would queue a second cleanup and restore the table twice.
      if (closeTimer) return

      // Focus leaves before the animation does. Waiting would strand
      // the keyboard inside a dialog that's on its way out, and the
      // trap has to come off with it or Tab would still be captured.
      if (trapHandler) {
        document.removeEventListener('keydown', trapHandler)
        trapHandler = null
      }
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus()
      lastFocused = null

      // The dialog dips back to `--modal-scale-close` as it fades; the
      // backdrop fades on the same clock (its open class comes off
      // here, not in the cleanup, so the two move together).
      if (container) {
        container.classList.remove('is-open')
        container.classList.add('is-closing')
      }
      backdrop.classList.remove(BACKDROP_OPEN_CLASS)

      // With the close animation disabled (`--modal-close-dur: 0`) there
      // is nothing to wait for: finish in the same task so the table is
      // back in the thread the instant the dialog goes — no fade, and no
      // frame where neither the dialog nor the thread shows it. A real
      // duration still defers cleanup until the fade has played.
      if (closeMs > 0) {
        closeTimer = window.setTimeout(finishClose, closeMs)
      } else {
        finishClose()
      }
    }

    // The other half — cleanup deferred until the dialog's fade (if any)
    // has played. `hidden` resolves to `display: none`, so setting it up
    // front would leave nothing to animate; writing the clone's drops
    // back and discarding it waits here for the same reason. `expanded`
    // stays set until this runs — it's the flag `open` tests to refuse a
    // second trigger mid-close.
    function finishClose () {
      closeTimer = null

      modal.setAttribute('hidden', '')
      modal.classList.remove(MODAL_OPEN_CLASS)
      backdrop.setAttribute('hidden', '')
      // Back to the resting scale, or the next open would start from
      // the closing state and skip its own animation.
      if (container) container.classList.remove('is-closing')

      // Write any drops made in the dialog back to the thread's table by
      // row id so the two copies agree, then discard the clone. The
      // thread table was never touched, so there is nothing to move home
      // and nothing for it to re-lay-out — which is the whole point.
      if (expanded && source) {
        var rows = expanded.querySelectorAll(SELECTORS.convRow)
        for (var i = 0; i < rows.length; i++) {
          var id = rows[i].getAttribute('data-sh-conv-row-id')
          if (!id) continue
          var srcRow = source.querySelector('[data-sh-conv-row][data-sh-conv-row-id="' + id + '"]')
          if (srcRow) paintRowStatus(srcRow, rows[i].getAttribute('data-sh-review-status') || null)
        }
      }
      if (expanded && expanded.parentNode) expanded.parentNode.removeChild(expanded)
      expanded = null
      source = null
    }

    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest
        ? event.target.closest(SELECTORS.convExpand)
        : null
      if (!button) return
      event.preventDefault()
      open(button)
    })

    var closeBtn = modal.querySelector(SELECTORS.tableModalClose)
    var doneBtn  = modal.querySelector(SELECTORS.tableModalDone)
    if (closeBtn) closeBtn.addEventListener('click', close)
    if (doneBtn)  doneBtn.addEventListener('click', close)

    // Click-outside-to-dismiss, and the listener that does it is on the
    // MODAL, not the backdrop. `.slds-modal` is itself a transparent
    // layer pinned to all four edges at a higher z-index than
    // `.slds-backdrop`, so a click on the shaded gutter never reaches
    // the backdrop — it lands on the section. Testing `target === modal`
    // is what distinguishes the gutter from the dialog inside it. The
    // backdrop keeps a listener anyway, for the SLDS versions where the
    // stacking is the other way round.
    modal.addEventListener('click', function (event) {
      if (event.target === modal) close()
    })
    backdrop.addEventListener('click', close)
  }

  // ──────────────────────────────────────────────────────────────
  // Outreach review controller
  // ──────────────────────────────────────────────────────────────
  // Owns:
  //   • `selectedId`  — currently displayed prospect id.
  //   • `reviews`     — per-prospect review state:
  //                     { [id]: { status, feedback? } }.
  //   • `completed`   — true after "Approve all" confirms.
  //   • Rendering the prospect-detail panel on state change.
  //   • Toggling action-button labels + disabled state per status.
  //   • Confirmation-dialog open/close + focus trap.
  //
  // Prospect data comes from the inlined conversations map (already
  // parsed by `readConversationsMap`). Ordered ids come from the
  // review root's `data-sh-review-prospect-ids` attribute — same
  // order as the table, so Prev/Next moves in list order.
  function bindOutreachReview (reviewRoot, convMap) {
    if (!reviewRoot) return

    var reviewId = reviewRoot.getAttribute('data-sh-review-id')
    var idsAttr  = reviewRoot.getAttribute('data-sh-review-prospect-ids') || ''
    var ids      = idsAttr.split(',').filter(Boolean)
    if (!ids.length) return

    // Look up the full prospect roster in the conversations map.
    // The review lives inside an agent message with a `table.rows`
    // array; walk every conversation's messages and pick the row
    // set whose ids match `ids` (positional, so a partial mismatch
    // still resolves as long as the ids exist somewhere).
    var prospectsById = buildProspectIndex(convMap, ids)

    // Read the status label/modifier map serialized alongside the
    // review shell (`<script type="application/json" data-sh-review-statuses>`).
    // Kept as a JSON blob so adding a new status only needs a
    // change in _home_outreach_review.html.
    var statuses = readStatusMap(reviewId)

    // ── State ────────────────────────────────────────────────
    var state = {
      selectedId: ids[0],
      // reviews map: { id: { status, feedback? } }. Keyed by
      // prospect id so switching between prospects preserves both
      // status AND any feedback the seller typed.
      reviews: Object.create(null),
      completed: false
    }

    // ── DOM refs ─────────────────────────────────────────────
    // Cached upfront so render() doesn't re-query on every notify.
    var els = {
      current:       reviewRoot.querySelector('[data-sh-review-current]'),
      reviewedCount: reviewRoot.querySelector('[data-sh-review-reviewed-count]'),
      name:          reviewRoot.querySelector('[data-sh-review-name]'),
      role:          reviewRoot.querySelector('[data-sh-review-role]'),
      company:       reviewRoot.querySelector('[data-sh-review-company]'),
      signalRow:     reviewRoot.querySelector('[data-sh-review-signal-row]'),
      signal:        reviewRoot.querySelector('[data-sh-review-signal]'),
      channelLabel:  reviewRoot.querySelector('[data-sh-review-channel-label]'),
      subject:       reviewRoot.querySelector('[data-sh-review-subject]'),
      bodyText:      reviewRoot.querySelector('[data-sh-review-body-text]'),
      statusPill:    reviewRoot.querySelector('[data-sh-review-status]'),
      statusLabel:   reviewRoot.querySelector('[data-sh-review-status-label]'),
      approveBtn:    reviewRoot.querySelector('[data-sh-review-approve]'),
      requestBtn:    reviewRoot.querySelector('[data-sh-review-request-changes]'),
      prevBtn:       reviewRoot.querySelector('[data-sh-review-prev]'),
      nextBtn:       reviewRoot.querySelector('[data-sh-review-next]'),
      approveAllBtn: reviewRoot.querySelector('[data-sh-review-approve-all]'),
      body:          reviewRoot.querySelector('[data-sh-review-body]'),
      actionsRow:    reviewRoot.querySelector('.seller-home__conv-review-actions'),
      batchRow:      reviewRoot.querySelector('.seller-home__conv-review-batch'),
      completed:     reviewRoot.querySelector('[data-sh-review-completed]'),
      feedback:      reviewRoot.querySelector('[data-sh-review-feedback]'),
      feedbackInput: reviewRoot.querySelector('[data-sh-review-feedback-input]'),
      feedbackSave:  reviewRoot.querySelector('[data-sh-review-feedback-save]'),
      feedbackCancel:reviewRoot.querySelector('[data-sh-review-feedback-cancel]')
    }

    // Dialog + backdrop are siblings of the review root, emitted by
    // the same macro. Search that shared parent first so a second
    // review — one arriving inside a scripted reply — drives its OWN
    // dialog instead of whichever one happens to come first in the
    // document. Document scope stays as the fallback for a review
    // whose dialog was hoisted elsewhere.
    var dialogScope = reviewRoot.parentNode && reviewRoot.parentNode.querySelector
      ? reviewRoot.parentNode
      : document
    var dialogEls = {
      dialog:   dialogScope.querySelector(SELECTORS.reviewDialog) ||
                document.querySelector(SELECTORS.reviewDialog),
      backdrop: dialogScope.querySelector(SELECTORS.reviewBackdrop) ||
                document.querySelector(SELECTORS.reviewBackdrop)
    }
    if (dialogEls.dialog) {
      dialogEls.confirm = dialogEls.dialog.querySelector('[data-sh-review-dialog-confirm]')
      dialogEls.cancel  = dialogEls.dialog.querySelector('[data-sh-review-dialog-cancel]')
      dialogEls.close   = dialogEls.dialog.querySelector('[data-sh-review-dialog-close]')
    }

    // ── State mutators ───────────────────────────────────────
    function setSelected (id, source) {
      if (ids.indexOf(id) < 0) return
      if (id === state.selectedId) return
      state.selectedId = id
      render()
      // If the user drove selection from the table, scroll the
      // review into view so they don't have to hunt for the panel
      // on a long thread. If they drove it from Prev/Next inside
      // the review, the review is already visible — skip the
      // scroll so we don't jump the page.
      if (source === 'table') scrollReviewIntoView()
    }

    function setReview (id, patch) {
      if (ids.indexOf(id) < 0) return
      var current = state.reviews[id] || { status: 'not_reviewed' }
      var merged = {}
      // Manual copy to avoid Object.assign dependency on ancient browsers.
      for (var k in current) merged[k] = current[k]
      for (var k2 in patch)   merged[k2] = patch[k2]
      state.reviews[id] = merged
      render()
      dispatch(reviewRoot, EVT_DECISION, {
        rowId: id,
        decision: patch.status === 'approved' ? 'approve'
          : patch.status === 'changes_requested' ? 'request_changes'
          : 'update'
      })
    }

    // A decision made in the table's Actions column is the same
    // decision as this panel's Approve / Request-changes buttons, so
    // it flows into the same state: progress count, status pill, and
    // the approve-all completion check all update. Guarded against
    // re-applying an unchanged status, which would re-render (and
    // re-announce) for nothing.
    document.addEventListener(EVT_TABLE_DECISION, function (event) {
      var d = event.detail || {}
      if (!d.rowId || ids.indexOf(d.rowId) < 0) return
      if (d.status !== 'approved' && d.status !== 'changes_requested') return
      var current = state.reviews[d.rowId]
      if (current && current.status === d.status) return
      setReview(d.rowId, { status: d.status })
    })

    function approveAll () {
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i]
        var current = state.reviews[id] || {}
        // Force status → approved; preserve any prior feedback
        // for future audit / undo.
        state.reviews[id] = {
          status: 'approved',
          feedback: current.feedback
        }
      }
      state.completed = true
      render()
      dispatch(reviewRoot, EVT_DECISION, { decision: 'approve_all' })
    }

    // Count non-`not_reviewed` entries. `not_reviewed` is the
    // default when a prospect has never been touched.
    function reviewedCount () {
      var count = 0
      for (var id in state.reviews) {
        var r = state.reviews[id]
        if (r && r.status && r.status !== 'not_reviewed') count++
      }
      return count
    }

    // Compute the id at offset +/- from the current selection.
    // Wraps at either end so the seller can loop through all 12
    // without hitting a dead-end at row 12.
    function neighborId (direction) {
      var idx = ids.indexOf(state.selectedId)
      if (idx < 0) return ids[0]
      var next = idx + direction
      if (next < 0) next = ids.length - 1
      if (next >= ids.length) next = 0
      return ids[next]
    }

    // Render — single function called on every state change.
    // Idempotent: calling with unchanged state produces the same
    // DOM. Keeps the mental model simple (state → view) even
    // though vanilla JS forces us to touch the DOM imperatively.
    function render () {
      var prospect = prospectsById[state.selectedId]
      if (!prospect) return
      var review = state.reviews[state.selectedId] || { status: 'not_reviewed' }
      var currentIdx = ids.indexOf(state.selectedId)

      // Progress counters.
      if (els.current)       els.current.textContent       = String(currentIdx + 1)
      if (els.reviewedCount) els.reviewedCount.textContent = String(reviewedCount())

      // Prospect metadata.
      if (els.name)    els.name.textContent    = prospect.prospect || ''
      if (els.role)    els.role.textContent    = prospect.role || ''
      if (els.company) els.company.textContent = prospect.company || ''

      // Signal row: hide when empty, show otherwise.
      if (els.signalRow) {
        if (prospect.signal) {
          els.signalRow.removeAttribute('hidden')
          if (els.signal) els.signal.textContent = prospect.signal
        } else {
          els.signalRow.setAttribute('hidden', '')
        }
      }

      // Draft.
      if (els.channelLabel) els.channelLabel.textContent = channelLabel(prospect.channel)
      if (els.subject)      els.subject.textContent      = prospect.subject || '(No subject)'
      if (els.bodyText)     els.bodyText.textContent     = prospect.body || ''

      // Status pill.
      applyStatusPill(review.status)

      // Action-button state per current review status.
      applyActionState(review.status)

      // Completed override — replaces the body / actions / batch
      // with the "All N drafts approved" block.
      applyCompletedState(state.completed)

      // Table sync: fire `sh:conv-row-select` so the table's
      // subscriber highlights the corresponding row. Fired on
      // EVERY render (cheap: the table listener bails when the
      // row is already selected). Marked `source: 'review'` so
      // the table doesn't rebound-fire the same event.
      dispatch(reviewRoot, EVT_ROW_SELECT, {
        rowId: state.selectedId,
        source: 'review'
      })

      // Sync feedback textarea with the selected prospect's saved
      // feedback (idle-state; only visible if the seller opened
      // the feedback form for this prospect).
      if (els.feedbackInput) {
        var saved = review && review.feedback ? review.feedback : ''
        // Only overwrite if not currently in a mid-edit state —
        // detect by whether the feedback panel is hidden.
        if (els.feedback && els.feedback.hasAttribute('hidden')) {
          els.feedbackInput.value = saved
        }
      }
    }

    // ── Sub-render helpers ───────────────────────────────────
    function applyStatusPill (statusKey) {
      if (!els.statusPill || !els.statusLabel) return
      var info = statuses[statusKey] || statuses.not_reviewed
      els.statusLabel.textContent = info ? info.label : statusKey
      // Reset any previous modifier, then apply the current one.
      for (var s in statuses) {
        els.statusPill.classList.remove('seller-home__conv-review-status--' + statuses[s].modifier)
      }
      if (info) {
        els.statusPill.classList.add('seller-home__conv-review-status--' + info.modifier)
      }
    }

    // Per-status action-button configuration. Kept as data so a
    // future status only needs a new key here.
    var ACTION_STATE_BY_STATUS = {
      not_reviewed: {
        approveDisabled: false, approveLabel: 'Approve',
        requestDisabled: false, requestLabel: 'Edit'
      },
      approved: {
        // Approved: disable Approve (idempotent + prevents
        // accidental re-approval clicks). Edit stays enabled so
        // the seller can course-correct.
        approveDisabled: true,  approveLabel: 'Approved',
        requestDisabled: false, requestLabel: 'Edit'
      },
      changes_requested: {
        // Changes requested: approve stays enabled so the seller
        // can flip to approved after re-reading the draft; the
        // request button relabels to "Update feedback" to signal
        // that clicking again edits the existing note rather
        // than starting a fresh request.
        approveDisabled: false, approveLabel: 'Approve',
        requestDisabled: false, requestLabel: 'Update feedback'
      }
    }

    function applyActionState (statusKey) {
      var conf = ACTION_STATE_BY_STATUS[statusKey] || ACTION_STATE_BY_STATUS.not_reviewed
      if (els.approveBtn) {
        els.approveBtn.disabled   = conf.approveDisabled
        els.approveBtn.textContent = conf.approveLabel
      }
      if (els.requestBtn) {
        els.requestBtn.disabled   = conf.requestDisabled
        els.requestBtn.textContent = conf.requestLabel
      }
    }

    function applyCompletedState (isComplete) {
      // Toggle visibility of the whole "review this draft" surface
      // vs. the "all done" summary. Hide the confirmation trigger
      // too — after Approve all, there's nothing more to batch.
      toggleHidden(els.body,       isComplete)
      toggleHidden(els.actionsRow, isComplete)
      toggleHidden(els.batchRow,   isComplete)
      toggleHidden(els.completed, !isComplete)
    }

    function toggleHidden (el, shouldHide) {
      if (!el) return
      if (shouldHide) el.setAttribute('hidden', '')
      else            el.removeAttribute('hidden')
    }

    function scrollReviewIntoView () {
      if (typeof reviewRoot.scrollIntoView !== 'function') return
      try {
        reviewRoot.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      } catch (e) {
        // Older browsers: scrollIntoView doesn't accept options.
        reviewRoot.scrollIntoView()
      }
    }

    // ── Event wiring ─────────────────────────────────────────
    // Prev / Next.
    if (els.prevBtn) els.prevBtn.addEventListener('click', function () {
      setSelected(neighborId(-1), 'review')
    })
    if (els.nextBtn) els.nextBtn.addEventListener('click', function () {
      setSelected(neighborId(1), 'review')
    })

    // Approve.
    if (els.approveBtn) els.approveBtn.addEventListener('click', function () {
      if (els.approveBtn.disabled) return
      var prospect = prospectsById[state.selectedId]
      var name = prospect ? (prospect.prospect || prospect.company || '') : ''
      setReview(state.selectedId, { status: 'approved' })
      showToast('Cadence approved for ' + name)
    })

    // Request changes → open inline feedback form.
    if (els.requestBtn) els.requestBtn.addEventListener('click', function () {
      openFeedbackForm()
    })

    // Feedback form save / cancel.
    if (els.feedbackSave) els.feedbackSave.addEventListener('click', function () {
      var val = els.feedbackInput ? els.feedbackInput.value : ''
      setReview(state.selectedId, {
        status: 'changes_requested',
        feedback: (val || '').trim() || undefined
      })
      closeFeedbackForm()
    })
    if (els.feedbackCancel) els.feedbackCancel.addEventListener('click', function () {
      closeFeedbackForm()
    })

    function openFeedbackForm () {
      if (!els.feedback) return
      // Pre-fill with any saved feedback for THIS prospect so the
      // seller can edit instead of retyping.
      var existing = state.reviews[state.selectedId] && state.reviews[state.selectedId].feedback
      if (els.feedbackInput) els.feedbackInput.value = existing || ''
      els.feedback.removeAttribute('hidden')
      if (els.feedbackInput) els.feedbackInput.focus()
    }
    function closeFeedbackForm () {
      if (!els.feedback) return
      els.feedback.setAttribute('hidden', '')
      // Return focus to the trigger for keyboard users.
      if (els.requestBtn) els.requestBtn.focus()
    }

    // Approve all → dialog.
    if (els.approveAllBtn) els.approveAllBtn.addEventListener('click', function () {
      openDialog(els.approveAllBtn)
    })

    // ── Confirmation dialog ─────────────────────────────────
    // Focus-trap keyboard handler is created per-open so the
    // listener can be cleanly removed on close (avoiding stale
    // handlers if the dialog is opened / closed repeatedly).
    var lastFocused = null
    var trapHandler = null

    function openDialog (returnFocusTo) {
      if (!dialogEls.dialog || !dialogEls.backdrop) return
      lastFocused = returnFocusTo || document.activeElement
      dialogEls.dialog.removeAttribute('hidden')
      dialogEls.dialog.classList.add(DIALOG_OPEN_CLASS)
      dialogEls.backdrop.removeAttribute('hidden')
      dialogEls.backdrop.classList.add(DIALOG_OPEN_CLASS)
      // Default focus lands on the confirm button (primary action).
      // Wrapped in setTimeout(0) so the browser's own default-focus
      // logic doesn't compete on the same tick.
      setTimeout(function () {
        if (dialogEls.confirm) dialogEls.confirm.focus()
      }, 0)
      trapHandler = createTrapHandler(dialogEls.dialog, closeDialog)
      document.addEventListener('keydown', trapHandler)
    }

    function closeDialog () {
      if (!dialogEls.dialog || !dialogEls.backdrop) return
      dialogEls.dialog.setAttribute('hidden', '')
      dialogEls.dialog.classList.remove(DIALOG_OPEN_CLASS)
      dialogEls.backdrop.setAttribute('hidden', '')
      dialogEls.backdrop.classList.remove(DIALOG_OPEN_CLASS)
      if (trapHandler) {
        document.removeEventListener('keydown', trapHandler)
        trapHandler = null
      }
      // Restore focus to whatever triggered the open (spec:
      // "focus returns to Approve all when closed").
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus()
      lastFocused = null
    }

    if (dialogEls.confirm) dialogEls.confirm.addEventListener('click', function () {
      approveAll()
      closeDialog()
      showToast('All ' + ids.length + ' cadences approved')
    })
    if (dialogEls.cancel) dialogEls.cancel.addEventListener('click', closeDialog)
    if (dialogEls.close)  dialogEls.close.addEventListener('click', closeDialog)
    if (dialogEls.backdrop) dialogEls.backdrop.addEventListener('click', closeDialog)

    // Subscribe to selection events from the table.
    document.addEventListener(EVT_ROW_SELECT, function (event) {
      var d = event.detail || {}
      if (!d.rowId) return
      // Ignore self-fired events (source: 'review') — the mutation
      // that produced them has already updated internal state.
      if (d.source === 'review') return
      setSelected(d.rowId, 'table')
    })

    // Initial render — populates the SSR panel with the same
    // prospect the shell already rendered, but ALSO wires up
    // status / action-button state / progress counters that
    // depend on JS-owned review state.
    render()
  }

  // Build a { id: prospectRecord } index by scanning every
  // conversation for `table.rows` arrays — both the thread's own
  // messages and the replies parked in `scriptedTurns`, since a
  // scripted turn can answer with a table + review of its own and its
  // rows won't exist in `messages`. Returns records only for ids in
  // the `wantedIds` set — a light guard that keeps the index bounded
  // to the review's roster.
  function buildProspectIndex (convMap, wantedIds) {
    var index = Object.create(null)
    var wanted = Object.create(null)
    for (var i = 0; i < wantedIds.length; i++) wanted[wantedIds[i]] = true
    if (!convMap) return index
    for (var convId in convMap) {
      var conv = convMap[convId] || {}
      collectProspects(conv.messages, wanted, index)
      var turns = conv.scriptedTurns || []
      for (var t = 0; t < turns.length; t++) {
        collectProspects(turns[t] && turns[t].reply, wanted, index)
      }
    }
    return index
  }

  // Pull every wanted prospect row out of a message list into `index`.
  function collectProspects (messages, wanted, index) {
    if (!messages || !messages.length) return
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m]
      var rows = msg && msg.table && msg.table.rows
      if (!rows || !rows.length) continue
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r]
        if (row && row.id && wanted[row.id]) index[row.id] = row
      }
    }
  }

  // Read the status-label/modifier map serialized alongside the
  // review shell. Falls back to a sensible built-in default so the
  // review still renders if the script tag is missing (e.g. a
  // future template regression).
  function readStatusMap (reviewId) {
    var fallback = {
      not_reviewed:        { label: 'Not reviewed',      modifier: 'not-reviewed' },
      approved:            { label: 'Approved',          modifier: 'approved' },
      changes_requested:   { label: 'Changes requested', modifier: 'changes-requested' }
    }
    var selector = '[data-sh-review-statuses="' + reviewId + '"]'
    var node = document.querySelector(selector)
    if (!node) return fallback
    try {
      return JSON.parse(node.textContent) || fallback
    } catch (e) {
      return fallback
    }
  }

  // Human-readable channel labels. Kept in JS (not the JSON) so
  // localization can hook in centrally later.
  function channelLabel (channel) {
    switch (channel) {
      case 'linkedin': return 'LinkedIn'
      case 'phone':    return 'Phone'
      case 'sms':      return 'SMS'
      default:         return 'Email'
    }
  }

  // Focus-trap keydown handler. Cycles Tab focus between the
  // dialog's focusable descendants; Escape closes.
  function createTrapHandler (container, onEscape) {
    return function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault()
        onEscape()
        return
      }
      if (e.key !== 'Tab') return
      var focusables = container.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables.length) return
      var first = focusables[0]
      var last  = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  // ── Toast notification ─────────────────────────────────────────
  function showToast (message, duration) {
    duration = duration || 3000
    var existing = document.querySelector('.sh-toast-container')
    if (existing) existing.remove()

    var container = document.createElement('div')
    container.className = 'slds-notify_container sh-toast-container'
    container.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:9999;'
    container.innerHTML =
      '<div class="slds-notify slds-notify_toast slds-theme_success" role="status">' +
        '<span class="slds-assistive-text">success</span>' +
        '<span class="slds-icon_container slds-icon-utility-success slds-m-right_small slds-no-flex slds-align-top">' +
          '<svg class="slds-icon slds-icon_small" aria-hidden="true">' +
            '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#success"></use>' +
          '</svg>' +
        '</span>' +
        '<div class="slds-notify__content">' +
          '<h2 class="slds-text-heading_small">' + message + '</h2>' +
        '</div>' +
        '<div class="slds-notify__close">' +
          '<button class="slds-button slds-button_icon slds-button_icon-inverse" title="Close">' +
            '<svg class="slds-button__icon" aria-hidden="true">' +
              '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#close"></use>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>'

    document.body.appendChild(container)

    container.querySelector('.slds-notify__close button').addEventListener('click', function () {
      container.remove()
    })

    setTimeout(function () {
      if (container.parentNode) container.remove()
    }, duration)
  }

  // ── Workflow side panel ─────────────────────────────────────────
  // Reveal the panel belonging to `activeConvId` and hide the rest.
  // Every workflow-backed conversation renders its own panel at build
  // time, so switching conversations is a visibility toggle.
  //
  // When no panel matches — the conversation has no `workflowContext`,
  // or it's a scheduling draft — the layout collapses and the thread
  // takes the full width. The empty `data-sh-conv-workflow-id` is what
  // keeps the header's Activity button hidden in that case (see the
  // compound selector in home_conversation.scss).
  function switchPanel (activeConvId, activeEntry) {
    var layout = document.querySelector('[data-sh-conv-layout]')
    var panels = document.querySelectorAll('[data-sh-workflow-panel]')
    var visiblePanel = null

    for (var i = 0; i < panels.length; i++) {
      var p = panels[i]
      if (p.getAttribute('data-sh-workflow-panel-conversation-id') === activeConvId) {
        p.removeAttribute('hidden')
        p.removeAttribute('aria-hidden')
        visiblePanel = p
      } else {
        p.setAttribute('hidden', '')
        p.setAttribute('aria-hidden', 'true')
      }
    }

    if (!layout) return

    if (visiblePanel && activeEntry && activeEntry.workflowContext) {
      // A panel to show — but respect the seller's last choice for
      // this workflow. Closing it once should stay closed.
      var wfId = visiblePanel.getAttribute('data-sh-workflow-panel-id') || ''
      var pref = null
      try {
        pref = window.localStorage && window.localStorage.getItem(sk('sh:convPanel:' + wfId))
      } catch (e) { /* private mode: fall through to open */ }
      if (pref === 'collapsed') layout.classList.add('is-panel-collapsed')
      else layout.classList.remove('is-panel-collapsed')
      layout.setAttribute('data-sh-conv-workflow-id', wfId)
    } else {
      layout.classList.add('is-panel-collapsed')
      layout.setAttribute('data-sh-conv-workflow-id', '')
    }
  }

  // Wire one workflow panel: collapse, overflow menu, run selection
  // (scroll the thread to that run's output), Retry, and the two
  // Activity filters.
  //
  // What it does NOT own: the messages themselves. The thread renders
  // its own content; the panel only anchors into it.
  // ── Run History dropdown ──────────────────────────────────────────
  // The header control for a thread that is one scheduled workflow, run
  // many times, every run appended below the last. It wears the
  // composer's agent-switcher classes and borrows the cadence Prospect
  // lookup's search behavior — see _run_history_menu.html for why the
  // roles are combobox/listbox rather than menu.
  //
  // One registry for every menu on the page so opening one closes the
  // others, and so an outside click has a single place to ask.
  var runMenus = []
  var runGlobalsBound = false

  function closeRunMenus (except) {
    for (var i = 0; i < runMenus.length; i++) {
      if (runMenus[i].el !== except) runMenus[i].close()
    }
  }

  function bindRunHistoryGlobals () {
    if (runGlobalsBound) return
    runGlobalsBound = true
    document.addEventListener('click', function (event) {
      var inside = (event.target && event.target.closest)
        ? event.target.closest('[data-sh-run-menu]')
        : null
      if (!inside) closeRunMenus(null)
    })
  }

  // Show the dropdown belonging to the active conversation and hide the
  // rest. Same arrangement as `switchPanel`: every conversation with a
  // `runHistory` block renders its own, and changing conversations is a
  // visibility toggle rather than a re-render.
  function switchRunHistory (activeConvId) {
    var menus = document.querySelectorAll('[data-sh-run-menu]')
    for (var i = 0; i < menus.length; i++) {
      if (menus[i].getAttribute('data-sh-run-menu-conversation') === activeConvId) {
        menus[i].removeAttribute('hidden')
      } else {
        menus[i].setAttribute('hidden', '')
      }
    }
  }

  function bindRunHistoryMenu (menu) {
    if (!menu || menu.getAttribute('data-sh-run-bound') === 'true') return
    menu.setAttribute('data-sh-run-bound', 'true')

    var trigger = menu.querySelector('[data-sh-run-menu-trigger]')
    var panel = menu.querySelector('[data-sh-run-menu-panel]')
    var search = menu.querySelector('[data-sh-run-menu-search]')
    var list = menu.querySelector('[data-sh-run-menu-list]')
    var emptyEl = menu.querySelector('[data-sh-run-menu-empty]')
    var labelEl = menu.querySelector('[data-sh-run-menu-trigger-label]')
    var iconEl = menu.querySelector('[data-sh-run-menu-trigger-icon]')
    if (!trigger || !panel || !list) return

    var items = []
    var found = list.querySelectorAll('[data-sh-run-menu-item]')
    for (var f = 0; f < found.length; f++) items.push(found[f])

    var activeIndex = -1

    function isOpen () { return !panel.hasAttribute('hidden') }

    function shown () {
      var out = []
      for (var i = 0; i < items.length; i++) {
        if (!items[i].hasAttribute('hidden')) out.push(items[i])
      }
      return out
    }

    // The active row is a class plus `aria-activedescendant`, not real
    // focus: focus stays in the search box so the arrows can walk the
    // list while typing still goes to the query. Same arrangement as
    // `highlightOption` in home_conversation_lookups.js.
    function setActive (index) {
      var options = shown()
      for (var i = 0; i < items.length; i++) items[i].classList.remove('is-active')
      if (index >= 0 && index < options.length) {
        activeIndex = index
        options[index].classList.add('is-active')
        if (search) search.setAttribute('aria-activedescendant', options[index].id)
        try { options[index].scrollIntoView({ block: 'nearest' }) } catch (e) { /* no-op */ }
      } else {
        activeIndex = -1
        if (search) search.removeAttribute('aria-activedescendant')
      }
    }

    // Case-insensitive substring across the run's number, date and
    // status, copying `matchesQuery` in the lookups module: the whole
    // query as one string rather than per word, so "aug 10" matches and
    // "10 aug" doesn't — the same trade the Prospect search makes.
    // Rows are hidden in place rather than rebuilt. At rest every run is
    // shown; the list is height-capped to ~7 rows (home_conversation.scss)
    // and scrolls for the rest, with search to jump straight to one.
    function filter (query) {
      var q = String(query || '').toLowerCase().trim()
      var visible = 0
      for (var i = 0; i < items.length; i++) {
        var hay = (items[i].getAttribute('data-sh-run-search') || '').toLowerCase()
        if (!q || hay.indexOf(q) > -1) {
          items[i].removeAttribute('hidden')
          visible++
        } else {
          items[i].setAttribute('hidden', '')
        }
      }
      if (emptyEl) {
        if (visible) emptyEl.setAttribute('hidden', '')
        else emptyEl.removeAttribute('hidden')
      }
      setActive(-1)
    }

    function open () {
      if (isOpen()) return
      closeRunMenus(menu)
      panel.removeAttribute('hidden')
      trigger.setAttribute('aria-expanded', 'true')
      // Every open starts from the full list: a query left over from
      // last time would hide runs the seller never filtered out.
      if (search) {
        search.value = ''
        filter('')
        try { search.focus() } catch (e) { /* no-op */ }
      }
    }

    function close (returnFocus) {
      if (!isOpen()) return
      panel.setAttribute('hidden', '')
      trigger.setAttribute('aria-expanded', 'false')
      setActive(-1)
      if (returnFocus) {
        try { trigger.focus() } catch (e) { /* no-op */ }
      }
    }

    function select (item) {
      if (!item) return

      for (var i = 0; i < items.length; i++) items[i].setAttribute('aria-selected', 'false')
      item.setAttribute('aria-selected', 'true')

      // The trigger's job is to say which run you are looking at, so it
      // takes the row's label and a copy of its glyph.
      if (labelEl) {
        labelEl.textContent = item.getAttribute('data-sh-run-label') || labelEl.textContent
      }
      if (iconEl) {
        var glyph = item.querySelector('.seller-home__run-history-icon, .sh-spinner')
        if (glyph) {
          var copy = glyph.cloneNode(true)
          copy.classList.remove('seller-home__run-history-icon--row')
          copy.classList.add('seller-home__run-history-icon--trigger')
          iconEl.innerHTML = ''
          iconEl.appendChild(copy)
        }
      }

      close(true)

      // Scroll only — deliberately no `highlightTarget` here. The jump
      // itself is the feedback, and tinting the message on arrival read
      // as the run being selected rather than merely shown. The side
      // panel's Activity tiles still highlight; that surface has no
      // header label saying which run you are on, so it needs the cue.
      var target = findMessage(item.getAttribute('data-sh-run-target'))
      if (!target) return
      scrollToTarget(target)
    }

    trigger.addEventListener('click', function (event) {
      event.preventDefault()
      if (isOpen()) close(true)
      else open()
    })

    trigger.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close(true)
    })

    list.addEventListener('click', function (event) {
      var item = (event.target && event.target.closest)
        ? event.target.closest('[data-sh-run-menu-item]')
        : null
      if (!item || !list.contains(item)) return
      event.preventDefault()
      select(item)
    })

    if (search) {
      search.addEventListener('input', function () { filter(search.value) })
      search.addEventListener('keydown', function (event) {
        var options = shown()
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault()
            setActive(activeIndex < options.length - 1 ? activeIndex + 1 : 0)
            break
          case 'ArrowUp':
            event.preventDefault()
            setActive(activeIndex > 0 ? activeIndex - 1 : options.length - 1)
            break
          case 'Enter':
            event.preventDefault()
            if (activeIndex >= 0 && activeIndex < options.length) select(options[activeIndex])
            break
          case 'Escape':
            event.preventDefault()
            close(true)
            break
        }
      })
    }

    runMenus.push({ el: menu, close: function () { close(false) } })
  }

  // ── Jumping to a run's output in the thread ───────────────────────
  // Shared by the workflow side panel and the header's Run History
  // dropdown: both answer "show me that run" the same way, and a second
  // copy of this would be a second place for the highlight timing to
  // drift. Module scope also means one highlight at a time across the
  // page, which is what you want — two glowing messages would be a lie
  // about which one you asked for.
  var HIGHLIGHT_MS = 1800
  var highlightTimeoutId = 0
  var highlightTargetEl = null

  // A run's output is a message in the thread. The message macros key
  // messages on `data-sh-conv-msg` rather than a DOM id, so resolve by
  // id first (that's what a tile's `href` names, and what works with JS
  // off) and fall back to the data attribute.
  function findMessage (messageId) {
    if (!messageId) return null
    return document.getElementById(messageId) ||
      document.querySelector('[data-sh-conv-msg="' + messageId + '"]')
  }

  function scrollToTarget (el) {
    try {
      el.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start'
      })
    } catch (e) {
      el.scrollIntoView()
    }
    // Focus gives keyboard and screen-reader users the same anchor the
    // scroll just gave everyone else. The message isn't a natural tab
    // stop, so make it focusable for this one purpose, and don't let the
    // focus move re-scroll on top of the smooth scroll.
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    setTimeout(function () {
      try { el.focus({ preventScroll: true }) } catch (e) { el.focus() }
    }, 0)
  }

  function highlightTarget (el) {
    if (highlightTimeoutId) {
      window.clearTimeout(highlightTimeoutId)
      highlightTimeoutId = 0
    }
    if (highlightTargetEl && highlightTargetEl !== el) {
      highlightTargetEl.classList.remove('is-highlighted')
    }
    // Remove, flush, re-add — otherwise picking the same run twice
    // doesn't replay the transition.
    el.classList.remove('is-highlighted')
    /* eslint-disable-next-line no-unused-expressions */
    el.offsetWidth
    el.classList.add('is-highlighted')
    highlightTargetEl = el
    highlightTimeoutId = window.setTimeout(function () {
      el.classList.remove('is-highlighted')
      highlightTimeoutId = 0
      highlightTargetEl = null
    }, HIGHLIGHT_MS)
  }

  function bindWorkflowSidePanel (panel) {
    if (!panel) return

    var workflowId = panel.getAttribute('data-sh-workflow-panel-id') || ''
    var layout = panel.closest ? panel.closest('[data-sh-conv-layout]') : null
    var storageKey = sk('sh:convPanel:' + workflowId)
    var ERROR_TIMEOUT_MS = 6000
    var RETRY_MOCK_MS = 2000

    function collapse () {
      if (!layout || layout.classList.contains('is-panel-collapsed')) return
      layout.classList.add('is-panel-collapsed')
      try {
        if (window.localStorage) window.localStorage.setItem(storageKey, 'collapsed')
      } catch (e) { /* no-op */ }
      // Don't strand the caret on a control that just went away.
      var main = document.querySelector('.seller-home__conv')
      if (main && typeof main.focus === 'function') main.focus()
    }

    var closeBtn = panel.querySelector('[data-sh-workflow-panel-close]')
    if (closeBtn) closeBtn.addEventListener('click', collapse)

    // Escape inside the panel collapses it, the way SLDS docked panels
    // behave — unless a menu is open, which claims Escape first.
    panel.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' && event.key !== 'Esc') return
      if (panel.querySelector('[data-sh-workflow-panel-menu-list]:not([hidden])')) return
      if (!layout || layout.classList.contains('is-panel-collapsed')) return
      event.preventDefault()
      collapse()
    })

    // ── Overflow menu ──────────────────────────────────────────
    var menuTrigger = panel.querySelector('[data-sh-workflow-panel-menu-trigger]')
    var menuList = panel.querySelector('[data-sh-workflow-panel-menu-list]')
    if (menuTrigger && menuList) {
      var setMenuOpen = function (open) {
        menuList.hidden = !open
        menuTrigger.setAttribute('aria-expanded', open ? 'true' : 'false')
      }

      menuTrigger.addEventListener('click', function (event) {
        event.stopPropagation()
        var isOpen = menuTrigger.getAttribute('aria-expanded') === 'true'
        setMenuOpen(!isOpen)
        if (!isOpen) {
          var firstItem = menuList.querySelector('[data-sh-workflow-panel-action]')
          if (firstItem && typeof firstItem.focus === 'function') {
            setTimeout(function () { firstItem.focus() }, 0)
          }
        }
      })

      document.addEventListener('click', function (event) {
        if (menuList.hidden) return
        if (event.target && menuTrigger.parentNode &&
            menuTrigger.parentNode.contains(event.target)) return
        setMenuOpen(false)
      })

      menuList.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' && event.key !== 'Esc') return
        event.stopPropagation()
        setMenuOpen(false)
        menuTrigger.focus()
      })

      var menuItems = menuList.querySelectorAll('[data-sh-workflow-panel-action]')
      for (var m = 0; m < menuItems.length; m++) {
        menuItems[m].addEventListener('click', function (event) {
          dispatch(panel, 'sh:workflow-action', {
            action: event.currentTarget.getAttribute('data-sh-workflow-panel-action'),
            workflowId: workflowId,
            source: 'panel-overflow'
          })
          setMenuOpen(false)
          menuTrigger.focus()
        })
      }
    }

    // ── Announce + inline error ────────────────────────────────
    var announceEl = panel.querySelector('[data-sh-workflow-panel-announce]')
    var errorEl = panel.querySelector('[data-sh-workflow-panel-error]')
    var errorTextEl = panel.querySelector('[data-sh-workflow-panel-error-text]')
    var errorDismissEl = panel.querySelector('[data-sh-workflow-panel-error-dismiss]')
    var errorTimeoutId = 0

    function announce (text) {
      if (!announceEl) return
      // Blank first, then write on the next frame: a live region
      // assigned the same string twice isn't re-read.
      announceEl.textContent = ''
      requestAnimationFrame(function () { announceEl.textContent = text })
    }

    function hideError () {
      if (errorEl) errorEl.hidden = true
      if (errorTimeoutId) {
        window.clearTimeout(errorTimeoutId)
        errorTimeoutId = 0
      }
    }

    function showError (text) {
      if (!errorEl || !errorTextEl) return
      errorTextEl.textContent = text
      errorEl.hidden = false
      if (errorTimeoutId) window.clearTimeout(errorTimeoutId)
      errorTimeoutId = window.setTimeout(hideError, ERROR_TIMEOUT_MS)
    }

    if (errorDismissEl) errorDismissEl.addEventListener('click', hideError)

    // ── Run selection → scroll the thread ──────────────────────

    var runAnchors = panel.querySelectorAll('a[data-sh-workflow-panel-run-target]')
    for (var a = 0; a < runAnchors.length; a++) {
      runAnchors[a].addEventListener('click', function (event) {
        // Leave open-in-new-tab intent to the browser.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (event.button !== 0) return
        event.preventDefault()
        selectRun(event.currentTarget, { updateHash: true })
      })
    }

    // `.is-selected` on the newest tile is baked in by the template,
    // but a URL that arrives with `#msg-…` should win — then the panel
    // and the thread agree on what "current" means.
    var hashId = window.location.hash ? window.location.hash.slice(1) : ''
    if (hashId) {
      var matchAnchor = panel.querySelector('a[data-sh-workflow-panel-run-target="' + hashId + '"]')
      if (matchAnchor) {
        // One frame late, so the browser's own scroll restoration and
        // the thread's first paint both finish first.
        requestAnimationFrame(function () {
          selectRun(matchAnchor, { updateHash: false })
        })
      }
    }

    function selectRun (anchor, options) {
      options = options || {}
      var targetId = anchor.getAttribute('data-sh-workflow-panel-run-target')
      var runId = anchor.getAttribute('data-sh-workflow-panel-run')
      var labelEl = anchor.querySelector('.seller-home__conv-side-run-timestamp')
      var labelText = labelEl ? labelEl.textContent.trim() : (runId || 'run')

      // Selection and hash update regardless of whether the message
      // resolves — otherwise a stale selection lingers on a tile the
      // seller just clicked.
      selectAnchor(anchor)
      hideError()

      var targetEl = findMessage(targetId)

      if (!targetEl) {
        // Every seeded run maps to a rendered message here. This branch
        // is what a real backend needs when the message is outside the
        // loaded range.
        showError('That output isn\u2019t available right now. Try again in a moment.')
        announce('Output for ' + labelText + ' isn\u2019t available.')
        return
      }

      if (options.updateHash) {
        // `replaceState` when the hash already matches, so repeated
        // clicks on the current selection don't grow the history stack.
        var nextHash = '#' + targetId
        try {
          if (window.location.hash === nextHash) window.history.replaceState({}, '', nextHash)
          else window.history.pushState({}, '', nextHash)
        } catch (e) { /* no-op */ }
      }

      scrollToTarget(targetEl)
      highlightTarget(targetEl)
      announce('Loaded ' + labelText + ' output.')
    }

    function selectAnchor (anchor) {
      var selected = panel.querySelectorAll('[data-sh-workflow-panel-run].is-selected')
      for (var i = 0; i < selected.length; i++) {
        selected[i].classList.remove('is-selected')
        selected[i].removeAttribute('aria-current')
      }
      anchor.classList.add('is-selected')
      anchor.setAttribute('aria-current', 'true')
    }

    // ── Retry ──────────────────────────────────────────────────
    // Dispatched as a *cancelable* event so a live backend can call
    // `preventDefault()` and own the retry. Nothing cancels it in the
    // prototype, so the local mock runs instead — and says so, rather
    // than implying the run was really re-queued.
    var retryPending = {}
    var retryBtns = panel.querySelectorAll('[data-sh-workflow-panel-run-retry]')
    for (var rb = 0; rb < retryBtns.length; rb++) {
      retryBtns[rb].addEventListener('click', function (event) {
        var btn = event.currentTarget
        var runId = btn.getAttribute('data-sh-workflow-panel-run-retry') || ''
        if (retryPending[runId]) return
        retryPending[runId] = true

        var originalLabel = btn.textContent
        btn.disabled = true
        btn.setAttribute('aria-busy', 'true')
        btn.textContent = 'Retrying\u2026'

        var restore = function () {
          retryPending[runId] = false
          btn.disabled = false
          btn.removeAttribute('aria-busy')
          btn.textContent = originalLabel
        }

        // Built inline rather than through `dispatch()`, which doesn't
        // hand back the event needed to read `defaultPrevented`.
        var evt = null
        try {
          evt = new CustomEvent('sh:workflow-action', {
            bubbles: true,
            cancelable: true,
            detail: {
              action: 'retry',
              workflowId: workflowId,
              runId: runId,
              source: 'panel-retry'
            }
          })
          panel.dispatchEvent(evt)
        } catch (e) { /* legacy browser: no-op */ }

        if (evt && evt.defaultPrevented) {
          restore()
          return
        }

        announce('Retry started for ' + runId + ' (local prototype).')
        window.setTimeout(function () {
          restore()
          announce('Retry finished (local prototype).')
        }, RETRY_MOCK_MS)
      })
    }

    // ── Activity filters ───────────────────────────────────────
    // Client-side, against each tile's own status + startedAt
    // attributes. A range the runs all fall outside of is a real
    // answer, so the no-match line takes over the list rather than
    // leaving the section looking broken.
    var statusFilter = panel.querySelector('[data-sh-workflow-panel-filter="status"]')
    var rangeFilter = panel.querySelector('[data-sh-workflow-panel-filter="range"]')
    var runItems = panel.querySelectorAll('[data-sh-workflow-panel-run-item]')
    var noMatchEl = panel.querySelector('[data-sh-workflow-panel-no-match]')
    var MS_PER_DAY = 24 * 60 * 60 * 1000

    function applyFilters () {
      var statusVal = statusFilter ? statusFilter.value : 'all'
      var rangeVal = rangeFilter ? rangeFilter.value : 'last_30_days'
      var now = Date.now()
      var rangeMs = rangeVal === 'today' ? MS_PER_DAY
        : rangeVal === 'last_7_days' ? 7 * MS_PER_DAY
          : rangeVal === 'last_30_days' ? 30 * MS_PER_DAY
            : Infinity
      var shown = 0

      for (var i = 0; i < runItems.length; i++) {
        var item = runItems[i]
        var status = item.getAttribute('data-sh-workflow-panel-run-status') || ''
        var startedRaw = item.getAttribute('data-sh-workflow-panel-run-started-at') || ''
        var startedAt = startedRaw ? Date.parse(startedRaw) : NaN

        var statusMatch = statusVal === 'all' || status === statusVal
        // An unparseable or absent timestamp is never filtered out —
        // hiding a run because its date is malformed loses information
        // the seller has no way to get back.
        var rangeMatch = !isFinite(rangeMs) || isNaN(startedAt) || (now - startedAt) <= rangeMs

        if (statusMatch && rangeMatch) {
          item.removeAttribute('hidden')
          shown++
        } else {
          item.setAttribute('hidden', '')
        }
      }

      if (noMatchEl) noMatchEl.hidden = shown > 0
    }

    if (statusFilter) statusFilter.addEventListener('change', applyFilters)
    if (rangeFilter) rangeFilter.addEventListener('change', applyFilters)
    applyFilters()
  }

  // The header's Activity button — the way back after the panel has
  // been closed. Clearing the stored preference is the point: the
  // seller has just overridden the "stay closed" choice, so it
  // shouldn't come back collapsed on the next visit.
  //
  // Visibility is CSS's job (see the compound selector on
  // `.seller-home__conv-layout.is-panel-collapsed`), so this only has
  // to handle activation.
  function bindReopenPanel () {
    var btn = document.querySelector('[data-sh-conv-header-reopen]')
    if (!btn) return

    btn.addEventListener('click', function () {
      var layout = document.querySelector('[data-sh-conv-layout]')
      if (!layout) return
      var wfId = layout.getAttribute('data-sh-conv-workflow-id') || ''
      if (!wfId) return // defensive: CSS should have kept this hidden

      layout.classList.remove('is-panel-collapsed')
      try {
        if (window.localStorage) window.localStorage.removeItem(sk('sh:convPanel:' + wfId))
      } catch (e) { /* no-op */ }

      // Land focus on the first labelled control inside the region
      // that just appeared, a tick later so the class change above
      // doesn't intercept the move.
      var panel = document.querySelector('[data-sh-workflow-panel]:not([hidden])')
      var close = panel && panel.querySelector('[data-sh-workflow-panel-close]')
      if (close && typeof close.focus === 'function') {
        setTimeout(function () { close.focus() }, 0)
      }
    })
  }

  window._shShowToast = showToast

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
}())
