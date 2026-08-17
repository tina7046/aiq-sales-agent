// ──────────────────────────────────────────────────────────────────────
// Skill scheduling conversation — shared store + state machine
// =====================================================================
// Reached from the Skill detail page's "Schedule" button.
//
// The Schedule flow REUSES the existing conversational panel at
// `/home_conversation.html?id=<convId>` rather than shipping a second
// chat implementation. This module owns everything that has to travel
// between the Skill page and that conversation:
//
//   • Draft-conversation envelope   — title, prefilled composer text,
//                                     stable conversation id, source
//                                     type / source skill id, and
//                                     (after confirmation) the linked
//                                     `scheduledWorkflowId`.
//
//   • Recents "extras" list         — the ordered set of draft
//                                     conversations, which home.js
//                                     merges into the left nav's own
//                                     Recents rail above whatever the
//                                     session has visited. Written on
//                                     `createDraftForSkill`,
//                                     re-labelled on schedule
//                                     confirmation.
//
//   • Scheduling state machine      — `awaiting_cadence` →
//                                     `awaiting_confirm` → `confirmed`
//                                     turn-by-turn, keyed by the
//                                     draft's `convId` so each
//                                     scheduling conversation
//                                     progresses independently.
//
//   • Scheduled-workflow persistence — a localStorage mirror of the
//                                     SSR'd `scheduled.json` list
//                                     that the Scheduled page can
//                                     splice on load.
//
// Persistence is deliberately localStorage-only. This is a prototype
// surface; a real integration will swap the read/write helpers for a
// service client without touching the state machine or the UI.
//
// ── Who calls what ──────────────────────────────────────────────────
//   `createDraftForSkill`   ← skill_detail.js, on the Schedule click
//   `readDraft`             ← home_conversation.js, for the title
//   `readComposerDraft`     ← home_conversation.js, for the prefill
//   `clearComposerDraft`    ← home_conversation.js, after the first send
//   `advanceScheduling`     ← home_conversation.js, per send, for the
//                             agent's next turn. `confirmSchedule` is
//                             reached through it on an affirmative
//                             reply, and is exported as well so a
//                             future one-click affordance can fire the
//                             same path.
//   `readScheduledWorkflows` ← scheduled_drafts.js, which splices a row
//                             per confirmed schedule into the list on
//                             /scheduled.html
//
// The Recents list is read straight out of localStorage by home.js
// rather than through `readDraftList`: the nav renders on surfaces this
// file isn't loaded on, so home.js can't depend on it being there.
// `removeDraftListEntry` has no caller — nothing deletes a draft yet.
//
// Envelope schemas (versioned so a schema bump can invalidate stale
// drafts cleanly):
//
//   sh:convDraft:v1:<convId> → {
//     v: 1,
//     id, title, sourceType, sourceSkillId,
//     composerDraftPrefix,           ← text BEFORE the pills (e.g. "Schedule ")
//     composerDraftPills: [{ skillId, name }], ← inline chip mentions
//     composerDraft,                 ← text AFTER the pills (currently empty
//                                       for the Schedule prefill; reserved
//                                       for future "prefix + pill + suffix"
//                                       shapes)
//     seedMessages: [],
//     scheduledWorkflowId: null | string,
//     createdAt, updatedAt
//   }
//
//   sh:convDrafts:list:v1 → [
//     { conversationId, label, sourceType, sourceSkillId,
//       scheduledWorkflowId, createdAt, updatedAt }
//   ]   ← ordered newest-first; home.js renders in array order at the
//         top of the Recents block.
//
//   sh:convSched:v1:<convId> → {
//     v: 1,
//     step: 'awaiting_cadence' | 'awaiting_confirm' | 'confirmed',
//     cadence?, time?, timezone?,
//     scheduledWorkflowId: null | string
//   }
//
//   sh:scheduledWorkflows:v1 → [
//     { id, title, cadence, status, conversationId, linked: true,
//       createdAt }
//   ]
// ──────────────────────────────────────────────────────────────────────

