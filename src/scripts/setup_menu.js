// ──────────────────────────────────────────────────────────────────────
// Seller Home — header gear Setup Menu
// =====================================================================
// Opens the global-header Setup (gear) menu. Salesforce Go navigates
// to this seller's onboarding page (href is already user-scoped at
// compile time). Other items are present to match the product menu.
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

  function bindMenu (root) {
    var trigger = root.querySelector('[data-sh-setup-trigger]')
    var menu = root.querySelector('[data-sh-setup-dropdown]')
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
      var link = event.target.closest('a[href]')
      if (!link || !menu.contains(link)) return
      var href = link.getAttribute('href')
      if (!href || href === '#') {
        event.preventDefault()
        close()
        return
      }
      // Same-tab. The home page also listens on this menu for shader
      // picks; assigning here keeps Salesforce Go from getting swallowed.
      event.preventDefault()
      window.location.assign(href)
    })

    document.addEventListener('click', function (event) {
      if (!root.contains(event.target)) close()
    })

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close()
    })
  }

  document.addEventListener('DOMContentLoaded', function () {
    var roots = document.querySelectorAll('[data-sh-setup-menu]')
    for (var i = 0; i < roots.length; i++) bindMenu(roots[i])
  })
})()
