// Copyright (c) 2017-present, Salesforce.com, Inc. All rights reserved
// Licensed under BSD 3-Clause - see LICENSE.txt or git.io/sfdc-license

'use strict'

// This gulpfile makes use of new JavaScript features.
// Babel handles this without us having to do anything. It just works.
// You can read more about the new JavaScript features here:
// https://babeljs.io/docs/learn-es2015/

const path = require('path')
const fs = require('fs')
const gulp = require('gulp')
const del = require('del')
const browserSync = require('browser-sync')
const JSON5 = require('json5')
const nunjucks = require('nunjucks')
const { SELLER_HTML, prefixAppUrl, redirectLocation } = require('./user-routes')

const $ = require('gulp-load-plugins')({
  postRequireTransforms: {
    sass: (sass) => {
      return sass(require('sass'))
    }
  }
})

gulp.task('assets', () =>
  gulp
    .src([
      'node_modules/@salesforce-ux/design-system/assets/**/*.{woff,woff2,txt,jpg,png,gif,svg}',
      'src/assets/**/*.{woff,woff2,txt,jpg,png,gif,svg,mp4}'
    ])
    .pipe(gulp.dest('dist/assets'))
)

gulp.task('favicon', () =>
  gulp
    .src([
      'src/favicon*.*'
    ], { base: 'src' })
    .pipe(gulp.dest('dist'))
)

const getSharedData = () => JSON5.parse(fs.readFileSync('./src/views/data/shared.json', 'utf8'))

const getUsersCatalog = () => {
  try {
    return JSON5.parse(fs.readFileSync('./src/views/data/users.json', 'utf8'))
  } catch (e) {
    return { defaultUserId: 'rohan', users: [] }
  }
}

// Set for the duration of one Nunjucks compile pass so `appUrl`
// prefixes in-app hrefs with `/u/<id>/`. Lab pages compile with
// this null and emit today's unprefixed paths (then the static
// server redirects leftover seller URLs to the default user).
let compileUser = null

function userById (catalog, id) {
  const users = (catalog && catalog.users) || []
  for (let i = 0; i < users.length; i++) {
    if (users[i] && users[i].id === id) return users[i]
  }
  return users[0] || null
}

function defaultUser (catalog) {
  return userById(catalog, catalog && catalog.defaultUserId) || (catalog.users && catalog.users[0]) || null
}

function readJson5File (filePath) {
  try {
    return JSON5.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (e) {
    return null
  }
}

// Overlay arrays replace; overlay objects merge key-by-key. That lets
// `users/<id>/index.json` own `feed.items` without copying feed chrome
// (headings, filter, outputTypes) into every persona pack.
function deepMerge (base, overlay) {
  if (overlay === undefined) return base
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return overlay
  }
  const out = (base && typeof base === 'object' && !Array.isArray(base))
    ? Object.assign({}, base)
    : {}
  Object.keys(overlay).forEach((key) => {
    out[key] = deepMerge(out[key], overlay[key])
  })
  return out
}

function pageDataPath (name) {
  return path.resolve('./src/views/data/' + name + '.json')
}

function userOverlayPath (userId, name) {
  return path.resolve('./src/views/data/users/' + userId + '/' + name + '.json')
}

// Shared chrome + the persona overlay for this compile.
// A non-default user who authored `users/<id>/<name>.json` replaces
// the default pack for that page (conversation maps are objects;
// merging on top of Rohan would keep Rohan's ids). Missing overlay
// files still fall back to the default user so a thin pack can omit
// a page.
function loadPageData (name, userId) {
  const shared = readJson5File(pageDataPath(name))
  if (!shared) return null
  const catalog = getUsersCatalog()
  const defaultId = catalog.defaultUserId
  const overlayId = userId || defaultId
  const defaultOverlay = defaultId ? readJson5File(userOverlayPath(defaultId, name)) : null
  const userOverlay = (overlayId && defaultId && overlayId !== defaultId)
    ? readJson5File(userOverlayPath(overlayId, name))
    : null
  const overlay = (overlayId !== defaultId && userOverlay)
    ? userOverlay
    : defaultOverlay
  return overlay ? deepMerge(shared, overlay) : shared
}

// Get data from the corresponding filename
// e.g. inject data/foo.json into foo.html
const getData = (file) => {
  const catalog = getUsersCatalog()
  const pageName = path.basename(file.path, '.html')
  let data = {
    shared: getSharedData(),
    usersCatalog: catalog,
    currentUser: compileUser || defaultUser(catalog)
  }

  try {
    const page = loadPageData(pageName, compileUser && compileUser.id)
    if (page) data = Object.assign(data, page)
  } catch (e) {
    // Don't fail if the JSON is badly formed or the file doesn't exist
  } finally {
    /* eslint-disable no-unsafe-finally */
    return data
  }
}

