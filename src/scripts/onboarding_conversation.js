// ──────────────────────────────────────────────────────────────────────
// Onboarding — scripted conversation player
// =====================================================================
// Owns /onboarding_conversation.html. Auto-plays a fixed onboarding
// script and wires the composer, mirroring the Seller Home ->
// conversation mechanic (echo the user, show a thinking indicator, then
// reveal the agent message on a timer) — see `playBeat` in
// home_conversation.js, which this is a slimmed, self-contained copy of.
//
// Deliberately NOT the shared home_conversation.js engine: that one is
// coupled to the conversations registry, recents, and workflow panels,
// and its agent messages can't carry the tables + bullet list this
// onboarding copy needs. Here the beats are inert <template>s authored
// in the page (data-ob-tpl="…") and cloned in order.
//
// Flow (from onboarding_conversation.md):
//   on load  -> greeting -> user "Start now" -> thinking -> discovery
//   on send  -> echo the typed text -> thinking (STOP; no reply yet)
//
// Boots off `[data-onboarding-conv-root]` and no-ops if it's absent, so
// the file is safe to load only where the markup exists.
// ──────────────────────────────────────────────────────────────────────

(function () {
  'use strict'

  var root = document.querySelector('[data-onboarding-conv-root]')
  if (!root) return

  var thread = root.querySelector('[data-ob-thread]')
  var scroller = root.querySelector('.seller-home__conv-thread')
  var form = root.querySelector('[data-sh-conv-composer]')
  var input = root.querySelector('[data-sh-conv-composer-input]')
  var sendBtn = root.querySelector('[data-sh-conv-composer-send]')

  if (!thread) return

  // ── Timing (ms) — grouped for easy tuning ──────────────────────────
  var TIMING = {
    greetingDelay: 250,    // pause before the greeting lands
    afterGreeting: 500,    // greeting stream done -> user "Start now"
    discoveryThinking: 2600, // thinking before the discovery message
    runThinking: 2000,     // echo -> thinking -> run card after the answer
    rowStagger: 90         // per-row delay in a table's staggered fade cascade
  }

  // Thinking-label copy per beat.
  var LABELS = {
    discovery: 'Inspecting your Salesforce org\u2026',
    send: 'Scoping the analysis\u2026'
  }

  // ── Templates ───────────────────────────────────────────────────────
  var TEMPLATES = {}
  var tplNodes = root.querySelectorAll('[data-ob-tpl]')
  for (var i = 0; i < tplNodes.length; i++) {
    TEMPLATES[tplNodes[i].getAttribute('data-ob-tpl')] = tplNodes[i]
  }

  var busy = false
  var runStarted = false

  // Run-card config (three placeholder steps for now; real steps drop into
  // the [data-ob-run-config] JSON in the page).
  var runCfg = (function () {
    var node = root.querySelector('[data-ob-run-config]')
    if (!node) return null
    try { return JSON.parse(node.textContent) } catch (e) { return null }
  })()

  function num (v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d }

  function cloneTpl (name) {
    var tpl = TEMPLATES[name]
    if (!tpl || !tpl.content || typeof tpl.content.cloneNode !== 'function') {
      return null
    }
    return tpl.content.cloneNode(true)
  }

  function scrollToLatest () {
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }

  function appendTpl (name) {
    var frag = cloneTpl(name)
    if (!frag) return null
    var el = frag.firstElementChild
    thread.appendChild(frag)
    scrollToLatest()
    return el
  }

  // Append the thinking indicator and return its <li> so it can be
  // removed when the beat resolves. The label is rewritten per beat.
  function appendThinking (label) {
    var frag = cloneTpl('thinking')
    if (!frag) return null
    if (label) {
      var labelEl = frag.querySelector('[data-sh-conv-thinking-label]')
      if (labelEl) labelEl.textContent = label
    }
    var li = frag.querySelector('[data-sh-conv-thinking]')
    thread.appendChild(frag)
    scrollToLatest()
    return li
  }

  function removeNode (node) {
    if (node && node.parentNode) node.parentNode.removeChild(node)
  }

  function setBusy (on) {
    busy = on
    thread.setAttribute('aria-busy', on ? 'true' : 'false')
    updateSendState()
  }

  // thinking (for `ms`) -> remove -> reveal `name`, then `done(el)` with
  // the appended message element so the caller can stream it.
  function playBeat (name, ms, label, done) {
    var indicator = appendThinking(label)
    window.setTimeout(function () {
      removeNode(indicator)
      var el = appendTpl(name)
      if (done) done(el)
    }, ms)
  }

  // ── Streaming text (transitions.dev) ────────────────────────────────
  // Agent prose reveals word-by-word: wrap each word in a `.t-stream-w`
  // span (resting invisible + blurred via onboarding_conversation.css),
  // then add `.is-in` one word at a time every `--stream-gap`.
  var STREAM_REDUCE = (typeof matchMedia === 'function') &&
    matchMedia('(prefers-reduced-motion: reduce)').matches

  function streamGapMs () {
    try {
      var raw = getComputedStyle(document.documentElement).getPropertyValue('--stream-gap')
      var n = parseFloat(raw)
      if (!isFinite(n) || n <= 0) return 60
      // Seconds vs milliseconds.
      return (String(raw).indexOf('ms') === -1 && String(raw).indexOf('s') !== -1) ? n * 1000 : n
    } catch (e) { return 60 }
  }

  // Turn `el`'s inline content into reveal units: each word of a text node
  // becomes a `.t-stream-w` span, and each inline element (<strong>,
  // <code>) is tagged as ONE `.t-stream-w` unit so it — background and all
  // — stays fully hidden until revealed (no grey-pill skeletons). Collects
  // the units, in document order, into `out`.
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

  // Reveal a sequence of units STRICTLY top-to-bottom. Everything not yet
  // reached is `display:none`, so nothing shows below the cursor — no
  // premature tables, empty bullets, or skeleton chips. Prose units type in
  // word-by-word; a table reveals as a whole and its rows cascade in with a
  // staggered fade; the stream then continues below.
  //   units: [{ el, kind: 'prose'|'table', showParent? }]
  function streamUnits (units, done) {
    // Pre-wrap prose so its words rest hidden before the unit is shown.
    units.forEach(function (u) {
      if (u.kind === 'prose') u.spans = wrapWords(u.el, [])
    })

    if (STREAM_REDUCE || typeof window.setTimeout !== 'function') {
      units.forEach(function (u) {
        if (u.showParent) u.showParent.style.display = ''
        u.el.style.display = ''
        ;(u.spans || []).forEach(function (s) { s.classList.add('is-in') })
      })
      scrollToLatest()
      if (done) done()
      return
    }

    // Hide every unit (and any parent container) until it is reached.
    units.forEach(function (u) {
      u.el.style.display = 'none'
      if (u.showParent) u.showParent.style.display = 'none'
    })

    var gap = streamGapMs()
    var ui = 0
    function nextUnit () {
      if (ui >= units.length) { if (done) done(); return }
      var u = units[ui]; ui++
      if (u.showParent) u.showParent.style.display = ''
      u.el.style.display = ''
      scrollToLatest()

      if (u.kind === 'table') {
        // Rows cascade in via a CSS stagger (per-row animation-delay set in
        // discoveryUnits). Hold until the cascade lands, then continue.
        var trs = u.el.querySelectorAll('tbody tr')
        var FADE = 350 // matches --stream-fade
        var hold = (trs.length ? (trs.length - 1) * TIMING.rowStagger : 0) + FADE + 120
        window.setTimeout(nextUnit, hold)
        return
      }

      var spans = u.spans || []
      if (!spans.length) { window.setTimeout(nextUnit, gap); return }
      var wi = 0
      function stepWord () {
        if (wi >= spans.length) { nextUnit(); return }
        spans[wi].classList.add('is-in')
        wi++
        if (wi % 6 === 0) scrollToLatest()
        window.setTimeout(stepWord, gap)
      }
      stepWord()
    }
    nextUnit()
  }

  // Ordered reveal units for the discovery report: headings/paragraphs as
  // prose, each bullet as its own prose unit, and each table as a whole
  // unit whose rows cascade in with a staggered fade (per-row
  // animation-delay set here; the table is tagged `ob-streaming`). The
  // first bullet of a list carries its <ul> so it stays hidden until reached.
  function discoveryUnits (li) {
    var rich = li ? li.querySelector('.onboarding-conv__rich') : null
    if (!rich) return []
    var units = []
    Array.prototype.slice.call(rich.children).forEach(function (child) {
      var tag = child.tagName ? child.tagName.toLowerCase() : ''
      if (tag === 'table') {
        child.classList.add('ob-streaming')
        var trs = child.querySelectorAll('tbody tr')
        for (var r = 0; r < trs.length; r++) {
          trs[r].style.animationDelay = (r * TIMING.rowStagger) + 'ms'
        }
        units.push({ el: child, kind: 'table' })
      } else if (tag === 'ul') {
        var lis = child.querySelectorAll('li')
        for (var i = 0; i < lis.length; i++) {
          units.push({ el: lis[i], kind: 'prose', showParent: i === 0 ? child : null })
        }
      } else {
        units.push({ el: child, kind: 'prose' })
      }
    })
    return units
  }

  // ── Opening sequence ────────────────────────────────────────────────
  // Event-driven: each agent message streams in, and the next beat only
  // starts once the prior stream finishes.
  function playOpening () {
    setBusy(true)
    window.setTimeout(function () {
      var greeting = appendTpl('greeting')
      var paras = greeting
        ? Array.prototype.slice.call(greeting.querySelectorAll('.seller-home__conv-msg-agent-text'))
        : []
      var greetUnits = paras.map(function (p) { return { el: p, kind: 'prose' } })
      streamUnits(greetUnits, function () {
        window.setTimeout(function () {
          appendTpl('user-start')
          playBeat('discovery', TIMING.discoveryThinking, LABELS.discovery, function (discoveryLi) {
            streamUnits(discoveryUnits(discoveryLi), function () {
              setBusy(false)
              if (input && typeof input.focus === 'function') input.focus()
            })
          })
        }, TIMING.afterGreeting)
      })
    }, TIMING.greetingDelay)
  }

  // ── Composer ────────────────────────────────────────────────────────
  function composerText () {
    var raw = input && input.textContent ? input.textContent : ''
    // Normalize the nbsp contenteditable can inject on space.
    return raw.replace(/\u00a0/g, ' ').trim()
  }

  function updatePlaceholder () {
    if (input) input.classList.toggle('is-empty', composerText().length === 0)
  }

  function updateSendState () {
    if (sendBtn) sendBtn.disabled = busy || composerText().length === 0
  }

  function clearComposer () {
    if (input) input.textContent = ''
    updatePlaceholder()
    updateSendState()
  }

  function appendUserEcho (text) {
    var frag = cloneTpl('user-echo')
    if (!frag) return
    var textEl = frag.querySelector('[data-sh-conv-msg-text]')
    if (textEl) textEl.textContent = text
    thread.appendChild(frag)
    scrollToLatest()
  }

  // type -> Send: echo the user, a short thinking beat, then kick off the
  // long-running task (the run card). Fires once; later sends no-op.
  function submit () {
    if (busy || runStarted) return
    var text = composerText()
    if (!text) return

    runStarted = true
    appendUserEcho(text)
    clearComposer()
    setBusy(true)

    var indicator = appendThinking(LABELS.send)
    window.setTimeout(function () {
      removeNode(indicator)
      var frag = cloneTpl('run')
      if (!frag) { setBusy(false); return }
      var card = frag.querySelector('.rl-run')
      thread.appendChild(frag)
      scrollToLatest()
      startRun(card)
    }, TIMING.runThinking)
  }

  // ── Run card (long-running task) ────────────────────────────────────
  // A slim, self-contained port of running_lab.js scoped to the appended
  // card. Plays `runCfg.phases` over ~totalMs and ends at "Completed".
  // (The lab's own engine can't drive this — it self-starts on page load.)
  function startRun (card) {
    if (!card || !runCfg || !runCfg.phases || !runCfg.phases.length) {
      setBusy(false)
      return
    }

    var phases = runCfg.phases
    var startDelay = num(runCfg.startDelay, 500)
    var phaseGap = num(runCfg.phaseGapMs, 800)
    var totalMs = num(runCfg.totalMs, 60000)

    var totalSubsteps = 0
    phases.forEach(function (p) { totalSubsteps += (p.substeps && p.substeps.length) || 1 })

    // Per-sub-step dwell derived so the run lands on ~totalMs no matter how
    // many sub-steps the steps carry.
    var stepMs = Math.max(
      400,
      Math.round((totalMs - startDelay - (phases.length - 1) * phaseGap) / Math.max(1, totalSubsteps))
    )

    var cycleEl = card.querySelector('[data-rl-cot-cycle]')
    var labelEl = card.querySelector('[data-rl-status-label]')
    var elapsedEl = card.querySelector('[data-rl-elapsed]')
    var headerToggle = card.querySelector('[data-rl-cot-toggle]')

    var sections = {}
    phases.forEach(function (p) {
      var el = card.querySelector('[data-rl-phase="' + p.key + '"]')
      if (!el) return
      sections[p.key] = {
        el: el,
        name: el.querySelector('[data-rl-phase-name]'),
        tools: el.querySelector('[data-rl-tools]'),
        toggle: el.querySelector('[data-rl-phase-toggle]')
      }
    })

    // Collapse / expand the whole card from its header.
    if (headerToggle) {
      headerToggle.addEventListener('click', function () {
        var collapsed = card.classList.toggle('is-collapsed')
        headerToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
      })
    }

    // A finished (is-done) step can be expanded to show its details.
    Object.keys(sections).forEach(function (key) {
      var sec = sections[key]
      if (!sec.toggle) return
      sec.toggle.addEventListener('click', function () {
        if (!sec.el.classList.contains('is-done')) return
        var expanded = sec.el.classList.toggle('is-expanded')
        sec.toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
      })
    })

    // Elapsed timer (same format as the lab: "N secs" / "N mins").
    var timerStart = Date.now()
    var timerId = null
    function fmt (total) {
      function pick (v, u) { return v + ' ' + u + (v === 1 ? '' : 's') }
      if (total < 60) return pick(total, 'sec')
      if (total < 3600) return pick(Math.floor(total / 60), 'min')
      return pick(Math.floor(total / 3600), 'hr')
    }
    function tick () {
      if (elapsedEl) elapsedEl.textContent = fmt(Math.floor((Date.now() - timerStart) / 1000))
    }
    tick()
    timerId = window.setInterval(tick, 1000)

    function setHeadline (p) {
      if (cycleEl) cycleEl.textContent = (p && (p.running || p.name)) || ''
    }

    function activatePhase (p) {
      var sec = sections[p.key]
      if (!sec) return
      sec.el.classList.remove('is-pending', 'is-done', 'is-expanded')
      sec.el.classList.add('is-active')
      if (sec.toggle) sec.toggle.setAttribute('aria-expanded', 'false')
      setHeadline(p)
    }

    function completePhase (p) {
      var sec = sections[p.key]
      if (!sec) return
      sec.el.classList.remove('is-active')
      sec.el.classList.add('is-done')
      if (sec.name) sec.name.textContent = p.name || ''
    }

    // A sub-step is a label string or { label, icon, count }. Rendered as
    // one of the run card's chain-of-thought rows (`appendTool`), so the
    // styling is byte-for-byte the running lab's — grey utility icon +
    // muted label — rather than a bespoke list.
    function normSub (s) { return (typeof s === 'string') ? { label: s } : (s || {}) }

    var pi = 0
    function playPhase () {
      var p = phases[pi]
      var sec = sections[p.key]
      activatePhase(p)

      var subs = ((p.substeps && p.substeps.length) ? p.substeps : []).map(normSub)
      var si = 0

      // Append one chain-of-thought row per sub-step, accumulating over the
      // step's dwell exactly like the lab's tool rows. The first row lands
      // immediately so the active step's body reveals without a gap (the
      // lab hides an active body until it has a `.rl-cot__tools` child).
      function step () {
        if (si < subs.length) {
          appendTool(sec, subs[si])
          si++
          window.setTimeout(step, stepMs)
          return
        }
        completePhase(p)
        pi++
        if (pi < phases.length) window.setTimeout(playPhase, phaseGap)
        else finish()
      }

      step()
    }

    function finish () {
      if (timerId) { window.clearInterval(timerId); timerId = null }
      if (labelEl) labelEl.textContent = runCfg.summary ? 'Completed \u2014 ' + runCfg.summary : 'Completed'
      // CSS off `is-complete` swaps spinner -> chevron and shows the label;
      // `is-collapsed` folds the chain-of-thought shut.
      card.classList.add('is-complete')
      card.classList.add('is-collapsed')
      if (headerToggle) headerToggle.setAttribute('aria-expanded', 'false')
      // Terminal state — leave the composer disabled.
    }

    window.setTimeout(playPhase, startDelay)
  }

  // Tool / source row — built as DOM (not HTML strings). Mirrors the lab's
  // `agent-reasoning__tool` rows. Only used when a beat carries `tools`.
  function svgUse (spriteId) {
    var NS = 'http://www.w3.org/2000/svg'
    var XLINK = 'http://www.w3.org/1999/xlink'
    var svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('class', 'slds-icon slds-icon-text-default slds-icon_x-small')
    svg.setAttribute('aria-hidden', 'true')
    var use = document.createElementNS(NS, 'use')
    use.setAttributeNS(XLINK, 'xlink:href', '/assets/icons/utility-sprite/svg/symbols.svg#' + spriteId)
    svg.appendChild(use)
    return svg
  }

  function appendTool (sec, t) {
    if (!sec.tools || !t) return
    var iconClass = String(t.icon || '').replace(/_/g, '-')

    var row = document.createElement('div')
    row.className = 'slds-grid slds-grid_vertical-align-center slds-text-color_weak slds-p-left_xxx-small agent-reasoning__tool'
    row.setAttribute('role', 'status')

    var iconWrap = document.createElement('span')
    iconWrap.className = 'slds-icon_container slds-icon-utility-' + iconClass + ' agent-reasoning__tool-icon'
    if (t.label) iconWrap.title = t.label
    iconWrap.appendChild(svgUse(t.icon))
    var at = document.createElement('span')
    at.className = 'slds-assistive-text'
    at.textContent = t.label || ''
    iconWrap.appendChild(at)

    var label = document.createElement('p')
    label.className = 'slds-col slds-text-body_small slds-p-horizontal_x-small slds-truncate'
    if (t.label) label.title = t.label
    label.textContent = t.label || ''

    row.appendChild(iconWrap)
    row.appendChild(label)

    if (t.count) {
      var count = document.createElement('p')
      count.className = 'slds-col_bump-left slds-text-body_small'
      renderCountUp(count, String(t.count))
      row.appendChild(count)
    }

    sec.tools.appendChild(row)
  }

  // ── Result counter (transitions.dev "Number pop-in") ────────────────
  // Roll a numeric result up from 0, rebuilding its `.t-digit` spans on
  // each change so the pop-in replays per tick — a motion-blurred count-up
  // that settles on the target. Non-numeric results ("loaded") pop in as
  // one unit.
  function renderCountUp (pEl, text) {
    var m = text.match(/^\s*(\d[\d,]*)(.*)$/)

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

  // Roll a single `.t-digit-group` from 0 up to `target`. Shared by the
  // run-card counters and the table cell numbers.
  function rollNumber (group, target) {
    var reduce = (typeof matchMedia === 'function') && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !isFinite(target) || target <= 0 || typeof window.requestAnimationFrame !== 'function') {
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

  if (input) {
    input.addEventListener('input', function () {
      updatePlaceholder()
      updateSendState()
    })
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return
      if (event.shiftKey) return
      if (event.isComposing || event.keyCode === 229) return
      event.preventDefault()
      submit()
    })
  }

  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault()
      submit()
    })
  }

  updatePlaceholder()
  updateSendState()
  playOpening()
})()
