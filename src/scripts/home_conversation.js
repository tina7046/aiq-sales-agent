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
//   • Prospect table: wire single-select + keyboard nav
//     (roving-tabindex, Enter/Space, Arrow keys, Home/End). Kept
//     independent so the table works as a standalone list even
//     without a review controller attached.
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
//   • Composer: autosize, Enter-to-send, and the scripted-turn queue
//     (send → thinking indicator → hardcoded reply). See
//     `bindConvComposer`.
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
// Table <-> review sync flows through the DOM event
// `sh:conv-row-select` (payload: { rowId, source: 'table'|'review' }).
// The table dispatches on click / keyboard-activation; the review
// dispatches on Prev/Next. Every listener treats the event as
// authoritative — no direct calls between the two views, so a
// future third consumer (analytics, detail pane) can subscribe
// without needing a reference to either module.
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
    //   `convTable` — the wrapper carrying `data-sh-conv-table`.
    //   `convRow`   — the <tr> elements that support selection.
    convTable:    '[data-sh-conv-table]',
    convRow:      '[data-sh-conv-row]',
    // Per-row Accept / Reject in the table's Actions column:
    convAccept:   '[data-sh-conv-accept]',
    convReject:   '[data-sh-conv-reject]',
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
    userTemplate:     '[data-sh-conv-user-template]',
    thinkingTemplate: '[data-sh-conv-thinking-template]',
    thinkingItem:     '[data-sh-conv-thinking]',
    // Per-conversation templates. Every conversation in the registry
    // renders its own set, so these are always narrowed by the active
    // id (see `scopedSelector`) before being queried.
    inlineTemplate:   '[data-sh-conv-inline]',
    stageTemplate:    '[data-sh-conv-stage]',
    turnTemplate:     '[data-sh-conv-turn]',
    // Clickable bullet in a "suggested next steps" message:
    suggestion:       '[data-sh-conv-suggestion]'
  }
  // Class + ARIA the table row toggles on selection. `.is-selected`
  // is the visual state; `aria-selected` is the AT-facing state.
  var SELECTED_CLASS = 'is-selected'
  // Class the review section toggles when the confirmation dialog
  // opens (mirrors SLDS `slds-fade-in-open` semantically).
  var DIALOG_OPEN_CLASS = 'is-open'
  // Class the composer carries while a scripted turn is in flight.
  var BUSY_CLASS = 'is-busy'
  // Fallback thinking duration when a turn omits `thinkingMs` (or
  // ships an unparseable one).
  var DEFAULT_THINKING_MS = 2000
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
    if (!has(id)) id = root.getAttribute(ATTR_DEFAULT_CONV)
    if (!has(id) || !ID_PATTERN.test(id)) id = null

    var entry = id ? map[id] : null
    if (id) root.setAttribute('data-sh-conversation-id', id)

    // What the seller typed on Seller Home, if they arrived that way.
    var query = readQueryFromUrl()

    // Their own words title the thread when they wrote them — the
    // conversation's authored title is the fallback for every other
    // way in.
    var heading = query || (entry && entry.title)
    var titleEl = root.querySelector(SELECTORS.title)
    if (heading && titleEl) {
      titleEl.textContent = heading
      titleEl.setAttribute('title', heading)
    }

    // Recent highlight + intercept redundant clicks.
    applyActiveRecent(id)
    bindRecentClicks(id)

    // Wire the tables + reviews the server rendered. The same
    // function runs again on anything cloned in later, so build-time
    // and runtime content get identical behavior.
    bindMessageContent(document, map)

    // Composer: autosize, Enter-to-send, and the scripted reply queue.
    // It owns the thread mutations and the busy state, so the opening
    // sequence plays through the handle it returns rather than
    // reaching into the thread itself.
    var conv = bindConvComposer(root, map, id)
    if (conv) conv.playOpening(query)
  }

  // Attach the interactive behaviors that live INSIDE an agent
  // message, for every one found in `scope`. Called once for the
  // document at boot and again per injected reply — which is why
  // neither binder may assume it's the only one on the page.
  function bindMessageContent (scope, convMap) {
    if (!scope || !scope.querySelectorAll) return

    // Prospect tables: standalone single-select + keyboard nav.
    var tables = scope.querySelectorAll(SELECTORS.convTable)
    for (var t = 0; t < tables.length; t++) bindProspectTable(tables[t])

    // Cadence cards: the drafted sequence of touches per prospect.
    // Owns its own file — it subscribes to the same
    // `sh:conv-row-select` / `sh:review-decision` events the table
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
  function bindConvComposer (root, convMap, convId) {
    var form        = root.querySelector(SELECTORS.composer)
    var input       = root.querySelector(SELECTORS.composerInput)
    var send        = root.querySelector(SELECTORS.composerSend)
    var thread      = root.querySelector(SELECTORS.thread)
    var threadInner = root.querySelector(SELECTORS.threadInner)
    if (!form || !input || !send || !thread || !threadInner) return

    var userTpl     = root.querySelector(SELECTORS.userTemplate)
    var thinkingTpl = root.querySelector(SELECTORS.thinkingTemplate)

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

    var state = {
      nextTurn: 0,   // index into `turns`
      sent: 0,       // how many messages the seller has sent
      busy: false    // a turn is mid-flight
    }

    autosize()
    updateSendState()

    input.addEventListener('input', function () {
      autosize()
      updateSendState()
    })

    // Enter → send, Shift+Enter → newline (browser default). During
    // IME composition Enter is committing a candidate, NOT sending,
    // so bail on `isComposing` (plus the `keyCode === 229` fallback
    // for engines that don't set it).
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return
      if (event.shiftKey) return
      if (event.isComposing || event.keyCode === 229) return
      event.preventDefault()
      // Prefer `requestSubmit` so a real `submit` event fires and any
      // other listener on the form still sees it; fall back to the
      // handler directly on engines that lack it (Safari < 16).
      if (typeof form.requestSubmit === 'function') form.requestSubmit()
      else submit()
    })

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      submit()
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
      input.value = prompt
      autosize()
      updateSendState()
      if (typeof input.focus === 'function') input.focus()
      // Caret to the end so typing continues the sentence rather than
      // overwriting a selection.
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(prompt.length, prompt.length)
      }
    })

    function submit () {
      // Guard rather than trust the button's disabled state — Enter
      // and `requestSubmit` can both reach here around it.
      if (state.busy) return
      var raw = input.value
      var text = raw == null ? '' : raw.trim()
      if (!text) return

      state.sent++
      removeEmptyPlaceholder()
      appendUserMessage(text)

      input.value = ''
      autosize()

      var turnTpl = turns[state.nextTurn] || null
      if (!turnTpl) {
        // Queue exhausted — the echo is the whole interaction.
        updateSendState()
        scrollToLatest()
        return
      }
      state.nextTurn++
      runTurn(turnTpl)
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
    function playBeat (tpl, done) {
      var label = tpl.getAttribute('data-sh-conv-thinking-label') || ''
      var delay = parseInt(tpl.getAttribute('data-sh-conv-thinking-ms'), 10)
      if (!isFinite(delay) || delay < 0) delay = DEFAULT_THINKING_MS

      var indicator = appendThinking(label)
      scrollToLatest()

      window.setTimeout(function () {
        if (indicator && indicator.parentNode) {
          indicator.parentNode.removeChild(indicator)
        }
        appendTemplate(tpl, convMap)
        scrollToLatest()
        if (done) done()
      }, delay)
    }

    function runTurn (turnTpl) {
      setBusy(true)
      playBeat(turnTpl, function () {
        setBusy(false)
        // Hand the caret back so a follow-up doesn't need a click.
        if (typeof input.focus === 'function') input.focus()
      })
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
        scrollToLatest()
        return
      }

      removeEmptyPlaceholder()
      setBusy(true)
      next(0)

      function next (i) {
        if (i >= stages.length) {
          setBusy(false)
          return
        }
        playBeat(stages[i], function () { next(i + 1) })
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
    function appendTemplate (tpl, map) {
      var frag = cloneTemplate(tpl)
      if (!frag) return
      var added = []
      for (var n = 0; n < frag.childNodes.length; n++) {
        var node = frag.childNodes[n]
        if (node.nodeType === 1) added.push(node)
      }
      threadInner.appendChild(frag)
      for (var a = 0; a < added.length; a++) bindMessageContent(added[a], map)
    }

    // Drop the "Messages will appear here." row the first time real
    // content arrives, so an empty thread doesn't keep claiming it is
    // one.
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

    function updateSendState () {
      var hasText = !!(input.value && input.value.trim())
      send.disabled = state.busy || !hasText
    }

    // Grow the textarea to fit its content. `max-height` in the
    // stylesheet caps it and hands off to internal scrolling, so the
    // composer can't push the thread off-screen.
    function autosize () {
      input.style.height = 'auto'
      input.style.height = input.scrollHeight + 'px'
    }

    function scrollToLatest () {
      var top = thread.scrollHeight
      try {
        thread.scrollTo({
          top: top,
          behavior: prefersReducedMotion() ? 'auto' : 'smooth'
        })
      } catch (e) {
        // Older browsers: scrollTo doesn't accept options.
        thread.scrollTop = top
      }
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
  //   • Roving-tabindex keyboard nav (Arrow / Home / End).
  //   • Single-select visual state (`.is-selected`, aria-selected).
  //   • Reflecting review status onto the row (approved /
  //     changes_requested) via `data-sh-review-status`.
  //   • Dispatching `sh:conv-row-select` on user interaction so a
  //     review controller (or any other subscriber) can react.
  //
  // Also subscribes to `sh:conv-row-select` — external senders
  // (the review's Prev/Next buttons) can drive selection through
  // the same event, and the table updates its own DOM in response.
  function bindProspectTable (table) {
    if (!table) return
    var rows = table.querySelectorAll(SELECTORS.convRow)
    if (!rows.length) return

    // NodeList → array for readable index math.
    var rowList = []
    for (var i = 0; i < rows.length; i++) rowList.push(rows[i])

    // Roving tabindex — the first row is the initial tab stop.
    setRovingFocus(rowList, 0)

    // One click handler for the whole table so the Actions column can
    // claim a click before it becomes a row selection. That matters
    // because selecting a row scrolls the review panel into view —
    // accepting a prospect shouldn't move the page out from under the
    // cursor.
    table.addEventListener('click', function (event) {
      var target = event.target
      if (!target || !target.closest) return

      if (handleDecisionClick(target, table)) return
      // Email / phone links do their own navigating.
      if (target.closest('a[href]')) return

      var row = target.closest(SELECTORS.convRow)
      if (!row || !table.contains(row)) return
      selectRow(rowList, row, { source: 'table' })
    })

    table.addEventListener('keydown', function (event) {
      var row = event.target && event.target.closest
        ? event.target.closest(SELECTORS.convRow)
        : null
      if (!row || !table.contains(row)) return
      var currentIndex = rowList.indexOf(row)
      if (currentIndex < 0) return

      switch (event.key) {
        case 'Enter':
        case ' ':
        case 'Spacebar':
          event.preventDefault()
          selectRow(rowList, row, { source: 'table' })
          break
        case 'ArrowDown':
          event.preventDefault()
          moveFocus(rowList, currentIndex + 1)
          break
        case 'ArrowUp':
          event.preventDefault()
          moveFocus(rowList, currentIndex - 1)
          break
        case 'Home':
          event.preventDefault()
          moveFocus(rowList, 0)
          break
        case 'End':
          event.preventDefault()
          moveFocus(rowList, rowList.length - 1)
          break
      }
    })

    // External sync — a review's Prev/Next fires the same event.
    // If the target is a row of THIS table, update our DOM without
    // re-dispatching (`silent: true` prevents an event loop).
    document.addEventListener(EVT_ROW_SELECT, function (event) {
      var d = event.detail || {}
      if (!d.rowId) return
      var targetRow = table.querySelector('[data-sh-conv-row][data-sh-conv-row-id="' + d.rowId + '"]')
      if (!targetRow) return
      // Skip a re-application when the row is already selected —
      // avoids gratuitous focus + `.is-selected` toggles.
      if (targetRow.classList.contains(SELECTED_CLASS)) return
      selectRow(rowList, targetRow, { silent: true })
    })

    // React to per-prospect decisions by updating the row's
    // `data-sh-review-status` — the SCSS `[data-sh-review-status]`
    // rules paint the leading stripe from there.
    document.addEventListener(EVT_DECISION, function (event) {
      var d = event.detail || {}
      if (d.decision === 'approve_all') {
        // Mark every row as approved.
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
  }

  // ── Row decisions (Actions column) ──────────────────────────────
  // Accept / Reject write the row's status and announce it. The
  // review's own Approve / Request-changes buttons take the opposite
  // path (review → `sh:review-decision` → row), so both surfaces
  // converge on the same per-prospect state whichever one the seller
  // uses.
  //
  // Returns true when the click was a decision, so the caller knows
  // not to treat it as a row selection.
  function handleDecisionClick (target, table) {
    var accept = target.closest(SELECTORS.convAccept)
    var reject = accept ? null : target.closest(SELECTORS.convReject)
    var button = accept || reject
    if (!button) return false

    var row = button.closest(SELECTORS.convRow)
    if (!row || !table.contains(row)) return false

    var status = accept ? 'approved' : 'changes_requested'
    paintRowStatus(row, status)
    dispatch(row, EVT_TABLE_DECISION, {
      rowId:  row.getAttribute('data-sh-conv-row-id') || null,
      status: status
    })
    return true
  }

  // Reflect a decision in the row's DOM: the status attribute the
  // SCSS paints the leading stripe from, plus the pressed state of
  // the two action buttons. Deliberately silent — callers decide
  // whether the change also needs to be announced.
  function paintRowStatus (row, status) {
    row.setAttribute('data-sh-review-status', status)
    var acceptBtn = row.querySelector(SELECTORS.convAccept)
    var rejectBtn = row.querySelector(SELECTORS.convReject)
    if (acceptBtn) acceptBtn.setAttribute('aria-pressed', status === 'approved' ? 'true' : 'false')
    if (rejectBtn) rejectBtn.setAttribute('aria-pressed', status === 'changes_requested' ? 'true' : 'false')
  }


  function moveFocus (rowList, nextIndex) {
    var clamped = Math.max(0, Math.min(rowList.length - 1, nextIndex))
    setRovingFocus(rowList, clamped)
    var target = rowList[clamped]
    if (target && typeof target.focus === 'function') target.focus()
  }

  function setRovingFocus (rowList, focusIndex) {
    for (var i = 0; i < rowList.length; i++) {
      rowList[i].setAttribute('tabindex', i === focusIndex ? '0' : '-1')
    }
  }

  // Apply single-select DOM state. Dispatches `sh:conv-row-select`
  // unless `opts.silent` is set (used when the selection is being
  // driven by an already-dispatched external event, to prevent a
  // ping-pong loop).
  function selectRow (rowList, targetRow, opts) {
    opts = opts || {}
    for (var i = 0; i < rowList.length; i++) {
      var row = rowList[i]
      var isTarget = row === targetRow
      if (isTarget) {
        row.classList.add(SELECTED_CLASS)
        row.setAttribute('aria-selected', 'true')
      } else {
        row.classList.remove(SELECTED_CLASS)
        row.setAttribute('aria-selected', 'false')
      }
    }
    var idx = rowList.indexOf(targetRow)
    if (idx >= 0) setRovingFocus(rowList, idx)

    if (!opts.silent) {
      var table = targetRow.closest(SELECTORS.convTable)
      dispatch(targetRow, EVT_ROW_SELECT, {
        rowId:   targetRow.getAttribute('data-sh-conv-row-id') || null,
        tableId: table ? table.getAttribute('data-sh-conv-table') : null,
        source:  opts.source || 'table',
        row:     targetRow
      })
    }
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
      setReview(state.selectedId, { status: 'approved' })
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
}())
