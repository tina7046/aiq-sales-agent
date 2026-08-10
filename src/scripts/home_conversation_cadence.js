// ──────────────────────────────────────────────────────────────────────
// Cadence sequence — behavior
// =====================================================================
// Drives the cadence card rendered by _home_conversation_cadence.html:
// the drafted sequence of touches for one prospect, shown inside an
// agent message beneath the prospect table.
//
// Loaded by /home_conversation.html BEFORE home_conversation.js, which
// calls `ShCadence.mount(scope)` from `bindMessageContent` — once for
// the document at boot, and again for anything a scripted reply
// injects. Mounting is idempotent per card.
//
// Responsibilities
// ----------------
//   • Prospect switching. Selection arrives from the table (a row
//     click) or the card's own Prospect lookup, which dispatches the
//     same event the row does, and swaps which sequence shows.
//     Sequences are cloned out of the inert <template> per prospect
//     that Nunjucks rendered, with `{firstName}`-style tokens filled
//     in on the way.
//   • Per-touch interaction: collapse, the Details / Feedback tabs,
//     the inline citation hover card, and feedback-driven Regenerate.
//   • Per-prospect approval. Approving covers the whole sequence, so
//     the card speaks the same events the outreach review did and the
//     table's row stripe keeps working unchanged.
//
// Porting notes (from hunter's cadence-sequence.js / step-feedback.js)
// -------------------------------------------------------------------
//   • Hunter builds every step in JS from a JSON payload. Here the
//     markup — including each alternate version of a touch — comes out
//     of the same Nunjucks macros as the rest of the thread, so this
//     file only ever clones and wires. No DOM building.
//   • Behavior is delegated from the steps host rather than bound per
//     step, so a sequence swap or a regenerated card needs no
//     re-binding.
//   • Hunter's popover positions once and never updates. The thread
//     scrolls, so this one follows its anchor and clamps to the
//     viewport (see `positionCite`).
//   • Hunter's Regenerate walks forward through `regenerations` and
//     never returns to the original. This one treats the original as
//     part of the cycle, so pressing again brings it back.
//
// Nothing here talks to a server: Regenerate is a timer over
// pre-authored alternates.
// ──────────────────────────────────────────────────────────────────────

