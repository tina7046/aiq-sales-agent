/* ══════════════════════════════════════════════════════════════════════
   "Your agent at work" — PROTOTYPE behaviour
   ----------------------------------------------------------------------
   Standalone controller for the `_agent_at_work.html` component. Boots
   off `[data-aaw-root]` and does nothing when that element is absent, so
   it's safe to load on any page.

   Deliberately not part of home.js: the prototype should be freely
   rewritable without touching the file the live Seller Home page runs on.
   When the iteration settles, this folds back in as one more controller
   there.

   Requires GSAP + Flip (loaded on agent_at_work.html) for the two list
   motions. Both degrade to instant DOM changes when GSAP is missing or
   the user has asked for reduced motion.

   What it wires:
     • Row kebab      — open/close, ESC, click-outside, Arrow cycling
     • Section kebab  — same menu behaviour, one instance
     • Dismiss        — slides the row out, collapses the space, removes
     • Pause / resume — the status button on either row treatment, plus
                        the Flip reshuffle that re-sorts the list
     • Card click     — reports the selection; the row's own <a>/<button>
                        does the navigating
     • Date           — re-stamped from the browser clock on load

   Every custom event bubbles off the section root, so a host page can
   listen without reaching inside:
     `aaw:card-select`, `aaw:row-action`, `aaw:overflow-action`,
     `aaw:run-toggle`.
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict'

  function emit (el, name, detail) {
    el.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true }))
  }

  // ── Motion ──────────────────────────────────────────────────────────
  // Two list motions, both GSAP:
  //
  //   dismiss    the row slides left and fades, then collapses its own
  //              height and margin so the rows below close up over it
  //   reshuffle  Flip records where every row is, the row is moved in
  //              the DOM, and Flip tweens all of them to their new
  //              positions — used when pausing drops a row to the end
  //              of the list, or resuming lifts it back
  //
  // Both are optional. GSAP comes off a CDN, and someone reading this
  // prototype on a plane should still be able to dismiss a row, so every
  // animated path has an instant one behind it.
  var MOTION = {
    slide: 0.4,      // dismiss: travel out
    collapse: 0.4,   // dismiss: close the space
    shuffle: 0.5,    // reshuffle: reorder
    offset: -300,    // dismiss: how far left the card travels
    ease: 'power2.inOut'
  }

  function canAnimate () {
    return typeof gsap !== 'undefined' &&
      typeof Flip !== 'undefined' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  // "Mon August 17" — weekday + month + day, no comma. Same shape (and
  // same reason for `formatToParts`: en-US inserts a comma after the
  // weekday) as the `today()` global in gulpfile.js, so the value the
  // build stamps in and the one we swap in here agree.
  function todayLabel () {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'long', day: 'numeric'
    })
      .formatToParts(new Date())
      .filter(function (p) { return ['weekday', 'month', 'day'].indexOf(p.type) !== -1 })
      .map(function (p) { return p.value })
      .join(' ')
  }

  // ── Menus ───────────────────────────────────────────────────────────
  // One implementation for both the row kebab and the section overflow;
  // they only differ in which elements they're handed.
  function bindMenu (trigger, list, onAction, actionAttr) {
    if (!trigger || !list) return

    function items () {
      return Array.prototype.slice.call(list.querySelectorAll('[role="menuitem"]'))
    }

    function close (returnFocus) {
      if (list.hidden) return
      list.hidden = true
      trigger.setAttribute('aria-expanded', 'false')
      if (returnFocus) trigger.focus()
    }

    function open () {
      // Only one menu on the page at a time.
      document.dispatchEvent(new CustomEvent('aaw:menu-open', { detail: { list: list } }))
      list.hidden = false
      trigger.setAttribute('aria-expanded', 'true')
      var first = items()[0]
      if (first) first.focus()
    }

    trigger.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      if (list.hidden) open()
      else close(true)
    })

    list.addEventListener('keydown', function (event) {
      var all = items()
      var at = all.indexOf(document.activeElement)

      if (event.key === 'Escape') {
        event.preventDefault()
        close(true)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        all[(at + 1) % all.length].focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        all[(at - 1 + all.length) % all.length].focus()
      } else if (event.key === 'Tab') {
        close(false)
      }
    })

    list.addEventListener('click', function (event) {
      var item = event.target.closest('[' + actionAttr + ']')
      if (!item) return
      event.preventDefault()
      close(false)
      onAction(item.getAttribute(actionAttr), item)
    })

    document.addEventListener('aaw:menu-open', function (event) {
      if (event.detail.list !== list) close(false)
    })

    document.addEventListener('click', function (event) {
      if (!list.hidden && !list.contains(event.target) && !trigger.contains(event.target)) close(false)
    })
  }

  function bindRowMenus (root) {
    root.querySelectorAll('[data-aaw-menu]').forEach(function (menu) {
      var card = menu.closest('[data-aaw-card]')

      bindMenu(
        menu.querySelector('[data-aaw-menu-trigger]'),
        menu.querySelector('[data-aaw-menu-list]'),
        function (actionId) {
          emit(root, 'aaw:row-action', {
            actionId: actionId,
            cardId: card ? card.getAttribute('data-aaw-card') : null
          })
          if (actionId === 'dismiss') dismiss(card)
        },
        'data-aaw-menu-action'
      )
    })
  }

  function bindOverflow (root) {
    var overflow = root.querySelector('[data-aaw-overflow]')
    if (!overflow) return

    bindMenu(
      overflow.querySelector('[data-aaw-overflow-trigger]'),
      overflow.querySelector('[data-aaw-overflow-menu]'),
      function (actionId) { emit(root, 'aaw:overflow-action', { actionId: actionId }) },
      'data-aaw-overflow-action'
    )
  }

  // Dismiss — the "mark as complete" motion. The card slides out on its
  // own, then the `<li>` behind it collapses; the collapse starts before
  // the slide finishes so the list is already closing while the card is
  // still leaving, which reads as one gesture rather than two steps.
  //
  // The card and the `<li>` have different jobs on purpose: transforms
  // on the card can't move its neighbours, and height on the `<li>` is
  // what actually makes the rows below travel up.
  function dismiss (card) {
    if (!card) return
    var row = card.closest('.aaw__list-item') || card

    if (!canAnimate()) {
      row.remove()
      return
    }

    // The card overflows its shrinking row for most of the collapse,
    // since it's still ~75% opaque when the height starts closing.
    gsap.set(row, { overflow: 'hidden' })

    gsap.timeline({
      defaults: { ease: MOTION.ease },
      onComplete: function () { row.remove() }
    })
      .to(card, {
        x: MOTION.offset,
        opacity: 0,
        duration: MOTION.slide
      })
      .to(row, {
        height: 0,
        marginBottom: 0,
        duration: MOTION.collapse
      }, '<+=0.1')
  }

  // ── Reshuffle ───────────────────────────────────────────────────────
  // Where a row belongs is decided the same way the template decides it:
  // group by `stateOrder`, and within a group keep the order the list
  // was built in. Each `<li>` is stamped with that build index at boot,
  // so a row resumed after being paused returns to its original place
  // among its neighbours rather than to the top of its group.
  function sortKey (order, li) {
    var card = li.querySelector('[data-aaw-card]')
    var state = card ? card.getAttribute('data-aaw-state') : ''
    var group = order.indexOf(state)

    return {
      group: group === -1 ? order.length : group,
      built: Number(li.getAttribute('data-aaw-order')) || 0
    }
  }

  function placeRow (root, li) {
    var list = li.parentElement
    if (!list) return

    var order = (root.getAttribute('data-aaw-state-order') || '').split(',')
    var mine = sortKey(order, li)
    var before = null

    Array.prototype.slice.call(list.children).forEach(function (other) {
      if (before || other === li) return
      var theirs = sortKey(order, other)
      if (theirs.group > mine.group ||
         (theirs.group === mine.group && theirs.built > mine.built)) {
        before = other
      }
    })

    if (before) list.insertBefore(li, before)
    else list.appendChild(li)
  }

  // Flip needs the before-positions captured while the DOM is still in
  // its old arrangement, so the caller hands us the move to perform
  // rather than doing it first.
  function reshuffle (root, li, move) {
    var list = li.parentElement

    if (!list || !canAnimate()) {
      move()
      return
    }

    var state = Flip.getState(list.querySelectorAll('.aaw__list-item'))
    move()
    Flip.from(state, { duration: MOTION.shuffle, ease: MOTION.ease })
  }

  // ── Status button ───────────────────────────────────────────────────
  // Both row treatments carry the same status button and the same data
  // hooks, so one delegated handler drives either. What the button DOES
  // depends on the row's state:
  //
  //   paused   → resume, back into the state it was paused from
  //   failed   → retry, which starts a new run
  //   anything → pause
  //
  // `data-aaw-state` is the single source of truth. The glyph, the error
  // badge and the sort position are all selected off it, so applying a
  // state means writing the attribute plus the two things CSS can't
  // produce: the subline and the button's accessible name.
  var VERBS = { paused: 'Resume ', failed: 'Retry ' }

  // Which set of subline strings a state reads. Every slot carries all
  // three as attributes, so this picks a suffix rather than wording.
  function sublineKey (state, home) {
    if (state === 'paused') return 'paused'
    if (state === 'running' && home !== 'running') return 'running'
    return 'default'
  }

  function applyState (row, state) {
    var home = row.getAttribute('data-aaw-state-default') || 'scheduled'
    var toggle = row.querySelector('[data-aaw-run-toggle]')
    var title = row.querySelector('[data-aaw-title]')
    var key = sublineKey(state, home)

    row.setAttribute('data-aaw-state', state)

    // "Home" is the last state the row was in that wasn't paused, not
    // the one it first rendered in — otherwise retrying a failed row and
    // then pausing it would resume back into `failed`, undoing the retry.
    if (state !== 'paused') row.setAttribute('data-aaw-state-default', state)

    row.querySelectorAll('[data-aaw-status], [data-aaw-time]').forEach(function (slot) {
      var kind = slot.hasAttribute('data-aaw-status') ? 'status' : 'time'
      var value = slot.getAttribute('data-aaw-' + kind + '-' + key)
      if (value === null) return

      slot.textContent = value
      // Same reason: the strings a resume returns to have to track the
      // row's current presentation, not the one the template rendered.
      if (state !== 'paused') slot.setAttribute('data-aaw-' + kind + '-default', value)
    })

    if (toggle) {
      var label = (VERBS[state] || 'Pause ') + (title ? title.textContent.trim() : '')
      toggle.setAttribute('aria-label', label)
      toggle.setAttribute('title', label)
    }
  }

  // What pressing the status button turns the row into.
  function nextState (row) {
    var state = row.getAttribute('data-aaw-state')
    if (state === 'paused') return row.getAttribute('data-aaw-state-default') || 'scheduled'
    if (state === 'failed') return 'running'
    return 'paused'
  }

  function bindRowControls (root) {
    root.addEventListener('click', function (event) {
      var toggle = event.target.closest('[data-aaw-run-toggle]')
      var action = event.target.closest('[data-aaw-row-action]')
      if (!toggle && !action) return

      var row = (toggle || action).closest('[data-aaw-card]')
      if (!row) return

      event.preventDefault()
      event.stopPropagation()

      if (toggle) {
        var was = row.getAttribute('data-aaw-state')
        var now = nextState(row)
        var li = row.closest('.aaw__list-item')

        // Any state change can move the row: pausing sorts it to the
        // bottom, resuming lifts it back, and retrying a failed row
        // takes it out of the attention group at the top. So the state
        // change and the re-sort happen inside one Flip, and the row
        // travels while everything it displaced slides around it.
        if (li) {
          reshuffle(root, li, function () {
            applyState(row, now)
            placeRow(root, li)
          })
        } else {
          applyState(row, now)
        }

        emit(root, 'aaw:run-toggle', {
          cardId: row.getAttribute('data-aaw-card'),
          from: was,
          to: now,
          paused: now === 'paused'
        })
      } else {
        emit(root, 'aaw:row-action', {
          actionId: action.getAttribute('data-aaw-row-action'),
          cardId: row.getAttribute('data-aaw-card')
        })
      }
    })
  }

  // ── Whole-row click ─────────────────────────────────────────────────
  // Reporting only. Every row's title is a real control stretched over
  // the row by CSS, so navigation is the browser's job now — which is
  // what keeps command-click and "open in new tab" working on the rows
  // that lead somewhere. This used to synthesise `location.href` for
  // padding clicks and cancel a phantom `#`; neither exists any more.
  function bindCardClicks (root) {
    root.addEventListener('click', function (event) {
      if (event.target.closest('[data-aaw-stop]')) return

      var card = event.target.closest('[data-aaw-card]')
      if (!card) return

      var link = card.querySelector('[data-aaw-card-link]')

      emit(root, 'aaw:card-select', {
        cardId: card.getAttribute('data-aaw-card'),
        href: link ? link.getAttribute('href') : null
      })
    })
  }

  function bindDate (root) {
    root.querySelectorAll('[data-aaw-today]').forEach(function (el) {
      el.textContent = todayLabel()
    })
  }

  // The order the list was built in, recorded before anything can move
  // a row. It's the tiebreaker that lets a resumed row slot back in
  // among its original neighbours instead of landing at the top of its
  // group.
  function stampOrder (root) {
    root.querySelectorAll('.aaw__list-item').forEach(function (li, index) {
      li.setAttribute('data-aaw-order', index)
    })
  }

  function boot () {
    if (typeof gsap !== 'undefined' && typeof Flip !== 'undefined') {
      gsap.registerPlugin(Flip)
    }

    document.querySelectorAll('[data-aaw-root]').forEach(function (root) {
      stampOrder(root)
      bindDate(root)
      bindRowMenus(root)
      bindOverflow(root)
      bindRowControls(root)
      bindCardClicks(root)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
