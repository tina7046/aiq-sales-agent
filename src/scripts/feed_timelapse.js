// ──────────────────────────────────────────────────────────────────────
// Feed time-lapse director — lab only (/agent_at_work.html)
// =====================================================================
// Infinite 1 Completed + 4 Running conveyor. Each cycle swipes the
// oldest Completed (slide left + fade). As that row collapses — the
// remaining cards slide up — a new Running card rises with them so
// the pack lands together as five. The oldest Running flips to
// Completed at the same settle. One cycle is a single paused GSAP timeline so the lab
// scrubber can seek and step frame-by-frame. Extra seed rows sit
// `[hidden]` as the first inserts; after that, dismissed rows recycle
// from a boot-time HTML catalog. This file is the only place durations
// get retuned.
//
;(function () {
  // Seconds, GSAP-native. Bind these from the lab chrome; persist so
  // Replay (a reload) keeps the last values you typed.
  var TIMING = {
    rest: 0.9,             // hold before the swipe and after the pack lands
    enter: 0.7,            // pack settle: Completed collapse + new card rise (same clock)
    packStart: 0,          // 0–1: when during the swipe the pack begins (0 = with the swipe)
    dateDays: 7            // calendar days that elapse during one conveyor cycle
  }

  var TIMING_KEYS = [
    'rest',
    'enter',
    'packStart',
    'dateDays'
  ]
  var STORAGE_TIMING = 'aaw:feedTimelapseV9'
  var STORAGE_AUTOPLAY = 'aaw:feedTimelapsePlay'
  var READY_VISIBLE = 1
  var RUNNING_VISIBLE = 4
  var ENTER_EASE = 'power2.inOut'
  // How far below rest the new card starts (px). Ready dismiss uses 300
  // on X; that much on Y reads as a fly-in, so this stays a short rise.
  var ENTER_OFFSET = 40

  var playing = false
  var director = null
  var cycleCtx = null
  var scrubbing = false
  var catalog = []
  var catalogCursor = 0
  var nextOrder = 0
  var FRAME = 1 / 60
  // Keep in step with home.js `FEED_MOTION` (Ready dismiss).
  var DISMISS_SLIDE = 0.4
  var DISMISS_OFFSET = -300
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  var clock = null

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
        if (key === 'packStart') n = Math.min(1, n)
        if (key === 'dateDays') n = Math.max(1, Math.round(n))
        TIMING[key] = n
      })
    } catch (e) {}
  }

  function consumeAutoplay () {
    try {
      if (window.sessionStorage.getItem(STORAGE_AUTOPLAY) !== '1') return false
      window.sessionStorage.removeItem(STORAGE_AUTOPLAY)
      return true
    } catch (e) {
      return false
    }
  }

  function requestAutoplay () {
    try { window.sessionStorage.setItem(STORAGE_AUTOPLAY, '1') } catch (e) {}
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
      if (key === 'packStart') n = Math.min(1, n)
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

  function feedList () {
    var li = document.querySelector('[data-sh-feed-list-item]')
    return li ? li.parentElement : null
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

  function visibleCompletedItems () {
    return feedListItems().filter(function (li) {
      return isVisible(li) && rowState(li) === 'completed'
    })
  }

  function visibleRunningRows () {
    return Array.prototype.slice.call(
      document.querySelectorAll('[data-sh-feed-item][data-sh-feed-state="running"]')
    ).filter(function (row) {
      var li = row.closest('[data-sh-feed-list-item]')
      return isVisible(li)
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

  function applyVisibleStack () {
    var ready = 0
    var running = 0
    feedListItems().forEach(function (li) {
      var state = rowState(li)
      var show = false
      if (state === 'completed' && ready < READY_VISIBLE) {
        show = true
        ready += 1
      } else if (state === 'running' && running < RUNNING_VISIBLE) {
        show = true
        running += 1
      }
      if (show) li.removeAttribute('hidden')
      else li.setAttribute('hidden', '')
    })
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
    return cloneNext()
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

  function parsePinnedDate (text) {
    var fallback = new Date(2026, 8, 8)
    var m = String(text || '').match(/[A-Za-z]+\s+([A-Za-z]+)\s+(\d+)/)
    if (!m) return fallback
    var month = -1
    var i
    for (i = 0; i < MONTHS.length; i++) {
      if (MONTHS[i].toLowerCase() === m[1].toLowerCase()) {
        month = i
        break
      }
    }
    var day = parseInt(m[2], 10)
    if (month < 0 || !isFinite(day) || day < 1) return fallback
    return new Date(2026, month, day)
  }

  function formatFeedDate (d) {
    return WEEKDAYS[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate()
  }

  function dateSizers (values) {
    return values.map(function (v) {
      return '<span class="aaw-lab__date-sizer" aria-hidden="true">' + v + '</span>'
    }).join('')
  }

  // Weekday / month / day are separate slots. Invisible sizers hold the
  // longest value in each column so "May" → "September" and "7" → "30"
  // don't shove the heading or filter sideways as the conveyor ticks.
  function wrapDateParts () {
    var el = dateEl()
    if (!el || el.querySelector('[data-aaw-date-weekday]')) return
    el.classList.add('aaw-lab__feed-date')
    el.innerHTML =
      '<span class="aaw-lab__date-part aaw-lab__date-part--weekday">' +
        dateSizers(WEEKDAYS) +
        '<span class="aaw-lab__date-value" data-aaw-date-weekday></span>' +
      '</span>' +
      '<span class="aaw-lab__date-part aaw-lab__date-part--month">' +
        dateSizers(MONTHS) +
        '<span class="aaw-lab__date-value" data-aaw-date-month></span>' +
      '</span>' +
      '<span class="aaw-lab__date-part aaw-lab__date-part--day">' +
        dateSizers(['31']) +
        '<span class="aaw-lab__date-value" data-aaw-date-day></span>' +
      '</span>'
  }

  function addDays (d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  }

  function paintDate (d) {
    var el = dateEl()
    if (!el || !d) return
    var weekday = WEEKDAYS[d.getDay()]
    var month = MONTHS[d.getMonth()]
    var day = String(d.getDate())
    var weekdayEl = el.querySelector('[data-aaw-date-weekday]')
    var monthEl = el.querySelector('[data-aaw-date-month]')
    var dayEl = el.querySelector('[data-aaw-date-day]')
    if (weekdayEl && monthEl && dayEl) {
      if (weekdayEl.textContent !== weekday) weekdayEl.textContent = weekday
      if (monthEl.textContent !== month) monthEl.textContent = month
      if (dayEl.textContent !== day) dayEl.textContent = day
      el.setAttribute('aria-label', formatFeedDate(d))
      return
    }
    var next = formatFeedDate(d)
    if (el.textContent !== next) el.textContent = next
  }

  function dateDaysCount () {
    var n = TIMING.dateDays
    if (!isFinite(n) || n < 1) return 1
    return Math.round(n)
  }

  function elapsedDaysForTime (time) {
    var days = dateDaysCount()
    var dur = director ? director.duration() : 0
    if (dur <= 0) return 0
    var p = Math.max(0, Math.min(1, time / dur))
    return Math.min(days, Math.floor(p * days + 1e-9))
  }

  function applyDateForTime (time) {
    if (!clock) return
    paintDate(addDays(clock, elapsedDaysForTime(time)))
  }

  // Quota in the Daily Briefing lags the feed date. The conveyor still
  // spends `dateDays` per cycle (and the date ticks each of those days),
  // but the % / $ closed only move once every QUOTA_DAYS_PER_TICK
  // simulated days — so they don't race the cards. Seeded from the
  // markup; Replay reloads the page and starts over.
  var quotaClock = null
  var QUOTA_PCT_STEP = 1
  var QUOTA_CLOSED_STEP = 0.1
  var QUOTA_DAYS_PER_TICK = 7

  function quotaTicksForDays (days) {
    var step = QUOTA_DAYS_PER_TICK
    if (!isFinite(step) || step < 1) step = 1
    return Math.floor(Math.max(0, days) / step)
  }

  function wrapQuotaNodes () {
    var heading = document.querySelector('.aaw-lab .seller-home__briefing-heading')
    var link = document.querySelector('.aaw-lab .seller-home__briefing-link')
    if (heading && !heading.querySelector('[data-aaw-quota-pct]')) {
      heading.innerHTML = heading.innerHTML.replace(
        /(\d+(?:\.\d+)?)(\s*%)/,
        '<span data-aaw-quota-pct>$1</span>$2'
      )
    }
    if (link && !link.querySelector('[data-aaw-quota-closed]')) {
      link.innerHTML = link.innerHTML.replace(
        /\$(\d+(?:\.\d+)?)(M)/i,
        '$$<span data-aaw-quota-closed>$1</span>$2'
      )
    }
    var pctEl = document.querySelector('[data-aaw-quota-pct]')
    var closedEl = document.querySelector('[data-aaw-quota-closed]')
    quotaClock = {
      pct: pctEl ? parseFloat(pctEl.textContent) : 80,
      closed: closedEl ? parseFloat(closedEl.textContent) : 1.6,
      days: 0
    }
    if (!isFinite(quotaClock.pct)) quotaClock.pct = 80
    if (!isFinite(quotaClock.closed)) quotaClock.closed = 1.6
  }

  function paintQuota (elapsed) {
    if (!quotaClock) return
    var pctEl = document.querySelector('[data-aaw-quota-pct]')
    var closedEl = document.querySelector('[data-aaw-quota-closed]')
    var ticks = quotaTicksForDays(quotaClock.days + (isFinite(elapsed) ? elapsed : 0))
    if (pctEl) {
      var pct = Math.min(100, Math.round(quotaClock.pct + ticks * QUOTA_PCT_STEP))
      var pctText = String(pct)
      if (pctEl.textContent !== pctText) pctEl.textContent = pctText
    }
    if (closedEl) {
      var closed = quotaClock.closed + ticks * QUOTA_CLOSED_STEP
      var closedText = closed.toFixed(1)
      if (closedEl.textContent !== closedText) closedEl.textContent = closedText
    }
  }

  function applyQuotaForTime (time) {
    paintQuota(elapsedDaysForTime(time))
  }

  function applyStateForTime (time) {
    applyDateForTime(time)
    applyQuotaForTime(time)
    if (!cycleCtx || !cycleCtx.runningRow || !window.SH || !window.SH.feed) return
    var want = time >= cycleCtx.flipAt ? 'completed' : 'running'
    if (cycleCtx.runningRow.getAttribute('data-sh-feed-state') !== want) {
      window.SH.feed.applyState(cycleCtx.runningRow, want)
    }
  }

  function commitCycle () {
    if (!cycleCtx) return
    if (clock) {
      clock = addDays(clock, dateDaysCount())
      paintDate(clock)
    }
    if (quotaClock) {
      quotaClock.days += dateDaysCount()
      paintQuota(0)
    }
    if (cycleCtx.readyLi && cycleCtx.readyLi.parentNode) {
      cycleCtx.readyLi.parentNode.removeChild(cycleCtx.readyLi)
    }
    if (cycleCtx.enterLi) gsap.set(cycleCtx.enterLi, { clearProps: 'height,overflow' })
    if (cycleCtx.enterRow) gsap.set(cycleCtx.enterRow, { clearProps: 'y,opacity,transform' })
    if (cycleCtx.runningRow) window.SH.feed.applyState(cycleCtx.runningRow, 'completed')
    cycleCtx = null
    if (director) {
      director.kill()
      director = null
    }
  }

  function armCycle () {
    var readyItems = visibleCompletedItems()
    var running = visibleRunningRows()
    if (!readyItems.length || !running.length) return false

    var enterLi = takeNextRunningLi()
    if (!enterLi) return false

    var t = TIMING
    var readyLi = readyItems[0]
    var readyRow = rowOf(readyLi)
    var runningRow = running[0]
    var enterRow = rowOf(enterLi)

    if (director) director.kill()

    enterLi.removeAttribute('hidden')
    gsap.set(enterLi, { height: 'auto' })
    var enterHeight = enterLi.offsetHeight
    gsap.set(enterLi, { overflow: 'visible', height: 0 })
    if (enterRow) gsap.set(enterRow, { y: ENTER_OFFSET, opacity: 0 })

    var readyHeight = readyLi.offsetHeight
    var readyMargin = parseFloat(window.getComputedStyle(readyLi).marginBottom) || 0
    gsap.set(readyLi, { overflow: 'hidden' })

    // New card rises with the pack: collapse is what slides everyone
    // else up, so the enter tween shares that start and duration and
    // they land together as five. Pack motion begins `packStart` of the
    // way through the swipe (0 = the moment the Completed card starts
    // sliding out).
    var at = t.rest
    var packStart = Math.max(0, Math.min(1, t.packStart))
    var collapseAt = at + DISMISS_SLIDE * packStart
    var packDur = t.enter
    var landAt = collapseAt + packDur
    var flipAt = landAt
    var enterAt = collapseAt

    cycleCtx = {
      readyLi: readyLi,
      runningRow: runningRow,
      enterLi: enterLi,
      enterRow: enterRow,
      flipAt: flipAt
    }

    director = gsap.timeline({
      paused: true,
      onUpdate: function () {
        if (!director) return
        applyStateForTime(director.time())
        if (!scrubbing) syncScrubber()
      },
      onComplete: function () {
        syncScrubber()
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

    if (readyRow) {
      director.fromTo(readyRow, {
        x: 0,
        opacity: 1
      }, {
        x: DISMISS_OFFSET,
        opacity: 0,
        duration: DISMISS_SLIDE,
        ease: ENTER_EASE,
        immediateRender: false
      }, at)
    }
    director.fromTo(readyLi, {
      height: readyHeight,
      marginBottom: readyMargin
    }, {
      height: 0,
      marginBottom: 0,
      duration: packDur,
      ease: ENTER_EASE,
      immediateRender: false
    }, collapseAt)

    if (enterRow) {
      director.fromTo(enterRow, {
        y: ENTER_OFFSET,
        opacity: 0
      }, {
        y: 0,
        opacity: 1,
        duration: packDur,
        ease: ENTER_EASE,
        immediateRender: false
      }, enterAt)
    }
    director.fromTo(enterLi, {
      height: 0
    }, {
      height: enterHeight,
      duration: packDur,
      ease: ENTER_EASE,
      immediateRender: false
    }, enterAt)

    var dur = landAt + t.rest
    if (director.duration() < dur) {
      director.to({}, { duration: dur - director.duration() })
    }

    director.pause(0)
    applyStateForTime(0)
    syncScrubber()
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

  function play () {
    whenFeedReady(function () {
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
          setDirectorState(visibleCompletedItems().length && visibleRunningRows().length ? 'idle' : 'error')
          syncScrubber()
          return
        }
      }

      playing = true
      setDirectorState('playing')
      director.play()
    })
  }

  function replay () {
    applyTiming(readTimingFromForm(timingForm()))
    persistSettings()
    requestAutoplay()
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
    applyVisibleStack()
    clock = parsePinnedDate(dateEl() && dateEl().textContent)
    wrapDateParts()
    paintDate(clock)
    wrapQuotaNodes()
    paintQuota(0)
    fillTimingForm(form)
    syncScrubber()

    if (playBtn) {
      playBtn.addEventListener('click', function () { togglePlayPause() })
    }

    document.addEventListener('keydown', function (event) {
      var tag = (event.target && event.target.tagName) || ''
      var inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if ((event.code === 'Space' || event.key === ' ') && tag !== 'BUTTON' && !inField) {
        event.preventDefault()
        togglePlayPause()
        return
      }
      if (inField && event.target && event.target.type === 'number') return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepFrame(-1)
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
    play()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
