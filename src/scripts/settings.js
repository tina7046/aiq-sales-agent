// ──────────────────────────────────────────────────────────────────────
// Seller Home — Hunter settings (identity + voice to the seller)
// =====================================================================
// Org defaults live in unprefixed `sh:settings:org` so every persona
// can read what the admin set. Personal overrides live in
// `SH.storageKey('sh:settings:me')` so Rohan and Nima don't share a
// nickname. `?reset=1` is for recents / demo runs, not these prefs.
//
// Live apply (not toast-only):
//   • nickname → composer Hunter badge
//   • greeting energy → briefing heading emoji
//   • address-me → strip or keep the seller's name in that heading
//   • tone → labeled default next to the Hunter badge
//
;(function (global) {
  var ORG_KEY = 'sh:settings:org'
  var ME_KEY = 'sh:settings:me'
  var FALLBACK = {
    orgName: 'Hunter Sales Agent',
    badgeLabel: 'Hunter',
    tagline: 'Your sales agent',
    defaultTone: 'casual',
    defaultGreetingEnergy: true
  }
  var TONE_LABELS = {
    casual: 'Casual',
    balanced: 'Balanced',
    professional: 'Professional'
  }

  function storageKey (key) {
    return (global.SH && global.SH.storageKey) ? global.SH.storageKey(key) : key
  }

  function readJson (rawKey, scoped) {
    try {
      var key = scoped ? storageKey(rawKey) : rawKey
      var raw = global.localStorage.getItem(key)
      if (!raw) return null
      var parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch (e) {
      return null
    }
  }

  function writeJson (rawKey, value, scoped) {
    try {
      var key = scoped ? storageKey(rawKey) : rawKey
      global.localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
      // Quota / private mode — the form still reflects the in-memory save.
    }
  }

  function defaultsFromPage () {
    var el = document.getElementById('sh-settings-defaults')
    if (!el) return null
    try {
      return JSON.parse(el.textContent)
    } catch (e) {
      return null
    }
  }

  function toneLabel (id, tones) {
    if (tones) {
      for (var i = 0; i < tones.length; i++) {
        if (tones[i].id === id) return tones[i].label
      }
    }
    return TONE_LABELS[id] || id
  }

  function badgeFromOrgName (orgName, fallback) {
    var name = String(orgName || '').trim()
    if (!name) return fallback || FALLBACK.badgeLabel
    return name.split(/\s+/)[0]
  }

  function resolveSettings () {
    var page = defaultsFromPage() || {}
    var hunter = page.hunter || {}
    var org = readJson(ORG_KEY, false) || {}
    var me = readJson(ME_KEY, true) || {}

    var orgName = org.agentName || hunter.orgName || FALLBACK.orgName
    var badgeLabel = hunter.badgeLabel || FALLBACK.badgeLabel
    var defaultTone = org.defaultTone || hunter.defaultTone || FALLBACK.defaultTone
    var defaultGreeting = (typeof org.defaultGreetingEnergy === 'boolean')
      ? org.defaultGreetingEnergy
      : (typeof hunter.defaultGreetingEnergy === 'boolean'
        ? hunter.defaultGreetingEnergy
        : FALLBACK.defaultGreetingEnergy)

    var tone = me.tone || defaultTone
    var greetingEnergy = (typeof me.greetingEnergy === 'boolean')
      ? me.greetingEnergy
      : defaultGreeting

    return {
      page: page,
      orgName: orgName,
      tagline: org.tagline || hunter.tagline || FALLBACK.tagline,
      badgeLabel: badgeLabel,
      defaultTone: defaultTone,
      defaultGreetingEnergy: defaultGreeting,
      nickname: typeof me.nickname === 'string' ? me.nickname : '',
      tone: tone,
      greetingEnergy: greetingEnergy,
      addressMe: me.addressMe || 'first_name',
      displayBadge: (me.nickname && me.nickname.trim())
        ? me.nickname.trim()
        : badgeFromOrgName(orgName, badgeLabel)
    }
  }

  function escapeRegExp (value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function applyAddress (heading, addressMe, userName) {
    var text = String(heading || '')
    var name = String(userName || '').trim()
    if (addressMe !== 'no_name' || !name) return text
    text = text.replace(new RegExp(',\\s*' + escapeRegExp(name), 'g'), '')
    text = text.replace(new RegExp('\\b' + escapeRegExp(name) + '\\b', 'g'), '')
    return text.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim()
  }

  function hunterIsCurrent (root) {
    var icon = (root || document).querySelector('[data-sh-composer-badge-icon="hunter"]')
    return !!(icon && !icon.hasAttribute('hidden'))
  }

  function ensureToneLabel (menu) {
    var existing = menu.parentNode.querySelector('[data-sh-hunter-tone-label]')
    if (existing) return existing
    var label = document.createElement('span')
    label.className = 'seller-home__composer-tone'
    label.setAttribute('data-sh-hunter-tone-label', '')
    menu.parentNode.insertBefore(label, menu.nextSibling)
    return label
  }

  function applyLiveSettings () {
    var resolved = resolveSettings()
    var page = resolved.page || {}
    var userName = (page.userName) ||
      (global.SH_USER && global.SH_USER.name) ||
      ''

    var hunterItem = document.querySelector('[data-sh-composer-menu-item="hunter"]')
    if (hunterItem) {
      hunterItem.setAttribute('data-sh-composer-badge-text', resolved.displayBadge)
      var menuLabel = hunterItem.querySelector('.seller-home__composer-menu-label')
      if (menuLabel) menuLabel.textContent = resolved.orgName
    }

    document.querySelectorAll('[data-sh-composer-root]').forEach(function (root) {
      if (!hunterIsCurrent(root)) {
        var hiddenTone = root.querySelector('[data-sh-hunter-tone-label]')
        if (hiddenTone) hiddenTone.hidden = true
        return
      }
      var badge = root.querySelector('[data-sh-composer-badge-label]')
      if (badge) badge.textContent = resolved.displayBadge
      var trigger = root.querySelector('[data-sh-composer-menu-trigger]')
      if (trigger) {
        trigger.title = resolved.displayBadge + ' · ' + toneLabel(resolved.tone, page.tones)
        var aria = trigger.getAttribute('aria-label') || ''
        trigger.setAttribute(
          'aria-label',
          aria.replace(/:.*$/, ': ' + resolved.displayBadge)
        )
      }
      var menu = root.querySelector('[data-sh-composer-menu]')
      if (menu && menu.parentNode) {
        var toneEl = ensureToneLabel(menu)
        toneEl.textContent = toneLabel(resolved.tone, page.tones)
        toneEl.hidden = false
      }
    })

    var heading = document.querySelector('[data-sh-briefing-heading]')
    if (heading) {
      var energetic = heading.getAttribute('data-sh-briefing-heading-energy') || heading.textContent
      var quiet = heading.getAttribute('data-sh-briefing-heading-quiet') || energetic
      var next = resolved.greetingEnergy ? energetic : quiet
      heading.textContent = applyAddress(next, resolved.addressMe, userName)
    }

    return resolved
  }

  function showToast (message) {
    if (global._shShowToast) {
      global._shShowToast(message)
      return
    }
    var existing = document.querySelector('.sh-toast-container')
    if (existing) existing.remove()
    var container = document.createElement('div')
    container.className = 'slds-notify_container sh-toast-container'
    container.style.cssText =
      'position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:9999;'
    container.innerHTML =
      '<div class="slds-notify slds-notify_toast slds-theme_success" role="status">' +
        '<span class="slds-assistive-text">success</span>' +
        '<span class="slds-icon_container slds-icon-utility-success slds-m-right_small slds-no-flex slds-align-top">' +
          '<svg class="slds-icon slds-icon_small" aria-hidden="true">' +
            '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#success"></use>' +
          '</svg>' +
        '</span>' +
        '<div class="slds-notify__content"><h2 class="slds-text-heading_small"></h2></div>' +
      '</div>'
    container.querySelector('h2').textContent = String(message || '')
    document.body.appendChild(container)
    global.setTimeout(function () {
      if (container.parentNode) container.parentNode.removeChild(container)
    }, 4000)
  }

  function selectedTone (form) {
    var checked = form.querySelector('[data-sh-settings-tone]:checked')
    return checked ? checked.value : FALLBACK.defaultTone
  }

  function setTone (form, value) {
    var radios = form.querySelectorAll('[data-sh-settings-tone]')
    var found = false
    radios.forEach(function (radio) {
      radio.checked = radio.value === value
      if (radio.checked) found = true
    })
    if (!found && radios[0]) radios[0].checked = true
  }

  function previewCopy (resolved, page) {
    var name = resolved.nickname.trim() || resolved.orgName
    var greeting = resolved.greetingEnergy ? 'with greeting energy' : 'without greeting energy'
    var address = resolved.addressMe === 'no_name'
      ? 'without your name'
      : (resolved.addressMe === 'full_name' ? 'using your full name' : 'using your first name')
    return name + ' will sound ' + toneLabel(resolved.tone, page.tones) +
      ', ' + address + ', ' + greeting + '.'
  }

  function hydrateForm (form) {
    var resolved = resolveSettings()
    var page = resolved.page || {}
    var role = form.getAttribute('data-sh-settings-role') || page.role || 'rep'

    if (role === 'admin') {
      var nameInput = form.querySelector('[data-sh-settings-org-name]')
      var taglineInput = form.querySelector('[data-sh-settings-tagline]')
      var greeting = form.querySelector('[data-sh-settings-greeting]')
      if (nameInput) nameInput.value = resolved.orgName
      if (taglineInput) taglineInput.value = resolved.tagline
      setTone(form, resolved.defaultTone)
      if (greeting) greeting.checked = resolved.defaultGreetingEnergy
      return
    }

    var nickname = form.querySelector('[data-sh-settings-nickname]')
    var address = form.querySelector('[data-sh-settings-address]')
    var greetingRep = form.querySelector('[data-sh-settings-greeting]')
    var orgDisplay = form.querySelector('[data-sh-settings-org-display]')
    var toneHelp = form.querySelector('[data-sh-settings-tone-help]')
    var preview = form.querySelector('[data-sh-settings-preview]')

    if (orgDisplay) orgDisplay.textContent = resolved.orgName
    if (nickname) nickname.value = resolved.nickname
    setTone(form, resolved.tone)
    if (address) address.value = resolved.addressMe
    if (greetingRep) greetingRep.checked = resolved.greetingEnergy
    if (toneHelp && page.copy) {
      toneHelp.textContent = page.copy.toneHelpPrefix + ' ' +
        toneLabel(resolved.defaultTone, page.tones)
    }
    if (preview) preview.textContent = previewCopy(resolved, page)
  }

  function bindPreview (form) {
    function refresh () {
      var preview = form.querySelector('[data-sh-settings-preview]')
      if (!preview) return
      var page = defaultsFromPage() || {}
      var nicknameEl = form.querySelector('[data-sh-settings-nickname]')
      var addressEl = form.querySelector('[data-sh-settings-address]')
      var greetingEl = form.querySelector('[data-sh-settings-greeting]')
      var resolved = resolveSettings()
      resolved.nickname = nicknameEl ? nicknameEl.value : resolved.nickname
      resolved.tone = selectedTone(form)
      resolved.addressMe = addressEl ? addressEl.value : resolved.addressMe
      resolved.greetingEnergy = greetingEl ? greetingEl.checked : resolved.greetingEnergy
      preview.textContent = previewCopy(resolved, page)
    }
    form.addEventListener('input', refresh)
    form.addEventListener('change', refresh)
  }

  function bindForm (form) {
    hydrateForm(form)
    bindPreview(form)
    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var page = defaultsFromPage() || {}
      var role = form.getAttribute('data-sh-settings-role') || page.role || 'rep'
      var copy = page.copy || {}

      if (role === 'admin') {
        var nameInput = form.querySelector('[data-sh-settings-org-name]')
        var taglineInput = form.querySelector('[data-sh-settings-tagline]')
        var greeting = form.querySelector('[data-sh-settings-greeting]')
        writeJson(ORG_KEY, {
          agentName: nameInput ? nameInput.value.trim() || FALLBACK.orgName : FALLBACK.orgName,
          tagline: taglineInput ? taglineInput.value.trim() : '',
          defaultTone: selectedTone(form),
          defaultGreetingEnergy: greeting ? greeting.checked : true
        }, false)
        applyLiveSettings()
        showToast(copy.orgSavedToast || 'Hunter defaults saved')
        return
      }

      var nickname = form.querySelector('[data-sh-settings-nickname]')
      var address = form.querySelector('[data-sh-settings-address]')
      var greetingRep = form.querySelector('[data-sh-settings-greeting]')
      writeJson(ME_KEY, {
        nickname: nickname ? nickname.value.trim() : '',
        tone: selectedTone(form),
        greetingEnergy: greetingRep ? greetingRep.checked : true,
        addressMe: address ? address.value : 'first_name'
      }, true)
      applyLiveSettings()
      hydrateForm(form)
      showToast(copy.savedToast || 'Settings saved')
    })
  }

  function boot () {
    applyLiveSettings()
    var form = document.querySelector('[data-sh-settings-form]')
    if (form) bindForm(form)

    // Composer agent switches rewrite the badge from data-sh-composer-badge-text.
    // Re-apply after that so the tone label shows only while Hunter is current.
    document.addEventListener('click', function (event) {
      if (!event.target.closest('[data-sh-composer-menu-item]')) return
      global.setTimeout(applyLiveSettings, 0)
    })
  }

  global.SH = global.SH || {}
  global.SH.applyHunterSettings = applyLiveSettings

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})(window)
