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
//     services. Attachment upload is OUT of scope for Phase 3 — the
//     Add / Skills / All tools buttons dispatch a generic
//     `sh:composer-action` event so a future phase can bind a
//     file-picker without touching this file. (There was a mic here
//     too; it's been removed from the toolbar.)
//   • Phase 4: "Your agent at work" feed — one flat list of recurring
//     workflows, sorted by state rather than split across tabs. Each
//     row's `data-sh-feed-state` drives its status glyph, its per-state
//     menu actions and its sort position, so pausing, resuming,
//     retrying or running a row is one attribute write plus a GSAP
//     Flip re-sort. Also an inline overflow menu (Escape /
//     click-outside close, Arrow-Up/Down within menu) and delegated
//     row-click handling. The visible interactive element is the title
//     inside each row's heading — a `<button>` stretched over the row
//     in CSS so hover never shows a URL preview. Destinations live on
//     `data-sh-nav-href`; the click handler follows them. Rows dispatch
//     `sh:feed-item-select`; menu items dispatch
//     `sh:feed-item-action` / `sh:feed-overflow-action`; the status
//     button dispatches `sh:feed-run-toggle`.
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
  //     overflow menu that mirrors Knowledge's semantics. Row menu
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
//   ('true'/'false') per localStorage's storage contract.
//
//   This script CANNOT restore that state without a visible flash: it
//   loads at the end of <body> and boots on DOMContentLoaded, both of
//   which are after the rail's first paint, and the rail has a 180ms
//   width transition — so a collapsed user would watch it sweep open
//   and shut on every navigation. The restore therefore happens in a
//   parser-blocking inline script in _home_left_nav.html, which lands
//   the class before the rail is laid out. What's left here is the
//   toggle itself, the ARIA state, and thawing the transition one
//   frame in (`releasePreload`).
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

  // Scope every demo/preference key to the URL user (`sh:rohan:recents`).
  // Two tabs on different /u/<id>/ paths share an origin otherwise.
  function sk (key) {
    return (window.SH && typeof window.SH.storageKey === 'function')
      ? window.SH.storageKey(key)
      : key
  }

  // Longest typed message carried in the composer's `?q=` handoff.
  // Well inside every browser's URL limit, and far past anything a
  // seller types into a one-line box.
  var COMPOSER_QUERY_MAX = 500

  function readCollapsed () {
    try {
      return window.localStorage.getItem(sk(STORAGE_KEY)) === 'true'
    } catch (e) {
      return false
    }
  }

  function writeCollapsed (isCollapsed) {
    try {
      window.localStorage.setItem(sk(STORAGE_KEY), isCollapsed ? 'true' : 'false')
    } catch (e) {
      // Silent — the toggle still works within the current tab.
    }
  }

  // ── Recents ─────────────────────────────────────────────────────
  // The Recents rail is session state rather than authored content: it
  // starts empty and grows as the seller opens conversations. There are
  // two ways in today — the "Found new prospects" review card (conv-001)
  // and the composer (conv-002) — and both land on
  // home_conversation.html, so rather than instrumenting each entry
  // point separately we record on ARRIVAL. Anything that reaches a
  // conversation gets a row, including a pasted deep link and the
  // Recents rows themselves.
  //
  // sessionStorage, not localStorage: a new tab should open on a clean
  // slate so the demo can be re-run, while a reload mid-flow keeps what
  // has been opened. (Nav collapse above is a genuine preference, so it
  // uses localStorage — the two are deliberately different.)
  var RECENTS_KEY = 'sh:recents'

  // Which workflow conversations the seller has OPENED (consumed). Opening
  // a completed workflow's thread clears its "New" dot in the rail and
  // drops it out of the feed's Completed group (it moves to Scheduled).
  // sessionStorage, same lifecycle as the recents rail. Kept separate from
  // `sh:convSeen` (home_conversation.js's replay-vs-instant record) on
  // purpose: reusing that key would let the nav mark a thread "seen" before
  // its first opening plays and suppress the reveal.
  var FEED_CONSUMED_KEY = 'sh:feedConsumed'

  // Unlocks the "Drafted reply to Marcus Chen" feed row after Approve
  // on Marcus's cadence in conv-001. Same session lifecycle as Recents.
  var MARCUS_REPLY_KEY = 'sh:marcusReplyReady'

  // Cap the rail so a long session can't scroll forever. Oldest fall
  // off the bottom.
  var RECENTS_MAX = 12

  // Conversations the seller started from a skill's Schedule button.
  // They're created before the conversation is ever opened, so they
  // can't come in through the arrival-recording above — and the store
  // is localStorage, because a schedule outlives the tab that set it up
  // in a way an ordinary thread doesn't.
  //
  // Owned and written by schedule_conversation.js, which isn't loaded
  // on every surface the nav renders on; this file is, so the key is
  // read directly here. It's a read-only dependency — nothing in this
  // file writes to that store.
  var DRAFT_LIST_KEY = 'sh:convDrafts:list:v1'

  // Whether the knowledge banner has been dismissed this session.
  // sessionStorage for the same reason as Recents: the dismissal should
  // survive moving around the app — drilling into a doc and coming back
  // is a full page load, and the banner popping up again there reads as
  // a bug — but a new tab should start clean so the demo can be re-run.
  //
  // Duplicated as a literal in the preload script in knowledge.html,
  // which runs before this file loads. Change one, change both.
  var KNOWLEDGE_BANNER_KEY = 'sh:knowledgeBannerDismissed'

  function readKnowledgeBannerDismissed () {
    try {
      return window.sessionStorage.getItem(sk(KNOWLEDGE_BANNER_KEY)) === 'true'
    } catch (e) {
      return false
    }
  }

  function writeKnowledgeBannerDismissed () {
    try {
      window.sessionStorage.setItem(sk(KNOWLEDGE_BANNER_KEY), 'true')
    } catch (e) {
      // Silent — the banner still stays gone for this page view.
    }
  }

  // The global Home tab wipes history and starts the demo over. It
  // lives in _template.html and shows on every page — including ones
  // that never load this script — so the signal travels in the URL
  // (`/index.html?reset=1`) rather than through a click handler that
  // would only be bound on Seller Home surfaces.
  var RESET_PARAM = 'reset'

  // Everything one run-through of the demo accumulates, in one list so
  // every way of starting over clears exactly the same set.
  //
  // The schedule keys matter as much as Recents here. A confirmed
  // schedule writes its conversation into `sh:convDrafts:list:v1`, which
  // the rail renders on top of this session's history — and that store is
  // localStorage. Left out of the reset (as it was), the row outlived the
  // tab, the refresh, and the Home tab's own start-over button, so it
  // read as a Recents item that could not be removed.
  //
  // Those keys are owned by schedule_conversation.js, which is not loaded
  // on every surface this file is, so they are cleared by name and prefix
  // here rather than through that module. Change a key there, change it
  // here. The nav-collapse preference is deliberately NOT in this list —
  // that one is a real preference, not demo state.
  // `sh:convSeen` is home_conversation.js's record of which threads have
  // already played their opening. It belongs in this list or a restart
  // would clear the rail but still treat every conversation as read,
  // painting them instantly instead of replaying them.
  var DEMO_SESSION_KEYS = [RECENTS_KEY, KNOWLEDGE_BANNER_KEY, 'sh:convSeen', 'sh:convOpeningContinued', FEED_CONSUMED_KEY, MARCUS_REPLY_KEY, 'sh:demoDay']
  var DEMO_LOCAL_KEYS = [DRAFT_LIST_KEY, 'sh:scheduledWorkflows:v1']
  var DEMO_LOCAL_PREFIXES = ['sh:convDraft:v1:', 'sh:convSched:v1:']

  function clearDemoState () {
    try {
      for (var i = 0; i < DEMO_SESSION_KEYS.length; i++) {
        window.sessionStorage.removeItem(sk(DEMO_SESSION_KEYS[i]))
      }
    } catch (e) {
      // Storage unavailable — nothing accumulated, nothing to clear.
    }

    try {
      for (var j = 0; j < DEMO_LOCAL_KEYS.length; j++) {
        window.localStorage.removeItem(sk(DEMO_LOCAL_KEYS[j]))
      }
      // The per-conversation records behind those lists. Collected first
      // and removed after: deleting while walking `key(i)` reindexes the
      // store underneath the loop and silently skips entries.
      var doomed = []
      for (var k = 0; k < window.localStorage.length; k++) {
        var key = window.localStorage.key(k)
        if (!key) continue
        for (var p = 0; p < DEMO_LOCAL_PREFIXES.length; p++) {
          if (key.indexOf(sk(DEMO_LOCAL_PREFIXES[p])) === 0) {
            doomed.push(key)
            break
          }
        }
      }
      for (var d = 0; d < doomed.length; d++) {
        window.localStorage.removeItem(doomed[d])
      }
    } catch (e) {
      // As above.
    }
  }

  // Was this page load a refresh, rather than a link followed?
  //
  // Refreshing is the demo's other start-over button, and the one people
  // reach for first. Navigation Timing tells the two apart, which is what
  // makes this safe: opening a conversation from the rail is a
  // `navigate`, so clicking through the demo never wipes it — only F5
  // does.
  function isReload () {
    try {
      var perf = window.performance
      if (perf && typeof perf.getEntriesByType === 'function') {
        var entries = perf.getEntriesByType('navigation')
        if (entries && entries.length && entries[0].type) {
          return entries[0].type === 'reload'
        }
      }
      // Browsers without Navigation Timing Level 2.
      return !!(perf && perf.navigation && perf.navigation.type === 1)
    } catch (e) {
      return false
    }
  }

  // Clear on arrival if the flag is set, then strip it from the
  // address bar: the reset is a one-shot action, and leaving it in
  // place would fire again on every refresh and read as part of the
  // route. Returns whether it fired.
  //
  // This is the ONLY thing that brings the knowledge banner back. It's
  // grouped with Recents because they're the same idea — the Home tab
  // is the demo's start-over button, and everything a run-through
  // accumulated gets cleared together.
  function consumeResetFlag () {
    try {
      var url = new URL(window.location.href)
      if (url.searchParams.get(RESET_PARAM) !== '1') return false
      clearDemoState()
      url.searchParams.delete(RESET_PARAM)
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
      return true
    } catch (e) {
      return false
    }
  }

  function readRecents () {
    try {
      var raw = window.sessionStorage.getItem(sk(RECENTS_KEY))
      if (!raw) return []
      var parsed = JSON.parse(raw)
      return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : []
    } catch (e) {
      // Unreadable or malformed — treat as no history rather than
      // letting a bad payload break the whole nav.
      return []
    }
  }

  function writeRecents (list) {
    try {
      window.sessionStorage.setItem(sk(RECENTS_KEY), JSON.stringify(list))
    } catch (e) {
      // Silent — the rail still renders for the current page.
    }
  }

  // One row per conversation, and a row never moves once it exists.
  // Re-opening a thread deliberately does NOT promote it to the top:
  // watching the rail reshuffle under the pointer every time you click
  // something reads as a glitch, so position is fixed at first visit.
  //
  // A revisit still refreshes the row in place. The label is whatever
  // the seller typed, so a second question about the same thread has
  // to re-title it — otherwise the rail would advertise the old
  // question while the row now opens the new one.
  function recordRecent (entry) {
    if (!entry || !entry.conversationId) return readRecents()

    var list = readRecents()
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].conversationId === entry.conversationId) {
        list[i] = entry
        writeRecents(list)
        return list
      }
    }

    // Genuinely new: newest on top, oldest pushed off the end.
    list.unshift(entry)
    list = list.slice(0, RECENTS_MAX)
    writeRecents(list)
    return list
  }

  // Schedule-flow conversations, newest first, in the same shape
  // `recordRecent` stores. No `query` — a draft's name comes from the
  // skill it schedules, not from anything typed into a composer.
  function readDraftRecents () {
    try {
      var raw = window.localStorage.getItem(sk(DRAFT_LIST_KEY))
      if (!raw) return []
      var parsed = JSON.parse(raw)
      if (Object.prototype.toString.call(parsed) !== '[object Array]') return []

      var out = []
      for (var i = 0; i < parsed.length; i++) {
        var entry = parsed[i]
        if (!entry || !entry.conversationId) continue
        out.push({
          id: 'rec-' + entry.conversationId,
          label: entry.label || entry.conversationId,
          conversationId: entry.conversationId,
          query: null
        })
      }
      return out
    } catch (e) {
      // Unreadable, malformed, or a browser refusing storage — the rail
      // still renders whatever this session has.
      return []
    }
  }

  // The name a Schedule-flow conversation goes by, or '' when the id
  // isn't one. Used to title the row for a draft the registry has never
  // heard of — see `currentConversation`.
  function draftRecentLabel (convId) {
    if (!convId) return ''
    var drafts = readDraftRecents()
    for (var i = 0; i < drafts.length; i++) {
      if (drafts[i].conversationId === convId) return drafts[i].label
    }
    return ''
  }

  // Drafts on top of this session's history. Where both have the same
  // conversation, the session copy wins: it's the one `recordRecent`
  // keeps current, so it holds the newer name after a schedule is
  // confirmed and the draft is renamed from "Schedule Foo" to "Foo".
  function withDraftRecents (recents) {
    var seen = {}
    for (var i = 0; i < recents.length; i++) {
      if (recents[i] && recents[i].conversationId) {
        seen[recents[i].conversationId] = true
      }
    }

    var drafts = readDraftRecents()
    var out = []
    for (var d = 0; d < drafts.length; d++) {
      if (!seen[drafts[d].conversationId]) out.push(drafts[d])
    }
    return out.concat(recents).slice(0, RECENTS_MAX)
  }

  // The workflow chat sessions inlined by _home_left_nav.html — one per
  // feed workflow, in feed order, each { feedId, conversationId, label,
  // status }. Read once and cached; the base list is static for the page
  // (its `status` values are patched in place by `updateNavSessionStatus`
  // so a later full re-render keeps the live state).
  var workflowSessionsCache = null
  function readWorkflowSessions () {
    if (workflowSessionsCache) return workflowSessionsCache
    workflowSessionsCache = []
    try {
      var el = document.querySelector('[data-sh-nav-workflow-sessions]')
      if (el) {
        var parsed = JSON.parse(el.textContent || '[]')
        if (Object.prototype.toString.call(parsed) === '[object Array]') {
          workflowSessionsCache = parsed
        }
      }
    } catch (e) {
      workflowSessionsCache = []
    }
    return workflowSessionsCache
  }

  // Which workflow conversations have been opened (consumed), as a lookup
  // keyed by conversation id. Drives the "clear the dot + drop from
  // Completed" behaviour.
  function readConsumedConversations () {
    var out = {}
    try {
      var raw = window.sessionStorage.getItem(sk(FEED_CONSUMED_KEY))
      if (!raw) return out
      var parsed = JSON.parse(raw)
      if (Object.prototype.toString.call(parsed) !== '[object Array]') return out
      for (var i = 0; i < parsed.length; i++) out[parsed[i]] = true
    } catch (e) {
      // Unreadable — treat as nothing consumed, which just leaves the
      // dots and Completed rows in place.
    }
    return out
  }

  // Record that a workflow conversation has been opened. Called when the
  // seller lands on a conversation page (see the nav block below), so it
  // reflects on the feed + rail the next time either renders.
  function markConversationConsumed (convId) {
    if (!convId) return
    try {
      var raw = window.sessionStorage.getItem(sk(FEED_CONSUMED_KEY))
      var list = raw ? JSON.parse(raw) : []
      if (Object.prototype.toString.call(list) !== '[object Array]') list = []
      for (var i = 0; i < list.length; i++) {
        if (list[i] === convId) return
      }
      list.push(convId)
      window.sessionStorage.setItem(sk(FEED_CONSUMED_KEY), JSON.stringify(list))
    } catch (e) {
      // Silent — worst case the dot lingers until the thread is reopened.
    }
  }

  // Workflow rows first (always present, in feed order), then any opened
  // or schedule-draft threads not already represented by a workflow's
  // conversation. Keeps the rail a superset of the workflows without
  // listing a thread twice when it IS a workflow. Each workflow entry is
  // cloned into the recents shape so a live status patch never mutates
  // the cached base.
  function isWorkflowSessionVisible (session) {
    if (!session || !session.demoGate) return true
    // Same gate the Home feed uses to unhide `ri-marcus-reply`. Reset
    // and refresh clear this key, so the Recents row leaves with it.
    if (session.demoGate === 'marcus-reply') {
      try { return window.sessionStorage.getItem(sk(MARCUS_REPLY_KEY)) === '1' } catch (e) { return false }
    }
    return false
  }

  function withWorkflowSessions (recents) {
    var sessions = readWorkflowSessions()
    var consumed = readConsumedConversations()
    var out = []
    var seen = {}
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i]
      if (!s || !s.feedId) continue
      if (!isWorkflowSessionVisible(s)) continue
      // A completed workflow whose thread has been opened has had its
      // results consumed: drop it out of the "New" (completed) indicator
      // the same way the feed drops it out of Completed. Down-ranking to
      // `scheduled` clears the dot (the indicator only paints
      // running/completed) and keeps the row in the rail.
      var status = s.status
      if (status === 'completed' && s.conversationId && consumed[s.conversationId]) {
        status = 'scheduled'
      }
      out.push({
        id: 'rec-' + s.feedId,
        feedId: s.feedId,
        conversationId: s.conversationId || '',
        label: s.label,
        status: status
      })
      if (s.conversationId) seen[s.conversationId] = true
    }
    for (var j = 0; j < recents.length; j++) {
      var r = recents[j]
      if (r && r.conversationId && !seen[r.conversationId]) {
        out.push(r)
        seen[r.conversationId] = true
      }
    }
    return out.slice(0, RECENTS_MAX)
  }

  // Live-sync the Recents rail when a feed workflow changes state on the
  // Home page: flip the matching row's trailing indicator (spinner while
  // running, dot when completed, nothing otherwise) in place, without a
  // full re-render. Matches on the feed item id carried as
  // `data-sh-recent-feed`. A no-op on surfaces with no such row.
  function updateNavSessionStatus (feedId, state) {
    if (!feedId) return

    // Patch the cached base too, so a later full re-render (e.g. after a
    // schedule confirmation) reflects the live state rather than the
    // authored one.
    var sessions = readWorkflowSessions()
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i] && sessions[i].feedId === feedId) {
        sessions[i].status = state
        break
      }
    }

    var navRoot = document.querySelector('[data-sh-nav-root]')
    if (!navRoot) return
    var rowEl = navRoot.querySelector('[data-sh-recent-feed="' + feedId + '"]')
    if (!rowEl) return

    if (state) rowEl.setAttribute('data-sh-recent-status', state)
    rowEl.classList.toggle('seller-home__nav-recent--running', state === 'running')

    // Strip the previous indicator, then rebuild from the new state.
    var old = rowEl.querySelectorAll('[data-sh-recent-indicator]')
    for (var k = 0; k < old.length; k++) {
      if (old[k].parentNode) old[k].parentNode.removeChild(old[k])
    }
    appendRecentStatus(rowEl, { status: state, label: rowEl.getAttribute('title') || '' })
  }

  // One or two letters standing in for a Recents label in the collapsed
  // rail, where the label is hidden and these rows have no icon to fall
  // back on. Word initials when there are two words to take them from,
  // the first two letters of a single word otherwise, upper-case either
  // way — the reasoning is written out over `recentMonogram` in
  // _home_left_nav.html, which is the seed render of the same markup.
  //
  // Letters and digits only: a label that opens on punctuation ("$20M of
  // your quota") would otherwise put a stray "$2" in the icon column.
  // Returns '' when there's nothing to take, and the caller renders no
  // monogram at all rather than an empty box.
  function recentMonogram (label) {
    var words = String(label || '').trim().split(/\s+/)
    var out = ''

    for (var i = 0; i < words.length && out.length < 2; i++) {
      var word = words[i].replace(/[^A-Za-z0-9]/g, '')
      if (!word) continue
      // A single word gives both letters; two or more give one each.
      out += words.length > 1 ? word.charAt(0) : word.slice(0, 2)
    }

    return out.slice(0, 2).toUpperCase()
  }

  // Paint the rail. Mirrors the linked-recent markup in
  // _home_left_nav.html — keep the two in step. `activeId` gets
  // `.is-active` here rather than waiting for home_conversation.js so
  // the highlight doesn't depend on script order.
  // Trailing state indicator for a Recents row — the runtime twin of the
  // `renderRecentStatus` macro in _home_left_nav.html. `running` clones
  // the pulse <template> the nav ships (so the markup lives in
  // one place); `completed` ("New") appends a green dot + an assistive-text
  // sibling. Every node carries `data-sh-recent-indicator` so
  // `updateNavSessionStatus` can strip the old indicator before swapping.
  function appendRecentStatus (a, r) {
    if (!r || !r.status) return
    if (r.status === 'running') {
      var tpl = document.querySelector('[data-sh-recent-spinner-template]')
      var spinner = (tpl && tpl.content && tpl.content.firstElementChild)
        ? tpl.content.firstElementChild.cloneNode(true)
        : null
      if (spinner) {
        spinner.setAttribute('aria-label', (r.label || '') + ' is running.')
        a.appendChild(spinner)
      }
    } else if (r.status === 'completed') {
      // Slot wrapper (centres the glyph) + inner green dot — mirrors the
      // macro so both render paths produce the same DOM.
      var slot = document.createElement('span')
      slot.className = 'seller-home__nav-recent-status seller-home__nav-recent-status--completed slds-col_bump-left'
      slot.setAttribute('data-sh-recent-indicator', '')
      slot.setAttribute('aria-hidden', 'true')

      var dot = document.createElement('span')
      dot.className = 'seller-home__nav-recent-status-glyph seller-home__nav-recent-status-glyph--dot'
      dot.setAttribute('data-sh-recent-status-dot', '')
      slot.appendChild(dot)
      a.appendChild(slot)

      var at = document.createElement('span')
      at.className = 'slds-assistive-text'
      at.setAttribute('data-sh-recent-indicator', '')
      at.textContent = ', new results'
      a.appendChild(at)
    }
  }

  function renderRecents (root, list, activeId) {
    var listEl = root.querySelector('[data-sh-recents-list]')
    if (!listEl) return

    // Rows only — the "Recents" heading above stays put even with no
    // history, so the rail doesn't change shape on the first chat.
    listEl.textContent = ''

    for (var i = 0; i < list.length; i++) {
      var r = list[i]
      if (!r) continue
      // A workflow row can lack a conversation (no thread yet) but still
      // needs to show — inert — with its state indicator. Only genuinely
      // empty entries are skipped.
      if (!r.conversationId && !r.feedId) continue

      var hasConv = !!r.conversationId
      var a = document.createElement('button')
      a.type = 'button'
      a.className = 'seller-home__nav-recent' +
        (hasConv ? ' seller-home__nav-recent--linked' : '') +
        (r.status === 'running' ? ' seller-home__nav-recent--running' : '')

      if (hasConv) {
        // Carry the original query back. The thread only renders the
        // seller's own bubble when `?q=` is present, so dropping it here
        // would reopen a row labelled with what they typed onto a thread
        // that starts on the agent. Destination lives on data-sh-nav-href
        // (not href) so hover never shows a URL preview.
        a.setAttribute('data-sh-nav-href', window.SH.userUrl('/home_conversation.html?id=' + encodeURIComponent(r.conversationId) +
          (r.query ? '&q=' + encodeURIComponent(r.query) : '')))
        a.setAttribute('data-sh-recent-conv', r.conversationId)
      } else {
        // Workflow with no conversation yet — present but inert, matching
        // the template's unlinked branch.
        a.setAttribute('data-sh-nav-noroute', '')
      }
      a.setAttribute('role', 'listitem')
      a.setAttribute('data-sh-recent', r.id || (r.feedId ? 'rec-' + r.feedId : 'rec-' + r.conversationId))
      // Feed item id, so the Home feed's live-sync can find this row.
      if (r.feedId) a.setAttribute('data-sh-recent-feed', r.feedId)
      if (r.status) a.setAttribute('data-sh-recent-status', r.status)
      a.title = r.label || r.conversationId

      if (activeId && hasConv && r.conversationId === activeId) {
        a.classList.add('is-active')
        a.setAttribute('aria-current', 'page')
      }

      // Ahead of the label, and only visible when the rail is collapsed.
      var mono = recentMonogram(r.label || r.conversationId)
      if (mono) {
        var monoEl = document.createElement('span')
        monoEl.className = 'seller-home__nav-recent-mono'
        // Hidden from AT: the row's accessible name comes from `title`,
        // which is the whole label — better than reading out "FN".
        monoEl.setAttribute('aria-hidden', 'true')
        monoEl.textContent = mono
        a.appendChild(monoEl)
      }

      var label = document.createElement('span')
      label.className = 'seller-home__nav-recent-label'
      // textContent, not innerHTML — labels are authored data today but
      // this path would happily render a typed query tomorrow.
      label.textContent = r.label || r.conversationId
      a.appendChild(label)

      // Trailing state indicator (spinner while running, dot when
      // completed, nothing otherwise).
      appendRecentStatus(a, r)

      listEl.appendChild(a)
    }
  }

  // The conversation this page is showing, if any. Returns null on
  // every other surface, which is what keeps Home / Knowledge /
  // Scheduled from writing history entries.
  function currentConversation (root) {
    var convRoot = root.querySelector('[data-sh-conv-root]') ||
      (root.matches && root.matches('[data-sh-conv-root]') ? root : null)
    if (!convRoot) return null

    var id = ''
    var query = ''
    try {
      var params = new URLSearchParams(window.location.search)
      id = params.get('id') || ''
      query = String(params.get('q') || '').trim().slice(0, COMPOSER_QUERY_MAX)
    } catch (e) {
      id = ''
      query = ''
    }
    if (!id) id = convRoot.getAttribute('data-sh-conv-default') || ''
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return null

    // What the seller typed is the truest name for the thread, so it
    // wins when there is one — matching the header the conversation
    // page paints from the same `?q=`. The rail is a single line with
    // an ellipsis (see .seller-home__nav-recent-label), so a long
    // question truncates on its own; the full text stays in `title`
    // for the hover tooltip.
    //
    // Arrivals with no query — the Ready to Review drill-in, a bare
    // deep link — fall back to the curated `recentLabel` from the
    // registry the page already inlines for home_conversation.js, so
    // there's no second source of truth for a conversation's name.
    var label = query
    if (!label) {
      label = id
      try {
        var registry = JSON.parse(convRoot.getAttribute('data-sh-conversations') || '{}')
        var entry = registry[id]
        if (entry) label = entry.recentLabel || entry.title || id
      } catch (e) {
        // Fall back to the raw id rather than dropping the row.
      }
      // A Schedule-flow conversation is created at runtime, so it's in
      // neither the registry nor the URL's `?q=`. Its name lives with
      // the draft — without this the rail would advertise the row by
      // its id.
      if (label === id) label = draftRecentLabel(id) || id
    }

    return { id: 'rec-' + id, label: label, conversationId: id, query: query || null }
  }

  // ── Today's date ────────────────────────────────────────────────
  // Re-stamp every `[data-sh-today]` element from the browser clock.
  // Pages that pin `feed.date` omit `data-sh-today` and stay put
  // (agent_at_work.html owns its own ladder).
  //
  // Format is "Mon July 13", matching the review header's design.
  // `formatToParts` rather than `format` because en-US inserts a comma
  // after the weekday. Deliberately duplicated from the gulpfile: the
  // build and the browser each need their own copy, and six lines is
  // cheaper than a shared-module build step in a no-bundler project.
  function formatToday (date) {
    if (!window.Intl || typeof window.Intl.DateTimeFormat !== 'function') return null
    try {
      var fmt = new window.Intl.DateTimeFormat('en-US', {
        weekday: 'short', month: 'long', day: 'numeric'
      })
      if (typeof fmt.formatToParts !== 'function') return null
      var out = []
      var parts = fmt.formatToParts(date)
      for (var i = 0; i < parts.length; i++) {
        var type = parts[i].type
        if (type === 'weekday' || type === 'month' || type === 'day') out.push(parts[i].value)
      }
      return out.length ? out.join(' ') : null
    } catch (e) {
      // Leave the build-time value in place rather than blanking it.
      return null
    }
  }

  function stampToday (root) {
    var day = new Date()
    var text = formatToday(day)
    if (!text) return
    var nodes = root.querySelectorAll('[data-sh-today]')
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].textContent !== text) nodes[i].textContent = text
    }

    // Short date prefix — "Aug 10" style, for output pills that
    // carry `data-sh-today-short`.
    var shortDate = formatTodayShort(day)
    if (!shortDate) return
    var shortNodes = root.querySelectorAll('[data-sh-today-short]')
    for (var j = 0; j < shortNodes.length; j++) {
      var el = shortNodes[j]
      var current = el.textContent
      if (current.indexOf(shortDate) !== 0) {
        var stripped = current.replace(/^[A-Z][a-z]{2}\s\d{1,2}\s/, '')
        el.textContent = shortDate + ' ' + stripped
      }
    }
  }

  function formatTodayShort (date) {
    if (!window.Intl || typeof window.Intl.DateTimeFormat !== 'function') return null
    try {
      var fmt = new window.Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
      if (typeof fmt.formatToParts !== 'function') return null
      var out = []
      var parts = fmt.formatToParts(date)
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'month' || parts[i].type === 'day') out.push(parts[i].value)
      }
      return out.length ? out.join(' ') : null
    } catch (e) { return null }
  }

  // Drop the class that freezes the rail's width transition during
  // load. Guarded on rAF so a browser without it (or a page where the
  // inline script never ran) still ends up unfrozen.
  function releasePreload (root) {
    var thaw = function () {
      root.classList.remove('seller-home--nav-preload')
    }
    if (typeof window.requestAnimationFrame !== 'function') return thaw()
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(thaw)
    })
  }

  // ── Boot ────────────────────────────────────────────────────────
  function init () {
    var root = document.querySelector('[data-sh-root]')
    if (!root) return

    // The inline script in _home_left_nav.html has already put the rail
    // in its restored state and frozen its width transition. Thaw it
    // once the browser has painted that state, so the first user-driven
    // toggle animates but the restore never did.
    //
    // Two frames, not one: the first fires before the paint this style
    // change belongs to, and removing the class there can still let the
    // restore animate.
    releasePreload(root)

    // Correct any build-time date stamp to the live calendar day.
    stampToday(root)

    var toggle = root.querySelector('[data-sh-nav-toggle]')
    if (toggle) {
      // Re-apply the persisted state so the toggle's ARIA attrs match
      // the classes the inline script set. Idempotent by design — the
      // classes are already correct, so this changes nothing visually
      // and no transition fires even before the thaw above lands.
      // `data-sh-nav-default-collapsed` forces a closed first paint
      // (agent-at-work lab) without reading Home's stored preference.
      applyState(
        root,
        toggle,
        root.hasAttribute('data-sh-nav-default-collapsed') ? true : readCollapsed()
      )

      toggle.addEventListener('click', function (event) {
        event.preventDefault()
        var next = !root.classList.contains('seller-home--nav-collapsed')
        applyState(root, toggle, next)
        writeCollapsed(next)
      })
    }

    // A refresh starts the demo over. Outside the `nav` block below so it
    // still fires on a surface with no Recents rail — the schedule state
    // it clears is app-wide, and a reload on one page should not leave
    // another page holding the last run-through.
    if (isReload()) clearDemoState()

    var nav = root.querySelector('[data-sh-nav-root]')

    // Recents. Reset first (the Home tab's `?reset=1` wipes history),
    // then record, then paint — so the conversation the seller just
    // opened is already in the list it renders, with no flash of a rail
    // that's missing the row you arrived on.
    if (nav) {
      consumeResetFlag()
      var current = currentConversation(root)
      // Landing on a conversation page means the seller opened it — record
      // it consumed BEFORE painting the rail so this workflow's "New" dot
      // is already gone on this very page, and stays gone on the feed when
      // they navigate back.
      if (current && current.conversationId) markConversationConsumed(current.conversationId)
      var recents = current ? recordRecent(current) : readRecents()
      var activeConvId = current ? current.conversationId : null
      renderRecents(nav, withWorkflowSessions(withDraftRecents(recents)), activeConvId)

      // Confirming a schedule renames its conversation — "Schedule
      // Pipeline Snapshot" becomes "Pipeline Snapshot",
      // since the thread is no longer about setting one up. Re-record
      // under the new name (in place: `recordRecent` keeps a row's
      // position) and repaint, so the rail updates without a reload.
      document.addEventListener('sh:schedule-confirmed', function (event) {
        var detail = event && event.detail
        var convId = detail && detail.conversationId
        var label = detail && detail.workflow && detail.workflow.title
        var next = (convId && label)
          ? recordRecent({
            id: 'rec-' + convId,
            label: label,
            conversationId: convId,
            query: null
          })
          : readRecents()
        renderRecents(nav, withWorkflowSessions(withDraftRecents(next)), activeConvId)
      })
    }

    // Every left-nav row is a `<button>` so hover never shows a URL
    // preview. Destinations live on `data-sh-nav-href`; this handler
    // follows them. Cmd/Ctrl/Shift-click and middle-click open a new
    // tab, matching what an `<a>` would do. `[data-sh-tools-open]` is
    // left alone so tools_modal.js can open the modal instead.
    if (nav) {
      function navHrefFrom (el) {
        return el && el.getAttribute('data-sh-nav-href')
      }

      function followNavHref (href, newTab) {
        if (!href) return
        if (newTab) {
          window.open(href, '_blank')
          return
        }
        window.location.assign(href)
      }

      nav.addEventListener('click', function (event) {
        var placeholder = closest(event.target, '[data-sh-nav-noroute]')
        if (placeholder) {
          event.preventDefault()
          return
        }
        var row = closest(event.target, '[data-sh-nav-href]')
        if (!row || row.hasAttribute('data-sh-tools-open')) return
        var href = navHrefFrom(row)
        if (!href) return
        followNavHref(href, event.metaKey || event.ctrlKey || event.shiftKey)
      })

      nav.addEventListener('auxclick', function (event) {
        if (event.button !== 1) return
        var row = closest(event.target, '[data-sh-nav-href]')
        if (!row || row.hasAttribute('data-sh-tools-open')) return
        var href = navHrefFrom(row)
        if (!href) return
        event.preventDefault()
        followNavHref(href, true)
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

    // The conversation page's composer carries the same agent switcher,
    // so it needs the same menu controller — but ONLY that. It is
    // deliberately not a `[data-sh-composer-root]`: `bindComposer` above
    // would also give it Seller Home's submit, which navigates away to a
    // new conversation, and this is a follow-up input that appends to the
    // thread it is already in (`bindConvComposer` in
    // home_conversation.js owns that). `bindComposerMenus` delegates on
    // whatever root it is handed, so handing it this one wires the badge
    // and nothing else.
    var convComposer = document.querySelector('[data-sh-conv-composer]')
    if (convComposer && convComposer.querySelector('[data-sh-composer-menu]')) {
      bindComposerMenus(convComposer)
    }

    // Phase 4 — "Your agent at work" feed.
    var feedRoot = root.querySelector('[data-sh-feed-root]')
    if (feedRoot) {
      bindFeed(feedRoot)
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

    // Knowledge tabs (Learnings / Sources). Bound AFTER the search so its
    // load-time re-filter finds the search controller's `input` listener
    // already attached. No-op when the tabs aren't on the page.
    if (knowledgeDocList) {
      bindKnowledgeTabs(root)
    }

    // Phase 5c — Knowledge banner dismiss (also /knowledge.html only).
    var knowledgeBanner = root.querySelector('[data-sh-knowledge-banner]')
    if (knowledgeBanner) {
      bindKnowledgeBanner(knowledgeBanner)
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
      bindScheduledComposer(scheduledRoot)
    }

    // Connections modal — "View all" button in the composer footer.
    bindConnectionsModal()
    bindFeedEditModal()
  }

  // Feed Edit dialog. Same fields as the Scheduled sidebar, filled from
  // the row that opened it. Instructions describe when the run happens
  // and where the result is delivered. Cancel discards; Save keeps the
  // frequency, time, and instructions for that row.
  var openFeedEditModal = function () {}

  function bindFeedEditModal () {
    var modal = document.querySelector('[data-sh-feed-edit-modal]')
    var backdrop = document.querySelector('[data-sh-feed-edit-backdrop]')
    if (!modal || !backdrop) return

    var titleEl = modal.querySelector('[data-sh-feed-edit-title]')
    var announceEl = modal.querySelector('[data-sh-feed-edit-announce]')
    var freqEl = modal.querySelector('[data-sh-feed-edit-frequency]')
    var freqList = modal.querySelector('[data-sh-feed-edit-frequency-list]')
    var timeEl = modal.querySelector('[data-sh-feed-edit-time]')
    var timeList = modal.querySelector('[data-sh-feed-edit-time-list]')
    var deliveryEl = modal.querySelector('[data-sh-feed-edit-delivery]')
    var skillEl = modal.querySelector('[data-sh-feed-edit-skill]')
    var skillNameEl = modal.querySelector('[data-sh-feed-edit-skill-name]')
    var instrEl = modal.querySelector('[data-sh-feed-edit-instructions]')
    var createdEl = modal.querySelector('[data-sh-feed-edit-created]')
    var lastRunEl = modal.querySelector('[data-sh-feed-edit-lastrun]')
    var saveBtn = modal.querySelector('[data-sh-feed-edit-save]')
    var closers = modal.querySelectorAll('[data-sh-feed-edit-close]')

    var FREQ_OPTIONS = ['Hourly', 'Daily', 'Weekdays', 'Monthly']
    var TIME_OPTIONS = (function () {
      var out = []
      for (var mins = 0; mins < 24 * 60; mins += 15) {
        var h = Math.floor(mins / 60)
        var m = mins % 60
        var period = h < 12 ? 'AM' : 'PM'
        var h12 = h % 12
        if (h12 === 0) h12 = 12
        out.push(h12 + ':' + (m < 10 ? '0' + m : m) + ' ' + period)
      }
      return out
    })()

    function readJson (id, fallback) {
      var el = document.getElementById(id)
      if (!el) return fallback
      try { return JSON.parse(el.textContent || '') } catch (err) { return fallback }
    }

    var skillNames = readJson('sh-feed-edit-skills', {}) || {}
    var byId = {}
    readJson('sh-feed-edit-schedules', []).forEach(function (rec) {
      if (rec && rec.id) byId[rec.id] = rec
    })

    var lastFocused = null
    var draft = null
    var opened = null
    var activeRow = null
    var SKILL_ROUTE = window.SH.userUrl('/skill_detail.html')
    var CHECK_ICON = '<svg class="slds-icon slds-icon_x-small slds-listbox__icon-selected" aria-hidden="true"><use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#check"></use></svg>'

    function writeControl (control, value) {
      if (!control) return
      if (control.tagName === 'INPUT') control.value = value || ''
      else {
        var trunc = control.querySelector('.slds-truncate')
        if (trunc) trunc.textContent = value || ''
        // SLDS grays a faux combobox until it carries this class, which
        // is why Frequency read lighter than the time input beside it.
        control.classList.toggle('slds-combobox__input-value', !!value)
      }
    }

    function readControl (control) {
      if (!control) return ''
      if (control.tagName === 'INPUT') return (control.value || '').trim()
      var trunc = control.querySelector('.slds-truncate')
      return trunc ? trunc.textContent.trim() : ''
    }

    function fillList (list, control, options, value) {
      if (!list) return
      var opts = options.slice()
      if (value && opts.indexOf(value) < 0) opts.unshift(value)
      list.innerHTML = ''
      opts.forEach(function (label) {
        var li = document.createElement('li')
        li.setAttribute('role', 'presentation')
        li.className = 'slds-listbox__item'
        var option = document.createElement('div')
        option.className = 'slds-media slds-listbox__option slds-listbox__option_plain slds-media_small'
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', label === value ? 'true' : 'false')
        if (label === value) option.classList.add('slds-is-selected')
        var figure = document.createElement('span')
        figure.className = 'slds-media__figure slds-listbox__option-icon'
        figure.innerHTML = CHECK_ICON
        var body = document.createElement('span')
        body.className = 'slds-media__body'
        var span = document.createElement('span')
        span.title = label
        span.textContent = label
        body.appendChild(span)
        option.appendChild(figure)
        option.appendChild(body)
        li.appendChild(option)
        list.appendChild(li)
      })
      writeControl(control, value)
    }

    function statusWord (state) {
      if (state === 'failed') return 'Failed'
      if (state === 'paused') return 'Paused'
      if (state === 'archived') return 'Archived'
      return 'Completed'
    }

    function renderLastRun (record) {
      if (!lastRunEl) return
      var when = (record.lastRun || '').replace(/^Last run\s+/i, '')
      var status = statusWord(record.state)
      if (when) lastRunEl.textContent = status + ' ' + when
      else lastRunEl.textContent = '—'
      lastRunEl.classList.toggle('is-error', record.state === 'failed')
    }

    function closeComboboxes () {
      toArray(modal.querySelectorAll('[data-slds-combobox]')).forEach(function (trigger) {
        trigger.classList.remove('slds-is-open')
        var control = trigger.querySelector('[role="combobox"]')
        if (control) control.setAttribute('aria-expanded', 'false')
      })
    }

    function populate (record) {
      if (titleEl) titleEl.textContent = record.title || 'Edit'
      fillList(freqList, freqEl, FREQ_OPTIONS, record.frequency)
      fillList(timeList, timeEl, TIME_OPTIONS, record.time)
      if (deliveryEl) deliveryEl.textContent = record.delivery || '—'
      var skillName = record.skillName || skillNames[record.skillId] || ''
      if (skillNameEl) skillNameEl.textContent = skillName
      if (skillEl) {
        if (skillName) {
          skillEl.hidden = false
          var href = record.skillId ? (SKILL_ROUTE + '?id=' + encodeURIComponent(record.skillId)) : SKILL_ROUTE
          skillEl.setAttribute('href', href)
          skillEl.setAttribute('aria-label', 'Uses Skill: ' + skillName + '. Open Skill details.')
        } else {
          skillEl.hidden = true
        }
      }
      if (instrEl) instrEl.value = record.instructions || ''
      if (createdEl) {
        var created = record.createdAt || ''
        if (record.createdBy) created = created ? (created + ' by ' + record.createdBy) : ('by ' + record.createdBy)
        createdEl.textContent = created || '—'
      }
      renderLastRun(record)
      if (announceEl) announceEl.textContent = 'Showing details for ' + (record.title || 'this schedule') + '.'
    }

    function replaceSlotTime (slot, prevTime, nextTime) {
      if (!slot || !prevTime || prevTime === nextTime) return
      var pattern = prevTime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      var re = new RegExp(pattern)
      ;['', '-default', '-paused', '-running', '-completed', '-scheduled', '-archived'].forEach(function (suffix) {
        var attr = suffix ? ('data-sh-feed-slot' + suffix) : null
        var value = attr ? slot.getAttribute(attr) : slot.textContent
        if (value && re.test(value)) {
          var next = value.replace(re, nextTime)
          if (attr) slot.setAttribute(attr, next)
          else slot.textContent = next
        }
      })
    }

    function replaceSlotFrequency (slot, prevFreq, nextFreq) {
      if (!slot || !prevFreq || prevFreq === nextFreq) return
      if (slot.textContent.trim() === prevFreq) slot.textContent = nextFreq
      ;['default', 'completed', 'scheduled'].forEach(function (key) {
        var attr = 'data-sh-feed-slot-' + key
        if (slot.getAttribute(attr) === prevFreq) slot.setAttribute(attr, nextFreq)
      })
    }

    function commit () {
      if (!draft) return
      draft.frequency = readControl(freqEl)
      draft.time = readControl(timeEl)
      if (instrEl) draft.instructions = instrEl.value
      if (draft.id) byId[draft.id] = JSON.parse(JSON.stringify(draft))
      if (activeRow && opened) {
        replaceSlotFrequency(activeRow.querySelector('[data-sh-feed-slot="status"]'), opened.frequency, draft.frequency)
        replaceSlotTime(activeRow.querySelector('[data-sh-feed-slot="time"]'), opened.time, draft.time)
      }
    }

    function focusables () {
      return toArray(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(function (el) { return !el.disabled && !el.hidden && el.getAttribute('aria-hidden') !== 'true' })
    }

    function open (returnTo, row) {
      var id = row && row.getAttribute('data-sh-feed-item')
      var base = (id && byId[id]) ? byId[id] : {
        id: id || '',
        title: 'Edit',
        frequency: 'Daily',
        time: '9:00 AM',
        delivery: 'the home feed',
        skillId: row ? (row.getAttribute('data-sh-feed-skill') || '') : '',
        instructions: '',
        createdBy: 'You',
        lastRun: '',
        state: row ? (row.getAttribute('data-sh-feed-state') || '') : ''
      }
      closeComboboxes()
      draft = JSON.parse(JSON.stringify(base))
      opened = JSON.parse(JSON.stringify(base))
      activeRow = row || null
      populate(draft)
      lastFocused = returnTo || document.activeElement
      modal.removeAttribute('hidden')
      modal.classList.add('slds-fade-in-open')
      backdrop.removeAttribute('hidden')
      backdrop.classList.add('slds-backdrop_open')
      setTimeout(function () {
        if (titleEl) titleEl.focus()
        else modal.focus()
      }, 0)
    }

    function close () {
      closeComboboxes()
      modal.classList.remove('slds-fade-in-open')
      backdrop.classList.remove('slds-backdrop_open')
      modal.setAttribute('hidden', '')
      backdrop.setAttribute('hidden', '')
      draft = null
      opened = null
      activeRow = null
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus()
      lastFocused = null
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        commit()
        close()
      })
    }
    for (var i = 0; i < closers.length; i++) {
      closers[i].addEventListener('click', close)
    }
    backdrop.addEventListener('click', close)
    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        e.preventDefault()
        close()
        return
      }
      if (e.key !== 'Tab') return
      var items = focusables()
      if (!items.length) return
      var first = items[0]
      var last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    })

    openFeedEditModal = open
  }

  // ── Connections modal ──────────────────────────────────────────
  function bindConnectionsModal () {
    var modal    = document.querySelector('[data-sh-connections-modal]')
    var backdrop = document.querySelector('[data-sh-connections-backdrop]')
    if (!modal || !backdrop) return

    var openers = document.querySelectorAll('[data-sh-connections-open]')
    var closers = modal.querySelectorAll('[data-sh-connections-modal-close]')
    var lastFocused = null

    function open (returnTo) {
      lastFocused = returnTo || document.activeElement
      modal.removeAttribute('hidden')
      modal.classList.add('slds-fade-in-open')
      backdrop.removeAttribute('hidden')
      backdrop.classList.add('slds-backdrop_open')
      setTimeout(function () { modal.focus() }, 0)
    }

    function close () {
      modal.classList.remove('slds-fade-in-open')
      backdrop.classList.remove('slds-backdrop_open')
      modal.setAttribute('hidden', '')
      backdrop.setAttribute('hidden', '')
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus()
      lastFocused = null
    }

    for (var i = 0; i < openers.length; i++) {
      openers[i].addEventListener('click', function () { open(this) })
    }
    for (var j = 0; j < closers.length; j++) {
      closers[j].addEventListener('click', close)
    }
    backdrop.addEventListener('click', close)
    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) close()
    })
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
  // The extra toolbar buttons (Add / Skills / All tools) are stub
  // actions — they dispatch `sh:composer-action` with the clicked
  // `data-sh-composer-action` id. Attachment infrastructure is
  // deliberately not started here.
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

    var restingPlaceholder = textarea.getAttribute('placeholder') || ''
    textarea.addEventListener('focus', function () {
      textarea.placeholder = ''
    })
    textarea.addEventListener('blur', function () {
      if (!textarea.value.trim()) textarea.placeholder = restingPlaceholder
    })

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

    bindComposerMenus(composerRoot)

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

  // ── Composer action menus ─────────────────────────────────────────
  // A toolbar button that picks one of a set — the agent chooser today.
  // Delegated on the composer root, so a second menu in the toolbar
  // needs only data.
  //
  // `aria-checked` on the items is the whole selection model: the check
  // is revealed off it in CSS, so choosing is one attribute write per
  // item and there's no class or JS-held state that could disagree with
  // what a screen reader is told.
  // How long the detail panel waits before closing once the pointer
  // leaves a row. The source's 200ms, and it's load-bearing: the panel
  // sits to the right with a gap, so without a grace period the pointer
  // closes it on the way to reading it.
  var COMPOSER_DETAIL_DELAY = 200
  var COMPOSER_DETAIL_GAP = 8

  function bindComposerMenus (composerRoot) {
    // Hover would otherwise fight the keyboard: arrowing moves the
    // panel, but the pointer is still sitting over whatever row it was
    // over, and that row's `mouseenter` has already fired. Ignore hover
    // until the mouse actually moves again. Straight from the source.
    var pointerMoved = true
    var hideTimer = null

    // Rows are what the list shows and the arrow keys walk. Agents are
    // what can be selected. They're mostly the same elements, but not
    // always: a row that opens a submenu isn't selectable, and the
    // agents inside that submenu aren't rows.
    function menuRows (scope) {
      return toArray(scope.querySelectorAll('[data-sh-composer-menu-row]'))
    }

    function menuAgents (scope) {
      return toArray(scope.querySelectorAll('[data-sh-composer-menu-item]'))
    }

    function detailFor (row) {
      var menu = closest(row, '[data-sh-composer-menu]')
      var id = row.getAttribute('data-sh-composer-menu-row')
      return menu
        ? menu.querySelector('[data-sh-composer-menu-detail="' + id + '"]')
        : null
    }

    // The row a panel belongs to — the inverse of `detailFor`, for
    // walking back out of a submenu.
    function rowFor (panel) {
      var menu = closest(panel, '[data-sh-composer-menu]')
      var id = panel.getAttribute('data-sh-composer-menu-detail')
      return menu
        ? menu.querySelector('[data-sh-composer-menu-row="' + id + '"]')
        : null
    }

    function cancelHide () {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
    }

    function hideDetails (menu) {
      cancelHide()
      toArray(menu.querySelectorAll('[data-sh-composer-menu-detail]'))
        .forEach(function (panel) { panel.hidden = true })
      menuRows(menu).forEach(function (row) {
        row.removeAttribute('aria-describedby')
        // Submenu rows advertise their panel's state; description rows
        // have no `aria-expanded` to reset.
        if (row.hasAttribute('aria-haspopup')) {
          row.setAttribute('aria-expanded', 'false')
        }
      })
    }

    // Right of the list, top-aligned to the row — the source's geometry.
    // Measured at show time rather than cached, because the row's
    // position depends on where the composer is on screen.
    function showDetail (row) {
      var menu = closest(row, '[data-sh-composer-menu]')
      var list = menu && menu.querySelector('[data-sh-composer-menu-list]')
      var panel = detailFor(row)
      if (!menu || !list || !panel) return

      cancelHide()
      hideDetails(menu)

      var listRect = list.getBoundingClientRect()
      var rowRect = row.getBoundingClientRect()

      panel.style.left = (listRect.right + COMPOSER_DETAIL_GAP) + 'px'
      panel.style.top = rowRect.top + 'px'
      panel.hidden = false

      if (row.hasAttribute('aria-haspopup')) {
        // A submenu is announced as open, not as a description of the
        // row — `aria-describedby` would have a screen reader read the
        // agent names as if they described the row that opens them.
        row.setAttribute('aria-expanded', 'true')
      } else if (panel.id) {
        row.setAttribute('aria-describedby', panel.id)
      }
    }

    function scheduleHide (menu) {
      cancelHide()
      hideTimer = setTimeout(function () { hideDetails(menu) }, COMPOSER_DETAIL_DELAY)
    }

    function closeMenu (menu, returnFocus) {
      var list = menu.querySelector('[data-sh-composer-menu-list]')
      var trigger = menu.querySelector('[data-sh-composer-menu-trigger]')
      if (!list || list.hidden) return

      hideDetails(menu)
      list.hidden = true
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false')
        if (returnFocus) trigger.focus()
      }
    }

    function closeAll (except) {
      toArray(composerRoot.querySelectorAll('[data-sh-composer-menu]'))
        .forEach(function (menu) { if (menu !== except) closeMenu(menu, false) })
    }

    composerRoot.addEventListener('click', function (event) {
      var trigger = closest(event.target, '[data-sh-composer-menu-trigger]')

      if (trigger) {
        var menu = closest(trigger, '[data-sh-composer-menu]')
        var list = menu && menu.querySelector('[data-sh-composer-menu-list]')
        if (!list) return

        event.preventDefault()
        event.stopPropagation()

        if (list.hidden) {
          closeAll(menu)
          list.hidden = false
          trigger.setAttribute('aria-expanded', 'true')

          // Open on the current choice rather than the first row, so
          // Arrow keys move relative to where the selection actually
          // is. When that choice lives in a submenu it isn't a row, so
          // fall back to the row that leads to it — focus has to land
          // in the list either way.
          var checked = menu.querySelector('[aria-checked="true"]')
          var landing = checked && checked.hasAttribute('data-sh-composer-menu-row')
            ? checked
            : checked && closest(checked, '[data-sh-composer-menu-detail]')
              ? rowFor(closest(checked, '[data-sh-composer-menu-detail]'))
              : null

          var first = landing || menuRows(list)[0]
          if (first) first.focus()
        } else {
          closeMenu(menu, true)
        }
        return
      }

      var item = closest(event.target, '[data-sh-composer-menu-item]')
      if (!item) return

      event.preventDefault()
      event.stopPropagation()

      var itemMenu = closest(item, '[data-sh-composer-menu]')
      var itemTrigger = itemMenu.querySelector('[data-sh-composer-menu-trigger]')

      // Scoped to the whole menu, not the list: the agents are split
      // across the list and its submenu panels, but they're still one
      // set — picking a custom agent has to clear the check on Hunter.
      menuAgents(itemMenu).forEach(function (other) {
        other.setAttribute('aria-checked', String(other === item))
      })

      // Carry the choice up to the trigger badge, which names the
      // selected agent.
      if (itemTrigger) {
        var chosen = item.querySelector('.seller-home__composer-menu-label')
        var chosenName = chosen ? chosen.textContent.trim() : ''
        var label = itemTrigger.getAttribute('title') || ''

        // The badge wears a short form of the name, so it comes off the
        // row's own attribute rather than the row's visible text.
        var badgeLabel = itemTrigger.querySelector('[data-sh-composer-badge-label]')
        var badgeText = item.getAttribute('data-sh-composer-badge-text') || chosenName
        if (badgeLabel && badgeText) badgeLabel.textContent = badgeText

        // The badge carries every agent's icon and shows one. Agents
        // come with two kinds of artwork — a portrait or a sprite glyph
        // on a disc — and picking between pre-rendered markup keeps
        // that difference in the template rather than teaching this to
        // build both.
        var chosen = item.getAttribute('data-sh-composer-menu-item')
        toArray(itemTrigger.querySelectorAll('[data-sh-composer-badge-icon]'))
          .forEach(function (slot) {
            slot.hidden = slot.getAttribute('data-sh-composer-badge-icon') !== chosen
          })

        // Which is why the accessible name keeps the full one: the
        // badge alone doesn't say which agent "Hunter" is.
        itemTrigger.setAttribute(
          'aria-label', label + (chosenName ? ': ' + chosenName : '')
        )
      }

      document.dispatchEvent(new CustomEvent('sh:composer-menu-select', {
        detail: {
          menu: itemTrigger ? itemTrigger.getAttribute('data-sh-composer-action') : null,
          value: item.getAttribute('data-sh-composer-menu-item'),
          source: 'composer'
        }
      }))

      closeMenu(itemMenu, true)
    })

    var COMPOSER_MENU_KEYS = [
      'Escape', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'
    ]

    composerRoot.addEventListener('keydown', function (event) {
      if (COMPOSER_MENU_KEYS.indexOf(event.key) === -1) return

      var menu = closest(event.target, '[data-sh-composer-menu]')
      if (!menu) return
      var list = menu.querySelector('[data-sh-composer-menu-list]')
      if (!list || list.hidden) return

      // Focus is either on a row in the list or on an agent inside an
      // open submenu, and every key below means something different
      // depending on which.
      var panel = closest(event.target, '[data-sh-composer-menu-detail]')

      event.preventDefault()

      // Keyboard drives the panel, and takes hover out of the running
      // until the pointer moves — otherwise the row the mouse happens
      // to rest on would pull the panel straight back.
      pointerMoved = false

      if (event.key === 'Escape') {
        // Out of the submenu first, then out of the menu: one Escape
        // shouldn't close everything from two levels down.
        if (panel) {
          var owner = rowFor(panel)
          hideDetails(menu)
          if (owner) owner.focus()
        } else {
          closeMenu(menu, true)
        }
        return
      }

      // Into a submenu, and back out of one.
      if (event.key === 'ArrowRight' && !panel) {
        var row = closest(event.target, '[data-sh-composer-menu-row]')
        if (row && row.hasAttribute('aria-haspopup')) {
          showDetail(row)
          var opened = detailFor(row)
          var firstAgent = opened && menuAgents(opened)[0]
          if (firstAgent) firstAgent.focus()
        }
        return
      }

      if (event.key === 'ArrowLeft') {
        if (panel) {
          var back = rowFor(panel)
          hideDetails(menu)
          if (back) back.focus()
        }
        return
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

      var all = panel ? menuAgents(panel) : menuRows(list)
      if (!all.length) return
      var at = all.indexOf(document.activeElement)
      var next = event.key === 'ArrowDown'
        ? all[(at + 1) % all.length]
        : all[(at - 1 + all.length) % all.length]

      next.focus()
      // Only the list drives the panel. Arrowing within a submenu is
      // moving inside the panel that's already open, and re-showing it
      // would tear down the element focus just landed on.
      if (!panel) showDetail(next)
    })

    // ── Hover ───────────────────────────────────────────────────────
    // `mouseover` rather than `mouseenter` so one delegated listener
    // covers every row; `mouseenter` doesn't bubble.
    composerRoot.addEventListener('mousemove', function () {
      pointerMoved = true
    })

    composerRoot.addEventListener('mouseover', function (event) {
      if (!pointerMoved) return

      // Rows, not agents: hovering an agent inside a submenu must not
      // re-show that submenu, and the row that opens one isn't an agent
      // at all.
      var row = closest(event.target, '[data-sh-composer-menu-row]')
      if (row) {
        showDetail(row)
        return
      }

      // Inside the panel itself: the pointer travelled there to read it
      // or to pick from it, so hold it open.
      if (closest(event.target, '[data-sh-composer-menu-detail]')) cancelHide()
    })

    composerRoot.addEventListener('mouseout', function (event) {
      var from = closest(event.target, '[data-sh-composer-menu-row]') ||
        closest(event.target, '[data-sh-composer-menu-detail]')
      if (!from) return

      // Moving between the row and its panel, or within either, isn't
      // leaving — only a landing spot outside both starts the timer.
      var to = event.relatedTarget
      if (to && (closest(to, '[data-sh-composer-menu-row]') ||
                 closest(to, '[data-sh-composer-menu-detail]'))) return

      var menu = closest(from, '[data-sh-composer-menu]')
      if (menu) scheduleHide(menu)
    })

    document.addEventListener('click', function (event) {
      if (closest(event.target, '[data-sh-composer-menu]')) return
      closeAll(null)
    })

    // The panels are `position: fixed`, so they don't travel with the
    // composer. Rather than reposition on every frame of a scroll, shut
    // the menu — which is what a dropdown should do anyway. Capture
    // phase because the scroll happens on `.seller-home__main`, an
    // ancestor, and scroll events don't bubble.
    document.addEventListener('scroll', function () {
      closeAll(null)
    }, true)
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
    sendBtn.disabled = false
    sendBtn.setAttribute('aria-disabled', 'false')
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
  // Phase 4 — "Your agent at work" feed
  // ──────────────────────────────────────────────────────────────────
  // One flat list of recurring workflows. Everything hangs off the
  // section root, and the row's `data-sh-feed-state` is the single
  // source of truth: the status glyph, the per-state menu actions and
  // the sort position are all selected off it, so a state change is one
  // attribute write plus the two strings CSS can't produce (the
  // subline, and the status button's accessible name).
  //
  //   overflow / row menus → bindFeedMenus(feedRoot)
  //   status button        → bindFeedRowControls(feedRoot)
  //   row activation       → bindFeedRowClicks(feedRoot)
  //
  // Everything is delegated on the section root, so rows added at
  // runtime inherit the behaviour without a re-bind.
  // ══════════════════════════════════════════════════════════════════

  // Two list motions, both GSAP:
  //
  //   dismiss    the row slides left and fades, then collapses its own
  //              height and margin so the rows below close up over it
  //   reshuffle  Flip records where every row is, one is moved in the
  //              DOM, and Flip tweens them all to their new positions —
  //              used whenever a state change re-sorts the list
  //
  // Both are optional. Every animated path has an instant one behind
  // it, so a missing GSAP/Flip or `prefers-reduced-motion` degrades
  // rather than breaks.
  var FEED_MOTION = {
    slide: 0.4,      // dismiss: travel out
    collapse: 0.4,   // dismiss: close the space
    shuffle: 0.5,    // reshuffle: reorder
    offset: -300,    // dismiss: how far left the row travels
    ease: 'power2.inOut'
  }

  function feedCanAnimate () {
    return typeof gsap !== 'undefined' &&
      typeof Flip !== 'undefined' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  // What the status button's accessible name says it will do. Anything
  // not listed pauses.
  var FEED_VERBS = { paused: 'Resume ', failed: 'Retry ', archived: 'Restart ' }

  // Which set of subline strings a state reads. Every slot carries all
  // three as attributes, so this picks a suffix rather than wording —
  // which is what keeps the copy in index.json.
  function feedSublineKey (state, home) {
    if (state === 'paused') return 'paused'
    if (state === 'running' && home !== 'running') return 'running'
    // Complete / Schedule from the kebab move the row into a finished or
    // waiting state; each slot carries the authored copy for those, so
    // the subline and title tense follow the way pause and run already do.
    if (state === 'completed') return 'completed'
    if (state === 'scheduled') return 'scheduled'
    if (state === 'archived') return 'archived'
    return 'default'
  }

  function applyFeedState (row, state) {
    // One-shot Home rows (e.g. Nima's Hunter setup plan) stay in the
    // Active/completed group. Opening the thread still consumes the
    // Recents "New" dot; the row itself never moves to Scheduled.
    if (state === 'scheduled' && row.hasAttribute('data-sh-feed-stay-home')) {
      state = 'completed'
    }
    var home = row.getAttribute('data-sh-feed-state-default') || 'scheduled'
    var toggle = row.querySelector('[data-sh-feed-run-toggle]')
    var title = row.querySelector('[data-sh-feed-item-title]')
    var key = feedSublineKey(state, home)

    row.setAttribute('data-sh-feed-state', state)

    // "Home" is the last state the row was in that wasn't paused or
    // archived — the "set aside" states — so resuming returns it to what
    // it was actually doing rather than to that holding state.
    if (state !== 'paused' && state !== 'archived') row.setAttribute('data-sh-feed-state-default', state)

    // Three slots: the row's title and both halves of its subline. Each
    // carries every string it may need as an attribute, so this picks
    // between them and composes no wording of its own — which is what
    // keeps all the copy in index.json.
    toArray(row.querySelectorAll('[data-sh-feed-slot]')).forEach(function (slot) {
      var value = slot.getAttribute('data-sh-feed-slot-' + key)
      if (value === null) return

      slot.textContent = value
      // Same reason: the strings a resume returns to have to track the
      // row's current presentation, not the one the template rendered.
      if (state !== 'paused' && state !== 'archived') slot.setAttribute('data-sh-feed-slot-default', value)
    })

    // Output pills with an authored scheduled variant: a Stop moves the
    // row into Scheduled, where a colored pill still reading a count
    // would claim progress the waiting run no longer has. Swap the glyph
    // to its grey scheduled art and the text to the generic label on
    // `scheduled`; restore the authored default on any other state. Pills
    // without a variant carry no marker and are left untouched.
    toArray(row.querySelectorAll('[data-sh-feed-output]')).forEach(function (pill) {
      var sched = state === 'scheduled'
      var img = pill.querySelector('.seller-home__feed-item-output-pill-glyph--image')
      var labelEl = pill.querySelector('.seller-home__feed-item-output-pill-label')
      if (img) {
        var nextIcon = pill.getAttribute('data-sh-feed-output-icon-' + (sched ? 'scheduled' : 'default'))
        if (nextIcon) img.setAttribute('src', nextIcon)
      }
      if (labelEl) {
        var nextLabel = pill.getAttribute('data-sh-feed-output-label-' + (sched ? 'scheduled' : 'default'))
        if (nextLabel !== null) labelEl.textContent = nextLabel
      }
    })

    // The title is one of those slots, so it may have just changed
    // tense — and anything derived from it has to follow. The row only
    // carries an `aria-label` when a workflow name had to be appended;
    // without one the accessible name is the visible text and updates
    // on its own.
    if (title && title.hasAttribute('aria-label')) {
      title.setAttribute('aria-label', title.textContent.trim() +
        (title.getAttribute('data-sh-feed-item-name-suffix') || ''))
    }

    if (toggle) {
      // Under the filter the status button drives the lab lifecycle: Run a
      // scheduled row, Stop a running one, Clear a completed one. Off the
      // filter (Seller Home) the live states pause. Resume/Retry come from
      // FEED_VERBS either way.
      var verb = FEED_VERBS[state]
      if (!verb) {
        if (closest(row, '[data-sh-feed-filter]')) {
          verb = state === 'scheduled' ? 'Run '
            : state === 'completed' ? 'Run '
            : state === 'running' ? 'Stop '
            : 'Pause '
        } else {
          verb = 'Pause '
        }
      }
      var label = verb + (title ? title.textContent.trim() : '')
      var tipLabel = verb.trim()
      toggle.setAttribute('aria-label', label)
      toggle.setAttribute('data-tooltip', tipLabel)
      var tip = toggle.parentElement &&
        toggle.parentElement.querySelector('[data-sh-feed-status-tip]')
      if (tip) tip.textContent = tipLabel
    }

    // Reflect the change on the Recents rail: this workflow's nav row
    // flips its indicator (running spinner ↔ completed dot ↔ none). Keyed
    // on the feed item id; a no-op where the workflow has no nav row.
    updateNavSessionStatus(row.getAttribute('data-sh-feed-item'), state)
  }

  // What pressing the status button turns the row into.
  function nextFeedState (row) {
    var state = row.getAttribute('data-sh-feed-state')
    var filtered = !!closest(row, '[data-sh-feed-filter]')
    if (filtered) {
      // Lab lifecycle, all off the one status button:
      //   scheduled → running   (Run now)
      //   completed → running   (Run now — re-run the workflow)
      //   running   → scheduled (Stop — back to its next run)
      //   archived  → scheduled (Restart — back into the schedule)
      //   failed    → running   (Retry)
      if (state === 'scheduled') return 'running'
      if (state === 'completed') return 'running'
      if (state === 'running') return 'scheduled'
      if (state === 'archived') return 'scheduled'
      if (state === 'failed') return 'running'
    }
    // Seller Home (no filter): pause the live ones, resume a paused one,
    // retry a failed one.
    if (state === 'paused') return row.getAttribute('data-sh-feed-state-default') || 'scheduled'
    if (state === 'failed') return 'running'
    return 'paused'
  }

  // Where a row belongs, decided the same way the template decides it:
  // group by `feed.stateOrder`, and within a group keep the order the
  // list was built in. Each `<li>` is stamped with that build index at
  // boot, so a row resumed after being paused returns to its original
  // place among its neighbours rather than to the top of its group.
  function feedSortKey (order, li) {
    var row = li.querySelector('[data-sh-feed-item]')

    // Group headers ("Active", "Paused") are list items too, and they
    // name the group they sit above rather than containing a row. They
    // carry `data-sh-feed-order="-1"` so they land first within it —
    // which is what keeps a row paused at runtime from being inserted
    // above its own header.
    var state = row
      ? row.getAttribute('data-sh-feed-state')
      : li.getAttribute('data-sh-feed-group-state')

    var group = order.indexOf(state)

    return {
      group: group === -1 ? order.length : group,
      built: Number(li.getAttribute('data-sh-feed-order')) || 0
    }
  }

  function placeFeedRow (feedRoot, li) {
    var list = li.parentElement
    if (!list) return

    var order = (feedRoot.getAttribute('data-sh-feed-state-order') || '').split(',')
    var mine = feedSortKey(order, li)
    var before = null

    toArray(list.children).forEach(function (other) {
      if (before || other === li) return
      var theirs = feedSortKey(order, other)
      if (theirs.group > mine.group ||
         (theirs.group === mine.group && theirs.built > mine.built)) {
        before = other
      }
    })

    if (before) list.insertBefore(li, before)
    else list.appendChild(li)
  }

  // Flip needs the before-positions captured while the DOM is still in
  // its old arrangement, so the caller hands us the move to perform
  // rather than doing it first.
  function feedReshuffle (li, move) {
    var list = li.parentElement

    if (!list || !feedCanAnimate()) {
      move()
      return
    }

    // Group labels sit between the rows, and one moves whenever the
    // number of rows above it changes — or when its group opens or
    // empties. Flip only animates the rows, so a label left visible
    // would jump straight to its new place while everything around it
    // glided there. Hide any label that's about to move, let the rows
    // travel, then fade it back in: it arrives once, in the right spot.
    //
    // Measured rather than inferred from the state change, because
    // "does this label move" depends on what's above it, not on what
    // the row became. Run now shuffles a row between two groups that
    // are both above the Paused label, and correctly leaves it alone.
    var headers = toArray(list.querySelectorAll('.seller-home__feed-group'))
    var wasAt = headers.map(function (h) { return h.getBoundingClientRect().top })

    var state = Flip.getState(list.querySelectorAll('[data-sh-feed-list-item]'))
    move()

    // Read after the move, when layout is final but before Flip starts
    // animating. A label that was hidden reads as 0 on one side and a
    // real offset on the other, so opening and emptying a group both
    // count as moving.
    var settling = headers.filter(function (h, i) {
      return h.getBoundingClientRect().top !== wasAt[i]
    })

    settling.forEach(function (h) { h.setAttribute('data-sh-feed-settling', '') })

    Flip.from(state, {
      duration: FEED_MOTION.shuffle,
      ease: FEED_MOTION.ease,
      onComplete: function () {
        settling.forEach(function (h) { h.removeAttribute('data-sh-feed-settling') })
      }
    })
  }

  // Any state change can move the row — pausing sorts it to the bottom,
  // resuming lifts it back, starting a run takes it out of whatever
  // group it was in — so the change and the re-sort happen inside one
  // Flip, and the row travels while everything it displaced slides
  // around it.
  function changeFeedState (feedRoot, row, state) {
    var li = closest(row, '[data-sh-feed-list-item]')

    if (!li) {
      applyFeedState(row, state)
      return
    }

    // Under the filter, if the new state isn't shown in the current view
    // the row is leaving it: fade it out here, then apply the change
    // (now hidden by the view rules) and drop it into place. It stays in
    // the DOM — one list, filtered by CSS — so it's already waiting under
    // whatever view does show it (Run a scheduled row from Scheduled and
    // it's under Active > Running; Stop or Clear a row in Active and it's
    // waiting under Scheduled).
    var filter = currentFeedFilter(feedRoot)
    if (filter && !feedStateVisibleIn(filter, state)) {
      feedFadeOutThen(li, function () {
        applyFeedState(row, state)
        placeFeedRow(feedRoot, li)
        feedResetRowStyles(li)
      })
      return
    }

    // Group labels are handled inside `feedReshuffle` — it can measure
    // which of them the move actually shifts, which is not something
    // this function could work out from the state change alone.
    feedReshuffle(li, function () {
      applyFeedState(row, state)
      placeFeedRow(feedRoot, li)
    })
  }

  // Dismiss. The row slides out on its own, then the `<li>` behind it
  // collapses; the collapse starts before the slide finishes so the
  // list is already closing while the row is still leaving, which reads
  // as one gesture rather than two steps.
  //
  // The row and the `<li>` have different jobs on purpose: transforms
  // on the row can't move its neighbours, and height on the `<li>` is
  // what actually makes the rows below travel up.
  function dismissListItem (li) {
    if (!li) return

    if (!feedCanAnimate()) {
      if (li.parentNode) li.parentNode.removeChild(li)
      return
    }

    var row = li.querySelector('[data-sh-feed-item]') || li

    // The row overflows its shrinking `<li>` for most of the collapse,
    // since it's still ~75% opaque when the height starts closing.
    gsap.set(li, { overflow: 'hidden' })

    gsap.timeline({
      defaults: { ease: FEED_MOTION.ease },
      onComplete: function () {
        if (li.parentNode) li.parentNode.removeChild(li)
      }
    })
      .to(row, {
        x: FEED_MOTION.offset,
        opacity: 0,
        duration: FEED_MOTION.slide
      })
      .to(li, {
        height: 0,
        marginBottom: 0,
        duration: FEED_MOTION.collapse
      }, '<+=0.1')
  }

  // ── Filter view (LAB) ───────────────────────────────────────────────
  // These do something only when the feed carries `data-sh-feed-filter`
  // (the `feed.filter` data flag). Without it, `currentFeedFilter`
  // returns null and the feed behaves exactly as it always has.

  // Which states each view SHOWS. Mirrors `$sh-feed-filter-hidden` in
  // home.scss, kept here as the visible set for a direct membership test.
  var FEED_FILTER_VISIBLE = {
    active: ['completed', 'running', 'paused'],
    scheduled: ['scheduled'],
    archived: ['archived']
  }

  function currentFeedFilter (feedRoot) {
    var list = feedRoot.querySelector('.seller-home__feed-list[data-sh-feed-filter]')
    return list ? list.getAttribute('data-sh-feed-filter') : null
  }

  function feedStateVisibleIn (filter, state) {
    var shown = FEED_FILTER_VISIBLE[filter]
    return !shown || shown.indexOf(state) > -1
  }

  // Fade a row out of the current view WITHOUT removing it — the dismiss
  // animation, but ending in a callback rather than a DOM delete.
  // Reduced motion / no GSAP: skip straight to the callback.
  function feedFadeOutThen (li, done) {
    if (!li) { if (done) done(); return }
    if (!feedCanAnimate()) { if (done) done(); return }

    var row = li.querySelector('[data-sh-feed-item]') || li
    gsap.set(li, { overflow: 'hidden' })
    gsap.timeline({
      defaults: { ease: FEED_MOTION.ease },
      onComplete: function () { if (done) done() }
    })
      .to(row, { x: FEED_MOTION.offset, opacity: 0, duration: FEED_MOTION.slide })
      .to(li, { height: 0, marginBottom: 0, duration: FEED_MOTION.collapse }, '<+=0.1')
  }

  // Clear the fade's inline styles so the row renders normally once the
  // view that shows it is opened. Safe while it's display:none in the
  // current view — nothing paints until then.
  function feedResetRowStyles (li) {
    if (!li) return
    var row = li.querySelector('[data-sh-feed-item]') || li
    if (typeof gsap !== 'undefined') {
      gsap.set(li, { clearProps: 'height,marginBottom,overflow' })
      gsap.set(row, { clearProps: 'x,opacity,transform' })
    } else {
      li.style.height = ''
      li.style.marginBottom = ''
      li.style.overflow = ''
      row.style.opacity = ''
      row.style.transform = ''
    }
  }

  // ── Menus ─────────────────────────────────────────────────────────
  // One delegated implementation for the section overflow and every row
  // kebab; they differ only in which attributes they're found by.
  var FEED_MENUS = [
    {
      scope: '[data-sh-feed-item-menu]',
      trigger: '[data-sh-feed-item-menu-trigger]',
      list: '[data-sh-feed-item-menu-list]',
      action: 'data-sh-feed-item-menu-action',
      event: 'sh:feed-item-action'
    },
    {
      scope: '[data-sh-feed-overflow]',
      trigger: '[data-sh-feed-overflow-trigger]',
      list: '[data-sh-feed-overflow-menu]',
      action: 'data-sh-feed-overflow-action',
      event: 'sh:feed-overflow-action'
    }
  ]

  // Only the items actually on screen. Some are scoped to a row state
  // and hidden with `display: none` (see the `data-sh-feed-action-only`
  // / `-not` rules), and a hidden item can't take focus — left in the
  // list, Arrow navigation would stall on it instead of stepping past.
  function feedMenuItems (list) {
    return toArray(list.querySelectorAll('[role="menuitem"]'))
      .filter(function (el) { return el.offsetParent !== null })
  }

  function closeFeedMenu (list, returnFocus) {
    if (!list || list.hidden) return
    var scope = list.parentElement
    var trigger = scope ? scope.querySelector('[aria-expanded]') : null

    list.hidden = true
    list.classList.remove('is-open')
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false')
      if (returnFocus) trigger.focus()
    }
  }

  function closeAllFeedMenus (feedRoot, except) {
    FEED_MENUS.forEach(function (kind) {
      toArray(feedRoot.querySelectorAll(kind.list)).forEach(function (list) {
        if (list !== except) closeFeedMenu(list, false)
      })
    })
  }

  function bindFeedMenus (feedRoot) {
    function kindFor (node) {
      for (var i = 0; i < FEED_MENUS.length; i++) {
        if (closest(node, FEED_MENUS[i].scope)) return FEED_MENUS[i]
      }
      return null
    }

    feedRoot.addEventListener('click', function (event) {
      var trigger = closest(event.target, '[data-sh-feed-item-menu-trigger]') ||
        closest(event.target, '[data-sh-feed-overflow-trigger]')

      if (trigger) {
        var kind = kindFor(trigger)
        if (!kind) return
        var scope = closest(trigger, kind.scope)
        var list = scope.querySelector(kind.list)
        if (!list) return

        event.preventDefault()
        event.stopPropagation()

        if (list.hidden) {
          closeAllFeedMenus(feedRoot, list)
          list.hidden = false
          list.classList.add('is-open')
          trigger.setAttribute('aria-expanded', 'true')
          var first = feedMenuItems(list)[0]
          if (first) first.focus()
        } else {
          closeFeedMenu(list, true)
        }
        return
      }

      // An action inside an open menu.
      for (var i = 0; i < FEED_MENUS.length; i++) {
        var spec = FEED_MENUS[i]
        var item = closest(event.target, '[' + spec.action + ']')
        if (!item) continue

        event.preventDefault()
        event.stopPropagation()

        var actionId = item.getAttribute(spec.action)
        var row = closest(item, '[data-sh-feed-item]')
        var rowId = row ? row.getAttribute('data-sh-feed-item') : null

        closeFeedMenu(closest(item, spec.list), false)

        document.dispatchEvent(new CustomEvent(spec.event, {
          detail: { action: actionId, rowId: rowId, source: 'feed' }
        }))

        // Every state-changing action is a transition the row can already
        // reach — Run now / Pause echo the status button, Complete and
        // Schedule move it into a finished or waiting state — so they all
        // go through `changeFeedState` rather than inventing a second path.
        if (actionId === 'dismiss') dismissListItem(closest(item, '[data-sh-feed-list-item]'))
        else if (actionId === 'run_now' && row) changeFeedState(feedRoot, row, 'running')
        else if (actionId === 'stop' && row) changeFeedState(feedRoot, row, 'scheduled')
        else if (actionId === 'archive' && row) changeFeedState(feedRoot, row, 'archived')
        else if (actionId === 'restart' && row) changeFeedState(feedRoot, row, 'scheduled')
        else if (actionId === 'pause' && row) changeFeedState(feedRoot, row, 'paused')
        else if (actionId === 'complete' && row) changeFeedState(feedRoot, row, 'completed')
        else if (actionId === 'schedule' && row) changeFeedState(feedRoot, row, 'scheduled')
        else if (actionId === 'edit') {
          var menuScope = closest(item, '[data-sh-feed-item-menu]')
          var returnTo = menuScope && menuScope.querySelector('[data-sh-feed-item-menu-trigger]')
          openFeedEditModal(returnTo || item, row)
        }
        return
      }
    })

    feedRoot.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

      var kind = kindFor(event.target)
      if (!kind) return
      var scope = closest(event.target, kind.scope)
      var list = scope.querySelector(kind.list)
      if (!list || list.hidden) return

      if (event.key === 'Escape') {
        event.preventDefault()
        closeFeedMenu(list, true)
        return
      }

      var all = feedMenuItems(list)
      if (!all.length) return
      var at = all.indexOf(document.activeElement)

      event.preventDefault()
      if (event.key === 'ArrowDown') all[(at + 1) % all.length].focus()
      else all[(at - 1 + all.length) % all.length].focus()
    })

    // Outside-click dismiss. Scoped to the menus rather than to the
    // section, so clicking another row — still inside the feed — closes
    // an open kebab instead of leaving it hanging over the list.
    // Trigger and action clicks stop propagating before they reach here.
    document.addEventListener('click', function (event) {
      var inside = closest(event.target, '[data-sh-feed-item-menu]') ||
        closest(event.target, '[data-sh-feed-overflow]')
      if (inside) return
      closeAllFeedMenus(feedRoot, null)
    })
  }

  // The glyph slot shows the row's state at rest and the NEXT action on
  // hover, and a click leaves the pointer sitting right where it was —
  // so the hover rules would take over immediately and the state just
  // created would never be seen. Press pause on a completed row and you
  // land straight on a play glyph, having never watched it become
  // paused, which is worst when the row doesn't move because it was
  // already last in the list.
  //
  // Latching the button out of preview until the pointer or focus
  // leaves gives that state a beat to be read, and puts the next preview
  // behind a deliberate act. A timer was the alternative and is worse:
  // the glyph would change on its own while the pointer sat still.
  //
  // Bound per interaction rather than delegated, because `pointerleave`
  // doesn't bubble. Both listeners remove themselves, so nothing
  // accumulates across clicks.
  //
  // `attr` names the latch, since the Scheduled list runs the same
  // control off its own attribute (`data-sh-workflow-hover-latched`).
  function latchStatusHover (toggle, attr) {
    var name = attr || 'data-sh-feed-hover-latched'
    toggle.setAttribute(name, '')

    function release () {
      toggle.removeAttribute(name)
      toggle.removeEventListener('pointerleave', release)
      toggle.removeEventListener('blur', release)
    }

    toggle.addEventListener('pointerleave', release)
    toggle.addEventListener('blur', release)
  }

  // ── Status button ─────────────────────────────────────────────────
  // What it does depends on the row's state: a paused row resumes, a
  // failed one retries, anything else pauses.
  function bindFeedRowControls (feedRoot) {
    feedRoot.addEventListener('click', function (event) {
      var toggle = closest(event.target, '[data-sh-feed-run-toggle]')
      if (!toggle) return

      var row = closest(toggle, '[data-sh-feed-item]')
      if (!row) return

      event.preventDefault()
      event.stopPropagation()

      var was = row.getAttribute('data-sh-feed-state')
      var now = nextFeedState(row)

      changeFeedState(feedRoot, row, now)
      latchStatusHover(toggle)

      document.dispatchEvent(new CustomEvent('sh:feed-run-toggle', {
        detail: {
          rowId: row.getAttribute('data-sh-feed-item'),
          from: was,
          to: now,
          paused: now === 'paused',
          source: 'feed'
        }
      }))
    })
  }

  // ── Whole-row click ───────────────────────────────────────────────
  // Every row's title is a `<button>` stretched over the card by CSS,
  // so hover never shows a URL preview. Destinations live on
  // `data-sh-nav-href`; this handler follows them. Cmd/Ctrl/Shift-click
  // and middle-click open a new tab, matching what an `<a>` would do.
  function bindFeedRowClicks (feedRoot) {
    function feedHrefFrom (row) {
      var link = row && row.querySelector('[data-sh-feed-item-link]')
      return link
        ? (link.getAttribute('data-sh-nav-href') || link.getAttribute('href'))
        : null
    }

    function followFeedHref (href, newTab) {
      if (!href) return
      if (newTab) {
        window.open(href, '_blank')
        return
      }
      window.location.assign(href)
    }

    feedRoot.addEventListener('click', function (event) {
      if (closest(event.target, '[data-sh-feed-item-stop]')) return

      var row = closest(event.target, '[data-sh-feed-item]')
      if (!row) return

      var href = feedHrefFrom(row)

      document.dispatchEvent(new CustomEvent('sh:feed-item-select', {
        detail: {
          rowId: row.getAttribute('data-sh-feed-item'),
          href: href,
          source: 'feed'
        }
      }))

      if (!href) return
      followFeedHref(href, event.metaKey || event.ctrlKey || event.shiftKey)
    })

    feedRoot.addEventListener('auxclick', function (event) {
      if (event.button !== 1) return
      if (closest(event.target, '[data-sh-feed-item-stop]')) return
      var row = closest(event.target, '[data-sh-feed-item]')
      if (!row) return
      var href = feedHrefFrom(row)
      if (!href) return
      event.preventDefault()
      followFeedHref(href, true)
    })
  }

  // The order the list was built in, recorded before anything can move
  // a row. It's the tiebreaker that lets a resumed row slot back in
  // among its original neighbours instead of landing at the top of its
  // group.
  function stampFeedOrder (feedRoot) {
    toArray(feedRoot.querySelectorAll('[data-sh-feed-list-item]'))
      .forEach(function (li, index) {
        li.setAttribute('data-sh-feed-order', index)
      })
  }

  // ── Filter control (LAB) ────────────────────────────────────────────
  // The section kebab becomes a Filter when the data defines `feed.filter`
  // (see _home_feed.html). This wires it: open/close the listbox, and on
  // choosing a view write `data-sh-feed-filter` onto the list so the view
  // rules in home.scss switch. No-ops when the filter control isn't on the
  // page, so Seller Home is unaffected.
  function bindFeedFilter (feedRoot) {
    var root = feedRoot.querySelector('[data-sh-feed-filter-root]')
    if (!root) return

    var trigger = root.querySelector('[data-sh-feed-filter-trigger]')
    var menu = root.querySelector('[data-sh-feed-filter-menu]')
    var list = feedRoot.querySelector('.seller-home__feed-list')
    if (!trigger || !menu || !list) return

    function options () {
      return toArray(menu.querySelectorAll('[data-sh-feed-filter-option]'))
    }

    function openMenu () {
      menu.hidden = false
      menu.classList.add('is-open')
      trigger.setAttribute('aria-expanded', 'true')
      var sel = menu.querySelector('[data-sh-feed-filter-option][aria-selected="true"]') ||
        options()[0]
      if (sel) sel.focus()
    }

    function closeMenu (focusTrigger) {
      menu.hidden = true
      menu.classList.remove('is-open')
      trigger.setAttribute('aria-expanded', 'false')
      if (focusTrigger) trigger.focus()
    }

    function select (id) {
      if (!id) return
      list.setAttribute('data-sh-feed-filter', id)
      var chosen = null
      options().forEach(function (opt) {
        var match = opt.getAttribute('data-sh-feed-filter-option') === id
        opt.setAttribute('aria-selected', match ? 'true' : 'false')
        if (match) chosen = opt
      })
      // Reflect the chosen view in the trigger's label + accessible name.
      var labelSrc = chosen && chosen.querySelector('.seller-home__feed-filter-item-label')
      var text = (labelSrc || chosen || {}).textContent
      text = text ? text.trim() : id
      var labelEl = trigger.querySelector('[data-sh-feed-filter-label]')
      if (labelEl) labelEl.textContent = text
      trigger.setAttribute('aria-label', 'Filter: ' + text)
      trigger.setAttribute('title', 'Filter: ' + text)
      var headingEl = feedRoot.querySelector('[data-sh-feed-heading]')
      var heading = chosen && chosen.getAttribute('data-sh-feed-filter-heading')
      if (headingEl && heading) headingEl.textContent = heading
    }

    trigger.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      if (menu.hidden) openMenu()
      else closeMenu(true)
    })

    menu.addEventListener('click', function (event) {
      var opt = closest(event.target, '[data-sh-feed-filter-option]')
      if (!opt) return
      event.preventDefault()
      event.stopPropagation()
      select(opt.getAttribute('data-sh-feed-filter-option'))
      closeMenu(true)
    })

    root.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (!menu.hidden) { event.preventDefault(); closeMenu(true) }
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (menu.hidden) return
      var all = options()
      if (!all.length) return
      var at = all.indexOf(document.activeElement)
      event.preventDefault()
      if (event.key === 'ArrowDown') all[(at + 1) % all.length].focus()
      else all[(at - 1 + all.length) % all.length].focus()
    })

    // Outside click closes it — scoped to the filter root so a click
    // anywhere else (including on the list) dismisses the menu.
    document.addEventListener('click', function (event) {
      if (closest(event.target, '[data-sh-feed-filter-root]')) return
      if (!menu.hidden) closeMenu(false)
    })
  }

  // Drop already-opened completed workflows out of Completed on load. A
  // completed row whose thread the seller has opened (recorded in
  // `sh:feedConsumed`) has had its results consumed, so it belongs back on
  // its schedule rather than in the Ready/Completed group. Runs before the
  // menus/controls bind and uses `placeFeedRow` (a plain reorder, no Flip)
  // so the row lands in the Scheduled group without a load-time animation.
  // Maps feed rows to conversations through the inlined workflow sessions,
  // so it no-ops on a feed with no nav (e.g. the lab surface).
  function reconcileConsumedFeedRows (feedRoot) {
    var consumed = readConsumedConversations()
    var sessions = readWorkflowSessions()
    if (!sessions.length) return

    var convByFeed = {}
    for (var j = 0; j < sessions.length; j++) {
      if (sessions[j] && sessions[j].feedId) {
        convByFeed[sessions[j].feedId] = sessions[j].conversationId || ''
      }
    }

    toArray(feedRoot.querySelectorAll('[data-sh-feed-item]')).forEach(function (row) {
      if (row.getAttribute('data-sh-feed-state') !== 'completed') return
      if (row.hasAttribute('data-sh-feed-stay-home')) return
      var convId = convByFeed[row.getAttribute('data-sh-feed-item')]
      if (!convId || !consumed[convId]) return
      applyFeedState(row, 'scheduled')
      var li = closest(row, '[data-sh-feed-list-item]')
      if (li) placeFeedRow(feedRoot, li)
    })
  }

  function revealGatedFeedItems (feedRoot) {
    var ready = false
    try { ready = window.sessionStorage.getItem(sk(MARCUS_REPLY_KEY)) === '1' } catch (e) {}
    if (!ready) return
    toArray(feedRoot.querySelectorAll('[data-sh-feed-demo-gate="marcus-reply"]')).forEach(function (el) {
      el.removeAttribute('hidden')
    })
  }

  function bindFeed (feedRoot) {
    if (typeof gsap !== 'undefined' && typeof Flip !== 'undefined') {
      gsap.registerPlugin(Flip)
    }

    stampFeedOrder(feedRoot)
    revealGatedFeedItems(feedRoot)
    reconcileConsumedFeedRows(feedRoot)
    bindFeedMenus(feedRoot)
    bindFeedFilter(feedRoot)
    bindFeedRowControls(feedRoot)
    bindFeedRowClicks(feedRoot)

    // Narrow director hook. Labs (and later Home) drive Running → Ready
    // and swipe-out through the same Flip / dismiss timelines the kebab
    // already uses — they must not click hidden menu items or copy GSAP.
    // `applyState` / `place` are the same helpers without Flip: a lab
    // that recycles a dismissed row into Running can retitle it and
    // drop it in the right group, then own the enter tween itself.
    window.SH = window.SH || {}
    window.SH.feed = {
      changeState: function (row, state) { changeFeedState(feedRoot, row, state) },
      dismiss: function (li) { dismissListItem(li) },
      applyState: function (row, state) { applyFeedState(row, state) },
      place: function (li) { placeFeedRow(feedRoot, li) }
    }
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

  // Per-row overflow menu controller — parallels `bindFeedMenus` for
  // the "Your agent at work" feed. Kept as its own
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
  // ── Scheduled status button ───────────────────────────────────────
  // Restores the feed-style status control on the Scheduled list (its
  // CSS + JS were dropped when issa/skills-scheduled-pages merged into
  // main). Mirrors the feed's control with three deliberate differences:
  // the row keeps its place (no re-sort), it isn't re-filtered under the
  // pointer, and state lives on `data-sh-workflow-status` — the same
  // attribute the tab filter reads.

  // The status registry from scheduled.json, handed to us as JSON on the
  // list root. Labels and action verbs only — which glyph a state paints
  // is the stylesheet's business.
  function readWorkflowStatusTypes (listRoot) {
    var raw = listRoot.getAttribute('data-sh-workflow-status-types')
    if (!raw) return {}
    try {
      return JSON.parse(raw) || {}
    } catch (err) {
      // A malformed registry costs the accessible names, not the toggle
      // — better a button that still works than a dead list.
      return {}
    }
  }

  // What pressing the status button turns the row into. Same rule the
  // feed uses, including "resume returns to the last state that wasn't
  // paused" so retrying an errored row and then pausing it doesn't
  // resume back into the error.
  function nextWorkflowStatus (item) {
    var status = item.getAttribute('data-sh-workflow-status')
    // Same lifecycle as the home feed: Run now a scheduled/completed row,
    // Stop a running one, Restart an archived one; a paused row resumes to
    // its last real state; a failed one retries.
    if (status === 'scheduled' || status === 'completed') return 'running'
    if (status === 'running' || status === 'archived') return 'scheduled'
    if (status === 'failed') return 'running'
    if (status === 'paused') return item.getAttribute('data-sh-workflow-status-default') || 'scheduled'
    return 'scheduled'
  }

  // A schedule with an unresolved blocking issue — its last run failed,
  // e.g. a delivery connection expired — can't be run on demand until
  // the issue is cleared. "Run now" is still offered (so the path is
  // discoverable) but disabled in both the row overflow menu and the
  // panel header menu while the block remains.
  function scheduleRunBlocked (status) {
    return status === 'failed'
  }

  function applyWorkflowStatus (item, status, types) {
    var meta = types[status] || {}
    var titleNode = item.querySelector('.seller-home__scheduled-workflow-title')
    var name = titleNode ? (titleNode.textContent || '').trim() : ''

    item.setAttribute('data-sh-workflow-status', status)
    if (status !== 'paused' && status !== 'archived') {
      item.setAttribute('data-sh-workflow-status-default', status)
    }

    // Accessible names are all CSS can't do here. Each element carries
    // the prefix the template composed it with, so this picks strings
    // out of the registry and never words anything itself — which is
    // what keeps the copy in scheduled.json.
    var toggle = item.querySelector('[data-sh-workflow-run-toggle]')
    if (toggle && meta.action) {
      var action = meta.action + ' ' + name
      toggle.setAttribute('aria-label', action)
      toggle.setAttribute('title', action)
    }

    if (!meta.label) return

    // Linked rows carry the status inside the row's own `aria-label`;
    // unlinked ones have no label to carry it, so it's a visually-hidden
    // span instead. A row has one or the other.
    var labelled = item.querySelector('[data-sh-workflow-status-label]')
    if (labelled) {
      labelled.setAttribute('aria-label',
        (labelled.getAttribute('data-sh-workflow-status-prefix') || '') + meta.label)
    }

    var text = item.querySelector('[data-sh-workflow-status-text]')
    if (text) {
      text.textContent =
        (text.getAttribute('data-sh-workflow-status-prefix') || '') + meta.label
    }
  }

  function scheduledStatusController (listRoot, onChange) {
    var types = readWorkflowStatusTypes(listRoot)

    listRoot.addEventListener('click', function (event) {
      var toggle = closest(event.target, '[data-sh-workflow-run-toggle]')
      if (!toggle) return

      var item = closest(toggle, '[data-sh-workflow-item]')
      if (!item) return

      // The button is painted over the row's full-row click surface, so
      // pressing it must not also open the row.
      event.preventDefault()
      event.stopPropagation()

      var from = item.getAttribute('data-sh-workflow-status') || ''
      var to = nextWorkflowStatus(item)

      applyWorkflowStatus(item, to, types)
      latchStatusHover(toggle, 'data-sh-workflow-hover-latched')
      if (onChange) onChange(item, from, to)

      document.dispatchEvent(new CustomEvent('sh:workflow-run-toggle', {
        detail: {
          workflowId: item.getAttribute('data-sh-workflow-id'),
          from: from,
          to: to,
          paused: to === 'paused',
          source: 'scheduled'
        }
      }))
    })
  }

  // Conversation-feed composer placed in the Scheduled body. The
  // conversation page owns the full thread/voice controller
  // (`bindConvComposer`); this one only keeps the box honest: placeholder
  // class, plain-text paste, Enter to send, and a no-op empty submit so
  // the form never reloads the page.
  function bindScheduledComposer (root) {
    var form = root.querySelector('[data-sh-scheduled-composer]')
    var input = form && form.querySelector('[data-sh-conv-composer-input]')
    var send = form && form.querySelector('[data-sh-conv-composer-send]')
    if (!form || !input || !send) return

    function composerText () {
      var out = ''
      for (var i = 0; i < input.childNodes.length; i++) {
        var node = input.childNodes[i]
        if (node.nodeType === 3) out += node.nodeValue
        else if (node.nodeType === 1 && node.tagName === 'BR') out += '\n'
        else if (node.nodeType === 1) out += node.textContent || ''
      }
      return out.replace(/\u00a0/g, ' ').replace(/\r/g, '')
    }

    function syncEmpty () {
      if (composerText().trim()) input.classList.remove('is-empty')
      else input.classList.add('is-empty')
    }

    function insertPlainText (text) {
      var sel = window.getSelection ? window.getSelection() : null
      if (!sel || !sel.rangeCount || !input.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        input.appendChild(document.createTextNode(text))
        return
      }
      var range = sel.getRangeAt(0)
      range.deleteContents()
      var node = document.createTextNode(text)
      range.insertNode(node)
      range.setStartAfter(node)
      range.setEndAfter(node)
      sel.removeAllRanges()
      sel.addRange(range)
    }

    syncEmpty()

    input.addEventListener('input', syncEmpty)

    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return
      if (event.isComposing || event.keyCode === 229) return
      if (event.shiftKey) {
        event.preventDefault()
        insertPlainText('\n')
        syncEmpty()
        return
      }
      event.preventDefault()
      if (typeof form.requestSubmit === 'function') form.requestSubmit()
    })

    input.addEventListener('paste', function (event) {
      if (!event.clipboardData) return
      event.preventDefault()
      insertPlainText(event.clipboardData.getData('text/plain') || '')
      syncEmpty()
    })

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var text = composerText().trim()
      if (!text) return
      document.dispatchEvent(new CustomEvent('sh:composer-submit', {
        detail: { text: text, source: 'scheduled' }
      }))
      while (input.firstChild) input.removeChild(input.firstChild)
      syncEmpty()
    })
  }

  function bindScheduled (root) {
    var tabsRoot = root.querySelector('[data-sh-scheduled-tabs]')
    var listRegion = root.querySelector('[data-sh-scheduled-list-region]')
    var listRoot = root.querySelector('[data-sh-scheduled-workflow-list]')
    var emptyPanel = root.querySelector('[data-sh-scheduled-empty]')
    var statusRegion = root.querySelector('[data-sh-scheduled-status]')

    // Toolbar overflow (⋮) menu + the Archived view it opens, and the
    // schedule-details side panel. All no-op when their markup is
    // absent, so this stays safe on a half-hydrated shell.
    var overflowTrigger = root.querySelector('[data-sh-scheduled-overflow-trigger]')
    var overflowMenu = root.querySelector('[data-sh-scheduled-overflow-menu]')
    var archivedBar = root.querySelector('[data-sh-scheduled-archived-bar]')
    var archivedBack = root.querySelector('[data-sh-scheduled-archived-back]')

    // Detail panel — bound up front, independent of the tab wiring.
    // Hooks are filled in once the tab filter / status registry exist
    // (below); the panel reads them lazily so a status change made from
    // its overflow menu can recategorise the card + refresh counts
    // without the panel closing itself.
    var scheduleHooks = { reflow: null, statusTypes: null }
    var detailPanel = scheduledDetailPanelController(root, scheduleHooks)

    // Set once the tab wiring below is known good. The status button is
    // bound before that point, so it reaches the recount through this
    // rather than by being bound after it — a page with malformed tab
    // markup still gets a working toggle, it just has no counts to fix.
    var afterStatusChange = null

    // Overflow menu + status button are independent of the tab
    // controller — bind them up front so per-row controls work even if
    // the tab wiring below early-returns due to malformed markup.
    if (listRoot) {
      scheduledWorkflowOverflowController(listRoot, function () {
        if (afterStatusChange) afterStatusChange()
      })
      scheduledStatusController(listRoot, function () {
        if (afterStatusChange) afterStatusChange()
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

    // Overflow views (Archived) filter the same list but live in the ⋮
    // menu, not the tab row. Register their status sets alongside the
    // tabs so `activateTab` can drive them, and remember their ids so it
    // knows to show the archived bar / mark the ⋮ trigger active.
    var overflowViewIds = []
    if (overflowMenu) {
      toArray(overflowMenu.querySelectorAll('[data-sh-scheduled-view]')).forEach(function (item) {
        var vid = item.getAttribute('data-sh-scheduled-view')
        if (!vid) return
        var vraw = item.getAttribute('data-sh-scheduled-view-statuses') || ''
        tabStatusesById[vid] = vraw.split(',').map(function (s) { return s.trim() }).filter(function (s) { return s })
        overflowViewIds.push(vid)
      })
    }
    function isOverflowView (id) { return overflowViewIds.indexOf(id) >= 0 }

    // The last real tab, so "Back" from the Archived view returns there.
    var lastMainTabId = null

    // Cache the row NodeList once. A hypothetical future incremental
    // list-render can call `refreshRows()` (exposed via the returned
    // object) but the prototype's list is static so we don't ship a
    // MutationObserver.
    var rows = toArray(listRoot.querySelectorAll('[data-sh-workflow-item]'))

    // Tab counts are painted server-side from scheduled.json and nothing
    // else updates them, so a row that changes state at runtime has to
    // bring them with it — pausing the last scheduled workflow would
    // otherwise leave "Scheduled 3" over a tab that now holds 2. Same
    // recount `scheduled_drafts.js` runs after splicing a schedule in.
    function refreshTabCounts () {
      tabs.forEach(function (tab) {
        var statuses = tabStatusesById[tab.getAttribute('data-sh-scheduled-tab')] || []
        var count = 0

        rows.forEach(function (row) {
          var status = row.getAttribute('data-sh-workflow-status') || ''
          // Counts are per-tab totals, so they ignore which rows the
          // ACTIVE tab is currently hiding.
          if (statuses.length === 0 || statuses.indexOf(status) >= 0) count++
        })

        var pill = tab.querySelector('[data-sh-scheduled-tab-count]')
        if (pill) pill.textContent = String(count)
        // The pill is decorative (`aria-hidden`); this is the copy AT
        // actually reads, so it has to move with it.
        var sr = tab.querySelector('.slds-assistive-text')
        if (sr) sr.textContent = count + ' workflow' + (count === 1 ? '' : 's')
      })
    }

    afterStatusChange = function () {
      refreshTabCounts()
      // Re-run the active tab's filter so a row whose new state no longer
      // matches (e.g. Archive while on Active) drops out of view — the way
      // the feed moves a row between views.
      activateTab(activeTabId, {})
    }

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

    // Now that the filter set + status registry exist, wire the detail
    // panel's hooks. `reflow` re-applies the CURRENT tab filter and
    // recounts after a panel-driven status change — same logic as
    // `activateTab`'s row pass, minus the tab-visual / focus / close
    // side-effects, so the open panel survives a Pause / Resume.
    scheduleHooks.statusTypes = readWorkflowStatusTypes(listRoot)
    scheduleHooks.reflow = function () {
      var statuses = tabStatusesById[activeTabId] || []
      var visibleCount = 0
      rows.forEach(function (row) {
        var status = row.getAttribute('data-sh-workflow-status') || ''
        var visible = statuses.length === 0 || statuses.indexOf(status) >= 0
        row.hidden = !visible
        if (visible) visibleCount++
      })
      if (emptyPanel) emptyPanel.hidden = visibleCount > 0
      if (listRoot) listRoot.hidden = visibleCount === 0
      refreshTabCounts()
    }

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

    // ── Toolbar overflow (⋮) menu → Archived view ──────────────────
    // A tiny menu controller (open / select / Escape / outside-click)
    // whose one item today activates the Archived view through the same
    // `activateTab` choke-point the tabs use.
    if (overflowTrigger && overflowMenu) {
      var closeOverflow = function (returnFocus) {
        overflowMenu.hidden = true
        overflowTrigger.setAttribute('aria-expanded', 'false')
        if (returnFocus) overflowTrigger.focus()
      }

      overflowTrigger.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        var willOpen = overflowMenu.hidden
        overflowMenu.hidden = !willOpen
        overflowTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false')
        if (willOpen) {
          var first = overflowMenu.querySelector('[data-sh-scheduled-view]')
          if (first) first.focus()
        }
      })

      overflowMenu.addEventListener('click', function (event) {
        var item = closest(event.target, '[data-sh-scheduled-view]')
        if (!item) return
        event.preventDefault()
        event.stopPropagation()
        var viewId = item.getAttribute('data-sh-scheduled-view')
        closeOverflow(false)
        activateTab(viewId, { announce: true, writeHash: true, focusTab: false })
        // Land focus on the archived bar's Back control so keyboard
        // users have an obvious way out of the view.
        if (archivedBack) archivedBack.focus()
      })

      overflowMenu.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeOverflow(true)
        }
      })

      document.addEventListener('click', function (event) {
        if (overflowMenu.hidden) return
        if (closest(event.target, '[data-sh-scheduled-overflow]')) return
        closeOverflow(false)
      })
    }

    // "Back" from the Archived view returns to the last main tab.
    if (archivedBack) {
      archivedBack.addEventListener('click', function (event) {
        event.preventDefault()
        activateTab(lastMainTabId || activeTabId,
          { announce: true, writeHash: true, focusTab: true })
      })
    }

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

      // Archived (and any future ⋮ view) toggles the archived bar and
      // the ⋮ trigger's selected look; a real tab clears both and is
      // remembered so "Back" from Archived can return here.
      var overflowView = isOverflowView(tabId)
      if (!overflowView) lastMainTabId = tabId
      if (archivedBar) archivedBar.hidden = !overflowView
      if (overflowTrigger) overflowTrigger.classList.toggle('is-active', overflowView)

      // Switching tab/view can hide the selected card, so close the
      // details panel to keep the selection and the panel in sync.
      if (detailPanel) detailPanel.close()

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

  // ── Schedule-details side panel (/scheduled.html) ──────────────
  // One shell (`_schedule_side_panel.html`), populated on card
  // activation from two config scripts scheduled.html emits:
  //   • #sh-scheduled-details      id → full schedule record
  //       { id, title, status, cadence, frequency, time, timezone,
  //         nextRun, delivery, skillId, skillName, instructions,
  //         createdAt, createdBy, lastRunId, lastRunStatus, lastRunAt,
  //         chatId }
  //   • #sh-scheduled-panel-config { menuActions:[{id,label,icon}],
  //                                skillRoute, chatRoute }
  // The panel mirrors the Figma frame (Frequency / Delivery / Uses Skill
  // / Instructions / Created / Last run) with the actions in a header
  // overflow (⋮) menu. Instructions is editable in place. Pause / Resume
  // / Run now / Archive repaint the card + reflow the active tab via the
  // hooks bindScheduled passes in.
  // The card body is a `<button data-sh-schedule-open="<id>">`; clicking
  // it opens the panel (or closes it on a second click of the same
  // card). The card keeps `aria-expanded="true"` + an is-selected
  // outline while open; Escape / × close and return focus to the card.
  // Returns null when the panel markup is absent so callers can guard.
  function scheduledDetailPanelController (root, hooks) {
    var panel = root.querySelector('[data-sh-schedule-panel]')
    if (!panel) return null
    hooks = hooks || {}

    var titleEl = panel.querySelector('[data-sh-schedule-panel-title]')
    var announceEl = panel.querySelector('[data-sh-schedule-panel-announce]')
    var closeBtn = panel.querySelector('[data-sh-schedule-panel-close]')
    var listRoot = root.querySelector('[data-sh-scheduled-workflow-list]')

    // Header overflow (⋮) menu.
    var menuWrap = panel.querySelector('[data-sh-schedule-menu]')
    var menuTrigger = panel.querySelector('[data-sh-schedule-menu-trigger]')
    var menuList = panel.querySelector('[data-sh-schedule-menu-list]')

    // Body value slots (filled per schedule).
    var freqEl = panel.querySelector('[data-sh-sched-frequency]')
    var freqList = panel.querySelector('[data-sh-sched-frequency-list]')
    var timeEl = panel.querySelector('[data-sh-sched-time]')
    var timeList = panel.querySelector('[data-sh-sched-time-list]')
    var deliveryEl = panel.querySelector('[data-sh-sched-delivery]')
    var skillLinkEl = panel.querySelector('[data-sh-sched-skill-link]')
    var skillNameEl = panel.querySelector('[data-sh-sched-skill-name]')
    var instrDisplayEl = panel.querySelector('[data-sh-sched-instr-display]')
    var instrEditEl = panel.querySelector('[data-sh-sched-instr-edit]')
    var createdEl = panel.querySelector('[data-sh-sched-created]')
    var lastRunEl = panel.querySelector('[data-sh-sched-lastrun]')

    // Error alert (Needs-Attention only).
    var alertEl = panel.querySelector('[data-sh-schedule-alert]')
    var alertTitleEl = panel.querySelector('[data-sh-schedule-alert-title]')
    var alertDescEl = panel.querySelector('[data-sh-schedule-alert-desc]')
    var alertLinkEl = panel.querySelector('[data-sh-schedule-alert-reconnect]')
    var alertLinkLabelEl = panel.querySelector('[data-sh-schedule-alert-link-label]')

    var detailsById = {}
    var config = {}

    var detailsScript = document.getElementById('sh-scheduled-details')
    if (detailsScript) {
      try {
        var arr = JSON.parse(detailsScript.textContent || '[]')
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] && arr[i].id) detailsById[arr[i].id] = arr[i]
        }
      } catch (err) { /* leave the map empty on malformed config */ }
    }
    var configScript = document.getElementById('sh-scheduled-panel-config')
    if (configScript) {
      try { config = JSON.parse(configScript.textContent || '{}') || config } catch (err) { /* keep defaults */ }
    }

    var CHAT_ROUTE = window.SH.userUrl(config.chatRoute || '/home_conversation.html')
    var SKILL_ROUTE = window.SH.userUrl(config.skillRoute || '/skill_detail.html')
    var activeTrigger = null
    var editing = false
    // Last values written by Save (or loaded with the schedule). Cancel
    // restores the form to this snapshot.
    var saved = null
    var saving = false
    var saveToken = 0

    // Frequency picklist + time picklist (15-minute increments). Built
    // once; `fillList` keeps whatever value a schedule already carries
    // even if it's off-list (e.g. "Fridays") by prepending it. Option
    // markup matches the home edit modal so app.js can write the
    // chosen label back into the combobox.
    var FREQ_OPTIONS = ['Hourly', 'Daily', 'Weekdays', 'Monthly']
    var TIME_OPTIONS = (function buildTimeOptions () {
      var out = []
      for (var mins = 0; mins < 24 * 60; mins += 15) {
        var h = Math.floor(mins / 60)
        var m = mins % 60
        var period = h < 12 ? 'AM' : 'PM'
        var h12 = h % 12
        if (h12 === 0) h12 = 12
        out.push(h12 + ':' + (m < 10 ? '0' + m : m) + ' ' + period)
      }
      return out
    })()
    var CHECK_ICON = '<svg class="slds-icon slds-icon_x-small slds-listbox__icon-selected" aria-hidden="true"><use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#check"></use></svg>'

    function writeControl (control, value) {
      if (!control) return
      if (control.tagName === 'INPUT') control.value = value || ''
      else {
        var trunc = control.querySelector('.slds-truncate')
        if (trunc) trunc.textContent = value || ''
        // SLDS grays a faux combobox until it carries this class, which
        // is why Frequency read lighter than the time input beside it.
        control.classList.toggle('slds-combobox__input-value', !!value)
      }
    }

    function readControl (control) {
      if (!control) return ''
      if (control.tagName === 'INPUT') return (control.value || '').trim()
      var trunc = control.querySelector('.slds-truncate')
      return trunc ? trunc.textContent.trim() : ''
    }

    function fillList (list, control, options, value) {
      if (!list) return
      var opts = options.slice()
      if (value && opts.indexOf(value) < 0) opts.unshift(value)
      list.innerHTML = ''
      opts.forEach(function (label) {
        var li = document.createElement('li')
        li.setAttribute('role', 'presentation')
        li.className = 'slds-listbox__item'
        var option = document.createElement('div')
        option.className = 'slds-media slds-listbox__option slds-listbox__option_plain slds-media_small'
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', label === value ? 'true' : 'false')
        if (label === value) option.classList.add('slds-is-selected')
        var figure = document.createElement('span')
        figure.className = 'slds-media__figure slds-listbox__option-icon'
        figure.innerHTML = CHECK_ICON
        var body = document.createElement('span')
        body.className = 'slds-media__body'
        var span = document.createElement('span')
        span.title = label
        span.textContent = label
        body.appendChild(span)
        option.appendChild(figure)
        option.appendChild(body)
        li.appendChild(option)
        list.appendChild(li)
      })
      writeControl(control, value)
    }

    function closeComboboxes () {
      toArray(panel.querySelectorAll('[data-slds-combobox]')).forEach(function (trigger) {
        trigger.classList.remove('slds-is-open')
        var control = trigger.querySelector('[role="combobox"]')
        if (control) control.setAttribute('aria-expanded', 'false')
      })
    }

    // The status-glyph / aria registry lives on the list root; the tab
    // controller hands it in so both share one parse, but fall back to
    // reading it here so the panel still works if bound standalone.
    function statusTypes () {
      return hooks.statusTypes || (listRoot ? readWorkflowStatusTypes(listRoot) : {})
    }

    function rowFor (id) {
      if (!listRoot || !id) return null
      return listRoot.querySelector('[data-sh-workflow-item][data-sh-workflow-id="' + id + '"]')
    }

    function clearSelected () {
      if (!listRoot) return
      toArray(listRoot.querySelectorAll('.seller-home__scheduled-workflow-item.is-selected'))
        .forEach(function (it) { it.classList.remove('is-selected') })
      toArray(listRoot.querySelectorAll('[data-sh-schedule-open][aria-expanded="true"]'))
        .forEach(function (b) { b.setAttribute('aria-expanded', 'false') })
    }

    // ── Error alert ────────────────────────────────────────────────
    // Shown whenever the schedule carries a `reconnect` block. Text is
    // set from the record (falling back to the shipped copy) and the
    // link label mirrors it. Not a live region — see the template note;
    // the open() announce carries the sentence once.
    function renderAlert (record) {
      if (!alertEl) return
      var rc = record && record.reconnect
      if (!rc) { hideAlert(); return }
      if (alertTitleEl) alertTitleEl.textContent = rc.message || 'Connection expired'
      if (alertDescEl) {
        alertDescEl.textContent = rc.description ||
          'This schedule couldn’t deliver today’s update and won’t run again until it’s reconnected.'
      }
      if (alertLinkLabelEl) alertLinkLabelEl.textContent = rc.linkLabel || 'Reconnect'
      if (alertLinkEl) {
        alertLinkEl.removeAttribute('aria-busy')
        alertLinkEl.disabled = false
        alertLinkEl.setAttribute('aria-label',
          rc.ariaLabel || ((rc.linkLabel || 'Reconnect') + ' for ' + (record.title || 'this schedule')))
      }
      alertEl.hidden = false
    }

    function hideAlert () {
      if (!alertEl) return
      alertEl.hidden = true
      if (alertLinkEl) {
        alertLinkEl.removeAttribute('aria-busy')
        alertLinkEl.disabled = false
      }
    }

    // ── Populate the panel from a schedule record ──────────────────
    function populate (record) {
      if (titleEl) titleEl.textContent = record.title || 'Schedule'
      renderAlert(record)
      closeComboboxes()
      fillList(freqList, freqEl, FREQ_OPTIONS, record.frequency)
      fillList(timeList, timeEl, TIME_OPTIONS, record.time)
      if (deliveryEl) deliveryEl.textContent = record.delivery || '—'

      if (skillNameEl) skillNameEl.textContent = record.skillName || ''
      if (skillLinkEl) {
        if (record.skillName) {
          skillLinkEl.hidden = false
          skillLinkEl.setAttribute('href',
            record.skillId ? (SKILL_ROUTE + '?id=' + encodeURIComponent(record.skillId)) : SKILL_ROUTE)
          skillLinkEl.setAttribute('aria-label', 'Uses Skill: ' + record.skillName + '. Open Skill details.')
        } else {
          skillLinkEl.hidden = true
        }
      }

      // Instructions — always land in display (read) mode on open.
      exitEdit(false)
      if (instrDisplayEl) instrDisplayEl.textContent = record.instructions || ''
      if (instrEditEl) instrEditEl.value = record.instructions || ''

      if (createdEl) {
        var created = record.createdAt || ''
        if (record.createdBy) created = created ? (created + ' by ' + record.createdBy) : ('by ' + record.createdBy)
        createdEl.textContent = created || '—'
      }

      renderLastRun(record)
      renderMenu(record)
      syncFooterAction(record)
      saved = {
        frequency: record.frequency || '',
        time: record.time || '',
        instructions: record.instructions || ''
      }
      saveToken += 1
      resetSaveButton()
    }

    // Last run reads "<status> <when>", plain. When the run is viewable
    // (a run id + a chat exist) a trailing "· View run" link opens the
    // chat and jumps to that run — so a failed run reads
    // "Failed today at 8:30 AM · View run" and lands the seller on the
    // technical details / partial output, not just a dead status line.
    function renderLastRun (record) {
      if (!lastRunEl) return
      lastRunEl.innerHTML = ''
      var text
      if (record.lastRunStatus && record.lastRunAt) text = record.lastRunStatus + ' ' + record.lastRunAt
      else text = record.lastRunAt || record.lastRunStatus || '—'

      // A failed run's status words carry the error color (only the
      // "View run" link below stays interactive — the line isn't a link).
      var failed = /^fail/i.test(record.lastRunStatus || '')
      if (failed) {
        var errSpan = document.createElement('span')
        errSpan.className = 'seller-home__schedule-side-meta-error'
        errSpan.textContent = text
        lastRunEl.appendChild(errSpan)
      } else {
        lastRunEl.appendChild(document.createTextNode(text))
      }

      if (record.lastRunId && record.chatId) {
        lastRunEl.appendChild(document.createTextNode(' · '))
        var a = document.createElement('a')
        a.className = 'seller-home__schedule-side-meta-link'
        a.href = CHAT_ROUTE + '?id=' + encodeURIComponent(record.chatId) +
          '#' + encodeURIComponent(record.lastRunId)
        a.textContent = 'View run'
        a.setAttribute('aria-label', 'View run: ' + text + '. Opens the chat at this run.')
        lastRunEl.appendChild(a)
      }
    }

    // ── Header overflow menu ───────────────────────────────────────
    // Run now / Pause↔Resume / Open Chat / Archive. Pause and Resume are
    // mutually exclusive; Open Chat needs a chat; run/pause/archive are
    // hidden once archived.
    function menuItemVisible (id, record) {
      var status = record.status || ''
      switch (id) {
        case 'run_now': return status !== 'archived'
        case 'pause': return status !== 'paused' && status !== 'archived'
        case 'resume': return status === 'paused'
        case 'open_chat': return !!record.chatId
        case 'archive': return status !== 'archived'
        default: return true
      }
    }

    function renderMenu (record) {
      if (!menuList) return
      var shown = 0
      toArray(menuList.querySelectorAll('[data-sh-schedule-menu-action]')).forEach(function (btn) {
        var actionId = btn.getAttribute('data-sh-schedule-menu-action')
        var vis = menuItemVisible(actionId, record)
        if (vis) shown++
        var li = btn.parentNode
        if (li && li.tagName === 'LI') li.hidden = !vis
        else btn.hidden = !vis

        // Run now stays visible but goes disabled while a blocking issue
        // remains (see scheduleRunBlocked).
        var dis = vis && actionId === 'run_now' && scheduleRunBlocked(record.status || '')
        btn.disabled = dis
        if (dis) {
          btn.setAttribute('aria-disabled', 'true')
          // Accessible explanation for why Run now is unavailable.
          btn.title = 'Reconnect Slack before running this schedule.'
          btn.setAttribute('aria-label', (btn.querySelector('.seller-home__schedule-side-menu-item-label')
            ? btn.querySelector('.seller-home__schedule-side-menu-item-label').textContent : 'Run now') +
            '. Reconnect Slack before running this schedule.')
        } else {
          btn.removeAttribute('aria-label')
          btn.removeAttribute('aria-disabled')
          btn.removeAttribute('title')
        }
      })
      // Nothing applies (e.g. an archived schedule) → hide the ⋮ trigger
      // rather than offer an empty menu.
      if (menuWrap) menuWrap.hidden = shown === 0
      syncFooterAction(record)
    }

    // Footer always opens a chat. An existing session is reused; a
    // schedule with none starts one, named for the workflow.
    function syncFooterAction () {
      if (!footerActionBtn) return
      footerActionBtn.textContent = 'Open Chat'
      footerActionBtn.disabled = false
      footerActionBtn.removeAttribute('aria-disabled')
      footerActionBtn.removeAttribute('title')
    }
    function openWorkflowChat (record, id) {
      if (record.chatId) {
        window.location.href = CHAT_ROUTE + '?id=' + encodeURIComponent(record.chatId)
        return
      }
      var api = window.SellerHomeScheduling
      var started = api && typeof api.createWorkflowChat === 'function'
        ? api.createWorkflowChat(record)
        : null
      if (started && started.convId) record.chatId = started.convId
      window.location.href = started && started.url
        ? started.url
        : CHAT_ROUTE + '?id=' + encodeURIComponent('conv-wf-' + id)
    }

    function visibleMenuItems () {
      if (!menuList) return []
      return toArray(menuList.querySelectorAll('[data-sh-schedule-menu-action]'))
        .filter(function (b) { return b.offsetParent !== null && !b.disabled })
    }

    function menuIsOpen () { return !!(menuList && !menuList.hidden) }

    function setMenuOpen (isOpen) {
      if (!menuList || !menuTrigger) return
      menuList.hidden = !isOpen
      menuTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
    }

    // ── State transitions ──────────────────────────────────────────
    // Recategorise a schedule: repaint the card glyph + accessible name
    // (shared `applyWorkflowStatus`), update its meta line, keep the
    // in-memory record in sync, refresh the overflow menu (Pause↔Resume)
    // and re-run the active tab filter + counts (without closing us).
    // Active cadence rebuilt from the (editable) frequency + time, with
    // the original "· Next run …" tail preserved so editing the picklists
    // updates the card without losing its schedule-relative suffix.
    function scheduledCadence (record) {
      var tail = ''
      var c = record.cadence || ''
      var idx = c.indexOf(' · ')
      if (idx >= 0) tail = c.slice(idx)
      return (record.frequency || '') + ' at ' + (record.time || '') + tail
    }

    // Repaint a failed row's meta as just the error message. The
    // recovery action now lives in a dedicated Reconnect button in the
    // row's right-side action area, not inline in the message.
    function renderReconnectMeta (meta, record) {
      var rc = record.reconnect || {}
      meta.textContent = rc.message || 'Connection issue'
    }

    function updateCadence (row, record, status) {
      var meta = row && row.querySelector('.seller-home__scheduled-workflow-meta')
      if (!meta) return
      var freq = (record.frequency || '').toLowerCase()
      var time = record.time || ''
      if (status === 'running') meta.textContent = 'Running now · Started at ' + time
      else if (status === 'paused') meta.textContent = 'Paused · Previously ran ' + freq + ' at ' + time
      else if (status === 'archived') meta.textContent = 'Archived'
      else if (status === 'failed' && record.reconnect) renderReconnectMeta(meta, record)
      else meta.textContent = scheduledCadence(record)
    }

    function changeStatus (id, record, newStatus) {
      record.status = newStatus
      var row = rowFor(id)
      if (row) {
        applyWorkflowStatus(row, newStatus, statusTypes())
        updateCadence(row, record, newStatus)
      }
      renderMenu(record)
      if (typeof hooks.reflow === 'function') hooks.reflow()
    }

    // ── Reconnect (Needs-Attention recovery action) ────────────────
    // Kicks off the (simulated) Slack reconnection for a failed
    // schedule. Guards against double-submits via `aria-busy`, shows the
    // button's loading state, and on success returns the schedule to
    // Active — clearing the error, restoring its cadence/next-run, and
    // letting `hooks.reflow()` move it out of Needs Attention and
    // recount the tabs.
    function setReconnectLoading (btn, loading) {
      if (!btn) return
      if (loading) {
        btn.setAttribute('aria-busy', 'true')
        btn.disabled = true
      } else {
        btn.removeAttribute('aria-busy')
        btn.disabled = false
      }
    }

    function reconnectSchedule (id, btn) {
      var record = id ? detailsById[id] : null
      if (!record) return
      // Already in flight — ignore repeat presses (Enter/Space/click).
      if (btn && btn.getAttribute('aria-busy') === 'true') return

      setReconnectLoading(btn, true)

      var name = record.title || 'Schedule'
      // A prototype stand-in for the async Slack OAuth round-trip. A
      // truthy `data-sh-reconnect-fail` on the button forces the failure
      // path for demoing the error state; otherwise it succeeds.
      var willFail = !!(btn && btn.getAttribute('data-sh-reconnect-fail'))

      window.setTimeout(function () {
        if (willFail) {
          // Keep the schedule under Needs Attention with its error state
          // intact; just release the button and surface an actionable
          // message.
          setReconnectLoading(btn, false)
          showScheduledToast(
            'Couldn\u2019t reconnect Slack for ' + name +
              '. Check your Slack workspace connection and try again.',
            'error'
          )
          return
        }

        // Success — clear the block and restore normal scheduling copy.
        record.reconnect = null
        record.cadence =
          (record.frequency || 'Weekdays') + ' at ' + (record.time || '8:30 AM') +
          ' \u00b7 Next run tomorrow'

        // Move Failed → Active. This repaints the status glyph + meta
        // (dropping the error color), rebuilds the header menu (Run now
        // re-enabled), and reflows the tabs so the card leaves Needs
        // Attention and the counts update.
        changeStatus(id, record, 'scheduled')

        // The recovery action no longer applies once the block is
        // cleared: retire the row's Reconnect button and hide the panel
        // alert, whichever surface triggered this.
        var row = rowFor(id)
        var rowBtn = row && row.querySelector('[data-sh-workflow-reconnect]')
        if (rowBtn && rowBtn.parentNode) rowBtn.parentNode.removeChild(rowBtn)
        if (panel.getAttribute('data-sh-schedule-current') === id) hideAlert()

        showScheduledToast('Slack reconnected. ' + name + ' is active again.', 'success')
      }, 1100)
    }

    function doAction (actionId, record, id) {
      if (!record || !id) return
      // Defensive: a blocked Run now is disabled in the menu, but never
      // act on it even if a stray dispatch slips through.
      if (actionId === 'run_now' && scheduleRunBlocked(record.status || '')) return
      switch (actionId) {
        case 'open_chat':
          openWorkflowChat(record, id)
          break
        case 'run_now':
          changeStatus(id, record, 'running')
          break
        case 'pause':
          changeStatus(id, record, 'paused')
          break
        case 'resume': {
          var row = rowFor(id)
          var back = (row && row.getAttribute('data-sh-workflow-status-default')) || 'scheduled'
          changeStatus(id, record, back)
          break
        }
        case 'archive':
          changeStatus(id, record, 'archived')
          // Archived schedules leave the operational tabs, so the card
          // it opened from is gone — close and hand focus back sensibly.
          close()
          break
      }

      // Broadcast for any future listener (drafts, analytics). No
      // in-tree listener mutates status off this, so it can't double up.
      document.dispatchEvent(new CustomEvent('sh:workflow-action', {
        detail: { action: actionId, workflowId: id, source: 'schedule-panel' }
      }))
      // eslint-disable-next-line no-console
      console.info('[seller-home] schedule action:', actionId, '(' + id + ')')
    }

    // ── Editable Instructions ──────────────────────────────────────
    function autosize (el) {
      if (!el) return
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }

    function enterEdit () {
      if (!instrDisplayEl || !instrEditEl || editing) return
      editing = true
      instrEditEl.value = instrDisplayEl.textContent
      instrDisplayEl.hidden = true
      instrEditEl.hidden = false
      autosize(instrEditEl)
      instrEditEl.focus()
      var len = instrEditEl.value.length
      try { instrEditEl.setSelectionRange(len, len) } catch (e) { /* older engines */ }
    }

    function exitEdit (save) {
      if (!instrDisplayEl || !instrEditEl) return
      // Keep the edited text in the display only. The record updates
      // when Save is pressed.
      if (editing && save) instrDisplayEl.textContent = instrEditEl.value
      editing = false
      instrEditEl.hidden = true
      instrDisplayEl.hidden = false
    }

    // ── Open / close ───────────────────────────────────────────────
    function open (id, trigger) {
      var record = detailsById[id]
      if (!record) return
      exitEdit(false)
      setMenuOpen(false)
      clearSelected()
      activeTrigger = trigger || null
      populate(record)
      panel.hidden = false
      panel.setAttribute('aria-hidden', 'false')
      panel.setAttribute('data-sh-schedule-current', id)
      var item = trigger && closest(trigger, '[data-sh-workflow-item]')
      if (item) item.classList.add('is-selected')
      if (trigger) trigger.setAttribute('aria-expanded', 'true')
      // Single polite announcement on open. When the schedule is in
      // error, fold the alert copy into it (associated with the schedule
      // name) so the alert conveys itself once without being its own
      // live region that would re-announce on every re-render.
      if (announceEl) {
        var msg = 'Showing details for ' + (record.title || 'schedule') + '.'
        if (record.reconnect) {
          msg += ' ' + (record.reconnect.message || 'Connection expired') + '. ' +
            (record.reconnect.description || '')
        }
        announceEl.textContent = msg
      }
      if (titleEl && typeof titleEl.focus === 'function') {
        // Defer so focus lands after the panel has laid out.
        setTimeout(function () { titleEl.focus() }, 0)
      }
    }

    function close () {
      if (panel.hidden) return
      exitEdit(false)
      setMenuOpen(false)
      closeComboboxes()
      panel.hidden = true
      panel.setAttribute('aria-hidden', 'true')
      panel.removeAttribute('data-sh-schedule-current')
      clearSelected()
      var back = activeTrigger
      activeTrigger = null
      // Don't return focus to the card. Its `:focus-within` surface is
      // the same grey as `.is-selected`, so focusing it after close
      // left the row looking selected. Land on the active tab instead,
      // unless the card was filtered out of the list (then the tab is
      // already the only sensible target).
      var target = root.querySelector('[data-sh-scheduled-tab][aria-checked="true"]') || null
      if (!target && back && back.offsetParent !== null) target = back
      if (target && typeof target.focus === 'function') {
        setTimeout(function () { target.focus() }, 0)
      }
    }

    // ── Wiring ─────────────────────────────────────────────────────
    if (listRoot) {
      listRoot.addEventListener('click', function (event) {
        // Reconnect is a nested action layered above the row-open
        // overlay: handle it first and stop the event so it never falls
        // through to opening the details panel.
        var reconnectBtn = closest(event.target, '[data-sh-workflow-reconnect]')
        if (reconnectBtn && listRoot.contains(reconnectBtn)) {
          event.preventDefault()
          event.stopPropagation()
          reconnectSchedule(reconnectBtn.getAttribute('data-sh-workflow-reconnect'), reconnectBtn)
          return
        }

        var card = closest(event.target, '[data-sh-schedule-open]')
        if (!card || !listRoot.contains(card)) return
        event.preventDefault()
        var id = card.getAttribute('data-sh-schedule-open')
        if (!panel.hidden && panel.getAttribute('data-sh-schedule-current') === id) {
          close()
        } else {
          open(id, card)
        }
      })
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function (event) {
        event.preventDefault()
        close()
      })
    }

    // "Reconnect Slack" in the error alert — starts the same reconnection
    // flow the row's Reconnect button uses, on the panel's current
    // schedule. Duplicate presses are guarded inside reconnectSchedule
    // via aria-busy.
    if (alertLinkEl) {
      alertLinkEl.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        var id = panel.getAttribute('data-sh-schedule-current')
        if (id) reconnectSchedule(id, alertLinkEl)
      })
    }

    // Frequency and time stay in the form until Save. Save stays
    // disabled until one of those differs from the last saved values.
    function scheduleDirty () {
      if (!saved) return false
      return readControl(freqEl) !== (saved.frequency || '') ||
        readControl(timeEl) !== (saved.time || '')
    }
    function syncSaveState () {
      if (!saveBtn) return
      if (saving) {
        saveBtn.disabled = true
        return
      }
      saveBtn.disabled = !scheduleDirty()
    }
    function resetSaveButton () {
      saving = false
      if (!saveBtn) return
      saveBtn.removeAttribute('aria-busy')
      var label = saveBtn.querySelector('[data-sh-schedule-panel-save-label]')
      if (label) label.textContent = 'Save'
      syncSaveState()
    }
    function commitSchedule () {
      if (saving || !scheduleDirty()) return
      var id = panel.getAttribute('data-sh-schedule-current')
      var record = id ? detailsById[id] : null
      if (!record) return
      var frequency = readControl(freqEl)
      var time = readControl(timeEl)
      var token = ++saveToken
      saving = true
      saveBtn.disabled = true
      saveBtn.setAttribute('aria-busy', 'true')
      var label = saveBtn.querySelector('[data-sh-schedule-panel-save-label]')
      if (label) label.textContent = 'Save'
      window.setTimeout(function () {
        if (frequency) record.frequency = frequency
        if (time) record.time = time
        updateCadence(rowFor(id), record, record.status)
        var stillOpen = token === saveToken &&
          panel.getAttribute('data-sh-schedule-current') === id
        if (stillOpen) {
          saved = {
            frequency: record.frequency || '',
            time: record.time || '',
            instructions: record.instructions || ''
          }
          resetSaveButton()
          close()
        }
        showScheduledToast('Changes saved successfully', 'success')
      }, 3000)
    }
    function watchScheduleEdits (control) {
      if (!control) return
      var listId = control.getAttribute('aria-controls')
      var list = listId && document.getElementById(listId)
      if (list) {
        list.addEventListener('click', function (event) {
          if (!closest(event.target, '[role="option"]')) return
          syncSaveState()
        })
      }
      if (control.tagName === 'INPUT') {
        control.addEventListener('input', syncSaveState)
        control.addEventListener('change', syncSaveState)
      }
    }
    var saveBtn = panel.querySelector('[data-sh-schedule-panel-save]')
    var footerActionBtn = panel.querySelector('[data-sh-schedule-panel-secondary]')
    watchScheduleEdits(freqEl)
    watchScheduleEdits(timeEl)
    if (saveBtn) saveBtn.addEventListener('click', commitSchedule)
    if (footerActionBtn) {
      footerActionBtn.addEventListener('click', function () {
        if (footerActionBtn.disabled) return
        var id = panel.getAttribute('data-sh-schedule-current')
        var record = id ? detailsById[id] : null
        if (!record) return
        doAction('open_chat', record, id)
      })
    }

    // Header overflow menu: open/close + action dispatch + roving keys.
    if (menuTrigger && menuList) {
      menuTrigger.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        var willOpen = menuList.hidden
        setMenuOpen(willOpen)
        if (willOpen) {
          var first = visibleMenuItems()[0]
          if (first) first.focus()
        }
      })

      menuList.addEventListener('click', function (event) {
        var btn = closest(event.target, '[data-sh-schedule-menu-action]')
        if (!btn) return
        event.preventDefault()
        event.stopPropagation()
        var actionId = btn.getAttribute('data-sh-schedule-menu-action')
        var id = panel.getAttribute('data-sh-schedule-current')
        var record = detailsById[id] || {}
        setMenuOpen(false)
        doAction(actionId, record, id)
      })

      menuList.addEventListener('keydown', function (event) {
        var items = visibleMenuItems()
        var idx = items.indexOf(document.activeElement)
        switch (event.key) {
          case 'Escape':
            event.preventDefault()
            event.stopPropagation()
            setMenuOpen(false)
            menuTrigger.focus()
            break
          case 'ArrowDown':
            event.preventDefault()
            if (items.length) items[(idx + 1) % items.length].focus()
            break
          case 'ArrowUp':
            event.preventDefault()
            if (items.length) items[(idx - 1 + items.length) % items.length].focus()
            break
          case 'Home':
            event.preventDefault()
            if (items.length) items[0].focus()
            break
          case 'End':
            event.preventDefault()
            if (items.length) items[items.length - 1].focus()
            break
        }
      })

      // Outside click closes the menu (but not the panel).
      document.addEventListener('click', function (event) {
        if (!menuIsOpen()) return
        if (closest(event.target, '[data-sh-schedule-menu]')) return
        setMenuOpen(false)
      })
    }

    // Instructions: click / Enter / Space to edit. Blur keeps the text
    // in the display; Save commits it. Escape drops the in-progress
    // edit. Escape + typing stay off the panel's Escape-to-close.
    if (instrDisplayEl) {
      instrDisplayEl.addEventListener('click', function () { enterEdit() })
      instrDisplayEl.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault()
          enterEdit()
        }
      })
    }
    if (instrEditEl) {
      instrEditEl.addEventListener('input', function () { autosize(instrEditEl) })
      instrEditEl.addEventListener('blur', function () { exitEdit(true) })
      instrEditEl.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          var id = panel.getAttribute('data-sh-schedule-current')
          var record = id ? detailsById[id] : null
          instrEditEl.value = (record && record.instructions) || ''
          exitEdit(false)
          if (instrDisplayEl && typeof instrDisplayEl.focus === 'function') instrDisplayEl.focus()
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          instrEditEl.blur() // commit via the blur handler
        }
      })
    }

    // Panel-level Escape: close the menu first, otherwise close the
    // panel. (Instructions edit + menu stop their own Escape from
    // bubbling here, so this only fires for the plain-panel case.)
    panel.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return
      if (menuIsOpen()) {
        event.preventDefault()
        setMenuOpen(false)
        if (menuTrigger) menuTrigger.focus()
        return
      }
      if (editing) return
      event.preventDefault()
      close()
    })

    return { open: open, close: close }
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
  function scheduledWorkflowOverflowController (listRoot, onChange) {
    var openMenu = null
    var openTrigger = null

    // Overflow actions that move the row to a new state — the same
    // transitions the status button and the home feed make. `edit` isn't
    // here, so it stays a dispatch-only placeholder.
    var WORKFLOW_ACTION_STATES = {
      run_now: 'running',
      stop: 'scheduled',
      restart: 'scheduled',
      archive: 'archived'
    }

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
          // Run now goes disabled while a blocking issue remains (its
          // last run failed — see scheduleRunBlocked). Recomputed each
          // open so it re-enables once the row is reconnected.
          var item = closest(trigger, '[data-sh-workflow-item]')
          var blocked = !!(item && scheduleRunBlocked(item.getAttribute('data-sh-workflow-status')))
          var runNow = menu.querySelector('[data-sh-workflow-action="run_now"]')
          if (runNow) {
            runNow.disabled = blocked
            if (blocked) {
              runNow.setAttribute('aria-disabled', 'true')
              runNow.title = 'Reconnect to run this schedule'
            } else {
              runNow.removeAttribute('aria-disabled')
              runNow.removeAttribute('title')
            }
          }
          var first = menu.querySelector('[data-sh-workflow-action]:not([disabled])')
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
      // Disabled items (e.g. Run now on a blocked row) never dispatch.
      if (actionBtn.disabled) return

      event.stopPropagation()
      event.preventDefault()

      var actionId = actionBtn.getAttribute('data-sh-workflow-action')
      var row = closest(actionBtn, '[data-sh-workflow-item]')
      var workflowId = row ? row.getAttribute('data-sh-workflow-id') : ''

      // Edit opens the backing skill's detail page — the same destination
      // the home feed's Edit action uses. The skill id rides on the row as
      // `data-sh-workflow-skill` (scheduled.json → workflow.skillId).
      if (actionId === 'edit') {
        var workflowSkillId = row ? row.getAttribute('data-sh-workflow-skill') : ''
        if (workflowSkillId) {
          window.location.href = window.SH.userUrl('/skill_detail.html?id=' + encodeURIComponent(workflowSkillId))
          return
        }
      }

      // Apply the state change (if any), then let the caller refresh the
      // tab counts + re-filter so the row moves between tabs.
      var target = WORKFLOW_ACTION_STATES[actionId]
      if (target && row) {
        applyWorkflowStatus(row, target, readWorkflowStatusTypes(listRoot))
        if (onChange) onChange(row, actionId, target)
      }

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

      var items = toArray(openMenu.querySelectorAll('[data-sh-workflow-action]:not([disabled])'))
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
  // ── Phase 5c — Knowledge banner dismiss ────────────────────────
  // "Got it" hides the banner for the rest of the session, and the
  // Home tab is the only thing that brings it back.
  //
  // The scope is deliberately in between the two obvious choices.
  // Forgetting immediately meant the banner returned on every page
  // load, so drilling into a doc and hitting Back put it right back on
  // screen — those are full page navigations here, not view swaps.
  // Remembering forever (localStorage) would mean whoever dismissed it
  // once never sees it again, and this is a surface people demo
  // repeatedly. Session scope with a reset on Home gives both: it
  // stays gone while you move around, and a run-through can start over.
  //
  // `hidden` rather than removal so the element can come back without
  // re-rendering, and so the reason it's gone is legible in the
  // inspector. It also takes the banner out of the accessibility tree,
  // which display:none via a class would do too but less obviously.
  //
  // It fades and dips in scale on the way out rather than blinking off,
  // and the rest of the column glides up to meet it. The curves are in
  // home.scss; what lives here is the scheduling and the measurement.
  function bindKnowledgeBanner (bannerRoot) {
    var dismiss = bannerRoot.querySelector('[data-sh-knowledge-banner-dismiss]')
    if (!dismiss) return

    // Normally the preload script in knowledge.html has already hidden
    // the banner before this runs — it has to, or there'd be a frame of
    // banner before the script loaded. This is the fallback for when
    // that didn't happen (storage threw on the first read but not the
    // second, markup used without the preload). Nothing to animate: the
    // banner was dismissed on a previous page, so it just isn't here.
    if (readKnowledgeBannerDismissed()) {
      bannerRoot.hidden = true
      return
    }

    dismiss.addEventListener('click', function () {
      // A second click would queue a second cleanup.
      if (bannerRoot.classList.contains('is-dismissing')) return

      writeKnowledgeBannerDismissed()

      var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) {
        bannerRoot.hidden = true
        return
      }

      var timing = readBannerTiming(bannerRoot)

      // Measure BEFORE the fade starts. The measurement briefly sets
      // `hidden`, which is `display: none`, and taking an element out
      // of the box tree cancels any transition running on it — doing
      // this mid-fade snapped the banner straight to invisible at the
      // exact moment the glide began, which is precisely the overlap
      // this is trying to create. Nothing is animating yet at click
      // time, so there's nothing to cancel.
      var runSettle = planContentSettle(bannerRoot)

      bannerRoot.classList.add('is-dismissing')

      // Start the glide partway into the fade so the two overlap
      // instead of running back to back. Driven by a timer rather than
      // the fade's `transitionend`, which by definition can only fire
      // at the end — there's no event for "partway".
      window.setTimeout(function () {
        runSettle(timing.settle)
      }, timing.delay)
    })
  }

  // The timings behind the dismiss, read off the element so the
  // stylesheet stays the one place they're written down. They're
  // declared on the column in home.scss and inherit to the banner.
  //
  // `delay` is how far into the fade the glide starts, and it's the one
  // of the three that only the script can act on — there's no CSS way
  // to say "begin this transition partway through that one".
  function readBannerTiming (bannerRoot) {
    var fade = 150
    var settle = 200
    var delay = 75
    try {
      var cs = window.getComputedStyle(bannerRoot)
      fade = parseFloat(cs.getPropertyValue('--knowledge-banner-fade')) || fade
      settle = parseFloat(cs.getPropertyValue('--knowledge-banner-settle')) || settle
      var raw = parseFloat(cs.getPropertyValue('--knowledge-banner-glide-delay'))
      delay = isNaN(raw) ? fade / 2 : raw
    } catch (e) {
      // Fall through to the defaults, which mirror home.scss.
    }
    return { fade: fade, settle: settle, delay: delay }
  }

  // Plans the second half of the dismiss: everything below the banner
  // sliding up into the space the banner is about to vacate. Returns
  // the function that runs it, so the measuring and the moving can sit
  // at different points on the clock.
  //
  // The split is what makes the overlap possible. The straightforward
  // version hides the banner and eases the resulting jump, but hiding
  // is `display: none` — it collapses the layout AND cancels the fade,
  // so the glide could only ever start once the banner was gone. Here
  // the banner stays in flow at full height while the siblings move
  // over it, and the distance comes from a measurement taken earlier,
  // at click time, before there was any transition to disturb.
  //
  // That measurement is itself a hide-read-unhide, all in one
  // synchronous block so the browser computes the collapsed layout
  // without painting it. Cheap and exact — it accounts for the column's
  // gap and any margins without this needing to know about them.
  //
  // The siblings are then translated UP by that distance, which lands
  // them exactly where the layout will put them once the banner goes.
  // That's what makes the final handoff invisible: dropping the
  // transform and hiding the banner in the same frame cancel out to
  // zero net movement. Either one alone would jump the full distance.
  function planContentSettle (bannerRoot) {
    // Everything after the banner that actually renders. The filter
    // isn't hypothetical: the banner's immediate next sibling in
    // knowledge.html is the inline preload script, and a `<script>`
    // generates no box, so measuring it yields zeroes.
    var movers = []
    var next = bannerRoot.nextElementSibling
    while (next) {
      if (next.getClientRects().length) movers.push(next)
      next = next.nextElementSibling
    }

    var i
    var shifted = []
    var deltas = []

    if (movers.length) {
      var before = []
      for (i = 0; i < movers.length; i++) {
        before.push(movers[i].getBoundingClientRect().top)
      }

      bannerRoot.hidden = true
      for (i = 0; i < movers.length; i++) {
        var delta = before[i] - movers[i].getBoundingClientRect().top
        if (!delta) continue
        shifted.push(movers[i])
        deltas.push(delta)
      }
      bannerRoot.hidden = false

      // Unhiding isn't enough on its own. The reads above forced a
      // style recalc while the banner was `display: none`, so that's
      // the last state the browser has on record for it — and an
      // element coming back from `display: none` doesn't transition.
      // Without this read, the caller's `is-dismissing` class would
      // apply opacity 0 with no fade at all. Forcing layout here puts
      // "displayed, opaque" on the record first, so the class that
      // follows has something to animate away from.
      void bannerRoot.offsetHeight
    }

    return function runSettle (settleMs) {
      function dropBanner () {
        bannerRoot.hidden = true
        bannerRoot.classList.remove('is-dismissing')
      }

      // Banner is the last rendered thing in the column, or nothing
      // moved — no glide to run, so just let it go.
      if (!shifted.length) {
        dropBanner()
        return
      }

      // Arm the transition before the offset, with a reflow between
      // them. A property can only animate if its `transition` was
      // already in effect on the previous style computation — set both
      // at once and the elements teleport.
      var j
      for (j = 0; j < shifted.length; j++) shifted[j].classList.add('is-settling')
      void shifted[0].offsetHeight
      for (j = 0; j < shifted.length; j++) {
        shifted[j].style.transform = 'translateY(' + (-deltas[j]) + 'px)'
      }

      // The handoff. All of this has to land in the same frame: drop
      // the transition first so clearing the transform doesn't animate
      // back, then clear it, then take the banner out of flow. The
      // elements are left exactly as they were found.
      window.setTimeout(function () {
        for (var k = 0; k < shifted.length; k++) {
          shifted[k].classList.remove('is-settling')
          shifted[k].style.transform = ''
        }
        dropBanner()
      }, settleMs)
    }
  }

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

    // The active Learnings/Sources tab, if the tabs are present. A row
    // is only visible when it belongs to the active tab AND matches the
    // query, so the search box filters WITHIN the selected tab. Returns
    // null when there are no tabs, in which case the tab check no-ops.
    function activeKnowledgeTab () {
      var parent = listRoot.parentNode
      if (!parent) return null
      var t = parent.querySelector('[data-sh-knowledge-tab][aria-checked="true"]')
      return t ? t.getAttribute('data-sh-knowledge-tab') : null
    }

    function applyFilter (rawQuery) {
      // Trim so trailing whitespace never zeroes out results.
      var query = (rawQuery == null ? '' : String(rawQuery)).trim().toLowerCase()
      var tab = activeKnowledgeTab()
      var visibleCount = 0

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i]
        // Tab gate first: a row outside the active tab is never shown,
        // regardless of the query.
        var rowTab = row.getAttribute('data-sh-knowledge-doc-tab')
        var tabMatch = !tab || !rowTab || rowTab === tab
        var visible
        if (!tabMatch) {
          visible = false
        } else if (!query) {
          // Empty query → all rows in the active tab (spec).
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

  // ── Knowledge tabs (Learnings / Sources) ──────────────────────────────
  // Filter chips over the one doc list — same pattern + styling as the
  // Scheduled page's tabs (radiogroup, roving tabindex, arrow-key nav).
  // Rather than toggle rows itself, activating a tab re-runs the search
  // controller's filter (which reads the active tab), so tab + query
  // filtering stay in one place and never fight over each row's `hidden`.
  //
  // DOM hooks:
  //   • [data-sh-knowledge-tabs]  → radiogroup wrapper
  //   • [data-sh-knowledge-tab]   → each chip (radio); its value is the
  //                                 tab id, matched against each row's
  //                                 data-sh-knowledge-doc-tab.
  function bindKnowledgeTabs (root) {
    var tabsRoot = root.querySelector('[data-sh-knowledge-tabs]')
    if (!tabsRoot) return
    var tabs = toArray(tabsRoot.querySelectorAll('[data-sh-knowledge-tab]'))
    if (!tabs.length) return
    var searchInput = root.querySelector('[data-sh-knowledge-search]')

    // Nudge the search controller to re-filter. Its listener reads the
    // active tab, so a plain re-run applies the current tab + query.
    function reFilter () {
      if (searchInput) {
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }

    function activeIndex () {
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].getAttribute('aria-checked') === 'true') return i
      }
      return 0
    }

    function activate (id, focus) {
      for (var i = 0; i < tabs.length; i++) {
        var isActive = tabs[i].getAttribute('data-sh-knowledge-tab') === id
        tabs[i].classList.toggle('is-active', isActive)
        tabs[i].setAttribute('aria-checked', isActive ? 'true' : 'false')
        tabs[i].setAttribute('tabindex', isActive ? '0' : '-1')
        if (isActive && focus && typeof tabs[i].focus === 'function') tabs[i].focus()
      }
      reFilter()
    }

    tabsRoot.addEventListener('click', function (event) {
      var tab = closest(event.target, '[data-sh-knowledge-tab]')
      if (!tab) return
      activate(tab.getAttribute('data-sh-knowledge-tab'))
    })

    // Arrow / Home / End roving, per the WAI-ARIA radiogroup convention.
    tabsRoot.addEventListener('keydown', function (event) {
      var idx = activeIndex()
      var next = null
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (idx + 1) % tabs.length
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (idx - 1 + tabs.length) % tabs.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = tabs.length - 1
      else return
      event.preventDefault()
      activate(tabs[next].getAttribute('data-sh-knowledge-tab'), true)
    })

    // Sync `hidden` with the server-active tab. CSS already hides the
    // other tab from first paint (`:has(aria-checked)`); this keeps
    // search-within-tab and the `hidden` attribute in agreement.
    reFilter()
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

  // ── Toast ──────────────────────────────────────────────────────────
  // A single docked SLDS notification (success | error), mirroring the
  // conversation page's `showToast` so the design-system chrome is
  // identical. `role="status"` (success) / `role="alert"` (error) make
  // it announce to AT; success auto-dismisses, errors linger longer so
  // the recovery message isn't missed. Reuses `window._shShowToast` if
  // the conversation bundle already exposed one.
  function showScheduledToast (message, kind) {
    kind = kind === 'error' ? 'error' : 'success'
    var duration = kind === 'error' ? 6000 : 4000

    var existing = document.querySelector('.sh-toast-container')
    if (existing) existing.remove()

    var container = document.createElement('div')
    container.className = 'slds-notify_container sh-toast-container'
    container.style.cssText =
      'position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:9999;'

    var theme = kind === 'error' ? 'slds-theme_error' : 'slds-theme_success'
    var role = kind === 'error' ? 'alert' : 'status'
    var icon = kind === 'error' ? 'warning' : 'success'
    var iconClass = kind === 'error'
      ? 'slds-icon-utility-warning' : 'slds-icon-utility-success'

    container.innerHTML =
      '<div class="slds-notify slds-notify_toast ' + theme + '" role="' + role + '">' +
        '<span class="slds-assistive-text">' + kind + '</span>' +
        '<span class="slds-icon_container ' + iconClass +
          ' slds-m-right_small slds-no-flex slds-align-top">' +
          '<svg class="slds-icon slds-icon_small" aria-hidden="true">' +
            '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#' + icon + '"></use>' +
          '</svg>' +
        '</span>' +
        '<div class="slds-notify__content">' +
          '<h2 class="slds-text-heading_small"></h2>' +
        '</div>' +
        '<div class="slds-notify__close">' +
          '<button class="slds-button slds-button_icon slds-button_icon-inverse" title="Close">' +
            '<svg class="slds-button__icon" aria-hidden="true">' +
              '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#close"></use>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>'

    // Set copy via textContent so a schedule name can never inject markup.
    container.querySelector('.slds-notify__content h2').textContent = String(message || '')

    document.body.appendChild(container)

    var closeBtn = container.querySelector('.slds-notify__close button')
    if (closeBtn) closeBtn.addEventListener('click', function () { container.remove() })

    window.setTimeout(function () {
      if (container.parentNode) container.remove()
    }, duration)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