(function () {
  'use strict'

  // ── Config ──────────────────────────────────────────────────────
  var SELECTORS = {
    root:        '[data-sh-cadence-root]',
    steps:       '[data-sh-cadence-steps]',
    seqTemplate: '[data-sh-cadence-seq]',
    // Header + identity write targets:
    touches:     '[data-sh-cadence-touches]',
    channels:    '[data-sh-cadence-channels]',
    summary:     '[data-sh-cadence-summary]',
    current:     '[data-sh-cadence-current]',
    name:        '[data-sh-cadence-name]',
    role:        '[data-sh-cadence-role]',
    company:     '[data-sh-cadence-company]',
    status:      '[data-sh-cadence-status]',
    statusLabel: '[data-sh-cadence-status-label]',
    // Controls:
    prev:        '[data-sh-cadence-prev]',
    next:        '[data-sh-cadence-next]',
    approve:     '[data-sh-cadence-approve]',
    approveAll:  '[data-sh-cadence-approve-all]',
    actions:     '.seller-home__conv-cadence-actions',
    batch:       '.seller-home__conv-cadence-batch',
    completed:   '[data-sh-cadence-completed]',
    // Approve-all confirmation:
    dialog:      '[data-sh-cadence-dialog]',
    backdrop:    '[data-sh-cadence-dialog-backdrop]',
    // One touch:
    step:        '[data-sh-step]',
    stepToggle:  '[data-sh-step-toggle]',
    stepHeader:  '[data-sh-step-header]',
    stepCard:    '[data-sh-step-card]',
    stepDraft:   '[data-sh-step-draft]',
    stepAlt:     '[data-sh-step-alt]',
    tabsRoot:    '[data-sh-step-tabs]',
    tabLink:     '[data-sh-tab-link]',
    tabItem:     '[data-sh-tab-item]',
    tabPanel:    '[data-sh-tab-panel]',
    feedback:    '[data-sh-step-feedback-input]',
    feedbackLbl: '[data-sh-step-feedback-label]',
    regenerate:  '[data-sh-step-regenerate]',
    banner:      '[data-sh-step-banner]',
    bannerLabel: '[data-sh-step-banner-label]',
    bannerClose: '[data-sh-step-banner-dismiss]',
    // Citations + their hover card:
    citation:    '.email-highlight',
    cite:        '[data-sh-cite-popover]'
  }

  var COLLAPSED_CLASS  = 'is-collapsed'
  var REGENERATING     = 'is-regenerating'
  var FLASHING_CLASS   = 'is-flashing'
  var CITING_CLASS     = 'is-citing'
  var DIALOG_OPEN      = 'is-open'
  var BANNER_SUCCESS   = 'seller-home__conv-step-banner--success'

  // Long enough to read as work happening, short enough that a demo
  // doesn't stall. Paced with the thread's thinking indicator.
  var REGEN_MS         = 2600
  var CITE_SHOW_MS     = 400
  var CITE_HIDE_MS     = 600
  var LOADING_LABEL    = 'Generating based on your feedback\u2026'
  var SUCCESS_LABEL    = 'Here\u2019s the updated message'

  // Shared with home_conversation.js — see the communication model at
  // the top of that file. Duplicated as literals rather than imported
  // because both files are plain scripts.
  var EVT_ROW_SELECT     = 'sh:conv-row-select'
  var EVT_DECISION       = 'sh:review-decision'
  var EVT_TABLE_DECISION = 'sh:conv-row-decision'

  var STATUS_FALLBACK = {
    not_reviewed:      { label: 'Not reviewed',      modifier: 'not-reviewed' },
    approved:          { label: 'Approved',          modifier: 'approved' },
    changes_requested: { label: 'Changes requested', modifier: 'changes-requested' }
  }

  // Per-status action-button configuration. Approving is idempotent,
  // so the button locks once it's done.
  //
  // One button's worth, where this used to carry two. Request Changes
  // came out of the footer, so its `requestDisabled` / `requestLabel`
  // pair went with it. `changes_requested` still has a row because the
  // status is still reachable — a table row's reject sets it — and
  // reaching it has to leave Approve live so the seller can change
  // their mind.
  //
  // `approveSelected` where this used to carry `approveLabel`: the
  // button is an SLDS stateful button now, so both labels are in the
  // markup and the state class picks which one shows. Writing
  // `textContent` here — what the label version did — would delete the
  // spans and the checkmark with them.
  var ACTION_STATE = {
    not_reviewed:      { approveDisabled: false, approveSelected: false },
    approved:          { approveDisabled: true,  approveSelected: true },
    changes_requested: { approveDisabled: false, approveSelected: false }
  }

  // Unique enough for one page, and readable in the inspector.
  var uid = 0

  // ── Utilities ───────────────────────────────────────────────────
  function dispatch (sourceEl, name, detail) {
    try {
      sourceEl.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || {} }))
    } catch (e) { /* legacy browser: no-op */ }
  }

  function parseJSONAttr (el, attr, fallback) {
    if (!el) return fallback
    var raw = el.getAttribute(attr)
    if (!raw) return fallback
    try {
      return JSON.parse(raw) || fallback
    } catch (e) {
      return fallback
    }
  }

  function toggleHidden (el, shouldHide) {
    if (!el) return
    if (shouldHide) el.setAttribute('hidden', '')
    else            el.removeAttribute('hidden')
  }

  function prefersReducedMotion () {
    if (!window.matchMedia) return false
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch (e) {
      return false
    }
  }

  // Fill a prospect's details into authored copy. The Nunjucks `fill`
  // macro does the same four tokens for the server-rendered sequence;
  // this handles one cloned out of a template. Add a token in one
  // place and it needs adding in the other.
  function fillTokens (html, p) {
    if (!html || !p) return html || ''
    return String(html)
      .split('{firstName}').join(p.firstName || '')
      .split('{prospect}').join(p.prospect || '')
      .split('{company}').join(p.company || '')
      .split('{signal}').join(p.signal || '')
  }

  // Parse an authored markup string into nodes. DOMParser rather than
  // innerHTML on a live node: it doesn't run scripts and it keeps the
  // "never assign markup into the page" habit, even though this
  // content is authored alongside the template.
  function parseFragment (html) {
    var frag = document.createDocumentFragment()
    var doc  = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html')
    var wrap = doc.body.firstChild
    // `adoptNode` and not `importNode`: adopt MOVES the node out of
    // the parsed document, so `firstChild` advances and the loop
    // terminates. Import copies, which would leave the source
    // untouched and spin forever.
    while (wrap && wrap.firstChild) {
      frag.appendChild(document.adoptNode(wrap.firstChild))
    }
    return frag
  }

  // ── Mount ───────────────────────────────────────────────────────
  function mount (scope) {
    var host = scope && scope.querySelectorAll ? scope : document
    // `scope` can be an injected message that IS the card's ancestor
    // but not its parent, and it can also be the card itself.
    var roots = []
    if (host.matches && host.matches(SELECTORS.root)) roots.push(host)
    var found = host.querySelectorAll(SELECTORS.root)
    for (var i = 0; i < found.length; i++) roots.push(found[i])

    for (var r = 0; r < roots.length; r++) bindCadence(roots[r])
  }

  // ── The header's two lookups ────────────────────────────────────
  // home_conversation_lookups.js is generic and knows nothing about
  // this card: it reads its records off `window` under the key each
  // field names in `data-slds-lookup`, and announces a pick as
  // `lookup-selection-change`. Both halves of that are joined up here,
  // because the card is where the records and the card's own event
  // vocabulary both live.
  //
  // Why at mount and not at load: the card is usually injected into the
  // thread by a scripted reply, long after any script has run, so
  // there's no earlier moment when both the fields and their data
  // exist. Init is idempotent on the lookup side, so a second mount is
  // harmless.
  function bindLookups (root, metaList) {
    if (!window.ShLookups) return

    // The Prospect field speaks name / title / account; the roster
    // speaks prospect / role / company. Translated here rather than
    // shipped twice, so there is one list of who exists. The id rides
    // along so a pick resolves to a row rather than to a name — two
    // people called Jane Doe would otherwise land on whichever came
    // first.
    var records = []
    for (var i = 0; i < metaList.length; i++) {
      var p = metaList[i]
      if (!p || !p.id) continue
      records.push({ id: p.id, name: p.prospect, title: p.role, account: p.company })
    }

    window.SH_PROSPECT_DATA = records
    window.SH_CADENCE_DATA  = parseJSONBlock(root, '[data-sh-cadence-list]', [])
    window.ShLookups.init()

    // A prospect pick is the same statement a table row click makes, so
    // it's re-announced as one and the card's existing listener does the
    // rest — which also means the table row highlights to match. Tagged
    // `lookup` so that listener knows not to scroll the card into view;
    // it's already on screen, being the thing that was just clicked.
    //
    // Nothing translates the other way. The field seeds its chip from
    // `data-lookup-default` at init and is not rewritten when selection
    // changes elsewhere, so choosing a row in the table moves the card
    // but leaves the field showing the previous name.
    if (root.dataset.lookupBridged === 'true') return
    root.dataset.lookupBridged = 'true'

    document.addEventListener('lookup-selection-change', function (event) {
      var d = event.detail || {}
      if (!d.selected || !d.record || d.entity !== 'Prospect') return
      if (!d.record.id) return
      document.dispatchEvent(new CustomEvent(EVT_ROW_SELECT, {
        detail: { rowId: d.record.id, source: 'lookup' }
      }))
    })
  }

  function parseJSONBlock (root, selector, fallback) {
    var el = root.querySelector(selector)
    if (!el) return fallback
    try { return JSON.parse(el.textContent) } catch (e) { return fallback }
  }

  function bindCadence (root) {
    if (!root || root.dataset.cadenceWired === 'true') return
    root.dataset.cadenceWired = 'true'

    var idsAttr = root.getAttribute('data-sh-cadence-prospect-ids') || ''
    var ids     = idsAttr.split(',').filter(Boolean)
    if (!ids.length) return

    // Prospect details for the token fill — read off the root rather
    // than re-derived from the table, so the card works wherever it's
    // rendered. The pager and identity line that also read this are
    // gone; `metaById` still feeds `{firstName}` and friends.
    var metaList = parseJSONAttr(root, 'data-sh-cadence-prospects', [])
    var metaById = Object.create(null)
    for (var m = 0; m < metaList.length; m++) {
      if (metaList[m] && metaList[m].id) metaById[metaList[m].id] = metaList[m]
    }

    bindLookups(root, metaList)

    var statuses = readStatusMap(root) || STATUS_FALLBACK

    var els = {
      steps:       root.querySelector(SELECTORS.steps),
      touches:     root.querySelector(SELECTORS.touches),
      channels:    root.querySelector(SELECTORS.channels),
      summary:     root.querySelector(SELECTORS.summary),
      current:     root.querySelector(SELECTORS.current),
      name:        root.querySelector(SELECTORS.name),
      role:        root.querySelector(SELECTORS.role),
      company:     root.querySelector(SELECTORS.company),
      status:      root.querySelector(SELECTORS.status),
      statusLabel: root.querySelector(SELECTORS.statusLabel),
      prev:        root.querySelector(SELECTORS.prev),
      next:        root.querySelector(SELECTORS.next),
      approve:     root.querySelector(SELECTORS.approve),
      approveAll:  root.querySelector(SELECTORS.approveAll),
      actions:     root.querySelector(SELECTORS.actions),
      batch:       root.querySelector(SELECTORS.batch),
      completed:   root.querySelector(SELECTORS.completed),
      prospectRow: root.querySelector('.seller-home__conv-cadence-prospect'),
      cite:        root.querySelector(SELECTORS.cite)
    }
    if (!els.steps) return

    // Dialog + backdrop are siblings of the card, emitted by the same
    // macro. Search the shared parent first so a second cadence card
    // drives its own dialog rather than whichever came first.
    var dialogScope = root.parentNode && root.parentNode.querySelector ? root.parentNode : document
    var dialog = {
      el:       dialogScope.querySelector(SELECTORS.dialog)   || document.querySelector(SELECTORS.dialog),
      backdrop: dialogScope.querySelector(SELECTORS.backdrop) || document.querySelector(SELECTORS.backdrop)
    }
    if (dialog.el) {
      dialog.confirm = dialog.el.querySelector('[data-sh-cadence-dialog-confirm]')
      dialog.cancel  = dialog.el.querySelector('[data-sh-cadence-dialog-cancel]')
      dialog.close   = dialog.el.querySelector('[data-sh-cadence-dialog-close]')
    }

    var state = {
      selectedId: ids[0],
      // { prospectId: { status } }. Keyed so stepping away from a
      // prospect and back preserves the decision.
      reviews: Object.create(null),
      completed: false,
      // Which sequence the steps host currently shows. Starts on the
      // one the server rendered, so mounting on the default prospect
      // costs no re-render.
      renderedFor: ids[0]
    }

    // The server rendered the first prospect. If the seller had
    // already picked a row before this card arrived, honour that.
    var preselected = findSelectedRowId(ids)
    if (preselected) state.selectedId = preselected

    var citations = createCitations(root, els.cite)
    wireSteps(root, els.steps, citations)
    wireCard()

    render({ rerender: state.selectedId !== state.renderedFor })

    // ── Sequence rendering ────────────────────────────────────
    // Swap in the template for this prospect, tokens filled. Nothing
    // needs re-binding afterwards: every step behavior is delegated
    // from the steps host, which survives the swap.
    function renderSequence (prospectId) {
      var meta = metaById[prospectId]
      var tpl  = root.querySelector('[data-sh-cadence-seq="' + prospectId + '"]') ||
                 root.querySelector('[data-sh-cadence-seq="default"]')
      if (!tpl || !meta) return

      var frag = parseFragment(fillTokens(tpl.innerHTML, meta))
      while (els.steps.firstChild) els.steps.removeChild(els.steps.firstChild)
      els.steps.appendChild(frag)
      state.renderedFor = prospectId

      // Touch count and channel mix travel on the template so they
      // can't disagree with the steps they describe.
      if (els.touches) {
        var count = tpl.getAttribute('data-sh-cadence-seq-touches') || ''
        els.touches.textContent = count + (count === '1' ? ' touch' : ' touches')
      }
      if (els.channels) {
        els.channels.textContent = tpl.getAttribute('data-sh-cadence-seq-channels') || ''
      }
      // Same reason, one level up: the sentence describing the cadence
      // is the card's unless the sequence carries its own.
      if (els.summary) {
        els.summary.textContent = tpl.getAttribute('data-sh-cadence-seq-summary') || ''
      }

      mintStepIds(els.steps)
    }

    // ── Render ────────────────────────────────────────────────
    function render (opts) {
      var meta   = metaById[state.selectedId] || {}
      var review = state.reviews[state.selectedId] || { status: 'not_reviewed' }
      var index  = ids.indexOf(state.selectedId)

      if (opts && opts.rerender) renderSequence(state.selectedId)

      if (els.current) els.current.textContent = String(index + 1)
      if (els.name)    els.name.textContent    = meta.prospect || ''
      if (els.role)    els.role.textContent    = meta.role || ''
      if (els.company) els.company.textContent = meta.company || ''

      applyStatus(review.status)
      applyActions(review.status)
      applyCompleted(state.completed)

      // Keep the table's highlight on the prospect being shown.
      // Cheap: the table's listener bails when the row is already
      // selected. Tagged so our own subscriber ignores the echo.
      dispatch(root, EVT_ROW_SELECT, { rowId: state.selectedId, source: 'cadence' })
    }

    function applyStatus (statusKey) {
      if (!els.status || !els.statusLabel) return
      var info = statuses[statusKey] || statuses.not_reviewed
      els.statusLabel.textContent = info ? info.label : statusKey
      for (var key in statuses) {
        els.status.classList.remove('seller-home__conv-review-status--' + statuses[key].modifier)
      }
      if (info) els.status.classList.add('seller-home__conv-review-status--' + info.modifier)
    }

    // Both classes get set explicitly rather than toggling one: the
    // two are opposites in SLDS's sheet, and leaving the stale one on
    // would show both labels at once. This runs on every render, so
    // switching to a different prospect resets the button to "Approve".
    function applyActions (statusKey) {
      var conf = ACTION_STATE[statusKey] || ACTION_STATE.not_reviewed
      if (els.approve) {
        els.approve.disabled = conf.approveDisabled
        els.approve.classList.toggle('slds-is-selected',  conf.approveSelected)
        els.approve.classList.toggle('slds-not-selected', !conf.approveSelected)
        els.approve.setAttribute('aria-pressed', conf.approveSelected ? 'true' : 'false')
      }
    }

    function applyCompleted (isComplete) {
      toggleHidden(els.steps,       isComplete)
      toggleHidden(els.prospectRow, isComplete)
      toggleHidden(els.actions,     isComplete)
      toggleHidden(els.batch,       isComplete)
      toggleHidden(els.completed,  !isComplete)
    }

    // ── State mutators ────────────────────────────────────────
    function setSelected (id, source) {
      if (ids.indexOf(id) < 0) return
      if (id === state.selectedId) return
      state.selectedId = id
      render({ rerender: true })
      // Selecting from the table means the card may be off-screen.
      // From the card's own Prospect lookup it is by definition in
      // view, so don't jump the page.
      if (source === 'table') scrollIntoView(root)
    }

    function setReview (id, status) {
      if (ids.indexOf(id) < 0) return
      state.reviews[id] = { status: status }
      render()
      dispatch(root, EVT_DECISION, {
        rowId: id,
        decision: status === 'approved' ? 'approve'
          : status === 'changes_requested' ? 'request_changes'
          : 'update'
      })
    }

    function approveAll () {
      for (var i = 0; i < ids.length; i++) state.reviews[ids[i]] = { status: 'approved' }
      state.completed = true
      render()
      dispatch(root, EVT_DECISION, { decision: 'approve_all' })
    }

    // Wrap at both ends so the seller can loop the roster rather than
    // dead-ending on the twelfth prospect.
    function neighborId (direction) {
      var idx = ids.indexOf(state.selectedId)
      if (idx < 0) return ids[0]
      var next = idx + direction
      if (next < 0) next = ids.length - 1
      if (next >= ids.length) next = 0
      return ids[next]
    }

    // ── Card-level wiring ─────────────────────────────────────
    function wireCard () {
      if (els.prev) els.prev.addEventListener('click', function () {
        setSelected(neighborId(-1), 'cadence')
      })
      if (els.next) els.next.addEventListener('click', function () {
        setSelected(neighborId(1), 'cadence')
      })

      if (els.approve) els.approve.addEventListener('click', function () {
        if (els.approve.disabled) return
        var meta = metaById[state.selectedId] || {}
        var name = meta.prospect || meta.company || ''
        var pendingId = state.selectedId

        // Show "Approving..." state
        els.approve.disabled = true
        var notSelectedSpan = els.approve.querySelector('.slds-text-not-selected')
        var origLabel = notSelectedSpan ? notSelectedSpan.textContent : ''
        if (notSelectedSpan) notSelectedSpan.textContent = 'Approving…'

        setTimeout(function () {
          if (notSelectedSpan) notSelectedSpan.textContent = origLabel
          setReview(pendingId, 'approved')
          if (window._shShowToast) window._shShowToast('Cadence approved for ' + name)
        }, 800)
      })
      if (els.approveAll) els.approveAll.addEventListener('click', function () {
        openDialog(els.approveAll)
      })

      // Selection from the table (or any other subscriber). Our own
      // echo is tagged `cadence` and ignored.
      //
      // The source is passed through rather than hardcoded to 'table'
      // because the Prospect lookup fires this event too, tagged
      // `lookup`, and it sits INSIDE the card — scrolling the card into
      // view on a pick made from within it would yank the page under
      // the dropdown that was just used. Anything untagged is treated
      // as the table, which is where this event came from originally.
      document.addEventListener(EVT_ROW_SELECT, function (event) {
        var d = event.detail || {}
        if (!d.rowId || d.source === 'cadence') return
        setSelected(d.rowId, d.source || 'table')
      })

      // A row's Accept / Reject lands in the same state the card's own
      // buttons set. Since Request Changes came out of the footer, this
      // is now the ONLY way `changes_requested` gets set — and with the
      // status pill gone too, nothing in the card renders it.
      document.addEventListener(EVT_TABLE_DECISION, function (event) {
        var d = event.detail || {}
        if (!d.rowId || ids.indexOf(d.rowId) < 0) return
        if (d.status !== 'approved' && d.status !== 'changes_requested') return
        var current = state.reviews[d.rowId]
        if (current && current.status === d.status) return
        setReview(d.rowId, d.status)
      })
    }

    // ── Approve-all confirmation ──────────────────────────────
    var lastFocused = null
    var trapHandler = null

    function openDialog (returnFocusTo) {
      if (!dialog.el || !dialog.backdrop) return
      lastFocused = returnFocusTo || document.activeElement
      dialog.el.removeAttribute('hidden')
      dialog.el.classList.add(DIALOG_OPEN)
      dialog.backdrop.removeAttribute('hidden')
      dialog.backdrop.classList.add(DIALOG_OPEN)
      // Deferred so the browser's own default-focus pass doesn't
      // compete on the same tick.
      setTimeout(function () {
        if (dialog.confirm) dialog.confirm.focus()
      }, 0)
      trapHandler = createTrapHandler(dialog.el, closeDialog)
      document.addEventListener('keydown', trapHandler)
    }

    function closeDialog () {
      if (!dialog.el || !dialog.backdrop) return
      dialog.el.setAttribute('hidden', '')
      dialog.el.classList.remove(DIALOG_OPEN)
      dialog.backdrop.setAttribute('hidden', '')
      dialog.backdrop.classList.remove(DIALOG_OPEN)
      if (trapHandler) {
        document.removeEventListener('keydown', trapHandler)
        trapHandler = null
      }
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus()
      lastFocused = null
    }

    if (dialog.confirm) dialog.confirm.addEventListener('click', function () {
      approveAll()
      closeDialog()
      setTimeout(function () {
        if (window._shShowToast) window._shShowToast('All ' + ids.length + ' cadences approved')
      }, 800)
    })
    if (dialog.cancel)   dialog.cancel.addEventListener('click', closeDialog)
    if (dialog.close)    dialog.close.addEventListener('click', closeDialog)
    if (dialog.backdrop) dialog.backdrop.addEventListener('click', closeDialog)
  }

  // Whichever prospect row the table already has selected, if this
  // card arrived after the seller picked one.
  //
  // Finds nothing today: the prospect table dropped row selection, so
  // no row ever carries `.is-selected` and this returns null, which
  // starts the card on the first prospect in the roster. Kept, with the
  // `sh:conv-row-select` subscriber below, so restoring selection makes
  // the card follow the table again without a change here.
  function findSelectedRowId (ids) {
    var row = document.querySelector('[data-sh-conv-row].is-selected')
    if (!row) return null
    var id = row.getAttribute('data-sh-conv-row-id')
    return id && ids.indexOf(id) >= 0 ? id : null
  }

  function readStatusMap (root) {
    var node = root.querySelector('[data-sh-cadence-statuses]')
    if (!node) return null
    try {
      return JSON.parse(node.textContent) || null
    } catch (e) {
      return null
    }
  }

  function scrollIntoView (el) {
    if (typeof el.scrollIntoView !== 'function') return
    try {
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' })
    } catch (e) {
      el.scrollIntoView()
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Per-touch behavior
  // ──────────────────────────────────────────────────────────────
  // All of it delegated from the steps host, so swapping in another
  // prospect's sequence — or replacing a card with a regenerated
  // version — needs no re-binding. The only per-node pass is
  // `mintStepIds`, which exists because ARIA needs real ids and this
  // markup is cloned many times over.
  function wireSteps (root, stepsHost, citations) {
    mintStepIds(stepsHost)

    stepsHost.addEventListener('click', function (event) {
      var target = event.target
      if (!target || !target.closest) return

      if (target.closest(SELECTORS.bannerClose)) {
        hideBanner(target.closest(SELECTORS.stepCard))
        return
      }

      var regen = target.closest(SELECTORS.regenerate)
      if (regen) {
        if (!regen.disabled) onRegenerate(regen.closest(SELECTORS.step))
        return
      }

      var tab = target.closest(SELECTORS.tabLink)
      if (tab) {
        event.preventDefault()
        activateTab(tab.closest(SELECTORS.tabsRoot), tab.getAttribute('data-sh-tab-link'))
        return
      }

      var toggle = target.closest(SELECTORS.stepToggle) || target.closest(SELECTORS.stepHeader)
      if (toggle) {
        // Selecting the header text to copy it also fires a click on
        // mouseup — that shouldn't collapse the touch.
        if (window.getSelection && String(window.getSelection()).length > 0) return
        collapseStep(toggle.closest(SELECTORS.step))
      }
    })

    // Regenerate needs feedback to work from, so it stays disabled
    // until the textarea has some.
    stepsHost.addEventListener('input', function (event) {
      var input = event.target && event.target.closest
        ? event.target.closest(SELECTORS.feedback)
        : null
      if (!input) return
      syncRegenerate(input.closest(SELECTORS.step))
    })

    citations.observe(stepsHost)
  }

  // Mint the ids ARIA needs on markup that gets cloned per touch and
  // per regenerated version — a hardcoded id would repeat across the
  // page and cross-wire the tab panels.
  function mintStepIds (scope) {
    var tabRoots = scope.querySelectorAll(SELECTORS.tabsRoot)
    for (var t = 0; t < tabRoots.length; t++) {
      var tabsRoot = tabRoots[t]
      if (tabsRoot.dataset.tabsWired === 'true') continue
      tabsRoot.dataset.tabsWired = 'true'

      var scopeId = ++uid
      var panels  = tabsRoot.querySelectorAll(SELECTORS.tabPanel)
      for (var p = 0; p < panels.length; p++) {
        panels[p].id = 'sh-tab-' + scopeId + '-' + panels[p].getAttribute('data-sh-tab-panel')
      }
      var links = tabsRoot.querySelectorAll(SELECTORS.tabLink)
      for (var l = 0; l < links.length; l++) {
        var name     = links[l].getAttribute('data-sh-tab-link')
        var anchorId = 'sh-tab-' + scopeId + '-' + name + '__link'
        links[l].id = anchorId
        links[l].setAttribute('aria-controls', 'sh-tab-' + scopeId + '-' + name)
        var panel = tabsRoot.querySelector('[data-sh-tab-panel="' + name + '"]')
        if (panel) panel.setAttribute('aria-labelledby', anchorId)
      }

      // Same for the feedback textarea's label association.
      var input = tabsRoot.querySelector(SELECTORS.feedback)
      var label = tabsRoot.querySelector(SELECTORS.feedbackLbl)
      if (input && label) {
        input.id = 'sh-step-feedback-' + scopeId
        label.setAttribute('for', input.id)
      }
    }
  }

  function activateTab (tabsRoot, name) {
    if (!tabsRoot || !name) return

    var items = tabsRoot.querySelectorAll(SELECTORS.tabItem)
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('slds-is-active', items[i].getAttribute('data-sh-tab-item') === name)
    }
    var links = tabsRoot.querySelectorAll(SELECTORS.tabLink)
    for (var l = 0; l < links.length; l++) {
      var match = links[l].getAttribute('data-sh-tab-link') === name
      links[l].setAttribute('aria-selected', match ? 'true' : 'false')
      links[l].setAttribute('tabindex', match ? '0' : '-1')
    }
    var panels = tabsRoot.querySelectorAll(SELECTORS.tabPanel)
    for (var p = 0; p < panels.length; p++) {
      var isActive = panels[p].getAttribute('data-sh-tab-panel') === name
      panels[p].classList.toggle('slds-show', isActive)
      panels[p].classList.toggle('slds-hide', !isActive)
    }
  }

  function collapseStep (step) {
    if (!step) return
    var collapsed = !step.classList.contains(COLLAPSED_CLASS)
    step.classList.toggle(COLLAPSED_CLASS, collapsed)

    // State lives on the icon button whichever trigger was clicked —
    // it's the control AT users actually reach.
    var btn = step.querySelector(SELECTORS.stepToggle)
    if (!btn) return
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    var label = btn.getAttribute('aria-label') || ''
    btn.setAttribute('aria-label', collapsed
      ? label.replace(/^Collapse/, 'Expand')
      : label.replace(/^Expand/, 'Collapse'))
    btn.setAttribute('title', collapsed ? 'Click to expand' : 'Click to collapse')
  }

  // ── Regenerate ──────────────────────────────────────────────────
  // Cycle the touch through its authored alternates and back to the
  // original. The versions are markup, not data: each alternate was
  // rendered into a <template> inside the article by the same macro
  // that rendered the visible card.
  function stepVersions (step) {
    if (step._versions) return step._versions
    var versions = []
    var card = step.querySelector(SELECTORS.stepCard)
    // Index 0 is the original, captured before anything mutates it.
    if (card) versions.push(card.cloneNode(true))
    var alts = step.querySelectorAll(SELECTORS.stepAlt)
    for (var a = 0; a < alts.length; a++) {
      var altCard = alts[a].content && alts[a].content.querySelector(SELECTORS.stepCard)
      if (altCard) versions.push(altCard.cloneNode(true))
    }
    step._versions = versions
    return versions
  }

  function onRegenerate (step) {
    if (!step) return
    var card  = step.querySelector(SELECTORS.stepCard)
    var draft = step.querySelector(SELECTORS.stepDraft)
    if (!card || !draft) return

    var versions = stepVersions(step)
    if (versions.length < 2) return

    var button = step.querySelector(SELECTORS.regenerate)
    var input  = step.querySelector(SELECTORS.feedback)

    // Pin the draft's height first: swapping real copy for the
    // stencil would otherwise collapse the card and yank the thread's
    // scroll position out from under the seller.
    draft.style.height = draft.offsetHeight + 'px'
    draft.classList.add(REGENERATING)
    showBanner(card, 'loading')

    if (button) {
      button.disabled = true
      button.setAttribute('aria-busy', 'true')
      button.textContent = 'Regenerating\u2026'
    }
    if (input) input.disabled = true

    setTimeout(function () {
      var next = (parseInt(step.getAttribute('data-sh-step-regen'), 10) || 0) + 1
      var replacement = versions[next % versions.length].cloneNode(true)

      step.setAttribute('data-sh-step-regen', String(next))
      card.parentNode.replaceChild(replacement, card)
      mintStepIds(step)
      showBanner(replacement, 'success')
      // Land on Details: the seller just asked for a change, so the
      // reasoning behind the new draft is what they want next.
      activateTab(replacement.querySelector(SELECTORS.tabsRoot), 'details')
    }, REGEN_MS)
  }

  function syncRegenerate (step) {
    if (!step) return
    var draft = step.querySelector(SELECTORS.stepDraft)
    // Mid-regen the button's state is owned by `onRegenerate`.
    if (draft && draft.classList.contains(REGENERATING)) return
    var input  = step.querySelector(SELECTORS.feedback)
    var button = step.querySelector(SELECTORS.regenerate)
    if (!input || !button) return
    button.disabled = !(input.value && input.value.trim().length)
  }

  function showBanner (card, mode) {
    if (!card) return
    var banner = card.querySelector(SELECTORS.banner)
    if (!banner) return
    var label = banner.querySelector(SELECTORS.bannerLabel)
    banner.classList.toggle(BANNER_SUCCESS, mode === 'success')
    if (label) label.textContent = mode === 'success' ? SUCCESS_LABEL : LOADING_LABEL
    banner.removeAttribute('hidden')
  }

  function hideBanner (card) {
    if (!card) return
    var banner = card.querySelector(SELECTORS.banner)
    if (!banner) return
    banner.setAttribute('hidden', '')
    banner.classList.remove(BANNER_SUCCESS)
  }

  // ──────────────────────────────────────────────────────────────
  // Citations
  // ──────────────────────────────────────────────────────────────
  // A hover card for the claim under the cursor: what it says, and
  // where it came from. One card per cadence card, moved to whichever
  // citation is hovered.
  //
  // Show and hide are both delayed. The show delay keeps the card
  // from strobing as the pointer crosses a sentence with several
  // citations; the hide delay lets the pointer travel into the card
  // itself without it vanishing en route.
  function createCitations (root, pop) {
    var showTimer, hideTimer
    var activeCard = null
    var anchor = null

    var els = pop ? {
      title:      pop.querySelector('[data-sh-cite-title]'),
      body:       pop.querySelector('[data-sh-cite-body]'),
      source:     pop.querySelector('[data-sh-cite-source]'),
      sourceIcon: pop.querySelector('[data-sh-cite-source-icon]'),
      sourceLbl:  pop.querySelector('[data-sh-cite-source-label]')
    } : null

    function show (card, hl) {
      if (!pop || !els) return
      if (els.title) els.title.textContent = hl.getAttribute('data-popover-title') || ''
      if (els.body)  els.body.textContent  = hl.getAttribute('data-popover-body') || ''

      var label = hl.getAttribute('data-source-label')
      var icon  = hl.getAttribute('data-source-icon')
      if (els.source) {
        if (label && icon) {
          if (els.sourceIcon) els.sourceIcon.setAttribute('src', icon)
          if (els.sourceLbl)  els.sourceLbl.textContent = label
          els.source.removeAttribute('hidden')
        } else {
          els.source.setAttribute('hidden', '')
        }
      }

      if (activeCard && activeCard !== card) activeCard.classList.remove(CITING_CLASS)
      activeCard = card
      card.classList.add(CITING_CLASS)

      anchor = hl
      pop.removeAttribute('hidden')
      positionCite()
    }

    function hide () {
      if (!pop) return
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
      pop.setAttribute('hidden', '')
      if (activeCard) activeCard.classList.remove(CITING_CLASS)
      activeCard = null
      anchor = null
    }

    function scheduleHide () {
      clearTimeout(hideTimer)
      hideTimer = setTimeout(hide, CITE_HIDE_MS)
    }

    // Beside the draft, level with the sentence — never over the copy
    // being explained. Falls to the draft's left when the right side
    // would run off screen, and clamps vertically so a citation near
    // the bottom of the thread doesn't push the card out of view.
    //
    // This is the piece hunter's version doesn't have: the thread
    // scrolls, so position has to be recomputed rather than set once.
    function positionCite () {
      if (!pop || !anchor || pop.hasAttribute('hidden')) return
      var draft = anchor.closest(SELECTORS.stepDraft)
      if (!draft) return

      var GAP    = 8
      var hlRect = anchor.getBoundingClientRect()
      var box    = draft.getBoundingClientRect()
      var popW   = pop.offsetWidth
      var popH   = pop.offsetHeight
      var maxX   = window.innerWidth - popW - GAP
      var maxY   = window.innerHeight - popH - GAP

      var left = box.right + GAP
      if (left > maxX) left = box.left - popW - GAP
      pop.style.left = Math.round(Math.max(GAP, Math.min(left, Math.max(GAP, maxX)))) + 'px'
      pop.style.top  = Math.round(Math.max(GAP, Math.min(hlRect.top, Math.max(GAP, maxY)))) + 'px'
    }

    function observe (stepsHost) {
      stepsHost.addEventListener('mouseover', function (event) {
        var target = event.target
        if (!target || !target.closest) return

        var card = target.closest(SELECTORS.stepCard)
        // First time the pointer reaches a card, pulse its citations
        // once — otherwise a dashed underline is easy to miss.
        if (card && !card.dataset.citeFlashed) {
          card.dataset.citeFlashed = 'true'
          card.classList.add(FLASHING_CLASS)
          setTimeout(function () { card.classList.remove(FLASHING_CLASS) }, 900)
        }

        var hl = target.closest(SELECTORS.citation)
        if (!hl || !card || hl === anchor) return
        clearTimeout(hideTimer)
        clearTimeout(showTimer)
        if (pop && !pop.hasAttribute('hidden')) show(card, hl)
        else showTimer = setTimeout(function () { show(card, hl) }, CITE_SHOW_MS)
      })

      stepsHost.addEventListener('mouseout', function (event) {
        var hl = event.target && event.target.closest
          ? event.target.closest(SELECTORS.citation)
          : null
        if (!hl) return
        if (hl.contains(event.relatedTarget)) return
        clearTimeout(showTimer)
        scheduleHide()
      })

      stepsHost.addEventListener('mouseleave', function () {
        clearTimeout(showTimer)
        scheduleHide()
      })
    }

    if (pop) {
      pop.addEventListener('mouseenter', function () { clearTimeout(hideTimer) })
      pop.addEventListener('mouseleave', scheduleHide)

      // Follow the anchor while the thread scrolls. Capture phase
      // because the thread scrolls, not the window, and `scroll`
      // doesn't bubble.
      window.addEventListener('scroll', positionCite, true)
      window.addEventListener('resize', positionCite)
    }

    return { observe: observe }
  }

  // Focus trap for the confirmation dialog. A local copy rather than
  // a shared import: this file and home_conversation.js are plain
  // scripts, and a dozen lines beats a cross-file global.
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

  window.ShCadence = { mount: mount }
}())
