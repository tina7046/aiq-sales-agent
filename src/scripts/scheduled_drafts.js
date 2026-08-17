// ──────────────────────────────────────────────────────────────────────
// Scheduled page — rows for schedules confirmed in a conversation
// =====================================================================
// The workflow list on /scheduled.html is server-rendered from
// scheduled.json, which is a build-time asset. A schedule the seller
// sets up in the Schedule flow is created at runtime, so it has nowhere
// to live in that file without a server round-trip.
//
// This script reads the records `confirmSchedule` in
// schedule_conversation.js writes to localStorage and prepends one row
// per record above the authored ones, then re-counts the tab pills so
// the numbers match what's in the list.
//
// Rows are built here rather than cloned from a hidden template because
// the list's markup is a Nunjucks macro
// (`renderScheduledWorkflowRow` in _scheduled_workflow_list.html) —
// this is the JS mirror of it, the same arrangement `renderRecents` in
// home.js has with the nav's recent-row markup. Keep the two in step.
// The one exception is the overflow menu, whose items are authored data
// (`rowActions`): that subtree is cloned off a row already in the list
// so the actions don't get a second definition here.
//
// Runs at parse time rather than on DOMContentLoaded, and is loaded
// AHEAD of home.js: `bindScheduled` caches the row list and applies the
// active tab's filter when it binds, so rows spliced in first are
// filtered, announced, and menu-wired for free.
// ──────────────────────────────────────────────────────────────────────