// Custom Nunjucks environment, needed because the default one has no
// loader configured for `{% include %}` / `{% import %}` of the `_*.html`
// partials, and no project filters. Ported alongside the Seller Home
// components from the `hunter-main-main` prototype:
//   • `tojson` — JSON.stringify, used by `_home_composer.html` to embed
//     the suggestion list in a `data-*` attribute.
//   • `emphasis` — the two inline markdown marks, so authored copy in the
//     JSON reads as prose instead of as HTML.
//   • `SOURCE_ICONS` / `distinctSources` — the shared source-to-icon
//     registry the prospect tables badge their signals with.
//   • `readData` — read another page's JSON at build time.
// `noCache` matters for the dev watcher: the loader otherwise caches compiled
// partials in memory, so editing `_template.html` or any `_*.html` include
// silently rebuilt pages from the stale copy until the server was restarted.
const nunjucksEnv = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(path.join(__dirname, 'src/views'), { noCache: true })
)
nunjucksEnv.addFilter('tojson', (obj) => JSON.stringify(obj))
nunjucksEnv.addFilter('appUrl', (href) => prefixAppUrl(compileUser && compileUser.id, href))
nunjucksEnv.addGlobal('appUrl', (href) => prefixAppUrl(compileUser && compileUser.id, href))
// `emphasis` — `**bold**` and `_italic_` in a JSON copy string become
// `<strong>` and `<em>`. Copy in this project is often pasted from a
// markdown draft, and a sentence written as prose is far easier to edit
// than the same sentence with tags in the middle of it.
//
// Escapes first, so the ONLY markup that survives is the two marks this
// filter puts there itself. Callers still need `| safe` to render the
// result — that's the marker that says "this string went through here".
// Deliberately not a markdown parser: no links, no lists, no code.
nunjucksEnv.addFilter('emphasis', (input) => {
  if (input == null) return ''
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
})
// `SOURCE_ICONS` — the data provider a signal came from, mapped to the
// brand mark in src/assets/images/source_icons. A global rather than a
// `{% set %}` per template because three tables render sources now (the
// conversation table, the table lab, the pivot/group lab) and a row's
// badge has to agree with the icons on that row's signals. Keys are the
// exact `source` strings in the data — including Moody's curly
// apostrophe, which is what the JSON has.
//
// TechCrunch has no mark of its own and rides the generic web icon; it
// stands in for press coverage generally.
nunjucksEnv.addGlobal('SOURCE_ICONS', {
  '6sense': 'source_6sense.svg',
  'Apollo': 'source_apollo.svg',
  'Demandbase': 'source_demandbase.svg',
  'G2': 'source_g2.svg',
  'Gong': 'source_gong.svg',
  'Momentum': 'source_momentum.svg',
  'Moody’s': 'source_moodys.svg',
  'Salesforce': 'source_salesforce.svg',
  'SalesIntel': 'source_salesintel.svg',
  'TechCrunch': 'source_web.svg',
  'ZoomInfo': 'source_zoominfo.svg'
})
// `distinctSources` — the providers behind a row's signals, deduped,
// first-mention order. Feeds the row's aggregated source badge, so that
// badge is a summary of the signal list rather than a separate fact
// that can disagree with it. Tolerates the older shape where a signal
// was a bare string (no source to report) by skipping it.
nunjucksEnv.addFilter('distinctSources', (signals) => {
  if (!Array.isArray(signals)) return []
  const out = []
  for (const s of signals) {
    const name = s && typeof s === 'object' ? s.source : null
    if (name && !out.includes(name)) out.push(name)
  }
  return out
})
// `readData("<name>")` — load src/views/data/<name>.json and deep-merge
// src/views/data/users/<id>/<name>.json for the current compile user
// (falling back to the default persona). Used by home_conversation.html
// to pull conversations out of index without copying keys into
// shared.json. Returns null on any error so callers can fall back with
// `{% if %}` instead of failing the build.
nunjucksEnv.addGlobal('readData', (name) => {
  try {
    return loadPageData(name, compileUser && compileUser.id)
  } catch (e) {
    return null
  }
})

