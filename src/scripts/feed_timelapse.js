// ──────────────────────────────────────────────────────────────────────
// Feed time-lapse director — lab only (/style_lab/agent_at_work.html)
// =====================================================================
// Opening stack is wave 1 (3 cards). Each Left/Up swipes the whole
// visible pack, jumps the date ladder (Sep 17 → Oct 1 → Oct 28,
// weekdays only) and the quota ladder, then the next wave rises
// (3 cards). Stack 2 keeps its last two cards Running. The last beat
// has no enter — empty state.
// cloneNext stays commented (no infinite recycle).
//
;(function () {
  // Seconds, GSAP-native. Bind these from the lab chrome; persist so
  // Replay (a reload) keeps the last values you typed.
  var TIMING = {
    rest: 0.9,             // hold before the swipe and after the pack lands
    enter: 0.7,            // pack settle: next wave rise + fade in
    enterAt: 1.3,          // when the next wave starts (after the left swipe)
    dateDays: 5            // unused; dates are the hardcoded ladder
  }

  var TIMING_KEYS = [
    'rest',
    'enter',
    'enterAt',
    'dateDays'
  ]
  var STORAGE_TIMING = 'aaw:feedTimelapseV12'
  var WAVES = [
    ['run-10', 'run-01', 'run-02'],
    ['run-03', 'run-04', 'run-05']
  ]
  var waveIndex = 0
  var ENTER_EASE = 'power2.inOut'
  // Incoming pack starts this many card-heights below rest. 1.5 puts
  // the first card at the middle of the outgoing stack.
  var ENTER_RISE_CARDS = 1.5
  // Tighter than the left-swipe stagger so the rise reads as one cascade.
  var ENTER_STAGGER = 0.04
  // How far below rest a recycled card starts (px). Ready dismiss uses
  // 300 on X; that much on Y reads as a fly-in, so this stays a short rise.
  var ENTER_OFFSET = 40

  var playing = false
  var oneShot = false
  var oneShotClosing = false
  var director = null
  var cycleCtx = null
  var scrubbing = false
  var catalog = []
  var catalogCursor = 0
  var nextOrder = 0
  var FRAME = 1 / 60
  // Keep in step with home.js `FEED_MOTION` (Ready dismiss).
  var DISMISS_SLIDE = 0.4
  var DISMISS_STAGGER = 0.1
  var DISMISS_OFFSET = -300
  var COMPLETE_DELAYS_FIRST = [500, 750]
  var COMPLETE_DELAYS_LATER = [750, 1000, 1250]
  var completeTimers = []
  var EMPTY_NESTLE_MS = 220
  var emptyCheckPlayed = false
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  var clock = null
  var dateIndex = 0
  // Demo pin: Thursday Sep 17 through Wednesday Oct 28. All weekdays,
  // different day numbers. One step per conveyor tick; last date is
  // the empty "You're all caught up" beat.
  var DATE_LADDER = [
    new Date(2026, 8, 17),
    new Date(2026, 9, 1),
    new Date(2026, 9, 28)
  ]

  function directorState () {
    var root = document.querySelector('[data-aaw-director]')
    return root ? root.getAttribute('data-aaw-director-state') : 'idle'
  }

  function syncButtons () {
    var state = directorState()
    var isPlaying = state === 'playing'
    var label = isPlaying ? 'Pause' : 'Play'
    var play = document.querySelector('[data-aaw-play]')
    if (play) {
      play.textContent = label
      play.disabled = state === 'error'
      play.classList.toggle('slds-button_brand', !isPlaying)
      play.classList.toggle('slds-button_neutral', isPlaying)
      play.setAttribute('aria-pressed', isPlaying ? 'true' : 'false')
    }
    var gear = document.querySelector('[data-aaw-gear-play-label]')
    if (gear) gear.textContent = label
  }

  function persistSettings () {
    var payload = {}
    TIMING_KEYS.forEach(function (key) { payload[key] = TIMING[key] })
    try {
      window.sessionStorage.setItem(STORAGE_TIMING, JSON.stringify(payload))
    } catch (e) {}
  }

  function loadTiming () {
    try {
      var raw = window.sessionStorage.getItem(STORAGE_TIMING)
      if (!raw) return
      var saved = JSON.parse(raw)
      TIMING_KEYS.forEach(function (key) {
        var n = parseFloat(saved[key])
        if (!isFinite(n) || n < 0) return
        if (key === 'dateDays') n = Math.max(1, Math.round(n))
        TIMING[key] = n
      })
    } catch (e) {}
  }

  function timingForm () {
    return document.querySelector('[data-aaw-timing]')
  }

  function fillTimingForm (form) {
    if (!form) return
    TIMING_KEYS.forEach(function (key) {
      var input = form.querySelector('[name="' + key + '"]')
      if (input) input.value = String(TIMING[key])
    })
  }

  function readTimingFromForm (form) {
    var next = {}
    TIMING_KEYS.forEach(function (key) { next[key] = TIMING[key] })
    if (!form) return next
    TIMING_KEYS.forEach(function (key) {
      var input = form.querySelector('[name="' + key + '"]')
      if (!input) return
      var n = parseFloat(input.value)
      if (!isFinite(n) || n < 0) return
      if (key === 'dateDays') n = Math.max(1, Math.round(n))
      next[key] = n
    })
    return next
  }

  function applyTiming (values) {
    TIMING_KEYS.forEach(function (key) {
      if (typeof values[key] === 'number') TIMING[key] = values[key]
    })
    persistSettings()
  }

  function feedApiReady () {
    return window.SH && window.SH.feed &&
      typeof window.SH.feed.changeState === 'function' &&
      typeof window.SH.feed.dismiss === 'function' &&
      typeof window.SH.feed.applyState === 'function' &&
      typeof window.SH.feed.place === 'function' &&
      typeof gsap !== 'undefined'
  }

  function feedListItems () {
    return Array.prototype.slice.call(
      document.querySelectorAll('[data-sh-feed-list-item]')
    )
  }

  function emptyStateEl () {
    return document.querySelector(
      '.aaw-lab .seller-home__feed-empty:not(.seller-home__feed-empty--filter)'
    )
  }

  function ensureEmptyCheck () {
    var empty = emptyStateEl()
    if (!empty) return null
    var mark = empty.querySelector('.aaw-ok__mark')
    if (mark) return mark
    var wrap = document.createElement('span')
    wrap.className = 'aaw-ok'
    wrap.setAttribute('aria-hidden', 'true')
    wrap.innerHTML =
      '<span class="aaw-ok__mark" data-state="spinning" style="--pv3q: 13;">' +
        '<span class="aaw-ok__disc"></span>' +
        '<span class="aaw-ok__check">' +
          '<svg viewBox="0 0 24 24">' +
            '<path d="M8 12.5L10.8 15.5L16.4 9.5"></path>' +
          '</svg>' +
        '</span>' +
      '</span>'
    empty.insertBefore(wrap, empty.firstChild)
    return wrap.querySelector('.aaw-ok__mark')
  }

  function playEmptyCheck () {
    var mark = ensureEmptyCheck()
    if (!mark || mark.getAttribute('data-state') === 'done') return
    mark.classList.add('is-resetting')
    mark.setAttribute('data-state', 'spinning')
    void mark.offsetWidth
    mark.classList.remove('is-resetting')
    void mark.offsetWidth
    mark.setAttribute('data-state', 'done')
  }

  // Empty-state check waits until `.seller-home__feed-empty` has played
  // `sh-feed-empty-in` (220ms fade/rise). Reduced motion skips nestle.
  function playEmptyCheckAfterNestle () {
    if (emptyCheckPlayed) return
    emptyCheckPlayed = true
    var empty = emptyStateEl()
    ensureEmptyCheck()
    if (!empty || reduceMotion) {
      playEmptyCheck()
      return
    }
    var settled = false
    function settle () {
      if (settled) return
      settled = true
      empty.removeEventListener('animationend', onEnd)
      playEmptyCheck()
    }
    function onEnd (event) {
      if (event.target !== empty) return
      var name = event.animationName || ''
      if (name.indexOf('sh-feed-empty-in') === -1) return
      settle()
    }
    empty.addEventListener('animationend', onEnd)
    window.setTimeout(settle, EMPTY_NESTLE_MS + 40)
  }

  function feedList () {
    var li = document.querySelector('[data-sh-feed-list-item]')
    if (li) return li.parentElement
    return document.querySelector('.aaw-lab .seller-home__feed-list')
  }

  function rowOf (li) {
    return li && (li.querySelector('[data-sh-feed-item]') || li)
  }

  function rowId (row) {
    return row ? row.getAttribute('data-sh-feed-item') : null
  }

  function rowState (li) {
    var row = rowOf(li)
    return row ? row.getAttribute('data-sh-feed-state') : null
  }

  function isVisible (li) {
    return li && !li.hasAttribute('hidden')
  }

  function visibleItems () {
    return feedListItems().filter(isVisible)
  }

  function itemIdOf (li) {
    return rowId(rowOf(li))
  }

  function waveIds (index) {
    return WAVES[index] || []
  }

  function lisForWave (index) {
    var ids = waveIds(index)
    return feedListItems().filter(function (li) {
      return ids.indexOf(itemIdOf(li)) !== -1
    })
  }

  function applyWaveVisibility () {
    var show = {}
    waveIds(waveIndex).forEach(function (id) { show[id] = true })
    feedListItems().forEach(function (li) {
      if (show[itemIdOf(li)]) li.removeAttribute('hidden')
      else li.setAttribute('hidden', '')
    })
  }

  function clearCompleteTimers () {
    while (completeTimers.length) window.clearTimeout(completeTimers.pop())
  }

  function scheduleWaveCompletes () {
    clearCompleteTimers()
    var delays = waveIndex === 0 ? COMPLETE_DELAYS_FIRST : COMPLETE_DELAYS_LATER
    var cards = lisForWave(waveIndex)
    if (waveIndex === 0) {
      cards = cards.filter(function (li) { return rowState(li) === 'running' })
    }
    // Stack 2: the last two cards stay Running for the whole beat.
    if (waveIndex === 1) {
      cards = cards.slice(0, Math.max(0, cards.length - 2))
    }
    cards.forEach(function (li, i) {
      if (i >= delays.length) return
      completeTimers.push(window.setTimeout(function () {
        var row = rowOf(li)
        if (!row || rowState(li) !== 'running') return
        window.SH.feed.applyState(row, 'completed')
      }, delays[i]))
    })
  }

  function hiddenRunningItems () {
    return feedListItems().filter(function (li) {
      return li.hasAttribute('hidden') && rowState(li) === 'running'
    })
  }

  function liveItemIds () {
    var ids = {}
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-sh-feed-item]'),
      function (row) {
        var id = rowId(row)
        if (id) ids[id] = true
      }
    )
    return ids
  }

  function maxFeedOrder () {
    var max = 0
    feedListItems().forEach(function (li) {
      var n = Number(li.getAttribute('data-sh-feed-order'))
      if (isFinite(n) && n > max) max = n
    })
    return max
  }

  function snapshotCatalog () {
    catalog = feedListItems().map(function (li) {
      var row = rowOf(li)
      return {
        id: rowId(row),
        html: li.outerHTML
      }
    }).filter(function (entry) { return entry.id && entry.html })
    catalogCursor = 0
    nextOrder = maxFeedOrder() + 1
  }

  function parseListItem (html) {
    var wrap = document.createElement('div')
    wrap.innerHTML = html
    return wrap.querySelector('[data-sh-feed-list-item]')
  }

  function cloneNext () {
    if (!catalog.length) return null
    var live = liveItemIds()
    var entry = null
    var i
    for (i = 0; i < catalog.length; i++) {
      var idx = (catalogCursor + i) % catalog.length
      if (!live[catalog[idx].id]) {
        entry = catalog[idx]
        catalogCursor = idx + 1
        break
      }
    }
    if (!entry) return null

    var li = parseListItem(entry.html)
    if (!li) return null
    li.removeAttribute('hidden')

    var list = feedList()
    if (!list) return null

    var row = rowOf(li)
    gsap.set(li, { overflow: 'visible', height: 0 })
    if (row) gsap.set(row, { y: ENTER_OFFSET, opacity: 0 })
    list.appendChild(li)

    if (row) window.SH.feed.applyState(row, 'running')
    li.setAttribute('data-sh-feed-order', String(nextOrder))
    nextOrder += 1
    window.SH.feed.place(li)
    return li
  }

  function takeNextRunningLi () {
    var hidden = hiddenRunningItems()
    if (hidden.length) return hidden[0]
    // Infinite recycle — uncomment to loop the catalog forever:
    // return cloneNext()
    return null
  }

  function scrubberEls () {
    return {
      range: document.querySelector('[data-aaw-scrub]'),
      time: document.querySelector('[data-aaw-time]'),
      prev: document.querySelector('[data-aaw-frame-prev]'),
      next: document.querySelector('[data-aaw-frame-next]')
    }
  }

  function syncScrubber () {
    var els = scrubberEls()
    var dur = director ? director.duration() : 0
    var now = director ? director.time() : 0
    if (els.range) {
      els.range.max = String(dur)
      els.range.value = String(now)
    }
    if (els.time) {
      els.time.textContent = now.toFixed(2) + 's / ' + dur.toFixed(2) + 's'
    }
  }

  function dateEl () {
    return document.querySelector('.aaw-lab .seller-home__feed-date')
  }

  function formatFeedDate (d) {
    return WEEKDAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate()
  }

  // Weekday / month / day size to their text so May / 7 don't keep
  // September / 31's width.
  function wrapDateParts () {
    var el = dateEl()
    if (!el || el.querySelector('[data-aaw-date-weekday]')) return
    el.classList.add('aaw-lab__feed-date')
    el.innerHTML =
      '<span class="aaw-lab__date-part aaw-lab__date-part--weekday">' +
        '<span class="aaw-lab__date-value t-digit-group" data-aaw-date-weekday></span>' +
      '</span>' +
      '<span class="aaw-lab__date-part aaw-lab__date-part--month">' +
        '<span class="aaw-lab__date-value t-digit-group" data-aaw-date-month></span>' +
      '</span>' +
      '<span class="aaw-lab__date-part aaw-lab__date-part--day">' +
        '<span class="aaw-lab__date-value t-digit-group" data-aaw-date-day></span>' +
      '</span>'
  }

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  // Rebuild a date slot as `.t-digit` spans and replay number pop-in
  // (index.css). Last two characters stagger, matching the skill's setDigits.
  function setDatePart (group, str, animate) {
    if (!group) return
    var next = String(str == null ? "" : str)
    if (group.textContent === next && group.querySelector(".t-digit")) return
    group.classList.remove("is-animating")
    while (group.firstChild) group.removeChild(group.firstChild)
    var chars = next.split("")
    var i
    for (i = 0; i < chars.length; i++) {
      var span = document.createElement("span")
      span.className = "t-digit"
      span.textContent = chars[i]
      if (i === chars.length - 2) span.setAttribute("data-stagger", "1")
      else if (i === chars.length - 1) span.setAttribute("data-stagger", "2")
      group.appendChild(span)
    }
    if (!animate || reduceMotion) return
    void group.offsetWidth
    group.classList.add("is-animating")
  }

  function paintDate (d, animate) {
    var el = dateEl()
    if (!el || !d) return
    var weekday = WEEKDAYS[d.getDay()] + ','
    var month = MONTHS[d.getMonth()]
    var day = String(d.getDate())
    var weekdayEl = el.querySelector("[data-aaw-date-weekday]")
    var monthEl = el.querySelector("[data-aaw-date-month]")
    var dayEl = el.querySelector("[data-aaw-date-day]")
    if (weekdayEl && monthEl && dayEl) {
      setDatePart(weekdayEl, weekday, animate)
      setDatePart(monthEl, month, animate)
      setDatePart(dayEl, day, animate)
      el.setAttribute("aria-label", formatFeedDate(d))
      return
    }
    var next = formatFeedDate(d)
    if (el.textContent !== next) el.textContent = next
  }

  function applyDateForTime (time) {
    if (!clock) return
    paintDate(clock)
  }

  // Quota in the Daily Briefing. Each Left/Up steps 80 → 87 → 102
  // and $ closed tracks that share of the $2M quota (1.6 → 1.74 →
  // 2.04). Replay reloads the seed.
  var quotaClock = null
  var QUOTA_TARGET = 2
  var QUOTA_LADDER = [87, 102]

  function wrapQuotaNodes () {
    var heading = document.querySelector('.aaw-lab .seller-home__briefing-heading')
    var link = document.querySelector('.aaw-lab .seller-home__briefing-link')
    if (heading && !heading.querySelector('[data-aaw-quota-pct]')) {
      heading.innerHTML = heading.innerHTML.replace(
        /(\d+(?:\.\d+)?)(\s*%)/,
        '<span class="aaw-lab__quota-sweep">' +
          '<span class="t-digit-group" data-aaw-quota-pct>$1</span>' +
          '<span class="aaw-lab__quota-pct-mark">$2</span>' +
        '</span>'
      )
    }
    if (link && !link.querySelector('[data-aaw-quota-closed]')) {
      link.innerHTML = link.innerHTML.replace(
        /\$(\d+(?:\.\d+)?)(M)/i,
        '$$<span class="t-digit-group" data-aaw-quota-closed>$1</span>$2'
      )
    }
    var pctEl = document.querySelector('[data-aaw-quota-pct]')
    quotaClock = {
      pct: pctEl ? parseFloat(pctEl.textContent) : 80,
      step: 0
    }
    if (!isFinite(quotaClock.pct)) quotaClock.pct = 80
  }

  function formatClosed (n) {
    var t = Math.round(n * 100) / 100
    var two = t.toFixed(2)
    if (two.charAt(two.length - 1) === '0') return t.toFixed(1)
    return two
  }

  function paintQuota (animate) {
    if (!quotaClock) return
    var pctEl = document.querySelector('[data-aaw-quota-pct]')
    var closedEl = document.querySelector('[data-aaw-quota-closed]')
    if (pctEl) {
      setDatePart(pctEl, String(Math.round(quotaClock.pct)), !!animate)
    }
    if (closedEl) {
      setDatePart(closedEl, formatClosed(QUOTA_TARGET * quotaClock.pct / 100), !!animate)
    }
  }

  function bumpQuotaLadder () {
    if (!quotaClock) return
    if (quotaClock.step >= QUOTA_LADDER.length) return
    quotaClock.pct = QUOTA_LADDER[quotaClock.step]
    quotaClock.step += 1
    paintQuota(true)
  }

  function applyQuotaForTime (time) {
    paintQuota(false)
  }

  function applyStateForTime (time) {
    applyDateForTime(time)
    applyQuotaForTime(time)
  }

  function advanceClock () {
    if (dateIndex >= DATE_LADDER.length - 1) return
    dateIndex += 1
    clock = DATE_LADDER[dateIndex]
    paintDate(clock, true)
  }

  function commitCycle (skipClock) {
    clearCompleteTimers()
    if (!cycleCtx) return
    if (!skipClock) {
      advanceClock()
      bumpQuotaLadder()
    }
    var i
    var list = feedList()
    if (!list && cycleCtx.dismissLis && cycleCtx.dismissLis[0]) {
      list = cycleCtx.dismissLis[0].parentNode
    }
    if (cycleCtx.dismissLis) {
      for (i = 0; i < cycleCtx.dismissLis.length; i++) {
        var li = cycleCtx.dismissLis[i]
        if (li && li.parentNode) li.parentNode.removeChild(li)
      }
    }
    if (cycleCtx.enterLis) {
      for (i = 0; i < cycleCtx.enterLis.length; i++) {
        gsap.set(cycleCtx.enterLis[i], { clearProps: 'height,overflow,marginBottom' })
      }
    }
    if (cycleCtx.enterRows) {
      for (i = 0; i < cycleCtx.enterRows.length; i++) {
        gsap.set(cycleCtx.enterRows[i], { clearProps: 'y,opacity,transform' })
      }
    }
    if (list) gsap.set(list, { clearProps: 'minHeight' })
    waveIndex += 1
    cycleCtx = null
    if (director) {
      director.kill()
      director = null
    }
    if (list && !list.querySelector('[data-sh-feed-list-item]') && list.parentNode) {
      playEmptyCheckAfterNestle()
      list.parentNode.removeChild(list)
    }
  }

  function armCycle () {
    var dismissLis = lisForWave(waveIndex)
    if (!dismissLis.length) return false

    var enterLis = lisForWave(waveIndex + 1)
    var t = TIMING
    var i
    var row
    var list = feedList()

    if (director) director.kill()
    clearCompleteTimers()

    var dismissRows = []
    var dismissTops = []
    var packH = 0
    var listRect = list ? list.getBoundingClientRect() : null
    for (i = 0; i < dismissLis.length; i++) {
      row = rowOf(dismissLis[i])
      dismissRows.push(row)
      dismissTops.push(listRect ? dismissLis[i].getBoundingClientRect().top - listRect.top : packH)
      packH += dismissLis[i].offsetHeight +
        (parseFloat(window.getComputedStyle(dismissLis[i]).marginBottom) || 0)
      if (row) gsap.set(row, { y: 0 })
    }
    var cardH = dismissLis.length ? packH / dismissLis.length : 0
    var enterY = cardH * ENTER_RISE_CARDS

    // Keep the next wave hidden until the swipe plays. Arming used to
    // pin the current pack and unhide the next one immediately, so rest
    // showed both stacks (5 cards instead of 3).
    var enterRows = []
    for (i = 0; i < enterLis.length; i++) {
      enterRows.push(rowOf(enterLis[i]))
    }

    var at = t.rest
    var swipeLast = at + Math.max(0, dismissLis.length - 1) * DISMISS_STAGGER
    var enterAt = isFinite(t.enterAt) ? t.enterAt : 1.3
    if (enterAt < 0) enterAt = 0
    var enterLast = enterAt + Math.max(0, enterLis.length - 1) * ENTER_STAGGER
    var packDur = t.enter
    var landAt = Math.max(swipeLast + DISMISS_SLIDE, enterLast + packDur)

    cycleCtx = {
      dismissLis: dismissLis,
      enterLis: enterLis,
      enterRows: enterRows,
      swipeAt: at,
      enterAt: enterAt,
      landAt: landAt,
      flipAt: landAt,
      pinned: false,
      revealed: false,
      pin: null,
      reveal: null
    }

    function pinDismiss () {
      if (!cycleCtx || cycleCtx.pinned) return
      cycleCtx.pinned = true
      clearCompleteTimers()
      var j
      for (j = 0; j < dismissLis.length; j++) {
        gsap.set(dismissLis[j], {
          position: 'absolute',
          top: dismissTops[j],
          left: 0,
          right: 0,
          width: '100%',
          zIndex: 3,
          marginBottom: 0
        })
      }
      if (list) gsap.set(list, { minHeight: packH })
    }

    function revealEnter () {
      if (!cycleCtx || cycleCtx.revealed) return
      cycleCtx.revealed = true
      var j
      var enterRow
      var enterPackH = 0
      for (j = 0; j < enterLis.length; j++) {
        if (list) list.appendChild(enterLis[j])
        enterLis[j].removeAttribute('hidden')
        gsap.set(enterLis[j], { height: 'auto', overflow: 'visible', marginBottom: '' })
        enterPackH += enterLis[j].offsetHeight +
          (parseFloat(window.getComputedStyle(enterLis[j]).marginBottom) || 0)
        enterRow = enterRows[j]
        if (enterRow) gsap.set(enterRow, { y: enterY, opacity: 0 })
      }
      if (list) gsap.set(list, { minHeight: enterPackH + enterY })
    }
    cycleCtx.pin = pinDismiss
    cycleCtx.reveal = revealEnter

    director = gsap.timeline({
      paused: true,
      onUpdate: function () {
        if (!director) return
        if (cycleCtx && cycleCtx.pin && director.time() >= cycleCtx.swipeAt - 1e-6) {
          cycleCtx.pin()
        }
        if (cycleCtx && cycleCtx.reveal && director.time() >= cycleCtx.enterAt - 1e-6) {
          cycleCtx.reveal()
        }
        applyStateForTime(director.time())
        if (!scrubbing) syncScrubber()
        if (oneShot && !oneShotClosing && cycleCtx && director.time() >= cycleCtx.landAt - 1e-6) {
          oneShotClosing = true
          director.pause(cycleCtx.landAt)
          window.requestAnimationFrame(finishOneShot)
        }
      },
      onComplete: function () {
        syncScrubber()
        if (oneShot) {
          finishOneShot()
          return
        }
        if (playing && directorState() === 'playing') {
          commitCycle()
          if (armCycle()) director.play(0)
          else {
            playing = false
            setDirectorState('idle')
            syncScrubber()
          }
        } else {
          playing = false
          setDirectorState('paused')
        }
      }
    })

    director.call(pinDismiss, null, at)
    if (enterLis.length) director.call(revealEnter, null, enterAt)

    for (i = 0; i < dismissRows.length; i++) {
      if (!dismissRows[i]) continue
      director.fromTo(dismissRows[i], {
        x: 0,
        y: 0,
        opacity: 1
      }, {
        x: DISMISS_OFFSET,
        y: 0,
        opacity: 0,
        duration: DISMISS_SLIDE,
        ease: ENTER_EASE,
        immediateRender: false
      }, at + i * DISMISS_STAGGER)
    }
    for (i = 0; i < enterRows.length; i++) {
      if (!enterRows[i]) continue
      director.fromTo(enterRows[i], {
        y: enterY,
        opacity: 0
      }, {
        y: 0,
        opacity: 1,
        duration: packDur,
        ease: ENTER_EASE,
        immediateRender: false
      }, enterAt + i * ENTER_STAGGER)
    }

    var dur = landAt + t.rest
    if (director.duration() < dur) {
      director.to({}, { duration: dur - director.duration() })
    }

    director.pause(0)
    applyStateForTime(0)
    syncScrubber()
    scheduleWaveCompletes()
    return true
  }

  function armIfNeeded () {
    if (director) return true
    if (!feedApiReady()) return false
    applyTiming(readTimingFromForm(timingForm()))
    gsap.config({ autoSleep: 0 })
    gsap.ticker.lagSmoothing(0)
    return armCycle()
  }

  function seekTo (time) {
    if (!armIfNeeded()) {
      whenFeedReady(function () { seekTo(time) })
      return
    }
    playing = false
    director.pause()
    setDirectorState('paused')
    var dur = director.duration()
    var next = Math.max(0, Math.min(dur, time))
    scrubbing = true
    director.time(next)
    applyStateForTime(next)
    scrubbing = false
    syncScrubber()
  }

  function stepFrame (dir) {
    var now = director ? director.time() : 0
    seekTo(now + dir * FRAME)
  }

  function setDirectorState (state) {
    var root = document.querySelector('[data-aaw-director]')
    if (root) root.setAttribute('data-aaw-director-state', state)
    syncButtons()
  }

  function pause () {
    if (!director || directorState() !== 'playing') return
    director.pause()
    playing = false
    setDirectorState('paused')
  }

  function resume () {
    if (!director || directorState() !== 'paused') return
    if (director.progress() === 1) {
      play()
      return
    }
    director.resume()
    playing = true
    setDirectorState('playing')
  }

  function togglePlayPause () {
    var state = directorState()
    if (state === 'playing') pause()
    else if (state === 'paused') resume()
    else play()
  }

  function whenFeedReady (cb) {
    if (feedApiReady()) {
      cb()
      return
    }
    var tries = 0
    var id = window.setInterval(function () {
      tries += 1
      if (feedApiReady()) {
        window.clearInterval(id)
        cb()
      } else if (tries > 80) {
        window.clearInterval(id)
        setDirectorState('error')
      }
    }, 25)
  }

  function finishOneShot () {
    if (!oneShot && !oneShotClosing) return
    oneShot = false
    oneShotClosing = false
    playing = false
    commitCycle(true)
    if (armCycle()) setDirectorState('paused')
    else setDirectorState('idle')
    syncScrubber()
  }

  function play () {
    whenFeedReady(function () {
      oneShot = false
      if (director && directorState() === 'paused' && director.progress() < 1) {
        resume()
        return
      }
      if (playing && directorState() === 'playing') return

      var values = readTimingFromForm(timingForm())
      applyTiming(values)
      fillTimingForm(timingForm())

      gsap.config({ autoSleep: 0 })
      gsap.ticker.lagSmoothing(0)

      if (director && director.progress() === 1) commitCycle()

      if (!director) {
        if (!armCycle()) {
          setDirectorState(visibleItems().length ? 'idle' : 'error')
          syncScrubber()
          return
        }
      }

      playing = true
      setDirectorState('playing')
      director.play()
    })
  }

  function advanceOneCycle () {
    whenFeedReady(function () {
      if (directorState() === 'playing') {
        if (!(cycleCtx && director && director.time() >= cycleCtx.landAt - 1e-6)) return
        finishOneShot()
      }

      applyTiming(readTimingFromForm(timingForm()))
      fillTimingForm(timingForm())
      gsap.config({ autoSleep: 0 })
      gsap.ticker.lagSmoothing(0)

      oneShot = true
      if (director && director.progress() === 1) commitCycle(true)
      if (!director) {
        if (!armCycle()) {
          oneShot = false
          setDirectorState(visibleItems().length ? 'idle' : 'error')
          syncScrubber()
          return
        }
      }

      advanceClock()
      bumpQuotaLadder()
      playing = true
      setDirectorState('playing')
      // Skip the leading rest — the swipe should start on the key.
      var swipe = cycleCtx && isFinite(cycleCtx.swipeAt) ? cycleCtx.swipeAt : 0
      if (cycleCtx && cycleCtx.pin) cycleCtx.pin()
      if (director.time() < swipe) director.play(swipe, false)
      else director.play()
    })
  }

  function replay () {
    applyTiming(readTimingFromForm(timingForm()))
    persistSettings()
    window.location.reload()
  }

  function bindChrome () {
    var playBtn = document.querySelector('[data-aaw-play]')
    var replayBtn = document.querySelector('[data-aaw-replay]')
    var form = timingForm()
    var range = document.querySelector('[data-aaw-scrub]')
    var prev = document.querySelector('[data-aaw-frame-prev]')
    var next = document.querySelector('[data-aaw-frame-next]')

    snapshotCatalog()
    applyWaveVisibility()
    ensureEmptyCheck()
    dateIndex = 0
    clock = DATE_LADDER[0]
    wrapDateParts()
    paintDate(clock)
    wrapQuotaNodes()
    paintQuota(false)
    fillTimingForm(form)
    syncScrubber()

    if (playBtn) {
      playBtn.addEventListener('click', function () { togglePlayPause() })
    }

    document.addEventListener('keydown', function (event) {
      var tag = (event.target && event.target.tagName) || ''
      var inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        !!(event.target && event.target.isContentEditable)
      if ((event.code === 'Space' || event.key === ' ') && tag !== 'BUTTON' && !inField) {
        event.preventDefault()
        togglePlayPause()
        return
      }
      if (inField) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!event.repeat) advanceOneCycle()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepFrame(1)
      }
    })
    if (replayBtn) {
      replayBtn.addEventListener('click', function () { replay() })
    }
    if (form) {
      form.addEventListener('change', function () {
        applyTiming(readTimingFromForm(form))
      })
    }
    if (range) {
      range.addEventListener('pointerdown', function () {
        if (directorState() === 'playing') pause()
      })
      range.addEventListener('input', function () {
        seekTo(parseFloat(range.value) || 0)
      })
    }
    if (prev) prev.addEventListener('click', function () { stepFrame(-1) })
    if (next) next.addEventListener('click', function () { stepFrame(1) })
  }

  function boot () {
    loadTiming()
    bindChrome()
    setDirectorState('idle')
    whenFeedReady(function () {
      if (armIfNeeded()) setDirectorState('paused')
      else setDirectorState(visibleItems().length ? 'idle' : 'error')
      syncScrubber()
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