(function () {
  'use strict'

  // Status registry — the client-side half of `statusTypes` in
  // scheduled.json, carrying only what a row paints: the dot's color
  // modifier and the label AT reads. The two dot statuses are here
  // because they're the two a confirmed schedule can land on; `paused`
  // is left out deliberately, since it renders a play glyph instead of
  // a dot and nothing in the Schedule flow can pause a schedule yet.
  var STATUS_TYPES = {
    needs_approval: { label: 'Needs approval', dot: 'yellow' },
    scheduled:      { label: 'Scheduled',      dot: 'green'  }
  }

  // A confirmed record's `status` is the scheduling module's own
  // vocabulary ('active'), which predates this page's three-state one.
  // Anything unrecognised lands on `scheduled` so a row always renders
  // rather than being dropped for a status this page can't paint.
  var STATUS_ALIASES = { active: 'scheduled' }
  var STATUS_FALLBACK = 'scheduled'

  var LIST_SELECTOR = '[data-sh-scheduled-workflow-list]'

  function resolveStatus (status) {
    var key = String(status || '')
    if (STATUS_ALIASES[key]) key = STATUS_ALIASES[key]
    return STATUS_TYPES[key] ? key : STATUS_FALLBACK
  }

  // The confirmed schedules, newest last (the store appends). Returns
  // an empty list when schedule_conversation.js isn't on the page,
  // which is every surface but this one and the conversation.
  function readRecords () {
    var api = window.SellerHomeScheduling
    if (!api || typeof api.readScheduledWorkflows !== 'function') return []
    var list = api.readScheduledWorkflows()
    return Object.prototype.toString.call(list) === '[object Array]' ? list : []
  }

  function existingIds (listEl) {
    var out = {}
    var rows = listEl.querySelectorAll('[data-sh-workflow-id]')
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].getAttribute('data-sh-workflow-id')
      if (id) out[id] = true
    }
    return out
  }

  // The ⋮ menu, lifted off whichever row the page already rendered.
  // Ids and the trigger's label are per-row, so they're rewritten on
  // the copy; everything else — the actions and their icons — comes
  // through as authored. Returns null on an empty list, and the row
  // renders without a menu rather than with a broken one.
  function cloneMenu (listEl, workflowId, title) {
    var donor = listEl.querySelector('[data-sh-workflow-menu]')
    if (!donor) return null
    var menu = donor.cloneNode(true)

    var menuId = 'workflow-' + workflowId + '-menu'
    var list = menu.querySelector('[data-sh-workflow-menu-list]')
    if (list) {
      list.id = menuId
      // The donor may have been open when it was copied.
      list.hidden = true
    }
    var trigger = menu.querySelector('[data-sh-workflow-menu-trigger]')
    if (trigger) {
      trigger.setAttribute('aria-controls', menuId)
      trigger.setAttribute('aria-expanded', 'false')
      trigger.setAttribute('aria-label', 'More actions for ' + title)
    }
    return menu
  }

  function buildRow (listEl, record) {
    var statusKey  = resolveStatus(record.status)
    var statusMeta = STATUS_TYPES[statusKey]
    var title      = record.title || 'Scheduled skill'
    var cadence    = record.cadence || ''

    var item = document.createElement('li')
    item.className = 'seller-home__scheduled-workflow-item'
    item.setAttribute('data-sh-workflow-item', '')
    item.setAttribute('data-sh-workflow-id', record.id)
    item.setAttribute('data-sh-workflow-status', statusKey)

    // Authored rows are inert because the workflow-detail view doesn't
    // exist yet. A confirmed schedule has somewhere real to go, though
    // — the conversation that set it up — so it renders as a link when
    // it carries one. The label says where it goes rather than
    // borrowing the macro's "Open workflow", which would promise a
    // detail page.
    var href = record.conversationId
      ? '/home_conversation.html?id=' + encodeURIComponent(record.conversationId)
      : ''
    var body

    if (href) {
      body = document.createElement('a')
      body.className = 'seller-home__scheduled-workflow-row'
      body.href = href
      body.setAttribute('data-sh-workflow-open', '')
      body.setAttribute(
        'aria-label',
        'Open the conversation that scheduled ' + title + ', ' + statusMeta.label
      )
    } else {
      body = document.createElement('div')
      body.className = 'seller-home__scheduled-workflow-row ' +
        'seller-home__scheduled-workflow-row--unlinked'
    }
    body.title = title

    // Status dot. `aria-hidden` because the status reaches AT through
    // the row's label — on the linked branch that's the `aria-label`
    // above, on the unlinked one the assistive span below.
    var dot = document.createElement('span')
    dot.className = 'seller-home__scheduled-status ' +
      'seller-home__scheduled-status--dot ' +
      'seller-home__scheduled-status--' + statusMeta.dot
    dot.setAttribute('aria-hidden', 'true')
    body.appendChild(dot)

    var bodyText = document.createElement('span')
    bodyText.className = 'seller-home__scheduled-workflow-body'

    var titleEl = document.createElement('span')
    titleEl.className = 'seller-home__scheduled-workflow-title'
    // textContent throughout: a title carries a skill name, which is
    // authored today but reaches this store through a conversation.
    titleEl.textContent = title
    bodyText.appendChild(titleEl)

    if (cadence) {
      var metaEl = document.createElement('span')
      metaEl.className = 'seller-home__scheduled-workflow-meta'
      metaEl.textContent = cadence
      bodyText.appendChild(metaEl)
    }

    if (!href) {
      var srStatus = document.createElement('span')
      srStatus.className = 'slds-assistive-text'
      srStatus.textContent = 'Status: ' + statusMeta.label
      bodyText.appendChild(srStatus)
    }

    body.appendChild(bodyText)
    item.appendChild(body)

    var menu = cloneMenu(listEl, record.id, title)
    if (menu) item.appendChild(menu)

    return item
  }

  // Re-count the tab pills from the rows now in the list. The counts
  // are rendered server-side from scheduled.json and nothing else
  // updates them, so without this a confirmed schedule would show in
  // the list while the tab above it still reported the authored total.
  function refreshTabCounts (root) {
    var tabs = root.querySelectorAll('[data-sh-scheduled-tab]')
    var rows = root.querySelectorAll('[data-sh-workflow-item]')
    if (!tabs.length) return

    for (var t = 0; t < tabs.length; t++) {
      var raw = tabs[t].getAttribute('data-sh-scheduled-tab-statuses') || ''
      var wanted = {}
      var any = true
      var parts = raw.split(',')
      for (var p = 0; p < parts.length; p++) {
        var name = parts[p].replace(/^\s+|\s+$/g, '')
        if (!name) continue
        wanted[name] = true
        // An empty statuses list is this page's "match everything".
        any = false
      }

      var count = 0
      for (var r = 0; r < rows.length; r++) {
        var status = rows[r].getAttribute('data-sh-workflow-status') || ''
        if (any || wanted[status]) count++
      }

      var pill = tabs[t].querySelector('[data-sh-scheduled-tab-count]')
      if (pill) pill.textContent = String(count)
      // The pill is decorative (`aria-hidden`); this is the copy AT
      // actually reads, so it has to move with it.
      var sr = tabs[t].querySelector('.slds-assistive-text')
      if (sr) sr.textContent = count + ' workflow' + (count === 1 ? '' : 's')
    }
  }

  function splice () {
    var root = document.querySelector('[data-sh-scheduled-root]')
    if (!root) return
    var listEl = root.querySelector(LIST_SELECTOR)
    if (!listEl) return

    var records = readRecords()
    if (!records.length) return

    // Ids already on the page — an authored row, or one this script
    // spliced on an earlier pass — so a re-run can't double a schedule.
    var seen = existingIds(listEl)
    var frag = document.createDocumentFragment()
    // Newest first, so the schedule the seller just confirmed is the
    // row at the top of the list they land on.
    for (var i = records.length - 1; i >= 0; i--) {
      var record = records[i]
      if (!record || !record.id) continue
      if (seen[record.id]) continue
      seen[record.id] = true
      frag.appendChild(buildRow(listEl, record))
    }

    if (frag.childNodes.length) {
      listEl.insertBefore(frag, listEl.firstChild)
      refreshTabCounts(root)
    }
  }

  splice()
}())
