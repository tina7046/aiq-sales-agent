/**
 * ShTabNav — pill tab bar
 * =====================================================================
 * Ported from the BB-AOP prototype, where this control appears inside
 * the Tools modal's detail panels (click "CRM Lookup" → the row of
 * pills above the example), on its Knowledge page, and in the editor's
 * slash-suggestion popover.
 *
 * It was hand-rolled in four separate places there — app.js, main.js,
 * slash-suggestion.js, and the tools modal's inline script — each with
 * its own copy of the same class-swapping loop. This is that control
 * written once, as a global, so the rest of this project can reach for
 * it instead of growing a fifth copy.
 *
 * Loaded from _template.html, so `window.ShTabNav` is available on
 * every page, to classic scripts and ES modules alike.
 *
 * Visuals are unchanged from the source: the same
 * `.tab-nav-cycler` / `.slds-item-active` / `.slds-item-inactive`
 * classes on the same `<div>` element, so a pill is pixel-identical in
 * both prototypes. Styles live in index.scss (global, next to the
 * other app chrome) and are a verbatim copy of the source's.
 *
 * The pill stays a `<div>` on purpose. Making it a `<button>` is the
 * obvious way to get keyboard access, but a button drags in its own UA
 * box model and the reset needed to undo that visibly shifts the pill.
 * Accessibility is added around the div instead — `role="tab"` inside a
 * `role="tablist"`, roving tabindex, arrow/Home/End to move, Enter or
 * Space to activate — which the source had none of.
 *
 * ── Two ways to use it ───────────────────────────────────────────────
 *
 * 1. Declarative — author the markup, let it wire itself. Any
 *    `[data-sh-tabnav]` on the page is picked up on DOMContentLoaded.
 *
 *      <ul class="slds-list_horizontal slds-has-dividers_right
 *                 tab-nav-cycler" data-sh-tabnav>
 *        <li class="slds-item">
 *          <div class="slds-item-active"   data-sh-tabnav-value="all">All</div>
 *        </li>
 *        <li class="slds-item">
 *          <div class="slds-item-inactive" data-sh-tabnav-value="crm">CRM</div>
 *        </li>
 *      </ul>
 *
 *      document.addEventListener('sh:tabnav-change', function (e) {
 *        e.detail // { index, label, value }
 *      })
 *
 *    The macro in _tools_content.html emits exactly this shape.
 *
 * 2. Programmatic — build the element from data and hand it a
 *    callback. This is what a JS-rendered panel wants.
 *
 *      var bar = ShTabNav.build(
 *        [{ label: 'Description' }, { label: 'Example' }],
 *        { onChange: function (d) { render(d.index) } }
 *      )
 *      container.appendChild(bar)
 *
 * Either way the control fires a bubbling `sh:tabnav-change` on the
 * `<ul>`, so a consumer can delegate from an ancestor instead of
 * holding a reference.
 */
