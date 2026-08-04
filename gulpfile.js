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
      'src/assets/**/*.{woff,woff2,txt,jpg,png,gif,svg}'
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

// Get data from the corresponding filename
// e.g. inject data/foo.json into foo.html
const getData = (file) => {
  const dataPath = path.resolve('./src/views/data/' + path.basename(file.path, '.html') + '.json')
  let data = { shared: getSharedData() }

  try {
    data = Object.assign(data, JSON5.parse(fs.readFileSync(dataPath, 'utf8')))
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
//   • `readData` — read another page's JSON at build time.
// `noCache` matters for the dev watcher: the loader otherwise caches compiled
// partials in memory, so editing `_template.html` or any `_*.html` include
// silently rebuilt pages from the stale copy until the server was restarted.
const nunjucksEnv = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(path.join(__dirname, 'src/views'), { noCache: true })
)
nunjucksEnv.addFilter('tojson', (obj) => JSON.stringify(obj))
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
// `readData("<name>")` — read src/views/data/<name>.json at build time so a
// template can reach another page's data without copying keys into
// shared.json (which loads on every page). Used by home_conversation.html to
// pull the `conversations` registry out of index.json, keeping Seller Home
// and the conversation drill-in on one source of truth. Returns null on any
// error so callers can fall back with `{% if %}` instead of failing the build.
nunjucksEnv.addGlobal('readData', (name) => {
  try {
    return JSON5.parse(fs.readFileSync(path.resolve('./src/views/data/' + name + '.json'), 'utf8'))
  } catch (e) {
    return null
  }
})
// `today()` — the current date as "Mon July 13", the shape the Seller Home
// review header has always shown. A function rather than a value so a
// dev watcher left running overnight re-renders it, and so a `dist` built
// on Monday isn't stamped Monday forever.
//
// Build time is only half the story: `dist` is a static bundle, so a
// deploy from last week would still serve last week's date. home.js
// re-stamps any `[data-sh-today]` element on load, which is what makes it
// genuinely live. This global exists so the markup ships with the right
// date already in it instead of flashing a stale one.
//
// `formatToParts` + filter rather than `format`, because en-US puts a
// comma after the weekday ("Mon, July 13") and the design doesn't have
// one. The same formatter is duplicated in home.js — six lines in two
// languages beats a build step to share them.
nunjucksEnv.addGlobal('today', () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'long', day: 'numeric'
  }).formatToParts(new Date())
  return parts
    .filter((p) => p.type === 'weekday' || p.type === 'month' || p.type === 'day')
    .map((p) => p.value)
    .join(' ')
})

gulp.task('views', () =>
  gulp
    .src([
      'src/views/**/*.html',
      '!src/views/**/_*.html'
    ], { base: 'src/views' })
    .pipe($.plumber())
    .pipe($.data(getData))
    .pipe($.nunjucks.compile(null, { env: nunjucksEnv }))
    .pipe(gulp.dest('dist'))
)

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
      server: 'dist'
    })
    gulp.watch('src/styles/**/*.scss', gulp.series('styles'))
    gulp.watch([
      'src/views/**/*.html',
      'src/views/data/*.json'
    ], gulp.series('views'))
    gulp.watch('src/assets/**/*.{woff,woff2,txt,jpg,png,gif,svg}', gulp.series('assets'))
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
