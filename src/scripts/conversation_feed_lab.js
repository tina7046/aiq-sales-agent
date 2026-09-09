// Conversation feed — lab page
// Isolated mock. Hunter replies use HUNTER_AVATAR_SRC in the 32px slot.

(function () {
  var HUNTER_AVATAR_SRC = '/assets/images/agent-icons/hunter-avatar.jpg'

  var MESSAGES = [
    {
      from: 'user',
      text: 'What are the top 3 things I must know to make my number?'
    },
    {
      from: 'hunter',
      text: "You're 80% to quota with $400K left this quarter. The biggest gap is top-of-funnel — outreach volume is down 18% vs last month."
    },
    {
      from: 'user',
      text: 'Who should I be reaching out to this week?'
    },
    {
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
    },
    {
      from: 'user',
      text: 'Draft outreach for those two.'
    }
  ]

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

  function renderMessage (msg) {
    if (msg.from === 'hunter') {
      return (
        '<li class="cf-lab__msg cf-lab__msg--hunter">' +
          '<article aria-label="Hunter">' +
            avatarHtml() +
            '<div class="cf-lab__body">' +
              '<p class="cf-lab__text">' + escapeHtml(msg.text) + '</p>' +
              tableHtml(msg.table) +
            '</div>' +
          '</article>' +
        '</li>'
      )
    }

    return (
      '<li class="cf-lab__msg cf-lab__msg--user">' +
        '<article aria-label="You">' +
          '<p class="cf-lab__pill">' + escapeHtml(msg.text) + '</p>' +
        '</article>' +
      '</li>'
    )
  }

  var root = document.querySelector('[data-cf-lab-thread]')
  if (root) root.innerHTML = MESSAGES.map(renderMessage).join('')

  var form = document.querySelector('[data-cf-lab-form]')
  var input = document.querySelector('[data-cf-lab-input]')
  var send = document.querySelector('[data-cf-lab-send]')

  function syncSend () {
    if (!send || !input) return
    send.disabled = !input.value.trim()
  }

  function autosize () {
    if (!input) return
    input.style.height = 'auto'
    input.style.height = input.scrollHeight + 'px'
  }

  if (form) {
    form.addEventListener('submit', function (e) { e.preventDefault() })
  }
  if (input) {
    input.addEventListener('input', function () {
      syncSend()
      autosize()
    })
    syncSend()
  }
})()
