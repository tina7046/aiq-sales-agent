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
// The REVEAL is shared, though: the word-by-word prose stream and the
// staggered table cascade this page introduced now live in
// scripts/conversation_stream.js (`window.ShStream`) and drive the home
// conversation too. Only the script and the run card are local.
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

  // ── Reveal ──────────────────────────────────────────────────────────
  // The word-by-word prose stream and the staggered table cascade are in
  // scripts/conversation_stream.js now (`window.ShStream`), shared with
  // the home conversation. This page only supplies what is its own: the
  // thread's scroller and the row cadence from TIMING.
  //
  // `reveal` walks the appended message itself, so the discovery report's
  // headings, paragraphs, bullets and tables come back in document order
  // without this file describing that structure a second time.
  function stream (node, done) {
    if (!node || !window.ShStream) { if (done) done(); return }
    window.ShStream.reveal(node, {
      scroll: scrollToLatest,
      rowStagger: TIMING.rowStagger,
      onDone: done
    })
  }

  // ── Opening sequence ────────────────────────────────────────────────
  // Event-driven: each agent message streams in, and the next beat only
  // starts once the prior stream finishes.
  function playOpening () {
    setBusy(true)
    window.setTimeout(function () {
      stream(appendTpl('greeting'), function () {
        window.setTimeout(function () {
          appendTpl('user-start')
          playBeat('discovery', TIMING.discoveryThinking, LABELS.discovery, function (discoveryLi) {
            stream(discoveryLi, function () {
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
    use.setAttributeNS(XLINK, 'xlink:href', '/aiq-sales-agent/assets/icons/utility-sprite/svg/symbols.svg#' + spriteId)
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
      // Rolls up from 0 with the motion-blurred digit pop-in; falls back
      // to the plain string when the shared module is absent.
      if (window.ShStream) window.ShStream.countUp.render(count, String(t.count))
      else count.textContent = String(t.count)
      row.appendChild(count)
    }

    sec.tools.appendChild(row)
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
