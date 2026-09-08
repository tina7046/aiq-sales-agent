// ──────────────────────────────────────────────────────────────────────
// Feed time-lapse director — lab only (/agent_at_work.html)
// =====================================================================
// Slice 1 is one pinned day. Rows start Running, Flip into Ready, hold,
// then swipe-out via Home's existing dismiss. Multi-day stagger-in is
// a later slice; this file is the only place durations get retuned.
//
;(function () {
  // Seconds, GSAP-native. Bind these from the lab chrome; persist so
  // Replay (a reload) keeps the last values you typed.
  var TIMING = {
    holdRunning: 1.4,     // rows sit in Running before completing
    betweenComplete: 0.7, // stagger between rows completing (covers Flip)
    holdReady: 1.6,       // sit in Ready before dismiss
    betweenDismiss: 0.45, // stagger between swipe-outs
    playDelay: 0.5        // pause after Play before the sequence starts
  }

  var TIMING_KEYS = [
    'holdRunning',
    'betweenComplete',
    'holdReady',
    'betweenDismiss',
    'playDelay'
  ]
  var STORAGE_TIMING = 'aaw:feedTimelapse'
  var STORAGE_AUTOPLAY = 'aaw:feedTimelapsePlay'

  var playing = false
  var director = null

  function loadTiming () {
    try {
      var raw = window.sessionStorage.getItem(STORAGE_TIMING)
      if (!raw) return
      var saved = JSON.parse(raw)
      TIMING_KEYS.forEach(function (key) {
        var n = parseFloat(saved[key])
        if (isFinite(n) && n >= 0) TIMING[key] = n
      })
    } catch (e) {}
  }

  function saveTiming (values) {
    try {
      window.sessionStorage.setItem(STORAGE_TIMING, JSON.stringify(values))
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
      if (isFinite(n) && n >= 0) next[key] = n
    })
    return next
  }

  function applyTiming (values) {
    TIMING_KEYS.forEach(function (key) {
      if (typeof values[key] === 'number') TIMING[key] = values[key]
    })
    saveTiming(TIMING)
  }

  function runningRows () {
    return Array.prototype.slice.call(
      document.querySelectorAll('[data-sh-feed-item][data-sh-feed-state="running"]')
    )
  }

  function setPlayEnabled (enabled) {
    var play = document.querySelector('[data-aaw-play]')
    if (play) play.disabled = !enabled
  }

  function setDirectorState (state) {
    var root = document.querySelector('[data-aaw-director]')
    if (root) root.setAttribute('data-aaw-director-state', state)
  }

  function whenFeedReady (cb) {
    if (window.SH && window.SH.feed && typeof gsap !== 'undefined') {
      cb()
      return
    }
    var tries = 0
    var id = window.setInterval(function () {
      tries += 1
      if (window.SH && window.SH.feed && typeof gsap !== 'undefined') {
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
      if (playing) return

      var rows = runningRows()
      if (!rows.length) {
        setDirectorState('idle')
        return
      }

      var t = readTimingFromForm(timingForm())
      applyTiming(t)
      fillTimingForm(timingForm())

      playing = true
      setPlayEnabled(false)
      setDirectorState('playing')

      if (director) director.kill()

      gsap.config({ autoSleep: 0 })
      gsap.ticker.lagSmoothing(0)

      var completeAt = t.playDelay + t.holdRunning
      var readyAt = completeAt + Math.max(0, rows.length - 1) * t.betweenComplete + t.holdReady
      var doneAt = readyAt + Math.max(0, rows.length - 1) * t.betweenDismiss

      director = gsap.timeline({
        onComplete: function () {
          playing = false
          director = null
          setDirectorState('done')
        }
      })

      rows.forEach(function (row, i) {
        director.call(function () {
          window.SH.feed.changeState(row, 'completed')
        }, null, completeAt + i * t.betweenComplete)
      })

      rows.forEach(function (row, i) {
        director.call(function () {
          var li = row.closest('[data-sh-feed-list-item]')
          window.SH.feed.dismiss(li)
        }, null, readyAt + i * t.betweenDismiss)
      })

      // Real tween so the timeline has a duration the ticker can advance
      // (empty-target dummy tweens can stall).
      director.fromTo(
        document.querySelector('[data-aaw-director]'),
        { '--aaw-playhead': 0 },
        { '--aaw-playhead': 1, duration: doneAt, ease: 'none' },
        0
      )
    })
  }

  function replay () {
    var t = readTimingFromForm(timingForm())
    applyTiming(t)
    requestAutoplay()
    window.location.reload()
  }

  function bindChrome () {
    var playBtn = document.querySelector('[data-aaw-play]')
    var replayBtn = document.querySelector('[data-aaw-replay]')
    var form = timingForm()

    fillTimingForm(form)

    if (playBtn) {
      playBtn.addEventListener('click', function () { play() })
    }
    if (replayBtn) {
      replayBtn.addEventListener('click', function () { replay() })
    }
    if (form) {
      form.addEventListener('change', function () {
        applyTiming(readTimingFromForm(form))
      })
    }
  }

  function boot () {
    loadTiming()
    bindChrome()
    setDirectorState('idle')
    var params = new URLSearchParams(window.location.search)
    var urlPlay = params.get('play') === '1'
    if (consumeAutoplay() || urlPlay) play()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