// `expandRuns(conv)` — expand a scheduled-workflow conversation whose
// thread is one block per run into the full message list the feed
// renders. Such a conversation authors only a few runs as content
// templates (`conv.messages`, each run starting at a message that
// carries a `runId`); this clones them across every entry in
// `conv.runHistory.runs`, so the thread reflects the whole run history
// without hand-writing dozens of near-identical blocks. (The user's
// ask: "generate 5 and re-use the same 5 over and over, swapping the
// dates.")
//
// Per run it prepends a `run_header` message ("{title} | {date}") that
// doubles as the run's scroll anchor, then a template's messages with
// their ids namespaced to the run (so nothing collides in the DOM) and
// their own `runId` stripped — the header is the single run-start the
// feed divider keys off. Failed runs take the short "didn't finish"
// template; completed runs cycle the full ones. The lead's "week of …"
// date is rewritten to the run's date; deeper figures stay the
// template's (a reused block, dated at the top).
//
// Feed order is oldest-first (runHistory is newest-first), so the most
// recent run sits at the bottom by the composer, like any chat thread.
// A conversation without runHistory is returned unchanged.
nunjucksEnv.addGlobal('expandRuns', (conv) => {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const fmtLong = (iso) => { const p = String(iso).slice(0, 10).split('-').map(Number); return MONTHS[p[1] - 1] + ' ' + p[2] + ', ' + p[0] }
  const fmtMonthDay = (iso) => { const p = String(iso).slice(0, 10).split('-').map(Number); return MONTHS[p[1] - 1] + ' ' + p[2] }

  // Only conversations that opt in with `expandFromTemplates` are built
  // from templates. A run-based thread whose messages ARE the runs
  // already (e.g. the Pipeline Snapshot runs), or a conversation that
  // just wants the header dropdown over its own single run, keeps its
  // authored messages untouched — it returns here unchanged and only the
  // Run History dropdown (rendered separately) is added.
  const rh = conv && conv.runHistory
  if (!rh || !rh.expandFromTemplates || !Array.isArray(rh.runs) || !rh.runs.length) {
    return (conv && conv.messages) || []
  }
  const msgs = conv.messages || []
  if (!msgs.length) return msgs

  // Group the authored messages into run templates: a new template
  // starts at each message carrying a `runId`, and runs until the next.
  const templates = []
  let cur = null
  for (const m of msgs) {
    if (m.runId) { cur = []; templates.push(cur) }
    if (cur) cur.push(m)
  }
  if (!templates.length) return msgs

  const shortTpl = templates.find((t) => t.length === 1) || null
  const fullTpls = templates.filter((t) => t.length > 1)
  const title = rh.headerTitle || 'Run'
  const clone = (o) => JSON.parse(JSON.stringify(o))

  const out = []
  let fullIdx = 0
  const runs = rh.runs.slice().reverse() // oldest-first for the feed
  for (const run of runs) {
    const tpl = (run.status === 'failed' && shortTpl)
      ? shortTpl
      : (fullTpls.length ? fullTpls[fullIdx++ % fullTpls.length] : templates[0])

    out.push({
      id: run.runId + '-header',
      type: 'run_header',
      runId: run.runId, // the ONE run-start per run — the divider keys off it
      titleLabel: title,
      dateLabel: fmtLong(run.startedAt)
    })

    for (let i = 0; i < tpl.length; i++) {
      const c = clone(tpl[i])
      delete c.runId // headers own the run boundary now
      c.id = run.runId + '-' + c.id
      if (c.table && c.table.id) c.table.id = run.runId + '-' + c.table.id
      if (c.table && Array.isArray(c.table.rows)) {
        for (const r of c.table.rows) { if (r && r.id) r.id = run.runId + '-' + r.id }
      }
      // The lead carries the only date worth reconciling with the run.
      if (i === 0 && typeof c.text === 'string') {
        c.text = c.text.replace(/for the week of \*\*[^*]+\*\*/, 'for the week of **' + fmtMonthDay(run.startedAt) + '**')
      }
      out.push(c)
    }
  }
  return out
})
// `today()` — live calendar as "Mon September 21", the shape the Seller
// Home feed header has always shown. Build-time stamp is a fallback;
// home.js re-stamps `[data-sh-today]` from the browser clock on load.
// Pages that pin `feed.date` omit that attribute and stay put.
//
// `formatToParts` + filter rather than `format`, because en-US puts a
// comma after the weekday ("Mon, September 21") and the design doesn't
// have one. The same formatter is duplicated in home.js — six lines in
// two languages beats a build step to share them.
nunjucksEnv.addGlobal('today', () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'long', day: 'numeric'
  }).formatToParts(new Date())
  return parts
    .filter((p) => p.type === 'weekday' || p.type === 'month' || p.type === 'day')
    .map((p) => p.value)
    .join(' ')
})
nunjucksEnv.addGlobal('todayShort', () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric'
  }).formatToParts(new Date())
  return parts
    .filter((p) => p.type === 'month' || p.type === 'day')
    .map((p) => p.value)
    .join(' ')
})

