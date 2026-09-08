// ──────────────────────────────────────────────────────────────────────
// Seller Home — per-user URL helper
// =====================================================================
// Loaded from `_template.html` on every page, before page scripts.
// Identity lives in the path (`/u/<id>/…`), not in a cookie, so two
// tabs can stay on different sellers.
//
//   SH.userUrl('/knowledge.html') → '/u/rohan/knowledge.html'
//   SH.userUrl('/skill_detail.html?id=x') keeps the query
//   Non-seller paths (`/styles/…`, `#`, external) pass through.
//
// Client storage is origin-wide, so two tabs on different /u/<id>/
// paths would share drafts without a prefix. `SH.storageKey('sh:recents')`
// → `sh:rohan:recents` from the URL user id (never a cookie).
//
;(function (global) {
  var SELLER_PAGES = {
    'index.html': true,
    'knowledge.html': true,
    'knowledge_document_detail.html': true,
    'skills.html': true,
    'skills-v2.html': true,
    'skill_detail.html': true,
    'scheduled.html': true,
    'home_conversation.html': true,
    'memory.html': true,
    'tools.html': true
  }

  function parseUserIdFromPath (pathname) {
    var match = String(pathname || '').match(/^\/u\/([^/]+)(?:\/|$)/)
    return match ? decodeURIComponent(match[1]) : null
  }

  function currentUserId () {
    if (global.SH_USER && global.SH_USER.id) return global.SH_USER.id
    return parseUserIdFromPath(global.location && global.location.pathname)
  }

  function userUrl (href, userId) {
    if (href == null || href === '') return href
    var raw = String(href)
    if (raw === '#' || raw.charAt(0) === '#') return raw
    if (/^(javascript:|mailto:|tel:)/i.test(raw)) return raw
    if (/^https?:\/\//i.test(raw)) return raw
    if (raw.indexOf('/u/') === 0) return raw
    if (
      raw.indexOf('/assets/') === 0 ||
      raw.indexOf('/styles/') === 0 ||
      raw.indexOf('/scripts/') === 0 ||
      raw.indexOf('/favicon') === 0
    ) {
      return raw
    }
    var id = userId || currentUserId()
    if (!id) return raw
    if (raw.charAt(0) !== '/') return raw

    var qIndex = raw.indexOf('?')
    var hashIndex = raw.indexOf('#')
    var cut = raw.length
    if (qIndex !== -1) cut = Math.min(cut, qIndex)
    if (hashIndex !== -1 && (qIndex === -1 || hashIndex < qIndex)) cut = Math.min(cut, hashIndex)
    var path = raw.slice(0, cut)
    var rest = raw.slice(cut)
    var file = path.replace(/^\//, '')
    if (!SELLER_PAGES[file]) return raw
    return '/u/' + encodeURIComponent(id) + path + rest
  }

  function urlForUser (userId, pathname, search, hash) {
    var path = pathname == null
      ? (global.location && global.location.pathname) || '/'
      : pathname
    var q = search == null
      ? (global.location && global.location.search) || ''
      : search
    var h = hash == null
      ? (global.location && global.location.hash) || ''
      : hash
    var scoped = String(path).match(/^\/u\/[^/]+(\/.*)?$/)
    var rest
    if (scoped) {
      rest = scoped[1] || '/index.html'
      if (rest === '/') rest = '/index.html'
    } else {
      rest = '/index.html'
      q = ''
      h = ''
    }
    return '/u/' + encodeURIComponent(userId) + rest + q + h
  }

  // `sh:recents` → `sh:<id>:recents`. Already-scoped keys pass through.
  // Non-`sh:` keys (`sh_tool_connections`) become `sh:<id>:<key>`.
  function storageKey (key) {
    if (key == null || key === '') return key
    var id = currentUserId()
    var raw = String(key)
    if (!id) return raw
    var ns = 'sh:' + id + ':'
    if (raw.indexOf(ns) === 0) return raw
    if (raw.indexOf('sh:') === 0) return ns + raw.slice(3)
    return ns + raw
  }

  global.SH = global.SH || {}
  global.SH.userUrl = userUrl
  global.SH.urlForUser = urlForUser
  global.SH.currentUserId = currentUserId
  global.SH.storageKey = storageKey
})(window)
