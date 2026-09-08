/* ══════════════════════════════════════════════════════════════════════
   Conversation stream — shared reveal engine
   ----------------------------------------------------------------------
   The word-by-word prose reveal and staggered table cascade that the
   onboarding conversation introduced, lifted out so every conversation
   surface can share one implementation.

   The rule it exists to enforce: nothing renders below the streaming
   cursor. Every unit rests at `display:none` until it is reached, so a
   reader never sees an empty table, a bullet with no text, or the grey
   background of a code chip waiting to be filled.

   Three kinds of unit:
     • prose — words fade in one at a time (`.t-stream-w` → `.is-in`)
     • table — the whole table lands, then its rows cascade (CSS stagger)
     • block — a rich card (cadence, email drafts, snapshot, insight)
               fades in as one piece; streaming its words would read as
               noise inside a structured layout.

   Consumers inject their own scroller, so nothing here knows which
   thread it is animating.

   The CSS contract (`.t-stream-w`, `.t-digit*`, `.sh-stream-rows`,
   `.sh-stream-block-in`, the `--stream-*` / `--digit-*` tokens) lives in
   index.scss, which _template.html links on every page.
   ══════════════════════════════════════════════════════════════════════ */

(function (window, document) {
  'use strict'

  var DEFAULTS = {
    gapMs: 60,      // per-word cadence fallback if --stream-gap is unreadable
    fadeMs: 350,    // matches --stream-fade
    rowStagger: 90, // per-row delay inside a table's cascade
    tailMs: 120,    // breath after a cascade / block fade before the next unit
    maxDepth: 3     // how far to descend into wrappers hunting for content
  }

  var PROSE_TAGS = {
    p: true, h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
    blockquote: true, figcaption: true
  }

  function noop () {}

  function num (value, fallback) {
    return (typeof value === 'number' && isFinite(value)) ? value : fallback
  }

  function reduced () {
    return (typeof window.matchMedia === 'function') &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  // Word cadence comes from CSS so the whole app retunes from one token.
  function gapMs () {
    try {
      var raw = getComputedStyle(document.documentElement).getPropertyValue('--stream-gap')
      var n = parseFloat(raw)
      if (!isFinite(n) || n <= 0) return DEFAULTS.gapMs
      // Seconds vs milliseconds.
      return (String(raw).indexOf('ms') === -1 && String(raw).indexOf('s') !== -1) ? n * 1000 : n
    } catch (e) { return DEFAULTS.gapMs }
  }

  function elementChildren (el) {
    var out = []
    var kids = el.children || []
    for (var i = 0; i < kids.length; i++) out.push(kids[i])
    return out
  }

  function tagOf (el) {
    return (el && el.tagName) ? el.tagName.toLowerCase() : ''
  }

  // ── Word wrapping ───────────────────────────────────────────────────
  // Each word of a text node becomes a `.t-stream-w` span. An inline
  // element (<strong>, <code>) is tagged as ONE unit instead of being
  // recursed into, so the chip's background and its text appear together
  // rather than the pill showing up empty first. Collects units, in
  // document order, into `out`.
  function wrapWords (el, out) {
    out = out || []
    var kids = Array.prototype.slice.call(el.childNodes)
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i]
      if (child.nodeType === 3) {
        var text = child.nodeValue
        if (!text) continue
        var frag = document.createDocumentFragment()
        var parts = text.split(/(\s+)/)
        for (var j = 0; j < parts.length; j++) {
          var part = parts[j]
          if (part === '') continue
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(part))
          } else {
            var span = document.createElement('span')
            span.className = 't-stream-w'
            span.textContent = part
            frag.appendChild(span)
            out.push(span)
          }
        }
        el.replaceChild(frag, child)
      } else if (child.nodeType === 1) {
        child.classList.add('t-stream-w')
        out.push(child)
      }
    }
    return out
  }

  // ── Unit building ───────────────────────────────────────────────────
  // A unit is { el, kind, parents }. `parents` are containers hidden
  // alongside the unit and revealed with it — a <ul> before its first
  // bullet, a card wrapper before the table inside it — which is what
  // stops empty chrome from appearing ahead of its content.

  function isStreamableMessage (el) {
    if (!el || el.nodeType !== 1 || !el.classList) return false
    if (!el.classList.contains('seller-home__conv-msg')) return false
    // The seller's own words are echoed instantly; only the agent streams.
    if (el.classList.contains('seller-home__conv-msg--user')) return false
    if (el.getAttribute('data-sh-conv-msg-type') === 'user') return false
    // The thinking row animates itself and is removed before the reply lands.
    if (el.hasAttribute('data-sh-conv-thinking')) return false
    return true
  }

  // Agent message bodies inside (or equal to) the given node.
  function messageBodies (node) {
    if (!node || node.nodeType !== 1) return []
    if (isStreamableMessage(node)) return [node]
    var out = []
    var found = node.querySelectorAll('.seller-home__conv-msg')
    for (var i = 0; i < found.length; i++) {
      if (isStreamableMessage(found[i])) out.push(found[i])
    }
    return out
  }

  function normalizeRoots (root) {
    if (!root) return []
    if (root.nodeType === 1) return [root]
    var out = []
    for (var i = 0; i < root.length; i++) {
      if (root[i] && root[i].nodeType === 1) out.push(root[i])
    }
    return out
  }

  function walk (container, units, depth) {
    var kids = elementChildren(container)
    for (var i = 0; i < kids.length; i++) classify(kids[i], units, depth)
  }

  function classify (el, units, depth) {
    var tag = tagOf(el)

    // A slot the page deliberately left hidden — an unfilled schedule
    // summary, an empty chip row — is not content. Revealing it would
    // change nothing on screen and only add dead time to the stream.
    if (el.hasAttribute && el.hasAttribute('hidden')) return

    if (tag === 'table') {
      units.push({ el: el, kind: 'table', parents: [] })
      return
    }

    if (tag === 'ul' || tag === 'ol') {
      var lis = elementChildren(el)
      var pushed = 0
      for (var i = 0; i < lis.length; i++) {
        if (tagOf(lis[i]) !== 'li') continue
        units.push({ el: lis[i], kind: 'prose', parents: pushed === 0 ? [el] : [] })
        pushed++
      }
      if (!pushed) units.push({ el: el, kind: 'block', parents: [] })
      return
    }

    if (PROSE_TAGS[tag]) {
      units.push({ el: el, kind: 'prose', parents: [] })
      return
    }

    // A generic container. Descend only when there's a table inside worth
    // cascading — otherwise the card reads better landing as one piece.
    if (el.querySelector && el.querySelector('table')) {
      var kids = elementChildren(el)
      // A lone table in a wrapper (the dataTable / prospectTable shape):
      // treat the wrapper itself as the table unit so its padding and
      // border arrive with the rows rather than ahead of them.
      if (kids.length === 1 && tagOf(kids[0]) === 'table') {
        units.push({ el: el, kind: 'table', parents: [] })
        return
      }
      if (depth < DEFAULTS.maxDepth) {
        var start = units.length
        walk(el, units, depth + 1)
        if (units.length > start) {
          // Hide the wrapper until the first thing inside it is reached.
          units[start].parents.unshift(el)
          return
        }
      }
    }

    units.push({ el: el, kind: 'block', parents: [] })
  }

  // Build the reveal order for one or more appended nodes.
  function buildUnits (root) {
    var units = []
    normalizeRoots(root).forEach(function (node) {
      messageBodies(node).forEach(function (body) {
        walk(body, units, 0)
      })
    })
    return units
  }

  // ── Streaming ───────────────────────────────────────────────────────

  function parentsOf (u) {
    var list = []
    if (u.showParent) list.push(u.showParent)
    if (u.parents && u.parents.length) list = list.concat(u.parents)
    return list
  }

  function setDisplay (list, value) {
    for (var i = 0; i < list.length; i++) list[i].style.display = value
  }

  // Tag the table and stamp each row's delay, so the cascade is pure CSS
  // once the unit is shown.
  function prepRows (el, rowStagger) {
    if (el.classList) el.classList.add('sh-stream-rows')
    var rows = el.querySelectorAll('tbody tr')
    for (var r = 0; r < rows.length; r++) {
      rows[r].style.animationDelay = (r * rowStagger) + 'ms'
    }
    return rows.length
  }

  // Take the animation back off once it has played, so the reveal is
  // genuinely one-shot.
  //
  // It has to come off, not just finish: these nodes get MOVED later. The
  // expanded-table dialog lifts a table out of the thread and puts it
  // back on close, and re-inserting a node restarts any CSS animation
  // still attached to it — which read as the prospect list re-dealing
  // itself every time the dialog opened and again when it closed.
  //
  // Safe to strip because both animations end on the value the element
  // has naturally (fully opaque), so removing them changes nothing on
  // screen.
  function settle (u) {
    if (u.kind === 'table') {
      if (u.el.classList) u.el.classList.remove('sh-stream-rows')
      var rows = u.el.querySelectorAll('tbody tr')
      for (var r = 0; r < rows.length; r++) rows[r].style.animationDelay = ''
      return
    }
    if (u.kind === 'block' && u.el.classList) {
      u.el.classList.remove('sh-stream-block-in')
    }
  }

  // Reveal units strictly top-to-bottom. `opts`:
  //   scroll     — called as content lands (inject the thread's scroller)
  //   onDone     — after the last unit settles
  //   gapMs      — per-word cadence (defaults to --stream-gap)
  //   fadeMs     — table row / block fade duration (matches --stream-fade)
  //   rowStagger — per-row delay inside a table cascade
  //   tailMs     — pause after a table/block before the next unit
  //   speed      — multiplier (2 = twice as fast). Divides the resolved
  //                timings so a conversation can retune without rewriting
  //                the token defaults.
  function streamUnits (units, opts) {
    opts = opts || {}
    var scroll = typeof opts.scroll === 'function' ? opts.scroll : noop
    var onDone = typeof opts.onDone === 'function' ? opts.onDone : null
    var speed = num(opts.speed, 1)
    if (!(speed > 0)) speed = 1
    var rowStagger = num(opts.rowStagger, DEFAULTS.rowStagger) / speed
    var fade = num(opts.fadeMs, DEFAULTS.fadeMs) / speed
    var gap = num(opts.gapMs, gapMs()) / speed
    var tail = num(opts.tailMs, DEFAULTS.tailMs) / speed

    var list = []
    for (var i = 0; i < (units || []).length; i++) {
      if (units[i] && units[i].el) list.push(units[i])
    }

    // Prepare every unit up front so nothing is measured or mutated
    // mid-stream.
    list.forEach(function (u) {
      u.parents = parentsOf(u)
      if (u.kind === 'prose') u.spans = wrapWords(u.el, [])
      if (u.kind === 'table') u.rowCount = prepRows(u.el, rowStagger)
      // Keep the CSS fade token in step with JS fadeMs/speed so word
      // transitions and row animations don't linger at the 1× duration.
      if (u.el && u.el.style && speed !== 1) {
        u.el.style.setProperty('--stream-fade', fade + 'ms')
      }
    })

    if (!list.length) { if (onDone) onDone(); return }

    if (reduced() || typeof window.setTimeout !== 'function') {
      list.forEach(function (u) {
        setDisplay(u.parents, '')
        u.el.style.display = ''
        ;(u.spans || []).forEach(function (s) { s.classList.add('is-in') })
        settle(u)
      })
      scroll()
      if (onDone) onDone()
      return
    }

    list.forEach(function (u) {
      u.el.style.display = 'none'
      setDisplay(u.parents, 'none')
    })

    var ui = 0
    function nextUnit () {
      if (ui >= list.length) { if (onDone) onDone(); return }
      var u = list[ui]; ui++
      setDisplay(u.parents, '')
      u.el.style.display = ''
      scroll()

      if (u.kind === 'table') {
        var hold = (u.rowCount ? (u.rowCount - 1) * rowStagger : 0) + fade + tail
        window.setTimeout(function () { settle(u); nextUnit() }, hold)
        return
      }

      if (u.kind === 'block') {
        u.el.classList.add('sh-stream-block-in')
        window.setTimeout(function () { settle(u); nextUnit() }, fade + tail)
        return
      }

      var spans = u.spans || []
      if (!spans.length) { window.setTimeout(nextUnit, gap); return }
      var wi = 0
      function stepWord () {
        if (wi >= spans.length) { nextUnit(); return }
        spans[wi].classList.add('is-in')
        wi++
        if (wi % 6 === 0) scroll()
        window.setTimeout(stepWord, gap)
      }
      stepWord()
    }
    nextUnit()
  }

  // Build + stream in one call — what most callers want.
  function reveal (root, opts) {
    var units = buildUnits(root)
    streamUnits(units, opts)
    return units
  }

  // ── Number pop-in (transitions.dev) ─────────────────────────────────
  // Roll a numeric result up from 0, rebuilding its `.t-digit` spans on
  // each change so the pop-in replays per tick — a motion-blurred
  // count-up that settles on the target. Non-numeric results ("loaded")
  // pop in as one unit.
  function renderCountUp (pEl, text) {
    var m = String(text).match(/^\s*(\d[\d,]*)(.*)$/)

    if (!m) {
      var solo = document.createElement('span')
      solo.className = 't-digit-group is-animating'
      var word = document.createElement('span')
      word.className = 't-digit'
      word.textContent = text
      solo.appendChild(word)
      pEl.appendChild(solo)
      return
    }

    var suffix = m[2] || ''
    var group = document.createElement('span')
    group.className = 't-digit-group is-animating'
    pEl.appendChild(group)
    if (suffix) {
      var suf = document.createElement('span')
      suf.textContent = suffix
      pEl.appendChild(suf)
    }
    rollNumber(group, parseInt(m[1].replace(/,/g, ''), 10))
  }

  function rollNumber (group, target) {
    if (reduced() || !isFinite(target) || target <= 0 ||
        typeof window.requestAnimationFrame !== 'function') {
      setDigits(group, formatInt(isFinite(target) ? target : 0))
      return
    }
    var DURATION = 700
    var startTs = null
    var lastVal = -1
    function frame (ts) {
      if (startTs === null) startTs = ts
      var t = Math.min(1, (ts - startTs) / DURATION)
      var eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      var val = Math.round(eased * target)
      if (val !== lastVal) { setDigits(group, formatInt(val)); lastVal = val }
      if (t < 1) window.requestAnimationFrame(frame)
      else if (lastVal !== target) setDigits(group, formatInt(target))
    }
    window.requestAnimationFrame(frame)
  }

  // Rebuild a group's digits. New elements inheriting `.is-animating`
  // start the pop-in from its 0% keyframe, so a rebuild = a replay.
  function setDigits (group, str) {
    while (group.firstChild) group.removeChild(group.firstChild)
    for (var i = 0; i < str.length; i++) {
      var d = document.createElement('span')
      d.className = 't-digit'
      if (i > 0) d.setAttribute('data-stagger', String(Math.min(i, 2)))
      d.textContent = str.charAt(i)
      group.appendChild(d)
    }
  }

  function formatInt (n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  window.ShStream = {
    reveal: reveal,
    buildUnits: buildUnits,
    streamUnits: streamUnits,
    wrapWords: wrapWords,
    gapMs: gapMs,
    reduced: reduced,
    countUp: { render: renderCountUp, roll: rollNumber }
  }
}(window, document));
