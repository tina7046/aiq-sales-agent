// Conversation feed — lab page
// Isolated turn-by-turn mock. Hunter replies use HUNTER_AVATAR_SRC
// in the 32px slot. Agent prose and tables stream via window.ShStream
// (conversation_stream.js), same engine as the other conversation feeds.

(function () {
  var HUNTER_AVATAR_SRC = '/assets/images/agent-icons/hunter-avatar.png'

  var TIMING = {
    afterUserMs: 400,
    thinkingMs: 900
  }

  var OPENING_USER = {
    from: 'user',
    text: 'What are the top 3 things I must know to make my number?'
  }

  var OPENING_HUNTER = {
    from: 'hunter',
    text: "You're 80% to quota with $400K left this quarter. The biggest gap is top-of-funnel — outreach volume is down 18% vs last month."
  }

  var FOLLOWUP_HUNTER = {
    from: 'hunter',
    text: "I found 20 accounts that match your ICP and haven't been touched in 14 days. Start with Northstar Health and Helix Logistics — both have open evals and a champion still in seat.",
    table: {
      columns: ['Account', 'Contact', 'Role', 'Last touch', 'Open eval', 'Amount'],
      rows: [
        ['Northstar Health', 'Maya Chen', 'Champion', '18 days', 'Yes', '$180K'],
        ['Helix Logistics', 'Jordan Hale', 'Economic Buyer', '21 days', 'Yes', '$95K'],
        ['Vesper Analytics', 'Priya Shah', 'Influencer', '16 days', 'No', '$60K'],
        ['Redwood Clinics', 'Sam Okonkwo', 'Coach', '14 days', 'Yes', '$120K'],
        ['Atlas Freight', 'Elena Ruiz', 'Champion', '19 days', 'No', '$75K']
      ]
    }
  }

  var thread = document.querySelector('[data-cf-lab-thread]')
  var form = document.querySelector('[data-cf-lab-form]')
  var input = document.querySelector('[data-cf-lab-input]')
  var send = document.querySelector('[data-cf-lab-send]')
  var thinkingTpl = document.querySelector('[data-cf-lab-tpl="thinking"]')

  if (!thread) return

  var busy = false
  var followupPlayed = false

  function escapeHtml (value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function avatarHtml () {
    var img = HUNTER_AVATAR_SRC
      ? '<img src="' + escapeHtml(HUNTER_AVATAR_SRC) + '" alt="">'
      : ''
    return '<div class="cf-lab__avatar" aria-hidden="true">' + img + '</div>'
  }

  function tableHtml (table) {
    if (!table || !table.columns || !table.rows) return ''
    var head = table.columns.map(function (col) {
      return '<th scope="col">' + escapeHtml(col) + '</th>'
    }).join('')
    var body = table.rows.map(function (row) {
      var cells = row.map(function (cell) {
        return '<td>' + escapeHtml(cell) + '</td>'
      }).join('')
      return '<tr>' + cells + '</tr>'
    }).join('')
    return (
      '<div class="cf-lab__table-wrap">' +
        '<table class="cf-lab__table">' +
          '<thead><tr>' + head + '</tr></thead>' +
          '<tbody>' + body + '</tbody>' +
        '</table>' +
      '</div>'
    )
  }

  function hunterHtml (msg) {
    return (
      '<li class="cf-lab__msg cf-lab__msg--hunter">' +
        '<article aria-label="Hunter">' +
          avatarHtml() +
          '<div class="cf-lab__body" data-cf-lab-stream>' +
            '<p class="cf-lab__text">' + escapeHtml(msg.text) + '</p>' +
            tableHtml(msg.table) +
          '</div>' +
        '</article>' +
      '</li>'
    )
  }

  function userHtml (text) {
    return (
      '<li class="cf-lab__msg cf-lab__msg--user">' +
        '<article aria-label="You">' +
          '<p class="cf-lab__pill">' + escapeHtml(text) + '</p>' +
        '</article>' +
      '</li>'
    )
  }

  function scrollToLatest () {
    thread.scrollTop = thread.scrollHeight
  }

  function appendHtml (html) {
    var wrap = document.createElement('div')
    wrap.innerHTML = html
    var li = wrap.firstElementChild
    if (li) thread.appendChild(li)
    scrollToLatest()
    return li
  }

  function appendThinking () {
    if (!thinkingTpl || !thinkingTpl.content) return null
    var frag = thinkingTpl.content.cloneNode(true)
    var li = frag.querySelector('.cf-lab__msg')
    thread.appendChild(frag)
    scrollToLatest()
    return li
  }

  function removeNode (node) {
    if (node && node.parentNode) node.parentNode.removeChild(node)
  }

  function composerText () {
    return input && input.value ? input.value.replace(/\u00a0/g, ' ').trim() : ''
  }

  function syncSend () {
    if (!send) return
    send.disabled = busy || !composerText()
  }

  function setBusy (on) {
    busy = on
    thread.setAttribute('aria-busy', on ? 'true' : 'false')
    syncSend()
  }

  function autosize () {
    if (!input) return
    input.style.height = 'auto'
    input.style.height = input.scrollHeight + 'px'
  }

  function clearComposer () {
    if (!input) return
    input.value = ''
    autosize()
    syncSend()
  }

  function streamNode (node, done) {
    var body = node && node.querySelector
      ? node.querySelector('[data-cf-lab-stream]')
      : null
    var target = body || node
    if (target && window.ShStream) {
      window.ShStream.reveal(target, {
        scroll: scrollToLatest,
        onDone: done
      })
      return
    }
    if (done) done()
  }

  function playHunter (msg, done) {
    var thinking = appendThinking()
    window.setTimeout(function () {
      removeNode(thinking)
      var li = appendHtml(hunterHtml(msg))
      streamNode(li, done)
    }, TIMING.thinkingMs)
  }

  function playOpening () {
    appendHtml(userHtml(OPENING_USER.text))
    setBusy(true)
    window.setTimeout(function () {
      playHunter(OPENING_HUNTER, function () {
        setBusy(false)
        if (input && typeof input.focus === 'function') input.focus()
      })
    }, TIMING.afterUserMs)
  }

  function submit () {
    if (busy) return
    var text = composerText()
    if (!text) return

    appendHtml(userHtml(text))
    clearComposer()

    if (followupPlayed) return

    followupPlayed = true
    setBusy(true)
    playHunter(FOLLOWUP_HUNTER, function () {
      setBusy(false)
      if (input && typeof input.focus === 'function') input.focus()
    })
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      submit()
    })
  }
  if (input) {
    input.addEventListener('input', function () {
      syncSend()
      autosize()
    })
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey) return
      e.preventDefault()
      submit()
    })
  }

  syncSend()
  playOpening()
})()
