// ──────────────────────────────────────────────────────────────────────
// First-run gate — send sellers through /onboarding.html before Ask
// =====================================================================
// Loaded from `_template.html` right after sh_user.js so identity and
// storageKey exist. Redirects before the Home canvas paints.
//
// Gated files: index.html, home_conversation.html.
// Skip: `?onboarding=0`. Reset: `?reset=1` is left for home.js so demo
// state clears, then home.js routes here.
//
;(function (global) {
  var DONE_KEY = 'sh:onboarding:done'
  var FRESH_KEY = 'sh:onboarding:fresh'
  var GATED = {
    'index.html': true,
    'home_conversation.html': true
  }

  function storageKey (key) {
    return (global.SH && global.SH.storageKey) ? global.SH.storageKey(key) : key
  }

  function pageFile () {
    var path = (global.location && global.location.pathname) || ''
    var match = path.match(/([^/]+\.html)$/)
    if (match) return match[1]
    if (/\/u\/[^/]+\/?$/.test(path) || path === '/' || path === '') return 'index.html'
    return ''
  }

  function isDone () {
    try {
      return global.localStorage.getItem(storageKey(DONE_KEY)) === '1'
    } catch (e) {
      return true
    }
  }

  function bootGate () {
    var file = pageFile()
    if (!GATED[file]) return
    var params
    try {
      params = new URL(global.location.href).searchParams
    } catch (e) {
      return
    }
    if (params.get('onboarding') === '0') return
    if (params.get('reset') === '1') return
    if (isDone()) return
    var dest = (global.SH && global.SH.userUrl)
      ? global.SH.userUrl('/onboarding.html')
      : '/onboarding.html'
    global.location.replace(dest)
  }

  var TEAM_NAMES = {
    'mid-market': 'AMER Mid-Market New Business',
    enterprise: 'AMER Enterprise Account Management',
    combined: 'both teams as one playbook'
  }

  function showFreshNotice () {
    var notice = document.querySelector('[data-sh-onboard-notice]')
    if (!notice) return
    try {
      var key = storageKey(FRESH_KEY)
      if (global.sessionStorage.getItem(key) !== '1') return
      global.sessionStorage.removeItem(key)
      var team = global.localStorage.getItem(storageKey('sh:onboarding:team'))
      var name = TEAM_NAMES[team]
      var copy = notice.querySelector('[data-sh-onboard-notice-copy]')
      if (copy && name) {
        copy.textContent = 'Hunter is learning ' + name + ' in the background. The playbook shows up under Knowledge, on Learnings. You can prospect now.'
      }
      notice.hidden = false
    } catch (e) {}
  }

  bootGate()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showFreshNotice)
  } else {
    showFreshNotice()
  }
})(window)
