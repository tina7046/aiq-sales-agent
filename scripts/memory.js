'use strict'

/**
 * Grain-agnostic contribution calendar.
 * Buckets are { start, value, label } at whatever grain the config asks
 * for (day | week | month). The grid is generated; it is never a hidden
 * 7-row day sheet.
 */
;(function () {
  var TIMEFRAMES = {
    '90d': { days: 90 },
    '12w': { days: 84 },
    '12m': { months: 12 },
    year: { days: 365 }
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  var WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']

  function parseDim(value) {
    if (value == null || value === '' || value === 'auto') return null
    var n = Number(value)
    if (!isFinite(n) || n < 1) return null
    return Math.floor(n)
  }

  var root = document.querySelector('[data-cal]')
  if (!root) return

  var fixture = window.MEMORY_CAL || {}
  var state = {
    grain: fixture.grain || 'day',
    timeframe: fixture.timeframe || 'year',
    cellSize: Number(fixture.cellSize) || 12,
    palette: fixture.palette || 'green',
    cols: parseDim(fixture.cols),
    rows: parseDim(fixture.rows),
    selectedStart: null
  }

  var grid = root.querySelector('[data-cal-grid]')
  var axisX = root.querySelector('[data-cal-axis-x]')
  var axisY = root.querySelector('[data-cal-axis-y]')
  var legend = root.querySelector('[data-cal-legend]')
  var tip = document.getElementById('cal-tip')
  var hideTimer = 0
  var activeCell = null

  function iso(date) {
    var y = date.getFullYear()
    var m = String(date.getMonth() + 1).padStart(2, '0')
    var d = String(date.getDate()).padStart(2, '0')
    return y + '-' + m + '-' + d
  }

  function parseIso(value) {
    var parts = String(value).split('-')
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  function startOfWeek(date) {
    var day = startOfDay(date)
    day.setDate(day.getDate() - day.getDay())
    return day
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1)
  }

  function addDays(date, n) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    next.setDate(next.getDate() + n)
    return next
  }

  function monthShort(value) {
    return MONTHS[parseIso(value).getMonth()]
  }

  var sources = Array.isArray(window.MEMORY_SOURCES) ? window.MEMORY_SOURCES : []

  function sourceDates () {
    var dates = []
    var i
    for (i = 0; i < sources.length; i++) {
      if (sources[i] && sources[i].learnedOn) dates.push(String(sources[i].learnedOn))
    }
    return dates
  }

  function countSourcesBetween (startIso, endIso) {
    var dates = sourceDates()
    var n = 0
    var i
    for (i = 0; i < dates.length; i++) {
      if (dates[i] >= startIso && dates[i] <= endIso) n++
    }
    return n
  }

  function bucketValue (startDate, endDate) {
    var startIso = iso(startDate)
    if (!sources.length) return synthValue(startIso)
    return countSourcesBetween(startIso, iso(endDate))
  }

  function hashIso(value) {
    var h = 2166136261
    for (var i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }

  function synthValue(start) {
    var n = hashIso(start)
    if (n % 5 === 0) return 0
    return n % 16
  }

  function levelFromValue(value) {
    if (value == null || value <= 0) return 0
    if (value <= 3) return 1
    if (value <= 6) return 2
    if (value <= 10) return 3
    return 4
  }

  function formatDayLabel(date, value) {
    var pretty = date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    })
    if (!value) return 'Nothing added'
    return value + ' added on ' + pretty
  }

  function formatWeekLabel(start, end, value) {
    var a = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    var b = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    if (!value) return 'Nothing added'
    return value + ' added in the week of ' + a + '–' + b
  }

  function formatMonthLabel(date, value) {
    var pretty = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (!value) return 'Nothing added'
    return value + ' added in ' + pretty
  }

  function rangeStart(end, timeframe) {
    var spec = TIMEFRAMES[timeframe] || TIMEFRAMES.year
    if (spec.months) {
      return new Date(end.getFullYear(), end.getMonth() - spec.months + 1, 1)
    }
    return addDays(end, -(spec.days - 1))
  }

  function buildBuckets(config) {
    var grain = config.grain
    var end = startOfDay(new Date())
    var start = rangeStart(end, config.timeframe)
    var buckets = []
    var cursor

    if (grain === 'week') {
      cursor = startOfWeek(start)
      var lastWeek = startOfWeek(end)
      while (cursor <= lastWeek) {
        var weekEnd = addDays(cursor, 6)
        var startIso = iso(cursor)
        var value = bucketValue(cursor, weekEnd)
        buckets.push({
          start: startIso,
          value: value,
          label: formatWeekLabel(cursor, weekEnd, value)
        })
        cursor = addDays(cursor, 7)
      }
      return buckets
    }

    if (grain === 'month') {
      cursor = startOfMonth(start)
      var lastMonth = startOfMonth(end)
      while (cursor <= lastMonth) {
        var monthIso = iso(cursor)
        var monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
        var monthValue = bucketValue(cursor, monthEnd)
        buckets.push({
          start: monthIso,
          value: monthValue,
          label: formatMonthLabel(cursor, monthValue)
        })
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      }
      return buckets
    }

    var alignWeeks = weekdayHeatmap(config)
    cursor = alignWeeks ? startOfWeek(start) : start
    var lastDay = alignWeeks ? addDays(startOfWeek(end), 6) : end
    while (cursor <= lastDay) {
      var dayIso = iso(cursor)
      var inRange = cursor >= start && cursor <= end
      var dayValue = inRange ? bucketValue(cursor, cursor) : null
      buckets.push({
        start: dayIso,
        value: dayValue,
        label: inRange ? formatDayLabel(cursor, dayValue) : '',
        empty: !inRange
      })
      cursor = addDays(cursor, 1)
    }
    return buckets
  }

  function normalizeBuckets(list) {
    return (list || []).map(function (raw) {
      var start = raw.start
      var value = raw.value == null ? 0 : Number(raw.value)
      return {
        start: start,
        value: value,
        label: raw.label || start,
        empty: Boolean(raw.empty)
      }
    })
  }

  function resolveBuckets(config) {
    var fixtureBuckets = fixture.buckets
    var sameGrain = fixture.grain === config.grain
    var sameFrame = fixture.timeframe === config.timeframe
    if (Array.isArray(fixtureBuckets) && fixtureBuckets.length && sameGrain && sameFrame) {
      return normalizeBuckets(fixtureBuckets)
    }
    return buildBuckets(config)
  }

  // Pad-to-week empty cells belong only on the 7-row weekday heatmap.
  // A column-wrap board would let a trailing empty day spill onto a new
  // blank row and count that row in the grid height.
  function weekdayHeatmap(config) {
    if (config.grain !== 'day') return false
    if (parseDim(config.cols)) return false
    var rows = parseDim(config.rows)
    return !rows || rows === 7
  }

  function dropEmptyTrailingRows(buckets, cols) {
    if (!cols || !buckets.length) return buckets
    var next = buckets.slice()
    while (next.length) {
      var rowStart = Math.floor((next.length - 1) / cols) * cols
      var allEmpty = true
      var i
      for (i = rowStart; i < next.length; i++) {
        if (next[i] && !next[i].empty && next[i].start) {
          allEmpty = false
          break
        }
      }
      if (!allEmpty) break
      next = next.slice(0, rowStart)
    }
    return next
  }

  function resolveLayout(config, bucketCount) {
    var cols = parseDim(config.cols)
    var rows = parseDim(config.rows)
    var count = Math.max(bucketCount, 1)

    if (cols && rows) {
      return {
        cols: cols,
        rows: rows,
        flow: 'row',
        weekdays: false,
        fixed: true
      }
    }
    if (cols) {
      return {
        cols: cols,
        rows: Math.ceil(count / cols),
        flow: 'row',
        weekdays: false,
        fixed: false
      }
    }
    if (rows) {
      return {
        cols: Math.ceil(count / rows),
        rows: rows,
        flow: 'column',
        weekdays: config.grain === 'day' && rows === 7,
        fixed: false
      }
    }
    if (config.grain === 'day') {
      return {
        cols: Math.ceil(count / 7),
        rows: 7,
        flow: 'column',
        weekdays: true,
        fixed: false
      }
    }
    return {
      cols: count,
      rows: 1,
      flow: 'column',
      weekdays: false,
      fixed: false
    }
  }

  function fitBuckets(buckets, layout) {
    if (!layout.fixed) return buckets
    var slots = layout.cols * layout.rows
    var fitted = buckets.length > slots
      ? buckets.slice(buckets.length - slots)
      : buckets.slice()
    while (fitted.length < slots) {
      fitted.push({ start: '', value: null, label: '', empty: true })
    }
    return fitted
  }

  function axisLabels(buckets, layout) {
    var labels = []
    var prev = ''
    var cols = layout.cols
    var rows = layout.rows
    var col

    function monthAtColumn(index) {
      var firstOfMonth = null
      var firstReal = null
      var r
      var bucket
      if (layout.flow === 'row') {
        for (r = 0; r * cols + index < buckets.length; r++) {
          bucket = buckets[r * cols + index]
          if (!bucket || bucket.empty || !bucket.start) continue
          if (!firstReal) firstReal = bucket
          if (parseIso(bucket.start).getDate() === 1) {
            firstOfMonth = bucket
            break
          }
        }
      } else {
        var slice = buckets.slice(index * rows, index * rows + rows)
        for (r = 0; r < slice.length; r++) {
          bucket = slice[r]
          if (!bucket || bucket.empty || !bucket.start) continue
          if (!firstReal) firstReal = bucket
          if (parseIso(bucket.start).getDate() === 1) {
            firstOfMonth = bucket
            break
          }
        }
      }
      var source = firstOfMonth || (index === 0 ? firstReal : null)
      if (!source) return
      var month = monthShort(source.start)
      if (!month || month === prev) return
      labels.push({ label: month, index: index })
      prev = month
    }

    for (col = 0; col < cols; col++) monthAtColumn(col)
    return labels
  }

  function hideTip() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = 0
    }
    activeCell = null
    if (tip && tip.matches && tip.matches(':popover-open')) {
      try { tip.hidePopover() } catch (err) { /* closed */ }
    }
  }

  function placeTip(cell) {
    if (!tip) return
    var anchor = cell.getBoundingClientRect()
    var box = tip.getBoundingClientRect()
    var top = anchor.top - box.height - 8
    var left = anchor.left + (anchor.width - box.width) / 2
    if (top < 8) top = anchor.bottom + 8
    left = Math.max(8, Math.min(left, document.documentElement.clientWidth - box.width - 8))
    tip.style.setProperty('--cal-tip-top', top + 'px')
    tip.style.setProperty('--cal-tip-left', left + 'px')
  }

  function showTip(cell) {
    if (!tip || cell.classList.contains('is-empty')) return
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = 0
    }
    activeCell = cell
    tip.textContent = cell.getAttribute('aria-label') || ''
    if (!tip.matches(':popover-open')) {
      try { tip.showPopover() } catch (err) { /* unsupported */ }
    }
    placeTip(cell)
    requestAnimationFrame(function () {
      if (activeCell === cell) placeTip(cell)
    })
  }

  function scheduleHide(next) {
    if (next && (grid.contains(next) && next.closest('.cal-cell') === activeCell)) return
    if (next === tip) return
    hideTimer = setTimeout(hideTip, 80)
  }

  function renderAxisX(buckets, layout) {
    if (!axisX) return
    var hideMonths = state.timeframe === '90d'
    axisX.hidden = hideMonths
    if (hideMonths) {
      axisX.replaceChildren()
      return
    }
    axisX.style.gridTemplateColumns = 'repeat(' + Math.max(layout.cols, 1) + ', var(--cal-cell-size))'
    axisX.replaceChildren()
    axisLabels(buckets, layout).forEach(function (item) {
      var el = document.createElement('span')
      el.textContent = item.label
      el.style.gridColumn = String(item.index + 1)
      axisX.appendChild(el)
    })
  }

  function renderAxisY(layout) {
    if (!axisY) return
    axisY.hidden = !layout.weekdays
    if (!layout.weekdays) {
      axisY.replaceChildren()
      return
    }
    axisY.replaceChildren()
    WEEKDAY_LABELS.forEach(function (label) {
      var el = document.createElement('span')
      el.textContent = label
      axisY.appendChild(el)
    })
  }

  function renderGrid(buckets) {
    if (!grid) return
    var frag = document.createDocumentFragment()
    buckets.forEach(function (bucket) {
      var level = bucket.empty ? 0 : levelFromValue(bucket.value)
      var el
      if (bucket.empty) {
        el = document.createElement('span')
        el.className = 'cal-cell is-empty'
        el.setAttribute('aria-hidden', 'true')
      } else {
        el = document.createElement('button')
        el.type = 'button'
        el.className = 'cal-cell'
        el.setAttribute('data-level', String(level))
        el.setAttribute('data-start', bucket.start)
        el.setAttribute('aria-label', bucket.label)
      }
      frag.appendChild(el)
    })
    grid.replaceChildren(frag)
  }

  var listRoot = document.querySelector('[data-sh-memory-source-list]')
  var emptyEl = document.querySelector('[data-sh-memory-source-empty]')

  function bucketEndIso (startIso, grain) {
    var start = parseIso(startIso)
    if (grain === 'week') return iso(addDays(start, 6))
    if (grain === 'month') {
      return iso(new Date(start.getFullYear(), start.getMonth() + 1, 0))
    }
    return startIso
  }

  function learnedOnInBucket (learnedOn, startIso) {
    if (!learnedOn || !startIso) return false
    var endIso = bucketEndIso(startIso, state.grain)
    return learnedOn >= startIso && learnedOn <= endIso
  }

  function findLatestStart (buckets) {
    var latest = ''
    var i
    for (i = 0; i < buckets.length; i++) {
      var b = buckets[i]
      if (!b || b.empty || !b.start || !b.value) continue
      if (b.start > latest) latest = b.start
    }
    return latest || null
  }

  function paintSelection () {
    if (!grid) return
    var cells = grid.querySelectorAll('button.cal-cell')
    var i
    for (i = 0; i < cells.length; i++) {
      var on = cells[i].getAttribute('data-start') === state.selectedStart
      cells[i].classList.toggle('is-selected', on)
      cells[i].setAttribute('aria-pressed', on ? 'true' : 'false')
    }
  }

  function filterSourceList () {
    if (!listRoot) return
    var rows = listRoot.querySelectorAll('[data-sh-knowledge-doc-item]')
    var shown = 0
    var start = state.selectedStart
    var i
    for (i = 0; i < rows.length; i++) {
      var on = learnedOnInBucket(rows[i].getAttribute('data-sh-memory-learned-on'), start)
      rows[i].hidden = !on
      if (on) shown++
    }
    listRoot.hidden = shown === 0
    if (emptyEl) emptyEl.hidden = shown > 0
  }

  function ensureSelection (buckets) {
    var stillThere = false
    var i
    if (state.selectedStart) {
      for (i = 0; i < buckets.length; i++) {
        if (buckets[i] && !buckets[i].empty && buckets[i].start === state.selectedStart) {
          stillThere = true
          break
        }
      }
    }
    if (!stillThere) state.selectedStart = findLatestStart(buckets)
    paintSelection()
    filterSourceList()
  }

  function bindSourceMenus (root) {
    if (!root) return
    var openMenu = null
    var openTrigger = null

    function closeMenu () {
      if (!openMenu || !openTrigger) return
      openMenu.hidden = true
      openMenu.classList.remove('is-open')
      openTrigger.setAttribute('aria-expanded', 'false')
      openMenu = null
      openTrigger = null
    }

    root.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-sh-knowledge-doc-menu-trigger]')
      if (!trigger || !root.contains(trigger)) return
      event.preventDefault()
      event.stopPropagation()
      var wrap = trigger.closest('[data-sh-knowledge-doc-menu]')
      var menu = wrap && wrap.querySelector('[data-sh-knowledge-doc-menu-list]')
      if (!menu) return
      if (openMenu === menu) {
        closeMenu()
        return
      }
      closeMenu()
      menu.hidden = false
      menu.classList.add('is-open')
      trigger.setAttribute('aria-expanded', 'true')
      openMenu = menu
      openTrigger = trigger
    })

    document.addEventListener('click', function (event) {
      if (!openMenu) return
      if (root.contains(event.target) && event.target.closest('[data-sh-knowledge-doc-menu]')) return
      closeMenu()
    })

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu()
    })
  }

  function renderLegend() {
    if (!legend) return
    legend.replaceChildren()
    var less = document.createElement('span')
    less.textContent = 'Less'
    legend.appendChild(less)
    for (var i = 0; i <= 4; i++) {
      var swatch = document.createElement('span')
      swatch.className = 'cal-cell'
      swatch.setAttribute('data-level', String(i))
      swatch.setAttribute('aria-hidden', 'true')
      legend.appendChild(swatch)
    }
    var more = document.createElement('span')
    more.textContent = 'More'
    legend.appendChild(more)
  }

  function applyLayout(layout) {
    root.dataset.grain = state.grain
    root.dataset.palette = state.palette
    if (layout.weekdays) root.setAttribute('data-weekdays', '')
    else root.removeAttribute('data-weekdays')
    root.style.setProperty('--cal-cell-size', state.cellSize + 'px')
    root.style.setProperty('--cal-gap', Math.max(2, Math.round(state.cellSize / 4)) + 'px')
    root.style.setProperty('--cal-rows', String(layout.rows))
    root.style.setProperty('--cal-cols', String(layout.cols))
    root.style.setProperty('--cal-flow', layout.flow)
    if (!grid) return
    grid.style.gridAutoFlow = layout.flow
    if (layout.flow === 'column') {
      grid.style.gridTemplateRows = 'repeat(' + layout.rows + ', var(--cal-cell-size))'
      grid.style.gridTemplateColumns = 'none'
    } else {
      grid.style.gridTemplateColumns = 'repeat(' + layout.cols + ', var(--cal-cell-size))'
      grid.style.gridTemplateRows = layout.fixed
        ? 'repeat(' + layout.rows + ', var(--cal-cell-size))'
        : 'none'
    }
  }

  function syncControls() {
    root.querySelectorAll('[data-cal-field]').forEach(function (field) {
      var key = field.getAttribute('data-cal-field')
      if (!key || !Object.prototype.hasOwnProperty.call(state, key)) return
      var value = state[key]
      field.value = value == null ? '' : String(value)
    })
  }

  function render() {
    hideTip()
    var buckets = resolveBuckets(state)
    var layout = resolveLayout(state, buckets.length)
    buckets = fitBuckets(buckets, layout)
    if (!layout.fixed && layout.flow === 'row') {
      buckets = dropEmptyTrailingRows(buckets, layout.cols)
      layout = resolveLayout(state, buckets.length)
    }
    applyLayout(layout)
    renderAxisX(buckets, layout)
    renderAxisY(layout)
    renderGrid(buckets)
    renderLegend()
    syncControls()
    ensureSelection(buckets)
  }

  function applyField(field) {
    var key = field.getAttribute('data-cal-field')
    if (!key) return
    var value = field.value
    if (key === 'cellSize') state.cellSize = Number(value)
    else if (key === 'cols' || key === 'rows') state[key] = parseDim(value)
    else {
      if (key === 'grain' || key === 'timeframe') state.selectedStart = null
      state[key] = value
    }
    render()
  }

  root.addEventListener('change', function (event) {
    var field = event.target.closest('[data-cal-field]')
    if (field) applyField(field)
  })
  root.addEventListener('input', function (event) {
    if (event.target.matches('input[data-cal-field]')) applyField(event.target)
  })

  if (grid) {
    grid.addEventListener('click', function (event) {
      var cell = event.target.closest('button.cal-cell')
      if (!cell || !grid.contains(cell) || cell.classList.contains('is-empty')) return
      var start = cell.getAttribute('data-start')
      if (!start) return
      state.selectedStart = start
      paintSelection()
      filterSourceList()
    })
    grid.addEventListener('pointerover', function (event) {
      var cell = event.target.closest('.cal-cell')
      if (!cell || cell.classList.contains('is-empty') || !grid.contains(cell)) return
      showTip(cell)
    })
    grid.addEventListener('pointerout', function (event) {
      var cell = event.target.closest('.cal-cell')
      if (!cell || cell !== activeCell) return
      scheduleHide(event.relatedTarget)
    })
    grid.addEventListener('focusin', function (event) {
      var cell = event.target.closest('.cal-cell')
      if (cell && !cell.classList.contains('is-empty')) showTip(cell)
    })
    grid.addEventListener('focusout', function (event) {
      scheduleHide(event.relatedTarget)
    })
  }

  if (tip) {
    tip.addEventListener('pointerenter', function () {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = 0
      }
    })
    tip.addEventListener('pointerleave', function (event) {
      scheduleHide(event.relatedTarget)
    })
  }

  window.addEventListener('scroll', hideTip, true)
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') hideTip()
  })

  bindSourceMenus(listRoot)

  render()
})()