(function () {
  'use strict'

  var ACTIVE   = 'slds-item-active'
  var INACTIVE = 'slds-item-inactive'

  // Where a mounted list keeps its onChange callback. Stashed on the
  // element rather than in a closure so `mount` can be called again to
  // swap the callback without rebinding the listeners.
  var CALLBACK = '_shTabnavOnChange'

  function tabsIn (list) {
    return Array.prototype.slice.call(list.querySelectorAll('.slds-item > *'))
  }

  /**
   * Paint the selected pill and move the roving tabindex onto it.
   * Split out from `select` so the initial paint doesn't fire a change
   * event or steal focus.
   */
  function paint (list, index) {
    var items = tabsIn(list)
    for (var i = 0; i < items.length; i++) {
      var isOn = i === index
      items[i].classList.toggle(ACTIVE, isOn)
      items[i].classList.toggle(INACTIVE, !isOn)
      // Roving tabindex: the bar is one tab stop and arrows move
      // within it, which is what a tablist is supposed to do and what
      // keeps a six-pill filter from eating six stops.
      items[i].setAttribute('aria-selected', isOn ? 'true' : 'false')
      items[i].setAttribute('tabindex', isOn ? '0' : '-1')
    }
    list.setAttribute('data-sh-tabnav-index', String(index))
  }

  function detailFor (list, index) {
    var item = tabsIn(list)[index]
    if (!item) return { index: index, label: '', value: '' }
    return {
      index: index,
      label: (item.textContent || '').trim(),
      value: item.getAttribute('data-sh-tabnav-value') || '',
    }
  }

  /**
   * Select a pill by index, announce it, and optionally take focus.
   *
   * @param {HTMLElement} list      The `<ul>`.
   * @param {number}      index
   * @param {object}     [opts]
   * @param {boolean}    [opts.focus]   Move focus to the pill. True for
   *                                    keyboard-driven selection.
   * @param {boolean}    [opts.silent]  Skip the change event. Used for
   *                                    the initial paint.
   */
  function select (list, index, opts) {
    var options = opts || {}
    var items = tabsIn(list)
    if (index < 0 || index >= items.length) return

    var previous = parseInt(list.getAttribute('data-sh-tabnav-index'), 10)
    paint(list, index)

    if (options.focus && items[index].focus) items[index].focus()
    if (options.silent || previous === index) return

    var detail = detailFor(list, index)
    if (typeof list[CALLBACK] === 'function') list[CALLBACK](detail)
    list.dispatchEvent(new CustomEvent('sh:tabnav-change', {
      bubbles: true,
      detail: detail,
    }))
  }

  /**
   * Wire an existing `<ul>`.
   *
   * @param {HTMLElement} list
   * @param {object}     [opts]
   * @param {function}   [opts.onChange]      Called with { index, label, value }.
   * @param {number}     [opts.initialIndex]  Defaults to whichever pill
   *                                          already carries the active
   *                                          class, else 0.
   * @returns {object|null} { select, getIndex, element }
   */
  function mount (list, opts) {
    if (!list) return null
    var options = opts || {}

    // Already wired — just update the callback and hand back the
    // controller rather than binding a second set of listeners.
    var isRebind = !!list.getAttribute('data-sh-tabnav-index')
    if (options.onChange) list[CALLBACK] = options.onChange

    var items = tabsIn(list)
    if (!items.length) return null

    if (!isRebind) {
      list.setAttribute('role', 'tablist')

      for (var i = 0; i < items.length; i++) {
        var parent = items[i].parentNode
        if (parent) parent.setAttribute('role', 'presentation')
        items[i].setAttribute('role', 'tab')
      }

      list.addEventListener('click', function (e) {
        var item = e.target.closest('.slds-item > *')
        if (!item || !list.contains(item)) return
        e.preventDefault()
        select(list, tabsIn(list).indexOf(item))
      })

      list.addEventListener('keydown', function (e) {
        var current = parseInt(list.getAttribute('data-sh-tabnav-index'), 10) || 0
        var items = tabsIn(list)
        var count = items.length
        var next = null

        // Enter / Space activate the focused pill. A <button> would
        // give us this for free; a div has to be told.
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          var focused = items.indexOf(document.activeElement)
          if (focused < 0) return
          e.preventDefault()
          select(list, focused)
          return
        }

        // Arrows move and select as they go — right for a tablist
        // whose panels are cheap to render. Home/End jump to the ends.
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % count
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + count) % count
        else if (e.key === 'Home') next = 0
        else if (e.key === 'End') next = count - 1
        else return

        e.preventDefault()
        select(list, next, { focus: true })
      })
    }

    var start = options.initialIndex
    if (typeof start !== 'number') {
      start = items.findIndex(function (el) { return el.classList.contains(ACTIVE) })
      if (start < 0) start = 0
    }
    select(list, start, { silent: true })

    return {
      element: list,
      getIndex: function () {
        return parseInt(list.getAttribute('data-sh-tabnav-index'), 10) || 0
      },
      select: function (index) { select(list, index) },
    }
  }

  /**
   * Build a tab bar from data. Returns a detached `<ul>` for the caller
   * to place — it's already wired by the time it comes back.
   *
   * @param {Array} tabs  Strings, or { label, value }.
   * @param {object} [opts]  Same as `mount`, plus:
   * @param {string} [opts.className]  Extra classes on the `<ul>`.
   * @returns {HTMLElement}
   */
  function build (tabs, opts) {
    var options = opts || {}
    var list = document.createElement('ul')
    list.className =
      'slds-list_horizontal slds-has-dividers_right tab-nav-cycler' +
      (options.className ? ' ' + options.className : '')
    list.setAttribute('data-sh-tabnav', '')

    for (var i = 0; i < tabs.length; i++) {
      var tab = typeof tabs[i] === 'string' ? { label: tabs[i] } : tabs[i]
      var li = document.createElement('li')
      li.className = 'slds-item'
      // A <div>, matching the source's markup exactly — see the note
      // at the top of this file for why it isn't a <button>.
      var pill = document.createElement('div')
      pill.className = i === 0 ? ACTIVE : INACTIVE
      pill.textContent = tab.label
      if (tab.value) pill.setAttribute('data-sh-tabnav-value', tab.value)
      if (tab.controls) pill.setAttribute('aria-controls', tab.controls)
      li.appendChild(pill)
      list.appendChild(li)
    }

    mount(list, options)
    return list
  }

  /** Wire every declarative tab bar on the page. Safe to call again. */
  function init () {
    var lists = document.querySelectorAll('[data-sh-tabnav]')
    for (var i = 0; i < lists.length; i++) mount(lists[i])
  }

  window.ShTabNav = {
    build: build,
    mount: mount,
    init: init,
    select: function (list, index) { select(list, index) },
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