// `inlineSvg("<path under src/assets>", { attr: value })` — drop an SVG's
// markup straight into the page instead of pointing an `<img>` at it.
//
// Why inline at all, when `<img>` is the simpler embed: an image is its
// own document. It never learns what the host page was asked for, so
// neither the page's `@media (prefers-reduced-motion: reduce)` rules nor
// the SVG's own reach it, and an endlessly looping illustration keeps
// looping for someone who asked for less motion. Inlined, the file's
// stylesheet joins this document and the query finally evaluates against
// the reader's preference. That's the whole reason this exists — an SVG
// that doesn't animate should stay an `<img>`, which caches as its own
// request and can't collide with anything on the page.
//
// Read at build time rather than pasted into a template, because these
// files are generated artifacts: a pasted copy is one asset rebuild away
// from being silently stale, and the source file's own handoff says not
// to hand-edit it. Same reason the attributes are injected here — adding
// `role`/`aria-label`/`class` to the root tag at render time leaves the
// file on disk byte-identical to what its generator produced.
//
// Returns a plain string, so callers need `| safe` — the same marker the
// `emphasis` filter uses to mark "this deliberately renders as markup".
// Forgetting it escapes the whole SVG into visible text, which is a loud
// enough failure to catch immediately.
//
// One caveat inherited from inlining stays with the caller: the file's
// `<style>` is document-scoped rather than sandboxed. The other — that
// an inline SVG brings its ids into the document, so normally only one
// copy per page — is what `idPrefix` is for. Pass a distinct one per
// copy and every id, every `url(#…)` and every `#…` in the embedded
// stylesheet is renamed to match, which is what lets the same artwork
// appear twice. Without it a second copy duplicates all 29 ids, and the
// CSS keyed on `#Scan_root` would style both roots from whichever copy
// the browser saw first.
nunjucksEnv.addGlobal('inlineSvg', (name, attrs, idPrefix) => {
  let svg
  try {
    svg = fs.readFileSync(path.resolve('./src/assets/' + name), 'utf8')
  } catch (e) {
    // Same posture as `readData`: a visible no-op beats failing the build.
    return '<!-- inlineSvg: could not read src/assets/' + name + ' -->'
  }

  // An XML prolog is legal in a standalone file and invalid mid-document.
  svg = svg.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^>]*\?>\s*/, '')

  // Rename every id the file declares, and every reference to one. The
  // references live in three places — `url(#x)` in fills, `href="#x"` in
  // <use>, and bare `#x` selectors in the embedded stylesheet — and all
  // three are just `#x` in the text, so one pass over `#id` covers them.
  //
  // Longest ids first: `#sc-s7` would otherwise match inside `#sc-s7-x`
  // and rename half of it. Already-renamed text can't be hit twice,
  // because the prefix lands between the `#` and the old name.
  if (idPrefix) {
    const ids = [...svg.matchAll(/\sid="([^"]+)"/g)]
      .map((m) => m[1])
      .sort((a, b) => b.length - a.length)

    for (const oldId of ids) {
      const esc = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      svg = svg
        .replace(new RegExp(`id="${esc}"`, 'g'), () => `id="${idPrefix}${oldId}"`)
        .replace(new RegExp(`#${esc}\\b`, 'g'), () => `#${idPrefix}${oldId}`)
    }
  }

  const extra = Object.keys(attrs || {})
    .map((k) => ' ' + k + '="' + String(attrs[k]).replace(/"/g, '&quot;') + '"')
    .join('')

  // Function replacement, not a string: `$&` and friends in an attribute
  // value would otherwise be read as replacement patterns.
  return svg.replace(/<svg\b/, () => '<svg' + extra)
})

const SELLER_VIEW_GLOBS = SELLER_HTML.map((name) => 'src/views/' + name)
const LAB_VIEW_GLOBS = [
  'src/views/**/*.html',
  '!src/views/**/_*.html'
].concat(SELLER_VIEW_GLOBS.map((glob) => '!' + glob))

function compileHtml (globs, dest, user) {
  compileUser = user || null
  return gulp
    .src(globs, { base: 'src/views', allowEmpty: true })
    .pipe($.plumber())
    .pipe($.data(getData))
    .pipe($.nunjucks.compile(null, { env: nunjucksEnv }))
    .pipe(gulp.dest(dest))
}

