'use strict'

// Rewrite the built dist/ so GitHub project Pages can serve it from
// https://<user>.github.io/aiq-sales-agent/ . Local `npm start` does
// not run this — paths stay root-absolute there.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'dist')
const BASE = '/aiq-sales-agent'
const PREFIXES = ['/assets/', '/styles/', '/scripts/', '/favicon', '/u/']
const TEXT = new Set(['.html', '.css', '.js', '.svg', '.map'])

function rewrite (text) {
  let out = text.replace(/window\.SH_BASE = ''/g, "window.SH_BASE = '" + BASE + "'")
  PREFIXES.forEach(function (prefix) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp('(?<!aiq-sales-agent)' + escaped, 'g')
    out = out.replace(re, BASE + prefix)
  })
  return out
}

function walk (dir) {
  fs.readdirSync(dir).forEach(function (name) {
    const full = path.join(dir, name)
    if (name === 'sh_user.js') return
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      walk(full)
      return
    }
    if (!TEXT.has(path.extname(name))) return
    const next = rewrite(fs.readFileSync(full, 'utf8'))
    fs.writeFileSync(full, next)
  })
}

if (!fs.existsSync(ROOT)) {
  console.error('No dist/. Run npm run build first.')
  process.exit(1)
}

walk(ROOT)
fs.writeFileSync(path.join(ROOT, '.nojekyll'), '')
fs.writeFileSync(path.join(ROOT, 'index.html'), [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8" />',
  '<meta http-equiv="refresh" content="0; url=' + BASE + '/u/rohan/index.html" />',
  '<title>Seller Home</title>',
  '<script>location.replace("' + BASE + '/u/rohan/index.html")</script>',
  '</head>',
  '<body>',
  '<p><a href="' + BASE + '/u/rohan/index.html">Open the prototype</a></p>',
  '</body>',
  '</html>',
  ''
].join('\n'))

console.log('Prepared dist/ for GitHub Pages at ' + BASE)
