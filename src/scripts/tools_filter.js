/**
 * Tools category filter
 * =====================================================================
 * Binds the category tab bar above the Tools card grid to the cards
 * themselves. Shared by both surfaces that render
 * `_tools_content.html`:
 *
 *   • the "View all" modal on Seller Home / the conversation drill-in
 *   • the Tools page (/tools.html)
 *
 * It's a standalone script rather than part of tools_modal.js because
 * the page renders the same grid without needing the modal controller,
 * so there'd be nothing to hang it off there. Classic script + IIFE,
 * matching home.js, and it no-ops when no grid is on the page.
 *
 * The tab bar itself is the global ShTabNav component (tab_nav.js),
 * which wires itself and emits a bubbling `sh:tabnav-change`. All this
 * has to do is listen and toggle `hidden` on the cards.
 *
 * More than one instance per page. The Tools page renders the grid in
 * its body AND includes the modal, whose panel 1 is a second copy of
 * the same grid. Each bar+grid pair is therefore scoped to its own
 * container (the bar's parent — see _tools_content.html, where the bar,
 * grid, and empty state are siblings) so filtering one surface never
 * touches the other.
 *
 * Filtering by attribute rather than rebuilding the grid keeps the
 * cards' identity stable, which matters in the modal: the ZoomInfo
 * card is mutated in place when its connection state changes, and a
 * rebuild would throw that away.
 *
 * Emits `sh:tools-filtered` on the grid after each pass. The modal
 * listens for it and re-measures, since hiding rows changes the panel
 * height the morph surface animates to.
 */
(function () {
  'use strict'

  // Wire one bar to the grid it governs. `scope` is the container that
  // holds both — the modal's content div on one surface, the page's
  // body-inner on the other — so two instances on the same page stay
  // independent.
  function bind (bar) {
    var scope = bar.parentNode
    if (!scope) return
    var grid = scope.querySelector('[data-sh-tools-grid]')
    if (!grid) return
    var empty = scope.querySelector('[data-sh-tools-empty]')

    function apply (category) {
      var cards = grid.querySelectorAll('[data-tool-category]')
      var shown = 0

      for (var i = 0; i < cards.length; i++) {
        // "all" is the one reserved id — every other tab value is
        // matched straight against the card's category.
        var match = category === 'all' ||
                    cards[i].getAttribute('data-tool-category') === category
        if (match) {
          cards[i].removeAttribute('hidden')
          shown++
        } else {
          cards[i].setAttribute('hidden', '')
        }
      }

      if (empty) {
        if (shown === 0) empty.removeAttribute('hidden')
        else empty.setAttribute('hidden', '')
      }

      grid.dispatchEvent(new CustomEvent('sh:tools-filtered', {
        bubbles: true,
        detail: { category: category, shown: shown },
      }))
    }

    // Listen on the bar itself, not document — the event bubbles, and a
    // document-level listener would fire every bar's handler for every
    // bar's change.
    bar.addEventListener('sh:tabnav-change', function (e) {
      apply(e.detail.value || 'all')
    })
  }

  function init () {
    var bars = document.querySelectorAll('[data-sh-tools-categories]')
    for (var i = 0; i < bars.length; i++) bind(bars[i])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
