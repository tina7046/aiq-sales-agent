'use strict'

/**
 * Approval queue interactions: expand a record, open an existing
 * record, and allow or reject a write. New records have no opener.
 * Decisions stay in the page. Nothing is sent anywhere.
 */
;(function () {
  var root = document.querySelector('[data-appr-root]')
  if (!root) return

  var dataEl = document.getElementById('appr-data')
  var data = { run: { steps: [] }, sections: [] }
  if (dataEl) data = JSON.parse(dataEl.textContent)

  var recordsById = {}
  ;(data.sections || []).forEach(function (section) {
    ;(section.groups || []).forEach(function (group) {
      ;(group.records || []).forEach(function (record) {
        record.object = group.object
        record.icon = group.icon
        record.action = group.action
        recordsById[record.id] = record
      })
    })
  })

  var STATUS = {
    allow: 'Allowed once',
    always: 'Allowed always',
    reject: 'Rejected'
  }

  var currentFilter = 'all'
  var toastTimer = null
  var drawerMode = null
  var currentId = null
  var history = []
  var lastFocus = null

  var drawer = root.querySelector('[data-appr-drawer]')
  var drawerPanel = drawer.querySelector('.appr-drawer__panel')
  var drawerKicker = drawer.querySelector('[data-appr-drawer-kicker]')
  var drawerTitle = drawer.querySelector('[data-appr-drawer-title]')
  var drawerBody = drawer.querySelector('[data-appr-drawer-body]')
  var drawerFooter = drawer.querySelector('[data-appr-drawer-footer]')
  var drawerBack = drawer.querySelector('[data-appr-drawer-back]')

  function esc (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function linkHtml (text, recordId, href) {
    var safe = esc(text)
    if (!safe) return '<span class="appr-empty">Empty</span>'
    if (recordId && recordsById[recordId]) {
      return '<button type="button" class="appr-link" data-appr-open="' + esc(recordId) + '">' + safe + '</button>'
    }
    if (href) {
      return '<a class="appr-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + safe + '</a>'
    }
    return safe
  }

  function toast (message) {
    var el = root.querySelector('[data-appr-toast]')
    el.textContent = message
    el.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () {
      el.hidden = true
    }, 2400)
  }

  function fitClamps (scope) {
    if (!scope) return
    var nodes = scope.querySelectorAll('[data-appr-clamp]')
    Array.prototype.forEach.call(nodes, function (el) {
      var btn = el.parentElement.querySelector('[data-appr-clamp-toggle]')
      if (!btn) return
      if (el.classList.contains('is-open')) {
        btn.hidden = false
        return
      }
      btn.hidden = el.scrollHeight <= el.clientHeight + 1
    })
  }

  function setOpen (record, open) {
    record.classList.toggle('is-open', open)
    var detail = record.querySelector('[data-appr-detail]')
    var btn = record.querySelector('[data-appr-toggle]')
    detail.hidden = !open
    btn.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (open) fitClamps(detail)
  }

  function updateGroupCounts () {
    var groups = root.querySelectorAll('[data-appr-group]')
    Array.prototype.forEach.call(groups, function (group) {
      var waiting = group.querySelectorAll('[data-appr-record][data-decision=""]').length
      var node = group.querySelector('[data-appr-group-waiting]')
      if (node) node.textContent = waiting + ' waiting'
    })
  }

  function setGroupOpen (group, open) {
    group.classList.toggle('is-open', open)
    var body = group.querySelector('[data-appr-group-body]')
    var btn = group.querySelector('[data-appr-group-toggle]')
    body.hidden = !open
    btn.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (!open) return
    var details = group.querySelectorAll('.appr-record.is-open [data-appr-detail]')
    Array.prototype.forEach.call(details, fitClamps)
  }

  function refreshCounts () {
    var records = root.querySelectorAll('[data-appr-record]')
    var counts = { all: records.length, waiting: 0, allowed: 0, rejected: 0 }
    Array.prototype.forEach.call(records, function (el) {
      var decision = el.getAttribute('data-decision') || ''
      if (!decision) counts.waiting += 1
      else if (decision === 'reject') counts.rejected += 1
      else counts.allowed += 1
    })
    Object.keys(counts).forEach(function (key) {
      var node = root.querySelector('[data-appr-count="' + key + '"]')
      if (node) node.textContent = String(counts[key])
    })
    var waitingNode = root.querySelector('[data-appr-waiting]')
    if (waitingNode) waitingNode.textContent = String(counts.waiting)
    var done = root.querySelector('[data-appr-done]')
    if (done) done.hidden = counts.waiting !== 0
  }

  function applyFilter () {
    var records = root.querySelectorAll('[data-appr-record]')
    Array.prototype.forEach.call(records, function (el) {
      var decision = el.getAttribute('data-decision') || ''
      var show = currentFilter === 'all' ||
        (currentFilter === 'waiting' && decision === '') ||
        (currentFilter === 'allowed' && (decision === 'allow' || decision === 'always')) ||
        (currentFilter === 'rejected' && decision === 'reject')
      el.hidden = !show
    })
    var groups = root.querySelectorAll('[data-appr-group]')
    Array.prototype.forEach.call(groups, function (group) {
      group.hidden = !group.querySelector('[data-appr-record]:not([hidden])')
    })
    var sections = root.querySelectorAll('[data-appr-section]')
    Array.prototype.forEach.call(sections, function (section) {
      var visible = section.querySelector('[data-appr-group]:not([hidden])')
      var empty = section.querySelector('[data-appr-section-empty]')
      if (empty) empty.hidden = !!visible
    })
  }

  function setFilter (next) {
    currentFilter = next
    var buttons = root.querySelectorAll('[data-appr-filter]')
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-appr-filter') === next ? 'true' : 'false')
    })
    applyFilter()
  }

  function showBanner (group, text) {
    var banner = group.querySelector('[data-appr-banner]')
    banner.textContent = text
    banner.hidden = false
  }

  function syncBanner (group) {
    var any = group.querySelector('[data-appr-record][data-decision="always"]')
    if (!any) group.querySelector('[data-appr-banner]').hidden = true
  }

  function renderDrawerFooter () {
    if (drawerMode !== 'record' || !currentId) {
      drawerFooter.hidden = true
      drawerFooter.innerHTML = ''
      return
    }
    var row = root.querySelector('[data-appr-record][data-record-id="' + currentId + '"]')
    var decision = row ? (row.getAttribute('data-decision') || '') : ''
    drawerFooter.hidden = false
    if (!decision) {
      drawerFooter.innerHTML =
        '<button type="button" class="appr-btn appr-btn--brand" data-appr-drawer-decide="always">Allow always</button>' +
        '<button type="button" class="appr-btn appr-btn--outline" data-appr-drawer-decide="allow">Allow once</button>' +
        '<button type="button" class="appr-btn appr-btn--reject" data-appr-drawer-decide="reject">Reject</button>'
      return
    }
    drawerFooter.innerHTML =
      '<span class="appr-status appr-status--' + esc(decision) + '">' + esc(STATUS[decision] || '') + '</span>' +
      '<button type="button" class="appr-btn appr-btn--quiet" data-appr-drawer-undo>Undo</button>'
  }

  function renderRecordBody (record) {
    var fields = record.preview || []
    var changing = (record.changes || []).map(function (change) { return change.field })
    var html = '<p class="appr-drawer__note">This is the record today, before Hunter writes.'
    if (changing.length) html += ' Will change: ' + esc(changing.join(', ')) + '.'
    html += '</p>'
    fields.forEach(function (field) {
      html += '<div class="appr-drawer__field' + (field.changing ? ' is-changing' : '') + '">'
      html += '<div class="appr-drawer__label">' + esc(field.label)
      if (field.changing) html += '<span class="appr-pill">Will change</span>'
      html += '</div><div>' + linkHtml(field.text, field.recordId, field.href) + '</div></div>'
    })
    return html
  }

  function renderRunBody () {
    var steps = (data.run && data.run.steps) || []
    var html = '<ol class="appr-steps">'
    steps.forEach(function (step) {
      html += '<li><h3>' + esc(step.title) + '</h3><p>' + esc(step.body) + '</p></li>'
    })
    html += '</ol>'
    return html
  }

  function paintDrawer () {
    drawerBack.hidden = history.length === 0
    if (drawerMode === 'run') {
      drawerKicker.textContent = 'Hunter'
      drawerTitle.textContent = data.run.title || 'This run'
      drawerBody.innerHTML = renderRunBody()
      drawerFooter.hidden = true
      drawerFooter.innerHTML = ''
      return
    }
    var record = recordsById[currentId]
    if (!record) return
    drawerKicker.textContent = record.object + ' · in Salesforce today'
    drawerTitle.textContent = record.name
    drawerBody.innerHTML = renderRecordBody(record)
    renderDrawerFooter()
  }

  function openDrawer () {
    if (!drawer.hidden) {
      paintDrawer()
      return
    }
    lastFocus = document.activeElement
    drawer.hidden = false
    document.body.classList.add('appr-lock')
    paintDrawer()
    drawerPanel.focus()
  }

  function closeDrawer () {
    drawer.hidden = true
    drawerMode = null
    currentId = null
    history = []
    document.body.classList.remove('appr-lock')
    if (lastFocus && lastFocus.focus) lastFocus.focus()
  }

  function openRecord (id, keepStack) {
    if (!recordsById[id] || recordsById[id].openable === false) return
    if (keepStack && currentId) history.push(currentId)
    if (!keepStack) history = []
    currentId = id
    drawerMode = 'record'
    openDrawer()
  }

  function openRun () {
    history = []
    currentId = null
    drawerMode = 'run'
    openDrawer()
  }

  function setDecision (record, decision) {
    record.setAttribute('data-decision', decision || '')
    var buttons = record.querySelector('[data-appr-buttons]')
    var status = record.querySelector('[data-appr-status]')
    var label = record.querySelector('[data-appr-status-label]')
    buttons.hidden = !!decision
    status.hidden = !decision
    if (label) {
      label.textContent = STATUS[decision] || ''
      label.className = 'appr-status' + (decision ? ' appr-status--' + decision : '')
    }
    refreshCounts()
    updateGroupCounts()
    applyFilter()
    if (drawerMode === 'record' && currentId === record.getAttribute('data-record-id')) {
      renderDrawerFooter()
    }
  }

  function decide (record, decision) {
    setDecision(record, decision)
    var name = record.getAttribute('data-name')
    var group = record.closest('[data-appr-group]')
    if (decision === 'allow') toast('Allowed ' + name + ' once')
    if (decision === 'reject') toast('Rejected ' + name)
    if (decision === 'always') {
      toast('Allowed ' + name + '. Allow always is on.')
      showBanner(group, 'Allow always is on for ' + group.getAttribute('data-noun-plural') + ' in this run. Anything still waiting stays in the list.')
    }
    if (!decision) {
      toast('Undid the decision on ' + name)
      syncBanner(group)
    }
  }

  function decideGroup (group, decision) {
    var pending = group.querySelectorAll('[data-appr-record][data-decision=""]')
    if (!pending.length) {
      toast('Nothing left waiting in ' + group.getAttribute('data-object'))
      return
    }
    var n = pending.length
    Array.prototype.forEach.call(pending, function (record) {
      setDecision(record, decision)
    })
    var noun = n === 1 ? group.getAttribute('data-noun') : group.getAttribute('data-noun-plural')
    if (decision === 'always') {
      showBanner(group, 'Allowed ' + n + ' ' + noun + '. Allow always is on for ' + group.getAttribute('data-noun-plural') + ' in this run.')
      toast('Allowed ' + n + ' ' + noun)
    } else if (decision === 'allow') {
      toast('Allowed ' + n + ' ' + noun + ' once')
    } else {
      toast('Rejected ' + n + ' ' + noun)
    }
  }

  root.addEventListener('click', function (event) {
    var filterBtn = event.target.closest('[data-appr-filter]')
    if (filterBtn) {
      setFilter(filterBtn.getAttribute('data-appr-filter'))
      return
    }

    var groupToggle = event.target.closest('[data-appr-group-toggle]')
    if (groupToggle) {
      var toggled = groupToggle.closest('[data-appr-group]')
      setGroupOpen(toggled, groupToggle.getAttribute('aria-expanded') !== 'true')
      return
    }

    var groupDecide = event.target.closest('[data-appr-group-decide]')
    if (groupDecide) {
      decideGroup(groupDecide.closest('[data-appr-group]'), groupDecide.getAttribute('data-appr-group-decide'))
      return
    }

    var decideBtn = event.target.closest('[data-appr-decide]')
    if (decideBtn) {
      decide(decideBtn.closest('[data-appr-record]'), decideBtn.getAttribute('data-appr-decide'))
      return
    }

    var undoBtn = event.target.closest('[data-appr-undo]')
    if (undoBtn) {
      decide(undoBtn.closest('[data-appr-record]'), '')
      return
    }

    var clampBtn = event.target.closest('[data-appr-clamp-toggle]')
    if (clampBtn) {
      var clamp = clampBtn.parentElement.querySelector('[data-appr-clamp]')
      var opened = clamp.classList.toggle('is-open')
      clampBtn.textContent = opened ? 'Show less' : 'Show more'
      return
    }

    var toggleBtn = event.target.closest('[data-appr-toggle]')
    if (toggleBtn) {
      setOpen(toggleBtn.closest('[data-appr-record]'), toggleBtn.getAttribute('aria-expanded') !== 'true')
      return
    }

    if (event.target.closest('[data-appr-view-run]')) {
      openRun()
      return
    }

    var opener = event.target.closest('[data-appr-open]')
    if (opener) {
      openRecord(opener.getAttribute('data-appr-open'), !!opener.closest('[data-appr-drawer]'))
      return
    }

    if (event.target.closest('a, button, input, textarea, [data-appr-actions]')) return

    var record = event.target.closest('[data-appr-record]')
    if (record && root.contains(record)) setOpen(record, !record.classList.contains('is-open'))
  })

  drawer.addEventListener('click', function (event) {
    if (event.target.closest('[data-appr-drawer-close]')) {
      closeDrawer()
      return
    }
    if (event.target.closest('[data-appr-drawer-back]')) {
      currentId = history.pop()
      drawerMode = 'record'
      paintDrawer()
      return
    }
    var drawerDecide = event.target.closest('[data-appr-drawer-decide]')
    if (drawerDecide) {
      var row = root.querySelector('[data-appr-record][data-record-id="' + currentId + '"]')
      if (row) decide(row, drawerDecide.getAttribute('data-appr-drawer-decide'))
      return
    }
    if (event.target.closest('[data-appr-drawer-undo]')) {
      var undoRow = root.querySelector('[data-appr-record][data-record-id="' + currentId + '"]')
      if (undoRow) decide(undoRow, '')
    }
  })

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return
    if (!drawer.hidden) closeDrawer()
  })

  function measureOpen () {
    var openDetails = root.querySelectorAll('.appr-record.is-open [data-appr-detail]')
    Array.prototype.forEach.call(openDetails, fitClamps)
  }

  window.addEventListener('resize', measureOpen)
  window.requestAnimationFrame(measureOpen)
  window.addEventListener('load', measureOpen)
})()