(function () {
  'use strict'

  // Version tag lives in the storage keys so a future schema change
  // just moves to `:v2:` and every :v1 draft is ignored on load —
  // no destructive migration needed for a prototype surface.
  var KEY_DRAFT_PREFIX      = 'sh:convDraft:v1:'
  var KEY_DRAFT_LIST        = 'sh:convDrafts:list:v1'
  var KEY_SCHED_PREFIX      = 'sh:convSched:v1:'
  var KEY_SCHED_WORKFLOWS   = 'sh:scheduledWorkflows:v1'

  // Deterministic id builder — one draft per skill so repeat clicks
  // on Schedule land on the same conversation. Once a schedule is
  // confirmed, we keep the id so the seller can reopen the same
  // conversation from Recents and see the confirmation trail.
  function draftIdForSkill (skillId) {
    return 'conv-draft-sched-' + String(skillId || '')
  }

  // Two well-known cadence presets. Chips echo these strings so the
  // responder can match on equality; free-text also lands here after
  // parsing so the summary reads the same regardless of input path.
  var PRESET_WEEKDAY = {
    cadence:  'Every weekday at 8:00 AM PST',
    time:     '8:00 AM',
    timezone: 'PST'
  }
  var PRESET_MONDAY = {
    cadence:  'Every Monday at 9:00 AM PST',
    time:     '9:00 AM',
    timezone: 'PST'
  }
  var CHIP_CUSTOM  = 'Choose a custom schedule'
  var CHIP_CONFIRM = 'Confirm and schedule'
  var CHIP_CHANGE  = 'Change'

  // ── localStorage helpers (defensive) ────────────────────────────
  // Every read is wrapped so private-mode / quota errors degrade to
  // empty defaults rather than throwing out of the state machine.

  function safeParse (raw) {
    if (raw == null) return null
    try { return JSON.parse(raw) } catch (_e) { return null }
  }

  function safeGet (key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null
    } catch (_e) { return null }
  }

  function safeSet (key, value) {
    try {
      if (!window.localStorage) return
      window.localStorage.setItem(key, value)
    } catch (_e) { /* quota / private-mode: no-op */ }
  }

  function safeRemove (key) {
    try {
      if (!window.localStorage) return
      window.localStorage.removeItem(key)
    } catch (_e) { /* no-op */ }
  }

  // ── Draft envelope ──────────────────────────────────────────────

  function readDraft (convId) {
    if (!convId) return null
    var parsed = safeParse(safeGet(KEY_DRAFT_PREFIX + convId))
    if (!parsed || parsed.v !== 1) return null
    return parsed
  }

  function writeDraft (envelope) {
    if (!envelope || !envelope.id) return
    envelope.v = 1
    envelope.updatedAt = new Date().toISOString()
    safeSet(KEY_DRAFT_PREFIX + envelope.id, JSON.stringify(envelope))
  }

  // ── Draft-list (Recents extras) ─────────────────────────────────

  function readDraftList () {
    var parsed = safeParse(safeGet(KEY_DRAFT_LIST))
    return Array.isArray(parsed) ? parsed : []
  }

  function writeDraftList (list) {
    if (!Array.isArray(list)) return
    safeSet(KEY_DRAFT_LIST, JSON.stringify(list))
  }

  function upsertDraftListEntry (entry) {
    if (!entry || !entry.conversationId) return
    var list = readDraftList()
    var next = []
    // Newest-first ordering — always place the touched entry at the
    // top and drop any prior copy so repeated Schedule clicks don't
    // multiply Recents rows.
    next.push({
      conversationId:      entry.conversationId,
      label:               entry.label || 'Untitled',
      sourceType:          entry.sourceType || 'skill-scheduling',
      sourceSkillId:       entry.sourceSkillId || null,
      scheduledWorkflowId: entry.scheduledWorkflowId || null,
      createdAt:           entry.createdAt || new Date().toISOString(),
      updatedAt:           new Date().toISOString()
    })
    for (var i = 0; i < list.length; i++) {
      var it = list[i]
      if (!it || it.conversationId === entry.conversationId) continue
      next.push(it)
    }
    writeDraftList(next)
  }

  function removeDraftListEntry (convId) {
    if (!convId) return
    var list = readDraftList()
    var next = []
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].conversationId !== convId) next.push(list[i])
    }
    writeDraftList(next)
  }

  // ── Scheduling state machine ────────────────────────────────────

  function readSchedulingState (convId) {
    if (!convId) return null
    var parsed = safeParse(safeGet(KEY_SCHED_PREFIX + convId))
    if (parsed && parsed.v === 1) return parsed
    // Fresh conversations start `awaiting_cadence` — the state is
    // materialised lazily on first use so the store only carries
    // records for conversations that actually reached the responder.
    return { v: 1, step: 'awaiting_cadence', scheduledWorkflowId: null }
  }

  function writeSchedulingState (convId, state) {
    if (!convId || !state) return
    state.v = 1
    safeSet(KEY_SCHED_PREFIX + convId, JSON.stringify(state))
  }

  // ── Scheduled workflows (Scheduled page mirror) ─────────────────

  function readScheduledWorkflows () {
    var parsed = safeParse(safeGet(KEY_SCHED_WORKFLOWS))
    return Array.isArray(parsed) ? parsed : []
  }

  function writeScheduledWorkflows (list) {
    if (!Array.isArray(list)) return
    safeSet(KEY_SCHED_WORKFLOWS, JSON.stringify(list))
  }

  function upsertScheduledWorkflow (record) {
    if (!record || !record.id) return
    var list = readScheduledWorkflows()
    var next = []
    var replaced = false
    for (var i = 0; i < list.length; i++) {
      var it = list[i]
      if (!it) continue
      if (it.id === record.id) { next.push(record); replaced = true }
      else next.push(it)
    }
    if (!replaced) next.push(record)
    writeScheduledWorkflows(next)
  }

  // ── Public: draft creation ──────────────────────────────────────
  // Called from the Skill detail page when the seller clicks
  // "Schedule". Idempotent by construction — reuse an existing draft
  // for this skill so a second click doesn't fork the conversation.
  function createDraftForSkill (skill) {
    if (!skill || !skill.id) return null
    var convId = draftIdForSkill(skill.id)
    var title = 'Schedule ' + (skill.name || 'skill')

    // Prefill copy reads as "Schedule [Skill Name] everyday at
    // 8am." — a leading verb, a chip mention of the skill, and a
    // sensible default cadence the seller can send as-is. Splits
    // into three ordered segments so the contenteditable composer
    // can seed text-before-pill and text-after-pill correctly:
    //   • prefix — leading verb ("Schedule ").
    //   • pills  — inline chip mention of the target skill.
    //   • suffix — trailing cadence text ("everyday at 8am.").
    //     `parseCadence` recognises this phrasing and jumps
    //     straight to the summary card if the seller sends
    //     without editing.
    var composerDraftPrefix = 'Schedule '
    var composerDraftText   = 'everyday at 8am.'
    var composerDraftPills  = [
      { skillId: skill.id, name: skill.name || 'this skill' }
    ]

    var existing = readDraft(convId)
    var envelope
    if (existing) {
      // Preserve any composer edits + confirmed schedule; only
      // refresh the display name in case the skill was renamed.
      envelope = existing
      envelope.title = title
      // Re-arm the composer prefill only if the seller hasn't sent
      // anything yet AND the draft hasn't been confirmed. Once
      // confirmation lands, opening the conversation should NOT
      // re-prefill — the seller has already scheduled it and the
      // composer should be blank for follow-ups.
      if (!envelope.scheduledWorkflowId) {
        // Envelopes created under the previous "Set up a recurring
        // schedule for this." shape stored their copy in
        // `composerDraft` with no prefix. Detect that case by the
        // ABSENCE of a `composerDraftPrefix` field and re-seed the
        // three segments from scratch — otherwise the stale suffix
        // text would leak into the new prefill.
        var isLegacyShape = envelope.composerDraftPrefix === undefined
        if (isLegacyShape) {
          envelope.composerDraftPrefix = composerDraftPrefix
          envelope.composerDraft       = composerDraftText
          envelope.composerDraftPills  = composerDraftPills
        } else {
          // Newer shape. We don't persist live seller edits — the
          // envelope only carries the last-seeded prefill state —
          // so re-arm any EMPTY slot with the current defaults.
          // Envelopes from an older iteration (prefix set, suffix
          // empty) pick up the new "everyday at 8am." suffix on
          // the next Schedule click.
          if (!envelope.composerDraftPrefix) envelope.composerDraftPrefix = composerDraftPrefix
          if (!envelope.composerDraft)       envelope.composerDraft       = composerDraftText
          envelope.composerDraftPills = envelope.composerDraftPills && envelope.composerDraftPills.length
            ? envelope.composerDraftPills
            : composerDraftPills
        }
      } else {
        envelope.composerDraftPrefix = ''
        envelope.composerDraft = ''
        envelope.composerDraftPills = []
      }
    } else {
      envelope = {
        v:                    1,
        id:                   convId,
        title:                title,
        sourceType:           'skill-scheduling',
        sourceSkillId:        skill.id,
        composerDraftPrefix:  composerDraftPrefix,
        composerDraft:        composerDraftText,
        composerDraftPills:   composerDraftPills,
        seedMessages:         [],
        scheduledWorkflowId:  null,
        createdAt:            new Date().toISOString(),
        updatedAt:            new Date().toISOString()
      }
    }
    writeDraft(envelope)
    upsertDraftListEntry({
      conversationId:      envelope.id,
      label:               envelope.scheduledWorkflowId ? (skill.name || envelope.title) : envelope.title,
      sourceType:          envelope.sourceType,
      sourceSkillId:       envelope.sourceSkillId,
      scheduledWorkflowId: envelope.scheduledWorkflowId,
      createdAt:           envelope.createdAt,
      updatedAt:           envelope.updatedAt
    })
    return {
      convId:   envelope.id,
      url:      '/home_conversation.html?id=' + encodeURIComponent(envelope.id),
      envelope: envelope
    }
  }

  // ── Public: composer-prefill accessors ──────────────────────────
  // `readComposerDraft` is idempotent — a page reload before the
  // seller sends anything restores the prefilled prompt so the
  // "review, edit, or expand" pause the Schedule flow prescribes
  // survives an accidental refresh / tab reopen.
  //
  // Return shape: `{ prefix, text, pills } | null`
  //   • prefix — text BEFORE any pills (e.g. "Schedule ").
  //   • text   — text AFTER the pills (reserved for future shapes;
  //              currently empty for the Schedule prefill).
  //   • pills  — ordered list of `{ skillId, name }` to render as
  //              inline chips between prefix and text.
  // Returns `null` (not `{}`) when the draft has no prefill left so
  // callers can `if (prefill)` cleanly.
  //
  // `clearComposerDraft` is called by home_conversation.js after the
  // FIRST user submit so a later reload of the same conversation
  // (now populated with sent turns) doesn't re-inject the opening
  // prompt on top of the seller's actual reply history. Clears
  // prefix + text + pills together — removing only some of them
  // could strand a half-prefill.
  function readComposerDraft (convId) {
    var envelope = readDraft(convId)
    if (!envelope) return null
    var prefix = envelope.composerDraftPrefix || ''
    var text   = envelope.composerDraft       || ''
    var pills  = Array.isArray(envelope.composerDraftPills)
      ? envelope.composerDraftPills.slice()
      : []
    if (!prefix && !text && !pills.length) return null
    return { prefix: prefix, text: text, pills: pills }
  }

  function clearComposerDraft (convId) {
    var envelope = readDraft(convId)
    if (!envelope) return
    var hadPrefix = !!envelope.composerDraftPrefix
    var hadText   = !!envelope.composerDraft
    var hadPills  = envelope.composerDraftPills && envelope.composerDraftPills.length
    if (!hadPrefix && !hadText && !hadPills) return
    envelope.composerDraftPrefix = ''
    envelope.composerDraft = ''
    envelope.composerDraftPills = []
    writeDraft(envelope)
  }

  // ── Public: state-machine step ──────────────────────────────────
  // Called from home_conversation.js's composer submit path when
  // the active conversation is a scheduling draft. Returns the next
  // agent turn — a `{ text, chips?, summary?, terminal? }` payload
  // the caller renders and appends to the thread.
  function advanceScheduling (convId, userText) {
    var envelope = readDraft(convId)
    if (!envelope) return { text: '' }
    var state = readSchedulingState(convId)
    var text = String(userText || '').trim()
    var skillName = envelope.title.replace(/^Schedule\s+/i, '') || 'this skill'

    if (state.step === 'confirmed') {
      // Post-confirmation follow-ups. Keep it conservative — no
      // real backend to modify a live schedule, so we redirect the
      // seller to the Scheduled page for further edits.
      return {
        text: 'You\u2019ve already scheduled this. Open the Scheduled page to change the cadence or pause it.'
      }
    }

    if (state.step === 'awaiting_cadence') {
      var parsed = parseCadence(text)
      if (parsed === 'custom') {
        return {
          text: 'Tell me when you\u2019d like it to run — for example, \u201cEvery Tuesday and Thursday at 7:30 AM\u201d.'
        }
      }
      if (parsed) {
        state.cadence  = parsed.cadence
        state.time     = parsed.time
        state.timezone = parsed.timezone
        state.step     = 'awaiting_confirm'
        writeSchedulingState(convId, state)
        return {
          text: 'Here\u2019s the schedule I\u2019ll set up:',
          summary: buildSummary(skillName, state),
          chips:   [CHIP_CONFIRM, CHIP_CHANGE]
        }
      }
      // First user message (or an unparseable reply): open with the
      // scheduling question + preset chips.
      return {
        text:  'When would you like this to run?',
        chips: [
          PRESET_WEEKDAY.cadence.replace(' PST', ''),
          PRESET_MONDAY.cadence.replace(' PST', ''),
          CHIP_CUSTOM
        ]
      }
    }

    if (state.step === 'awaiting_confirm') {
      if (isConfirm(text)) {
        var record = confirmSchedule(convId)
        return {
          text: 'Scheduled \u2705 ' + skillName + ' will run ' + (record.cadence || 'on your chosen cadence') + '. You\u2019ll find it on the Scheduled page.',
          summary: buildSummary(skillName, state),
          terminal: true,
          scheduledWorkflowId: record.id
        }
      }
      if (isChange(text)) {
        state.step = 'awaiting_cadence'
        state.cadence = null
        state.time = null
        state.timezone = null
        writeSchedulingState(convId, state)
        return {
          text:  'No problem — when would you like this to run?',
          chips: [
            PRESET_WEEKDAY.cadence.replace(' PST', ''),
            PRESET_MONDAY.cadence.replace(' PST', ''),
            CHIP_CUSTOM
          ]
        }
      }
      // Any other reply during confirmation — treat as a re-parse
      // attempt so the seller can adjust the cadence in one turn.
      var reparsed = parseCadence(text)
      if (reparsed && reparsed !== 'custom') {
        state.cadence  = reparsed.cadence
        state.time     = reparsed.time
        state.timezone = reparsed.timezone
        writeSchedulingState(convId, state)
        return {
          text: 'Updated. Here\u2019s the schedule I\u2019ll set up:',
          summary: buildSummary(skillName, state),
          chips:   [CHIP_CONFIRM, CHIP_CHANGE]
        }
      }
      return {
        text: 'Do you want me to schedule this?',
        summary: buildSummary(skillName, state),
        chips:   [CHIP_CONFIRM, CHIP_CHANGE]
      }
    }

    return { text: '' }
  }

  // ── Public: explicit confirmation ───────────────────────────────
  // Also exported so a UI affordance (e.g. clicking the Confirm chip
  // on the summary card) can fire the same code path as an
  // affirmative typed reply.
  function confirmSchedule (convId) {
    var envelope = readDraft(convId)
    var state    = readSchedulingState(convId)
    if (!envelope || !state) return null
    if (!state.cadence) return null

    var workflowId = envelope.scheduledWorkflowId
      || ('wf-draft-' + (envelope.sourceSkillId || 'skill') + '-' + Date.now().toString(36))

    var record = {
      id:             workflowId,
      title:          envelope.title.replace(/^Schedule\s+/i, '') || 'Scheduled skill',
      skillId:        envelope.sourceSkillId,
      cadence:        state.cadence,
      time:           state.time,
      timezone:       state.timezone,
      status:         'active',
      linked:         true,
      conversationId: envelope.id,
      createdAt:      new Date().toISOString()
    }
    upsertScheduledWorkflow(record)

    envelope.scheduledWorkflowId = workflowId
    envelope.title = record.title
    envelope.composerDraftPrefix = ''
    envelope.composerDraft = ''
    envelope.composerDraftPills = []
    writeDraft(envelope)

    state.step = 'confirmed'
    state.scheduledWorkflowId = workflowId
    writeSchedulingState(convId, state)

    upsertDraftListEntry({
      conversationId:      envelope.id,
      label:               record.title,
      sourceType:          envelope.sourceType,
      sourceSkillId:       envelope.sourceSkillId,
      scheduledWorkflowId: workflowId,
      createdAt:           envelope.createdAt,
      updatedAt:           new Date().toISOString()
    })

    // Cross-page ping so the Recents list on the current page can
    // re-splice with the updated label, and the Scheduled page (if
    // it happens to be open in another tab) can refresh its list.
    try {
      document.dispatchEvent(new CustomEvent('sh:schedule-confirmed', {
        detail: { conversationId: envelope.id, workflow: record }
      }))
    } catch (_e) { /* no-op */ }

    // Header title tracks the Recent label — a confirmed schedule
    // drops the "Schedule " prefix so subsequent visits read as
    // the actual scheduled workflow, not the setup conversation.
    // Guarded to the currently-open conversation so a background
    // tab doesn't accidentally rewrite an unrelated page.
    try {
      var convRoot = document.querySelector('[data-sh-conv-root]')
      var openId = convRoot ? convRoot.getAttribute('data-sh-conversation-id') : null
      if (openId && openId === envelope.id) {
        var titleEl = document.querySelector('[data-sh-conv-title]')
        if (titleEl) {
          titleEl.textContent = record.title
          titleEl.setAttribute('title', record.title)
        }
        try { document.title = record.title } catch (_e) { /* noop */ }
      }
    } catch (_e) { /* no-op */ }

    return record
  }

  // ── Cadence parsing (very lenient) ──────────────────────────────
  // Matches the two presets and the "custom" escape hatch. Every
  // other free-text answer falls through to a best-effort mapping so
  // a demo user can type ANYTHING and land on a summary they can
  // then confirm or change.
  function parseCadence (text) {
    if (!text) return null
    var lower = text.toLowerCase().trim()

    // Guard: prefill copy that mentions "schedule" but carries no
    // cadence signal ("Schedule <skill>", "Set up a schedule for
    // this.") is the seller's OPENING INTENT — reject it so the
    // state machine asks the cadence question instead of misreading
    // the prompt as the cadence itself.
    //
    // The keyword check is broad enough that anything with a real
    // cadence signal ("everyday at 8am", "every weekday", "8:00 AM",
    // "daily") still passes through to the parser below.
    var HAS_CADENCE_SIGNAL = /\b(every|everyday|weekday|weekdays|weekend|weekends|monday|tuesday|wednesday|thursday|friday|saturday|sunday|daily|weekly|monthly|hourly|hours?|minutes?|days?|weeks?|months?)\b|\d{1,2}\s*(am|pm)\b|\d{1,2}:\d{2}/i
    if (/\bschedul/i.test(lower) && !HAS_CADENCE_SIGNAL.test(lower)) return null

    if (lower === CHIP_CUSTOM.toLowerCase() || /\bcustom\b/.test(lower) || /\bchoose\b/.test(lower)) {
      return 'custom'
    }

    if (lower === PRESET_WEEKDAY.cadence.replace(' PST', '').toLowerCase()
        || (/\bweekday/.test(lower) && /8/.test(lower))) {
      return PRESET_WEEKDAY
    }
    if (lower === PRESET_MONDAY.cadence.replace(' PST', '').toLowerCase()
        || (/\bmonday/.test(lower) && /9/.test(lower))) {
      return PRESET_MONDAY
    }

    // Any weekday-ish match → weekday preset (8:00 AM default).
    if (/\bevery\s+weekday|weekdays\b/.test(lower)) return PRESET_WEEKDAY
    // Any Monday-ish match → Monday preset.
    if (/\bevery\s+monday|mondays\b/.test(lower)) return PRESET_MONDAY

    // "everyday" / "every day" / "daily" — canonical daily cadence.
    // Extracts an explicit time if present, otherwise defaults to
    // 8:00 AM PST so the Schedule-button prefill lands on a summary
    // the seller can confirm in one step.
    if (/\beveryday\b/.test(lower) || /\bevery\s+day\b/.test(lower) || /\bdaily\b/.test(lower)) {
      var dailyTime = extractTime(text) || '8:00 AM'
      var dailyTz   = extractTimezone(text) || 'PST'
      return {
        cadence:  'Every day at ' + dailyTime + ' ' + dailyTz,
        time:     dailyTime,
        timezone: dailyTz
      }
    }

    // Fallback: use the raw text as the cadence label. The seller
    // will still get a summary card and can Change if it looks off.
    return {
      cadence:  text.charAt(0).toUpperCase() + text.slice(1),
      time:     extractTime(text) || '9:00 AM',
      timezone: extractTimezone(text) || 'PST'
    }
  }

  function extractTime (text) {
    var m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
    if (!m) return null
    var hour = m[1]
    var minute = m[2] || '00'
    var period = (m[3] || '').toUpperCase() || (parseInt(hour, 10) >= 12 ? 'PM' : 'AM')
    return hour + ':' + minute + ' ' + period
  }

  function extractTimezone (text) {
    var m = text.match(/\b(PST|PDT|MST|MDT|CST|CDT|EST|EDT|UTC|GMT)\b/i)
    return m ? m[1].toUpperCase() : null
  }

  function isConfirm (text) {
    var lower = (text || '').toLowerCase().trim()
    if (lower === CHIP_CONFIRM.toLowerCase()) return true
    return /^(yes|y|confirm|schedule it|do it|go|ok|okay|sounds good|looks good|schedule)\b/.test(lower)
  }

  function isChange (text) {
    var lower = (text || '').toLowerCase().trim()
    if (lower === CHIP_CHANGE.toLowerCase()) return true
    return /^(no|change|edit|different|instead|switch|nope)\b/.test(lower)
  }

  function buildSummary (skillName, state) {
    return {
      skill:    skillName,
      cadence:  state.cadence || '',
      time:     state.time    || '',
      timezone: state.timezone || ''
    }
  }

  // ── Public API ──────────────────────────────────────────────────
  window.SellerHomeScheduling = {
    // Draft / envelope
    draftIdForSkill:      draftIdForSkill,
    createDraftForSkill:  createDraftForSkill,
    readDraft:            readDraft,
    writeDraft:           writeDraft,
    readComposerDraft:    readComposerDraft,
    clearComposerDraft:   clearComposerDraft,
    // Recents extras
    readDraftList:        readDraftList,
    removeDraftListEntry: removeDraftListEntry,
    // State machine
    readSchedulingState:  readSchedulingState,
    advanceScheduling:    advanceScheduling,
    confirmSchedule:      confirmSchedule,
    // Scheduled workflows
    readScheduledWorkflows: readScheduledWorkflows,
    // Chip labels (exported for chip → text substitution in the UI)
    CHIP_CONFIRM: CHIP_CONFIRM,
    CHIP_CHANGE:  CHIP_CHANGE,
    CHIP_CUSTOM:  CHIP_CUSTOM
  }
}())
