// ──────────────────────────────────────────────────────────────────────
// Seller Home — header avatar user switcher
// =====================================================================
// Opens the global-header avatar menu and navigates to the same page
// under `/u/<otherId>/`. Does not write a shared cookie: each tab's
// address bar is the source of truth.
//
;(function () {
  var CLOSE_MS = 150

  function prefersReducedMotion () {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch (e) {
      return false
    }
  }

  function bindSwitcher (root) {
    var trigger = root.querySelector('[data-sh-user-switcher-trigger]')
    var menu = root.querySelector('[data-sh-user-menu]')
    if (!trigger || !menu) return

    var closeTimer = null

    function isOpen () {
      return menu.classList.contains('is-open')
    }

    function open () {
      if (closeTimer) {
        window.clearTimeout(closeTimer)
        closeTimer = null
      }
      menu.classList.remove('is-closing')
      menu.classList.add('is-open')
      root.classList.add('slds-is-open')
      trigger.setAttribute('aria-expanded', 'true')
    }

    function close () {
      if (!isOpen() && !menu.classList.contains('is-closing')) return
      menu.classList.remove('is-open')
      trigger.setAttribute('aria-expanded', 'false')
      if (prefersReducedMotion()) {
        menu.classList.remove('is-closing')
        root.classList.remove('slds-is-open')
        return
      }
      menu.classList.add('is-closing')
      closeTimer = window.setTimeout(function () {
        menu.classList.remove('is-closing')
        root.classList.remove('slds-is-open')
        closeTimer = null
      }, CLOSE_MS)
    }

    function toggle () {
      if (isOpen()) close()
      else open()
    }

    trigger.addEventListener('click', function (event) {
      event.preventDefault()
      event.stopPropagation()
      toggle()
    })

    menu.addEventListener('click', function (event) {
      var link = event.target.closest('[data-sh-user-switch]')
      if (!link) return
      var id = link.getAttribute('data-sh-user-switch')
      if (!id) return
      event.preventDefault()
      if (typeof window.SH === 'undefined' || !window.SH.urlForUser) return
      if (window.SH.currentUserId && window.SH.currentUserId() === id) {
        close()
        return
      }
      window.location.assign(window.SH.urlForUser(id))
    })

    document.addEventListener('click', function (event) {
      if (!root.contains(event.target)) close()
    })

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close()
    })
  }

  function rewriteUnscopedSellerLinks () {
    if (!window.SH || typeof window.SH.userUrl !== 'function') return
    document.addEventListener('click', function (event) {
      var anchor = event.target && event.target.closest
        ? event.target.closest('a[href]')
        : null
      if (!anchor) return
      var href = anchor.getAttribute('href')
      if (!href) return
      var next = window.SH.userUrl(href)
      if (next && next !== href) anchor.setAttribute('href', next)
    }, true)
  }

  document.addEventListener('DOMContentLoaded', function () {
    var roots = document.querySelectorAll('[data-sh-user-switcher]')
    for (var i = 0; i < roots.length; i++) bindSwitcher(roots[i])
    rewriteUnscopedSellerLinks()
  })
})()
