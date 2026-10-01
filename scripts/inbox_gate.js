// ──────────────────────────────────────────────────────────────────────
// Salesforce Inbox gate — conversational connect from Drafted proposals
// =====================================================================
// When onboarding skipped mailbox, opening conv-draft-proposals fails
// gracefully (Sales Engagement on, Inbox not connected) and Hunter asks
// to connect. Yes opens this popup (Gmail / Outlook). After connect,
// Hunter enrolls and sends.
//
// Product calls for the open questions:
//   • No → stop. Chips: Connect email / Remind me later.
//   • Modal fail or timeout → one retry in chat, then park
//     (admin policy). Outlook's first Connect is the fail demo;
//     Gmail always succeeds; a second Outlook try succeeds.
//   • Cancel / close modal → re-prompt once, then park.
//   • Enroll after a successful connect → 8 of 10 send; 2 hit the
//     daily Sales Engagement limit. Retry the rest / Leave them.
//
;(function (global) {
  'use strict'

  var CONV_ID = 'conv-draft-proposals'
  var MAIL_KEY = 'sh:onboarding:mailbox'
  var CHIP_YES = 'Yes'
  var CHIP_NOT_NOW = 'Not now'
  var CHIP_CONNECT = 'Connect email'
  var CHIP_REMIND = 'Remind me later'
  var CHIP_RETRY = 'Try again'
  var CHIP_RETRY_REST = 'Retry the rest'
  var CHIP_LEAVE = 'Leave them'

  var step = 'ask'
  var modalCancels = 0
  var modalFails = 0
  var outlookAttempts = 0
  var gateBound = false
  var modalBusy = false
  var lastFocused = null
  var resultCallback = null
  var connectTimer = null

  function storageKey (key) {
    return (global.SH && global.SH.storageKey) ? global.SH.storageKey(key) : key
  }

  function readMailbox () {
    try {
      return global.localStorage.getItem(storageKey(MAIL_KEY)) || ''
    } catch (e) {
      return ''
    }
  }

  function writeMailbox (value) {
    try {
      global.localStorage.setItem(storageKey(MAIL_KEY), value)
    } catch (e) {}
  }

  function isConnected () {
    var value = readMailbox()
    return !!(value && value !== 'skipped')
  }

  function bindConversation (convId) {
    if (convId !== CONV_ID) {
      gateBound = false
      return
    }
    gateBound = !isConnected()
    step = gateBound ? 'ask' : 'done'
    modalCancels = 0
    modalFails = 0
  }

  function owns (convId) {
    return convId === CONV_ID && gateBound
  }

  function beats (thinkingLabel, thinkingMs, text, chips) {
    var reply = text ? { text: text } : null
    if (reply && chips && chips.length) reply.chips = chips
    return [{
      thinkingLabel: thinkingLabel || '',
      thinkingMs: thinkingMs || 700,
      reply: reply
    }]
  }

  function plan (list, openModal) {
    return { beats: list, openModal: !!openModal }
  }

  function lower (text) {
    return String(text || '').toLowerCase().trim()
  }

  function isYes (text) {
    var t = lower(text)
    if (t === CHIP_YES.toLowerCase()) return true
    if (t === CHIP_CONNECT.toLowerCase()) return true
    return /^(yes|y|yeah|yep|ok|okay|sure|connect|connect email|connect my email|please)\b/.test(t)
  }

  function isNo (text) {
    var t = lower(text)
    if (t === CHIP_NOT_NOW.toLowerCase()) return true
    return /^(no|nope|not now|skip|later|nah)\b/.test(t)
  }

  function isRemind (text) {
    var t = lower(text)
    if (t === CHIP_REMIND.toLowerCase()) return true
    return /remind/.test(t)
  }

  function isTryAgain (text) {
    var t = lower(text)
    if (t === CHIP_RETRY.toLowerCase()) return true
    return /^(try again|retry|again)\b/.test(t)
  }

  function isRetryRest (text) {
    var t = lower(text)
    if (t === CHIP_RETRY_REST.toLowerCase()) return true
    return /retry/.test(t) && /rest|remaining|other/.test(t)
  }

  function isLeave (text) {
    var t = lower(text)
    if (t === CHIP_LEAVE.toLowerCase()) return true
    return /^(leave|leave them|leave it)\b/.test(t)
  }

  function advance (convId, userText) {
    if (!owns(convId)) return null
    var text = String(userText || '').trim()

    if (step === 'ask') {
      if (isYes(text)) return beginConnect()
      if (isNo(text)) {
        step = 'declined'
        return plan(beats(
          '',
          400,
          'Okay — I won’t send yet. The 10 drafts stay here. Say connect email when you’re ready, or I can pick this up later.',
          [CHIP_CONNECT, CHIP_REMIND]
        ))
      }
      return plan(beats(
        '',
        400,
        'Your email is not connected. Do you want to connect your email?',
        [CHIP_YES, CHIP_NOT_NOW]
      ))
    }

    if (step === 'declined') {
      if (isRemind(text)) {
        step = 'parked'
        return plan(beats(
          '',
          400,
          'I’ll hold the drafts. Come back to this thread when you want to connect.'
        ))
      }
      if (isYes(text) || isTryAgain(text)) return beginConnect()
      return plan(beats(
        '',
        400,
        'Say connect email when you want to send these, or remind me later.',
        [CHIP_CONNECT, CHIP_REMIND]
      ))
    }

    if (step === 'retry') {
      if (isTryAgain(text) || isYes(text)) return beginConnect()
      if (isNo(text) || isRemind(text)) return parkNow()
      return plan(beats(
        '',
        400,
        'Want to try connecting Salesforce Inbox again?',
        [CHIP_RETRY, CHIP_NOT_NOW]
      ))
    }

    if (step === 'enroll_partial') {
      if (isRetryRest(text) || isYes(text) || isTryAgain(text)) {
        step = 'done'
        return plan(beats(
          'Queuing the remaining 2…',
          1200,
          'Queued the other 2 for tomorrow’s send window. 8 first touches are live now.'
        ))
      }
      if (isLeave(text) || isNo(text)) {
        step = 'done'
        return plan(beats(
          '',
          400,
          'I’ll leave those 2 in drafts. The 8 that enrolled will send as you.'
        ))
      }
      return plan(beats(
        '',
        400,
        '8 went out. Want me to retry the other 2 tomorrow, or leave them in drafts?',
        [CHIP_RETRY_REST, CHIP_LEAVE]
      ))
    }

    if (step === 'parked' || step === 'done') {
      if (!isConnected() && (isYes(text) || isTryAgain(text))) {
        modalCancels = 0
        modalFails = 0
        return beginConnect()
      }
      if (isConnected()) {
        return plan(beats(
          '',
          400,
          'Those drafts are handled. Open this thread if you want to check on them.'
        ))
      }
      return plan(beats(
        '',
        400,
        'I’ll wait. Say connect email when you want to try again.',
        [CHIP_CONNECT]
      ))
    }

    return beginConnect()
  }

  function beginConnect () {
    step = 'connecting'
    return plan(beats(
      'Opening Salesforce Inbox…',
      500,
      'I’ll open Salesforce Inbox so we can send as you.'
    ), true)
  }

  function parkNow () {
    step = 'parked'
    return plan(beats(
      '',
      400,
      'I’ll wait. Say connect email when you want to try again.',
      [CHIP_CONNECT]
    ))
  }

  function onModalResult (convId, result) {
    if (convId !== CONV_ID) return null
    var kind = result && result.type ? result.type : result

    if (kind === 'success') {
      var provider = (result && result.provider) || 'your mailbox'
      var label = provider === 'gmail' ? 'Gmail' : provider === 'outlook' ? 'Outlook' : 'your mailbox'
      step = 'enroll_partial'
      return {
        beats: [
          {
            thinkingLabel: '',
            thinkingMs: 400,
            reply: {
              text: 'Great — your ' + label + ' connection is ready. Now I will try enrolling the prospects and sending emails.'
            }
          },
          {
            thinkingLabel: 'Enrolling 10 prospects and sending first touches…',
            thinkingMs: 1800,
            reply: {
              text: 'Mailbox is connected, but I couldn’t enroll 2 of 10 — the daily Sales Engagement send limit. 8 first touches went out. Want me to retry the rest tomorrow?',
              chips: [CHIP_RETRY_REST, CHIP_LEAVE]
            }
          }
        ],
        openModal: false
      }
    }

    if (kind === 'fail') {
      modalFails += 1
      if (modalFails >= 2) {
        step = 'parked'
        return plan(beats(
          '',
          500,
          'Still blocked. An admin may need to allow Salesforce Inbox for Gmail or Outlook. I’ll keep the drafts here.',
          [CHIP_CONNECT]
        ))
      }
      step = 'retry'
      return plan(beats(
        '',
        500,
        'That didn’t go through — org policy or a timeout. Want to try again?',
        [CHIP_RETRY, CHIP_NOT_NOW]
      ))
    }

    // cancel / close partway
    modalCancels += 1
    if (modalCancels >= 2) return parkNow()
    step = 'retry'
    return plan(beats(
      '',
      500,
      'Looks like the connection didn’t finish. Want to try again?',
      [CHIP_RETRY, CHIP_NOT_NOW]
    ))
  }

  function modalEls () {
    return {
      modal: document.querySelector('[data-sh-inbox-modal]'),
      backdrop: document.querySelector('[data-sh-inbox-backdrop]'),
      error: document.querySelector('[data-sh-inbox-error]'),
      list: document.querySelector('[data-sh-inbox-providers]')
    }
  }

  function setError (message) {
    var els = modalEls()
    if (!els.error) return
    if (message) {
      els.error.textContent = message
      els.error.hidden = false
    } else {
      els.error.textContent = ''
      els.error.hidden = true
    }
  }

  function resetProviderButtons () {
    var els = modalEls()
    if (!els.list) return
    var rows = els.list.querySelectorAll('[data-sh-inbox-provider]')
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.remove('is-connected', 'is-busy')
      var btn = rows[i].querySelector('[data-sh-inbox-connect]')
      if (!btn) continue
      btn.disabled = false
      btn.textContent = 'Connect'
    }
  }

  function closeModal (silent) {
    var els = modalEls()
    if (!els.modal || !els.backdrop) return
    if (connectTimer) {
      global.clearTimeout(connectTimer)
      connectTimer = null
    }
    els.modal.classList.remove('slds-fade-in-open')
    els.backdrop.classList.remove('slds-backdrop_open')
    els.modal.setAttribute('hidden', '')
    els.backdrop.setAttribute('hidden', '')
    modalBusy = false
    resetProviderButtons()
    setError('')
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus()
    lastFocused = null
    var cb = resultCallback
    resultCallback = null
    if (!silent && cb) cb({ type: 'cancel' })
  }

  function finishSuccess (provider) {
    writeMailbox(provider)
    var cb = resultCallback
    resultCallback = null
    closeModal(true)
    if (cb) cb({ type: 'success', provider: provider })
  }

  function finishFail (message) {
    modalBusy = false
    resetProviderButtons()
    setError(message || 'Couldn’t connect. Try again, or pick the other provider.')
    var cb = resultCallback
    resultCallback = null
    closeModal(true)
    if (cb) cb({ type: 'fail' })
  }

  function openConnectModal (onResult) {
    var els = modalEls()
    if (!els.modal || !els.backdrop) {
      if (onResult) onResult({ type: 'fail' })
      return
    }
    resultCallback = onResult || null
    modalBusy = false
    resetProviderButtons()
    setError('')
    lastFocused = document.activeElement
    els.modal.removeAttribute('hidden')
    els.modal.classList.add('slds-fade-in-open')
    els.backdrop.removeAttribute('hidden')
    els.backdrop.classList.add('slds-backdrop_open')
    global.setTimeout(function () { els.modal.focus() }, 0)
  }

  function bindModal () {
    var els = modalEls()
    if (!els.modal || !els.backdrop) return

    var closers = els.modal.querySelectorAll('[data-sh-inbox-modal-close]')
    for (var i = 0; i < closers.length; i++) {
      closers[i].addEventListener('click', function () {
        if (modalBusy) {
          closeModal(false)
          return
        }
        closeModal(false)
      })
    }
    els.backdrop.addEventListener('click', function () {
      closeModal(false)
    })
    els.modal.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' || event.keyCode === 27) {
        event.preventDefault()
        closeModal(false)
      }
    })

    if (!els.list) return
    els.list.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest
        ? event.target.closest('[data-sh-inbox-connect]')
        : null
      if (!btn || btn.disabled) return
      var row = btn.closest('[data-sh-inbox-provider]')
      if (!row) return
      var id = row.getAttribute('data-sh-inbox-provider')
      if (!id) return

      modalBusy = true
      setError('')
      btn.disabled = true
      btn.textContent = 'Connecting…'
      row.classList.add('is-busy')
      var others = els.list.querySelectorAll('[data-sh-inbox-connect]')
      for (var o = 0; o < others.length; o++) {
        if (others[o] !== btn) others[o].disabled = true
      }

      connectTimer = global.setTimeout(function () {
        connectTimer = null
        if (!els.modal.classList.contains('slds-fade-in-open')) {
          modalBusy = false
          return
        }
        if (id === 'outlook' && outlookAttempts < 1) {
          outlookAttempts += 1
          finishFail()
          return
        }
        if (id === 'outlook') outlookAttempts += 1
        row.classList.remove('is-busy')
        row.classList.add('is-connected')
        btn.textContent = 'Connected'
        finishSuccess(id)
      }, 900)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindModal)
  } else {
    bindModal()
  }

  global.SellerHomeInbox = {
    CONV_ID: CONV_ID,
    isConnected: isConnected,
    bindConversation: bindConversation,
    owns: owns,
    advance: advance,
    onModalResult: onModalResult,
    openConnectModal: openConnectModal
  }
})(window)
