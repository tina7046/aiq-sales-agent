// Copyright (c) 2017-present, Salesforce.com, Inc. All rights reserved
// Licensed under BSD 3-Clause - see LICENSE.txt or git.io/sfdc-license

'use strict'

// Production server. Serves the built prototype out of ./dist and does
// nothing else — no API, no rendering, no state. `npm run build`
// produces dist; Heroku runs that automatically before this starts.
//
// For local work run `npm run dev` instead: that one rebuilds and
// reloads on every save. This file exists for the deployed copy.

const fs = require('fs')
const path = require('path')
const express = require('express')
const auth = require('http-auth')
const JSON5 = require('json5')
const { redirectLocation } = require('./user-routes')

const app = express()
const port = process.env.PORT || 3000
const dist = path.join(__dirname, 'dist')

function defaultUserId () {
  try {
    const catalog = JSON5.parse(fs.readFileSync(path.join(__dirname, 'src/views/data/users.json'), 'utf8'))
    return catalog.defaultUserId
  } catch (e) {
    return 'rohan'
  }
}

// Optional basic auth, on only when BOTH config vars are set — a
// half-configured pair leaves the site open rather than locking
// everyone out of a prototype.
//
// Deliberately NOT named USERNAME/PASSWORD: `USERNAME` is already set
// in many shells and CI images, so it silently wins over whatever you
// pass, and the door then opens for a name nobody chose. These two are
// ours alone.
const user = process.env.BASIC_AUTH_USER
const password = process.env.BASIC_AUTH_PASSWORD

if (user && password) {
  const basic = auth.basic({
    realm: 'Seller Home prototype'
  }, (suppliedUser, suppliedPassword, next) => {
    next(suppliedUser === user && suppliedPassword === password)
  })
  app.use(auth.connect(basic))
}

app.use((req, res, next) => {
  const loc = redirectLocation(req.url, defaultUserId())
  if (loc) return res.redirect(loc)
  next()
})

app.use('/', express.static(dist))

// A missing dist means the build didn't run, and express.static would
// answer every request with a 404 — which reads like a routing bug
// rather than a missing build step. Say so once, at boot.
if (!fs.existsSync(dist)) {
  console.warn('No ./dist directory found. Run "npm run build" first — every request will 404 until you do.')
}

app.listen(port, () =>
  console.log(`Listening on port ${port}!\n\nDeveloping locally? Run "npm run dev" instead.`))
