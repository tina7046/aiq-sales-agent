'use strict'

// Shared seller-page URL helpers for gulp (compile-time appUrl) and
// the static servers (root → /u/<default>/… redirects). Keep the HTML
// filename list here so a new Seller Home surface is one edit.

const SELLER_HTML = [
  'index.html',
  'knowledge.html',
  'knowledge_document_detail.html',
  'skills.html',
  'skill_detail.html',
  'scheduled.html',
  'home_conversation.html',
  'memory.html',
  'tools.html'
]

const SELLER_FILE = new Set(SELLER_HTML)

const ASSET_PREFIXES = ['/assets/', '/styles/', '/scripts/', '/favicon']

function prefixAppUrl (userId, href) {
  if (href == null || href === '') return href
  const raw = String(href)
  if (raw === '#' || raw.charAt(0) === '#') return raw
  if (/^(javascript:|mailto:|tel:)/i.test(raw)) return raw
  if (/^https?:\/\//i.test(raw)) return raw
  if (!userId) return raw
  if (raw.indexOf('/u/') === 0) return raw
  for (let i = 0; i < ASSET_PREFIXES.length; i++) {
    if (raw.indexOf(ASSET_PREFIXES[i]) === 0) return raw
  }
  if (raw.charAt(0) !== '/') return raw

  const qIndex = raw.indexOf('?')
  const hashIndex = raw.indexOf('#')
  let cut = raw.length
  if (qIndex !== -1) cut = Math.min(cut, qIndex)
  if (hashIndex !== -1 && (qIndex === -1 || hashIndex < qIndex)) cut = Math.min(cut, hashIndex)
  const path = raw.slice(0, cut)
  const rest = raw.slice(cut)
  const file = path.replace(/^\//, '')
  if (!SELLER_FILE.has(file)) return raw
  return '/u/' + userId + path + rest
}

// If this request is a root seller URL, return the Location to send
// them to. Otherwise null (serve as-is).
function redirectLocation (reqUrl, defaultUserId) {
  if (!defaultUserId) return null
  const qIndex = reqUrl.indexOf('?')
  const path = qIndex === -1 ? reqUrl : reqUrl.slice(0, qIndex)
  const query = qIndex === -1 ? '' : reqUrl.slice(qIndex)
  if (path === '/' || path === '') {
    return '/u/' + defaultUserId + '/index.html' + query
  }
  const file = path.replace(/^\//, '')
  if (SELLER_FILE.has(file)) {
    return '/u/' + defaultUserId + '/' + file + query
  }
  return null
}

module.exports = {
  SELLER_HTML,
  prefixAppUrl,
  redirectLocation
}