function compileLabViews () {
  return compileHtml(LAB_VIEW_GLOBS, 'dist', null)
}

function compileSellerViews (user) {
  const task = function compileOneUser () {
    return compileHtml(SELLER_VIEW_GLOBS, 'dist/u/' + user.id, user)
  }
  task.displayName = 'views:u:' + user.id
  return task
}

function sellerViewTasks () {
  const catalog = getUsersCatalog()
  const users = (catalog.users || []).filter((u) => u && u.id)
  if (!users.length) {
    return [compileSellerViews({ id: 'rohan', name: 'Rohan' })]
  }
  return users.map(compileSellerViews)
}

function removeRootSellerHtml (done) {
  const leftovers = SELLER_HTML.map((name) => path.join('dist', name))
  del(leftovers, { force: false }).then(function () { done() }, done)
}

gulp.task('views', function compileViews (done) {
  gulp.series(compileLabViews, ...sellerViewTasks(), removeRootSellerHtml)(done)
})

gulp.task('scripts', () =>
  gulp
    .src([
      'src/scripts/**/*.js'
    ], { base: 'src' })
    .pipe(gulp.dest('dist/'))
)

gulp.task('styles', () =>
  gulp
    .src('src/styles/**/*.scss')
    .pipe($.plumber())
    .pipe($.sourcemaps.init())
    .pipe($.sass.sync({
      precision: 10
    }).on('error', $.sass.logError))
    .pipe($.autoprefixer({ browsers: ['last 2 versions'], remove: false }))
    .pipe($.sourcemaps.write('.'))
    .pipe(gulp.dest('dist/styles'))
    .pipe(browserSync.stream({ match: '**/*.css' }))
)

gulp.task('clean', () => del(['dist'], { dot: true }))

// Static Server (development)
gulp.task('default',
  gulp.series('clean', gulp.parallel('assets', 'views', 'styles', 'scripts', 'favicon'),
  function () {
    browserSync({
      // The starter kit opens itself up in a new browser tab every time the app starts.
      // Uncomment the next line to prevent this behavior:
      // open: false,
      notify: false,
      // Ports 3000/3001 are usually taken by sibling prototypes, so pin the
      // dev server here to keep the URL stable across restarts.
      port: 3002,
      server: {
        baseDir: 'dist',
        // The HTML documents carry no cache-bust query of their own, so a
        // browser that revalidates only from its in-memory cache (the Cursor
        // Simple Browser does this on soft reloads) keeps serving the old
        // page — and with it the previous ?v= asset references, so bumped
        // CSS/JS never gets fetched. Force documents to never be cached.
        middleware: [
          function redirectSellerRoot (req, res, next) {
            const catalog = getUsersCatalog()
            const loc = redirectLocation(req.url, catalog.defaultUserId)
            if (loc) {
              res.writeHead(302, { Location: loc })
              res.end()
              return
            }
            next()
          },
          function (req, res, next) {
            if (/\.html(\?|$)/.test(req.url) || req.url === '/' || !/\.[a-z0-9]+(\?|$)/i.test(req.url)) {
              res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
              res.setHeader('Pragma', 'no-cache')
              res.setHeader('Expires', '0')
            }
            next()
          }
        ]
      }
    })
    gulp.watch('src/styles/**/*.scss', gulp.series('styles'))
    gulp.watch([
      'src/views/**/*.html',
      'src/views/data/**/*.json',

      // `inlineSvg` copies these into the markup at build time, so a
      // rebuilt illustration only reaches the page if the views rebuild
      // too — the `assets` watch below refreshes the standalone file and
      // would otherwise leave the inlined copy stale.
      'src/assets/images/illustrations/*.svg'
    ], gulp.series('views'))
    gulp.watch('src/assets/**/*.{woff,woff2,txt,jpg,png,gif,svg,mp4}', gulp.series('assets'))
    gulp.watch('src/scripts/**/*.js', gulp.series('scripts'))
    gulp.watch([
      'dist/**/*.html',
      'dist/scripts/**/*.js',

      // Note: we're not watching icons and fonts changes,
      // as they're slowing down the task
      'dist/assets/*.{woff,woff2,txt,jpg,png,gif,svg}',
      'dist/assets/styles/*.css'
    ]).on('change', browserSync.reload)
  }))

gulp.task('build', gulp.series('clean', 'assets', 'views', 'styles', 'scripts', 'favicon'))
