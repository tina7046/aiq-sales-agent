// ──────────────────────────────────────────────────────────────────────
// Seller Home — header avatar user switcher
// =====================================================================
// Opens the global-header avatar menu and lands on that person's
// Seller Home (`/u/<otherId>/index.html`). Does not write a shared
// cookie: each tab's address bar is the source of truth.
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
      var item = event.target.closest('[data-sh-user-switch]')
      if (!item) return
      var id = item.getAttribute('data-sh-user-switch')
      if (!id) return
      event.preventDefault()
      if (window.SH && window.SH.currentUserId && window.SH.currentUserId() === id) {
        close()
        return
      }
      var home = (window.SH && typeof window.SH.userUrl === 'function')
        ? window.SH.userUrl('/index.html', id)
        : (item.getAttribute('data-sh-nav-href') || ('/aiq-sales-agent/u/' + encodeURIComponent(id) + '/index.html'))
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        window.open(home, '_blank')
        return
      }
      window.location.assign(home)
    })

    menu.addEventListener('auxclick', function (event) {
      if (event.button !== 1) return
      var item = event.target.closest('[data-sh-user-switch]')
      if (!item) return
      var id = item.getAttribute('data-sh-user-switch')
      if (!id) return
      event.preventDefault()
      var home = (window.SH && typeof window.SH.userUrl === 'function')
        ? window.SH.userUrl('/index.html', id)
        : (item.getAttribute('data-sh-nav-href') || ('/aiq-sales-agent/u/' + encodeURIComponent(id) + '/index.html'))
      window.open(home, '_blank')
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

  function followNavHref (href, newTab) {
    if (!href) return
    if (newTab) {
      window.open(href, '_blank')
      return
    }
    window.location.assign(href)
  }

  // Cloud logo in the global header. Button (no URL preview) that still
  // lands on `/index.html?reset=1` so home.js can wipe demo state.
  function bindHeaderLogo () {
    var logo = document.querySelector('[data-sh-header-logo]')
    if (!logo) return

    logo.addEventListener('click', function (event) {
      var href = logo.getAttribute('data-sh-nav-href')
      if (!href) return
      followNavHref(href, event.metaKey || event.ctrlKey || event.shiftKey)
    })

    logo.addEventListener('auxclick', function (event) {
      if (event.button !== 1) return
      var href = logo.getAttribute('data-sh-nav-href')
      if (!href) return
      event.preventDefault()
      followNavHref(href, true)
    })
  }

  document.addEventListener('DOMContentLoaded', function () {
    var roots = document.querySelectorAll('[data-sh-user-switcher]')
    for (var i = 0; i < roots.length; i++) bindSwitcher(roots[i])
    bindHeaderLogo()
    rewriteUnscopedSellerLinks()
  })
})()
