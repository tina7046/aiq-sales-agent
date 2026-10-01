// ──────────────────────────────────────────────────────────────────────
// First-run onboarding — welcome, mailbox, team, confirm, learn, review
// =====================================================================
// Owns /onboarding.html. Hunter has already read the org. The sales
// leader picks which team to learn, confirms the deals, and approves
// the playbook. Mailbox connect is a fake beat (spinner → Connected).
//
;(function (global) {
  'use strict'

  var root = document.querySelector('[data-sh-onboard-root]')
  if (!root) return

  var DONE_KEY = 'sh:onboarding:done'
  var FRESH_KEY = 'sh:onboarding:fresh'
  var MAIL_KEY = 'sh:onboarding:mailbox'
  var TEAM_KEY = 'sh:onboarding:team'

  var selectedTeam = 'mid-market'

  function storageKey (key) {
    return (global.SH && global.SH.storageKey) ? global.SH.storageKey(key) : key
  }

  function write (key, value) {
    try {
      global.localStorage.setItem(storageKey(key), value)
    } catch (e) {}
  }

  function showStep (id) {
    var steps = root.querySelectorAll('[data-sh-onboard-step]')
    for (var i = 0; i < steps.length; i++) {
      var on = steps[i].getAttribute('data-sh-onboard-step') === id
      steps[i].hidden = !on
    }
    var dots = root.querySelectorAll('[data-sh-onboard-dot]')
    for (var d = 0; d < dots.length; d++) {
      var active = dots[d].getAttribute('data-sh-onboard-dot') === id
      dots[d].classList.toggle('is-active', active)
      dots[d].setAttribute('aria-current', active ? 'step' : 'false')
    }
    var scroller = root.querySelector('.seller-home__main')
    if (scroller) scroller.scrollTop = 0
  }

  function showProfile (id) {
    selectedTeam = id
    var blocks = root.querySelectorAll('[data-sh-onboard-profile]')
    for (var i = 0; i < blocks.length; i++) {
      var on = blocks[i].getAttribute('data-sh-onboard-profile') === id
      blocks[i].hidden = !on
    }
    syncLearnButton()
  }

  function setFork (on) {
    root.setAttribute('data-sh-onboard-fork', on ? '1' : '0')
  }

  function visibleProfile () {
    var blocks = root.querySelectorAll('[data-sh-onboard-profile]')
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].hidden) continue
      if (blocks[i].getAttribute('data-sh-onboard-profile') !== selectedTeam) continue
      if (blocks[i].querySelector('[data-sh-onboard-learn]')) return blocks[i]
    }
    return null
  }

  function syncLearnButton () {
    var profile = visibleProfile()
    if (!profile) return
    var wins = profile.querySelectorAll('[data-sh-onboard-win]')
    var left = 0
    for (var i = 0; i < wins.length; i++) {
      if (!wins[i].hidden) left += 1
    }
    var learn = profile.querySelector('[data-sh-onboard-learn]')
    if (learn) learn.disabled = left === 0
  }

  function finish (assigned) {
    if (assigned) write(TEAM_KEY, selectedTeam)
    write(DONE_KEY, '1')
    try {
      global.sessionStorage.setItem(storageKey(FRESH_KEY), '1')
    } catch (e) {}
    var dest = (global.SH && global.SH.userUrl)
      ? global.SH.userUrl('/index.html')
      : '/index.html'
    global.location.assign(dest)
  }

  function goTeams (skipMail) {
    if (skipMail) write(MAIL_KEY, 'skipped')
    setFork(false)
    showStep('teams')
  }

  function bindWelcome () {
    var connect = root.querySelector('[data-sh-onboard-go="mailbox"]')
    var skip = root.querySelector('[data-sh-onboard-go="teams-skip-mail"]')
    if (connect) {
      connect.addEventListener('click', function () {
        showStep('mailbox')
      })
    }
    if (skip) {
      skip.addEventListener('click', function () {
        goTeams(true)
      })
    }
  }

  function bindMailbox () {
    var list = root.querySelector('[data-sh-onboard-providers]')
    var skip = root.querySelector('[data-sh-onboard-go="teams"]')
    var cont = root.querySelector('[data-sh-onboard-mailbox-continue]')
    if (!list) return

    list.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-sh-onboard-connect]')
      if (!btn || btn.disabled) return
      var row = btn.closest('[data-sh-onboard-provider]')
      if (!row) return
      var id = row.getAttribute('data-sh-onboard-provider')
      var label = btn.getAttribute('data-sh-onboard-connected-label') || 'Connected'
      btn.disabled = true
      btn.textContent = 'Connecting…'
      global.setTimeout(function () {
        var rows = list.querySelectorAll('[data-sh-onboard-provider]')
        for (var i = 0; i < rows.length; i++) {
          var other = rows[i].querySelector('[data-sh-onboard-connect]')
          if (other && rows[i] !== row) other.disabled = true
        }
        btn.textContent = label
        btn.disabled = true
        row.classList.add('is-connected')
        write(MAIL_KEY, id)
        if (cont) cont.hidden = false
      }, 700)
    })

    if (skip) {
      skip.addEventListener('click', function () {
        goTeams(true)
      })
    }
    if (cont) {
      cont.addEventListener('click', function () {
        goTeams(false)
      })
    }
  }

  function bindTeams () {
    root.addEventListener('click', function (event) {
      var pick = event.target.closest('[data-sh-onboard-pick]')
      if (pick && root.contains(pick)) {
        setFork(false)
        showProfile(pick.getAttribute('data-sh-onboard-pick'))
        showStep('confirm')
        return
      }
      var split = event.target.closest('[data-sh-onboard-split-wrong]')
      if (split && root.contains(split)) {
        var panel = root.querySelector('[data-sh-onboard-split-panel]')
        if (panel) panel.hidden = false
        split.hidden = true
      }
    })
  }

  function bindConfirm () {
    root.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-sh-onboard-remove-win]')
      if (remove && root.contains(remove)) {
        var row = remove.closest('[data-sh-onboard-win]')
        if (row) row.hidden = true
        syncLearnButton()
        return
      }
      var learn = event.target.closest('[data-sh-onboard-learn]')
      if (learn && root.contains(learn) && !learn.disabled) {
        // Learning keeps going after this screen. Land on new chat.
        finish(true)
      }
    })
  }

  function bindKickoff () {
    var ready = root.querySelector('[data-sh-onboard-ready]')
    if (ready) {
      ready.addEventListener('click', function () {
        showStep('review')
      })
    }
  }

  function bindReview () {
    root.addEventListener('click', function (event) {
      var assign = event.target.closest('[data-sh-onboard-assign]')
      if (assign && root.contains(assign)) {
        finish(true)
        return
      }
      var next = event.target.closest('[data-sh-onboard-next]')
      if (next && root.contains(next)) {
        setFork(true)
        showProfile(next.getAttribute('data-sh-onboard-next'))
        showStep('confirm')
        return
      }
      var home = event.target.closest('[data-sh-onboard-home]')
      if (home && root.contains(home)) finish(false)
    })
  }

  showProfile('mid-market')
  setFork(false)
  showStep('welcome')
  bindWelcome()
  bindMailbox()
  bindTeams()
  bindConfirm()
  bindKickoff()
  bindReview()
})(window)
