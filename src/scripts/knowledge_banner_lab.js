/*
  Knowledge banner LAB — dismiss behaviour
  =====================================================================
  Drives /knowledge_banner_lab.html. Everything in the "COPIED" section
  below is lifted from home.js, function for function and comment for
  comment, so a change tried here can be pasted straight back:

    readKnowledgeBannerDismissed / writeKnowledgeBannerDismissed
    bindKnowledgeBanner
    readBannerTiming
    planContentSettle

  Two deliberate differences from production, both about the lab being a
  place to run the thing repeatedly rather than once:

    • Nothing is persisted. The real binder writes a sessionStorage flag
      so the banner stays dismissed across page loads, and reads it on
      bind to hide the banner outright. Here the write is a no-op and
      the read always returns false, so Replay always has a banner to
      dismiss. That's the ONLY edit inside the copied functions — see
      the two marked lines.

    • The page owns a Replay button, which restores the banner to its
      pre-dismiss state and re-binds. That lives in the lab section at
      the bottom and must never be ported.

  The four timings are NOT set here. They're custom properties on the
  stage, written by the toolbar, and read back out of the DOM by
  readBannerTiming — the same indirection production uses, which is what
  makes the sliders work without this file knowing they exist.
*/
;(function () {
  'use strict'

  // ══════════════════════════════════════════════════════════════════
  // COPIED from home.js — port changes below this line back verbatim
  // ══════════════════════════════════════════════════════════════════

  // ── LAB EDIT — the only change inside the copied functions ─────
  // Production reads and writes 'sh:knowledgeBannerDismissed' in
  // sessionStorage, wrapped in try/catch for the storage-unavailable
  // case, so the banner stays dismissed across page loads:
  //
  //   read:  return window.sessionStorage.getItem(KEY) === 'true'
  //   write: window.sessionStorage.setItem(KEY, 'true')
  //
  // Here both are stubbed. The read always says "not dismissed", so
  // Replay always has a banner to work on, and the write does nothing,
  // so reloading the lab doesn't start it in the dismissed state.
  //
  // Kept as functions rather than deleted because the copied binder
  // calls both, and that call is part of what's being ported.
  function readKnowledgeBannerDismissed () {
    return false
  }

  function writeKnowledgeBannerDismissed () {}

  // ── Phase 5c — Knowledge banner dismiss ────────────────────────
  // "Got it" hides the banner for the rest of the session, and the
  // Home tab is the only thing that brings it back.
  //
  // The scope is deliberately in between the two obvious choices.
  // Forgetting immediately meant the banner returned on every page
  // load, so drilling into a doc and hitting Back put it right back on
  // screen — those are full page navigations here, not view swaps.
  // Remembering forever (localStorage) would mean whoever dismissed it
  // once never sees it again, and this is a surface people demo
  // repeatedly. Session scope with a reset on Home gives both: it
  // stays gone while you move around, and a run-through can start over.
  //
  // `hidden` rather than removal so the element can come back without
  // re-rendering, and so the reason it's gone is legible in the
  // inspector. It also takes the banner out of the accessibility tree,
  // which display:none via a class would do too but less obviously.
  //
  // It fades and dips in scale on the way out rather than blinking off,
  // and the rest of the column glides up to meet it. The curves are in
  // home.scss; what lives here is the scheduling and the measurement.
  function bindKnowledgeBanner (bannerRoot) {
    var dismiss = bannerRoot.querySelector('[data-sh-knowledge-banner-dismiss]')
    if (!dismiss) return

    // Normally the preload script in knowledge.html has already hidden
    // the banner before this runs — it has to, or there'd be a frame of
    // banner before the script loaded. This is the fallback for when
    // that didn't happen (storage threw on the first read but not the
    // second, markup used without the preload). Nothing to animate: the
    // banner was dismissed on a previous page, so it just isn't here.
    if (readKnowledgeBannerDismissed()) {
      bannerRoot.hidden = true
      return
    }

    dismiss.addEventListener('click', function () {
      // A second click would queue a second cleanup.
      if (bannerRoot.classList.contains('is-dismissing')) return

      writeKnowledgeBannerDismissed()

      var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) {
        bannerRoot.hidden = true
        return
      }

      var timing = readBannerTiming(bannerRoot)

      // Measure BEFORE the fade starts. The measurement briefly sets
      // `hidden`, which is `display: none`, and taking an element out
      // of the box tree cancels any transition running on it — doing
      // this mid-fade snapped the banner straight to invisible at the
      // exact moment the glide began, which is precisely the overlap
      // this is trying to create. Nothing is animating yet at click
      // time, so there's nothing to cancel.
      var runSettle = planContentSettle(bannerRoot)

      bannerRoot.classList.add('is-dismissing')

      // Start the glide partway into the fade so the two overlap
      // instead of running back to back. Driven by a timer rather than
      // the fade's `transitionend`, which by definition can only fire
      // at the end — there's no event for "partway".
      window.setTimeout(function () {
        runSettle(timing.settle)
      }, timing.delay)
    })
  }

  // The timings behind the dismiss, read off the element so the
  // stylesheet stays the one place they're written down. They're
  // declared on the column in home.scss and inherit to the banner.
  //
  // `delay` is how far into the fade the glide starts, and it's the one
  // of the three that only the script can act on — there's no CSS way
  // to say "begin this transition partway through that one".
  function readBannerTiming (bannerRoot) {
    var fade = 150
    var settle = 200
    var delay = 75
    try {
      var cs = window.getComputedStyle(bannerRoot)
      fade = parseFloat(cs.getPropertyValue('--knowledge-banner-fade')) || fade
      settle = parseFloat(cs.getPropertyValue('--knowledge-banner-settle')) || settle
      var raw = parseFloat(cs.getPropertyValue('--knowledge-banner-glide-delay'))
      delay = isNaN(raw) ? fade / 2 : raw
    } catch (e) {
      // Fall through to the defaults, which mirror home.scss.
    }
    return { fade: fade, settle: settle, delay: delay }
  }

  // Plans the second half of the dismiss: everything below the banner
  // sliding up into the space the banner is about to vacate. Returns
  // the function that runs it, so the measuring and the moving can sit
  // at different points on the clock.
  //
  // The split is what makes the overlap possible. The straightforward
  // version hides the banner and eases the resulting jump, but hiding
  // is `display: none` — it collapses the layout AND cancels the fade,
  // so the glide could only ever start once the banner was gone. Here
  // the banner stays in flow at full height while the siblings move
  // over it, and the distance comes from a measurement taken earlier,
  // at click time, before there was any transition to disturb.
  //
  // That measurement is itself a hide-read-unhide, all in one
  // synchronous block so the browser computes the collapsed layout
  // without painting it. Cheap and exact — it accounts for the column's
  // gap and any margins without this needing to know about them.
  //
  // The siblings are then translated UP by that distance, which lands
  // them exactly where the layout will put them once the banner goes.
  // That's what makes the final handoff invisible: dropping the
  // transform and hiding the banner in the same frame cancel out to
  // zero net movement. Either one alone would jump the full distance.
  function planContentSettle (bannerRoot) {
    // Everything after the banner that actually renders. The filter
    // isn't hypothetical: the banner's immediate next sibling in
    // knowledge.html is the inline preload script, and a `<script>`
    // generates no box, so measuring it yields zeroes.
    var movers = []
    var next = bannerRoot.nextElementSibling
    while (next) {
      if (next.getClientRects().length) movers.push(next)
      next = next.nextElementSibling
    }

    var i
    var shifted = []
    var deltas = []

    if (movers.length) {
      var before = []
      for (i = 0; i < movers.length; i++) {
        before.push(movers[i].getBoundingClientRect().top)
      }

      bannerRoot.hidden = true
      for (i = 0; i < movers.length; i++) {
        var delta = before[i] - movers[i].getBoundingClientRect().top
        if (!delta) continue
        shifted.push(movers[i])
        deltas.push(delta)
      }
      bannerRoot.hidden = false

      // Unhiding isn't enough on its own. The reads above forced a
      // style recalc while the banner was `display: none`, so that's
      // the last state the browser has on record for it — and an
      // element coming back from `display: none` doesn't transition.
      // Without this read, the caller's `is-dismissing` class would
      // apply opacity 0 with no fade at all. Forcing layout here puts
      // "displayed, opaque" on the record first, so the class that
      // follows has something to animate away from.
      void bannerRoot.offsetHeight
    }

    return function runSettle (settleMs) {
      function dropBanner () {
        bannerRoot.hidden = true
        bannerRoot.classList.remove('is-dismissing')
      }

      // Banner is the last rendered thing in the column, or nothing
      // moved — no glide to run, so just let it go.
      if (!shifted.length) {
        dropBanner()
        return
      }

      // Arm the transition before the offset, with a reflow between
      // them. A property can only animate if its `transition` was
      // already in effect on the previous style computation — set both
      // at once and the elements teleport.
      var j
      for (j = 0; j < shifted.length; j++) shifted[j].classList.add('is-settling')
      void shifted[0].offsetHeight
      for (j = 0; j < shifted.length; j++) {
        shifted[j].style.transform = 'translateY(' + (-deltas[j]) + 'px)'
      }

      // The handoff. All of this has to land in the same frame: drop
      // the transition first so clearing the transform doesn't animate
      // back, then clear it, then take the banner out of flow. The
      // elements are left exactly as they were found.
      window.setTimeout(function () {
        for (var k = 0; k < shifted.length; k++) {
          shifted[k].classList.remove('is-settling')
          shifted[k].style.transform = ''
        }
        dropBanner()
      }, settleMs)
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // LAB ONLY — never port anything below this line
  // ══════════════════════════════════════════════════════════════════

  // All of them, not one: the page renders the banner once per backdrop
  // variant so they can be compared, and each needs its own dismiss.
  // A dismissed banner keeps its place in the DOM — `dropBanner` sets
  // the `hidden` attribute rather than removing the element — so this
  // list stays valid for the life of the page.
  var banners = document.querySelectorAll('[data-sh-knowledge-banner]')
  if (!banners.length) return

  // One snapshot per banner, taken as authored, so Replay can put each
  // back exactly as its first run started — including any classes or
  // inline styles a half-finished dismiss left behind. `current` tracks
  // the live element, since Replay swaps in a fresh clone each time.
  var slots = []
  for (var i = 0; i < banners.length; i++) {
    slots.push({ current: banners[i], pristine: banners[i].cloneNode(true) })
    bindKnowledgeBanner(banners[i])
  }

  var replay = document.querySelector('[data-kb-replay]')
  if (replay) {
    replay.addEventListener('click', function () {
      for (var s = 0; s < slots.length; s++) {
        var slot = slots[s]
        var fresh = slot.pristine.cloneNode(true)
        slot.current.parentNode.replaceChild(fresh, slot.current)
        slot.current = fresh

        // The siblings can still be carrying the glide's transform if
        // Replay is hit mid-dismiss.
        var next = fresh.nextElementSibling
        while (next) {
          next.classList.remove('is-settling')
          next.style.transform = ''
          next = next.nextElementSibling
        }

        bindKnowledgeBanner(fresh)
      }
    })
  }

  // ── Toolbar ───────────────────────────────────────────────────────
  // Writes the four motion tokens as live values. Nothing here talks to
  // the component: the copied CSS and the copied script both read these
  // off the DOM, which is the whole reason the sliders work at all.
  //
  // They go on the COLUMN, not the stage around it, because the copied
  // `.kb-column` rule declares them itself — a value inherited from an
  // ancestor loses to that, so setting them one level up would do
  // nothing. Inline styles outrank the rule, so this is the one place
  // the toolbar can win from.
  var tokenHost = document.querySelector('[data-kb-tokens]')

  function bindControl (el) {
    var prop = el.getAttribute('data-kb-token')
    var unit = el.getAttribute('data-kb-unit') || ''
    var out = document.querySelector('[data-kb-value="' + prop + '"]')

    function apply () {
      var value = el.value + unit
      if (tokenHost) tokenHost.style.setProperty(prop, value)
      if (out) out.textContent = value
    }

    // Both events: ranges report on 'input', and 'change' is the one a
    // <select> is guaranteed to fire.
    el.addEventListener('input', apply)
    el.addEventListener('change', apply)
    apply()
  }

  var controls = document.querySelectorAll('[data-kb-token]')
  for (var i = 0; i < controls.length; i++) bindControl(controls[i])
}())
