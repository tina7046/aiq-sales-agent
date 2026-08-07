// ──────────────────────────────────────────────────────────────────────
// Prospect + Cadence lookups — behavior — PORTED from BB - AOP
// =====================================================================
// Drives the two fields rendered by _home_conversation_lookups.html in
// the cadence card's header. Two modules from hunter's proto, merged
// into one file because they only ever ship together:
//
//   initLookups()   protos/BB - AOP → src/scripts/app.js, lines 59–551.
//                   The generic SLDS lookup: typeahead, option list,
//                   keyboard nav, the selected chip, and clearing it.
//   initPopover()   protos/BB - AOP → src/scripts/cadence-popover.js.
//                   The cadence field's popover: per-panel typeahead,
//                   click-to-pick, and the Generate prompt's Confirm.
//
// Changes from the originals:
//   1. It doesn't boot itself. Hunter's app.js calls initLookups() at
//      the bottom of the file, which needs the record arrays already on
//      `window`. Here the data arrives as JSON script blocks inside the
//      card, and the card can be injected into the thread long after
//      this file loads, so home_conversation_cadence.js publishes the
//      globals and calls `ShLookups.init()` at mount instead.
//   2. The entity icon travels on the wrapper as `data-lookup-icon-class`
//      + `data-lookup-icon-href` rather than being assembled from
//      `data-lookup-icon="standard-contact"`. Same two strings; hunter
//      derived them from one and had to special-case the symbol name
//      when the two disagreed (`sales-cadence` vs `sales_cadence`).
//   3. Multi-select is gone — the pill list, `data-lookup-multi`, and
//      the branch in select(). Neither field here is multi, and it was
//      the largest thing in the file with no path to being reached.
//   4. Both init passes are idempotent, because the card mounts more
//      than once and these selectors are document-wide.
//
// Not changed: the option markup, the chip markup, the class names, the
// `lookup-selection-change` event, and the three helpers the popover
// leans on (`_lookupSelect`, `_lookupSelectAction`, `_lookupClose`).
// A change to any of those ports straight back.
//
// Nothing here knows about the cadence card. The glue in
// home_conversation_cadence.js listens for `lookup-selection-change`
// and translates a prospect pick into the `sh:conv-row-select` event
// the card — and the prospect table — already speak.
// ──────────────────────────────────────────────────────────────────────

;(function () {
  'use strict'

  // Agent-action items. Only the Generate one is reachable here
  // (the popover's Confirm button routes to it); hunter also rendered
  // "Suggest Cadence" as a row in the plain list variant.
  var AGENT_ACTIONS = [
    { id: 'generate', name: 'Generate Cadence', meta: 'Agent will create a new cadence from scratch.' }
  ]

  // Hardcoded agent-action icon. `sparkles` exists in BOTH the utility
  // and standard sprites; we use the standard one so the symbol's
  // viewBox/proportions match what the slds-icon-standard-avatar
  // container expects (the utility variant renders visibly larger
  // inside the standard container).
  var ACTION_ICON_CLASS = 'slds-icon-standard-avatar'
  var ACTION_ICON_HREF  = '/assets/icons/standard-sprite/svg/symbols.svg#sparkles'

  // ── The generic lookup ──────────────────────────────────────────
  function initLookups () {
    document.querySelectorAll('[data-slds-lookup]').forEach(function (el) {
      // The card can mount more than once — home_conversation.js calls
      // ShCadence.mount for the document at boot and again for every
      // message a scripted reply injects — and this selector is
      // document-wide, so an already-wired field would get a second set
      // of listeners each time. Claim it on first pass.
      if (el.dataset.lookupReady === 'true') return
      el.dataset.lookupReady = 'true'

      if (el.dataset.lookupWired === 'true') return
      el.dataset.lookupWired = 'true'

      var data = window[el.dataset.sldsLookup] || []
      var entityLabel = el.dataset.lookupEntity || 'Record'
      var metaMode    = el.dataset.lookupMeta || 'account'

      // Change (2) — the icon arrives as its two finished strings.
      var iconContainerClass = el.dataset.lookupIconClass || 'slds-icon-standard-account'
      var iconSpritePath     = el.dataset.lookupIconHref || ''

      var container   = el.querySelector('.slds-combobox_container')
      var trigger     = el.querySelector('.slds-dropdown-trigger_click')
      var formElement = el.querySelector('.slds-combobox__form-element')
      var list        = el.querySelector('.slds-listbox_vertical')
      var labelEl     = el.querySelector('.slds-form-element__label')

      // Popover-mode wrappers intentionally omit role="listbox" on the
      // .slds-dropdown wrapper because the contents aren't a listbox.
      // Fall back to the .slds-dropdown div itself so there's still an
      // id to wire aria-controls to.
      var listboxEl = el.querySelector('[role="listbox"]') || el.querySelector('.slds-dropdown')
      var inputId   = el.querySelector('.slds-combobox__input').id
      var listboxId = listboxEl.id
      var labelId   = labelEl.id
      var focusedOptionIndex = -1

      // When a wrapper opts into popover mode, the dropdown content is
      // hand-authored markup instead of an SLDS option list. Skip
      // option rendering, typeahead and row wiring entirely and let the
      // popover module drive selection through the helpers exposed at
      // the bottom of this function.
      var isPopover = el.dataset.lookupPopover === 'true'

      function open () {
        trigger.classList.add('slds-is-open')
        var cb = formElement.querySelector('[role="combobox"]')
        if (cb) cb.setAttribute('aria-expanded', 'true')
      }

      function close () {
        trigger.classList.remove('slds-is-open')
        focusedOptionIndex = -1
        var cb = formElement.querySelector('[role="combobox"]')
        if (cb) {
          cb.setAttribute('aria-expanded', 'false')
          cb.removeAttribute('aria-activedescendant')
        }
      }

      function getVisibleOptions () {
        return Array.prototype.slice.call(list.querySelectorAll('[role="option"]'))
      }

      function highlightOption (index) {
        var options = getVisibleOptions()
        options.forEach(function (opt) { opt.classList.remove('slds-has-focus') })
        var cb = formElement.querySelector('[role="combobox"]')

        if (index >= 0 && index < options.length) {
          focusedOptionIndex = index
          options[index].classList.add('slds-has-focus')
          if (cb) cb.setAttribute('aria-activedescendant', options[index].id)
          options[index].scrollIntoView({ block: 'nearest' })
        } else {
          focusedOptionIndex = -1
          if (cb) cb.removeAttribute('aria-activedescendant')
        }
      }

      // The second line of an option row. Which fields make it up is
      // the wrapper's `data-lookup-meta`, because "Prospect • VP,
      // Sales • Rippling" and "Cadence • Multi-channel • 8 steps" are
      // the same shape over different records.
      function metaTextFor (item) {
        var tail
        if (metaMode === 'prospect') {
          tail = [item.title || '', item.account || ''].filter(Boolean).join(' \u2022 ')
        } else if (metaMode === 'cadence') {
          tail = [item.type || '', (item.steps != null ? item.steps + ' steps' : '')]
            .filter(Boolean).join(' \u2022 ')
        } else {
          tail = [item.city || '', item.state || ''].filter(Boolean).join(', ')
        }
        return entityLabel + (tail ? ' \u2022 ' + tail : '')
      }

      function matchesQuery (item, q) {
        var fields = metaMode === 'prospect'
          ? [item.name, item.title, item.account]
          : metaMode === 'cadence'
            ? [item.name, item.type, item.owner]
            : [item.name, item.city, item.state, item.industry]
        for (var i = 0; i < fields.length; i++) {
          if ((fields[i] || '').toLowerCase().indexOf(q) > -1) return true
        }
        return false
      }

      function optionLi (item, i) {
        return '<li role="presentation" class="slds-listbox__item">' +
          '<div id="' + listboxId + '-option-' + i + '" class="slds-media slds-listbox__option slds-listbox__option_entity slds-listbox__option_has-meta" role="option" data-idx="' + item._idx + '">' +
            '<span class="slds-media__figure slds-listbox__option-icon">' +
              '<span class="slds-icon_container ' + iconContainerClass + '">' +
                '<svg class="slds-icon slds-icon_small" aria-hidden="true">' +
                  '<use xlink:href="' + iconSpritePath + '"></use>' +
                '</svg>' +
              '</span>' +
            '</span>' +
            '<span class="slds-media__body">' +
              '<span class="slds-listbox__option-text slds-listbox__option-text_entity">' + item.name + '</span>' +
              '<span class="slds-listbox__option-meta slds-listbox__option-meta_entity">' + metaTextFor(item) + '</span>' +
            '</span>' +
          '</div>' +
        '</li>'
      }

      function emptyLi () {
        return '<li role="presentation" class="slds-listbox__item">' +
          '<div class="slds-media slds-listbox__option slds-listbox__option_plain slds-text-align_center" role="presentation">' +
            '<span class="slds-listbox__option-text">No matches found</span>' +
          '</div>' +
        '</li>'
      }

      function renderOptions (items) {
        list.innerHTML = items.length ? items.map(optionLi).join('') : emptyLi()
        list.querySelectorAll('[role="option"][data-idx]').forEach(function (opt) {
          opt.addEventListener('click', function () {
            select(data[parseInt(opt.dataset.idx, 10)])
          })
        })
      }

      // `_idx` is the record's index in the unfiltered array, carried
      // through the filter so a click can find the original record
      // rather than the copy in the result list.
      function filter (query) {
        var q = (query || '').toLowerCase().trim()
        var results = data.map(function (item, i) {
          var copy = {}
          for (var k in item) copy[k] = item[k]
          copy._idx = i
          return copy
        })
        if (q) results = results.filter(function (item) { return matchesQuery(item, q) })
        renderOptions(results.slice(0, q ? 5 : 4))
        focusedOptionIndex = -1
      }

      function wireInput (inputEl) {
        // Popover-mode lookups don't render an option list — there's no
        // <ul> inside the dropdown to filter into. Just wire open/close;
        // typeahead lives inside the popover. Escape still closes.
        if (isPopover) {
          inputEl.addEventListener('click', open)
          inputEl.addEventListener('focus', open)
          inputEl.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') close()
          })
          return
        }

        inputEl.addEventListener('click', function () { filter(inputEl.value); open() })
        inputEl.addEventListener('focus', function () { filter(inputEl.value); open() })
        inputEl.addEventListener('input', function () { filter(inputEl.value); open() })
        inputEl.addEventListener('keydown', function (e) {
          var options = getVisibleOptions()
          var count = options.length

          switch (e.key) {
            case 'ArrowDown':
              e.preventDefault()
              if (!trigger.classList.contains('slds-is-open')) {
                filter(inputEl.value)
                open()
              }
              highlightOption(focusedOptionIndex < count - 1 ? focusedOptionIndex + 1 : 0)
              break
            case 'ArrowUp':
              e.preventDefault()
              highlightOption(focusedOptionIndex > 0 ? focusedOptionIndex - 1 : count - 1)
              break
            case 'Enter':
              e.preventDefault()
              if (focusedOptionIndex >= 0 && focusedOptionIndex < count) {
                select(data[parseInt(options[focusedOptionIndex].dataset.idx, 10)])
              }
              break
            case 'Escape':
              close()
              break
          }
        })
      }

      // The chip. Both select paths write the same three elements —
      // entity icon, a faux-input holding the name, and a clear X —
      // and differ only in which icon and which event detail.
      function renderChip (name, iconClass, iconHref, iconTitle) {
        close()
        container.classList.add('slds-has-selection')
        formElement.classList.remove('slds-input-has-icon_right')
        formElement.classList.add('slds-input-has-icon_left-right')

        formElement.innerHTML =
          '<span class="slds-icon_container ' + iconClass + ' slds-combobox__input-entity-icon" title="' + iconTitle + '">' +
            '<svg class="slds-icon slds-icon_small" aria-hidden="true">' +
              '<use xlink:href="' + iconHref + '"></use>' +
            '</svg>' +
            '<span class="slds-assistive-text">' + iconTitle + '</span>' +
          '</span>' +
          '<div role="combobox" tabindex="0" class="slds-input_faux slds-combobox__input slds-combobox__input-value" ' +
            'aria-labelledby="' + labelId + '" id="' + inputId + '-selected-value" ' +
            'aria-controls="' + listboxId + '" aria-expanded="false" aria-haspopup="listbox">' +
            '<span class="slds-truncate">' + name + '</span>' +
          '</div>' +
          '<button class="slds-button slds-button_icon slds-input__icon slds-input__icon_right" title="Remove selected option">' +
            '<svg class="slds-button__icon" aria-hidden="true">' +
              '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#close"></use>' +
            '</svg>' +
            '<span class="slds-assistive-text">Remove selected option</span>' +
          '</button>'

        // Stop propagation so the document-level click handler below
        // doesn't see a click on the (now-replaced) X, mistake it for an
        // outside click, and immediately close the listbox that
        // clearSelection() just opened.
        formElement.querySelector('.slds-button_icon').addEventListener('click', function (e) {
          e.stopPropagation()
          clearSelection()
        })
      }

      function select (record) {
        if (!record) return
        renderChip(record.name, iconContainerClass, iconSpritePath, entityLabel)
        document.dispatchEvent(new CustomEvent('lookup-selection-change', {
          detail: { selected: true, el: el, entity: entityLabel, record: record }
        }))
      }

      // Mirror of select() for agent actions: the same chip shape with
      // the sparkles icon, and an `{ action }`-shaped event so a
      // consumer can route to agent behavior rather than a record.
      function selectAction (action) {
        if (!action) return
        renderChip(action.name, ACTION_ICON_CLASS, ACTION_ICON_HREF, 'Agent Actions')
        document.dispatchEvent(new CustomEvent('lookup-selection-change', {
          detail: { selected: true, el: el, entity: entityLabel, action: action }
        }))
      }

      function clearSelection () {
        container.classList.remove('slds-has-selection')
        formElement.classList.remove('slds-input-has-icon_left-right')
        formElement.classList.add('slds-input-has-icon_right')
        delete el.dataset.lookupActionVariant

        formElement.innerHTML =
          '<input type="text" class="slds-input slds-combobox__input" id="' + inputId + '" ' +
            'aria-autocomplete="list" aria-controls="' + listboxId + '" aria-expanded="false" ' +
            'aria-haspopup="listbox" autocomplete="off" role="combobox" placeholder="Search ' + entityLabel + 's..." />' +
          '<span class="slds-icon_container slds-icon-utility-search slds-input__icon slds-input__icon_right">' +
            '<svg class="slds-icon slds-icon_x-small slds-icon-text-default" aria-hidden="true">' +
              '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#search"></use>' +
            '</svg>' +
          '</span>'

        var newInput = formElement.querySelector('.slds-combobox__input')
        wireInput(newInput)
        newInput.focus()
        if (!isPopover) filter('')
        open()

        document.dispatchEvent(new CustomEvent('lookup-selection-change', {
          detail: { selected: false, el: el, entity: entityLabel }
        }))
      }

      wireInput(el.querySelector('.slds-combobox__input'))
      if (!isPopover) filter('')

      if (isPopover) {
        el._lookupSelect = select
        el._lookupSelectAction = selectAction
        el._lookupClose = close

        // One delegated handler covers every click in the input region
        // — the original input, the chip that replaces it, either icon,
        // and the blank space around them. The clear X calls
        // stopPropagation in its own handler, so this never fires for
        // that path (which would re-open the popover the moment the
        // chip is cleared). Attached once: formElement itself is never
        // replaced, only its innerHTML.
        formElement.addEventListener('click', function () { open() })
      }

      var defaultName = el.dataset.lookupDefault
      if (defaultName) {
        var match = null
        for (var i = 0; i < data.length; i++) {
          if (data[i] && (data[i].name || '').toLowerCase() === defaultName.toLowerCase()) {
            match = data[i]
            break
          }
        }
        if (match) select(match)
      }

      document.addEventListener('click', function (e) {
        if (!el.contains(e.target)) close()
      })
    })
  }

  // ── The cadence popover ─────────────────────────────────────────
  // Everything inside the dropdown of the field that opted into
  // `data-lookup-popover`. Selection is routed back through the
  // helpers above so the chip markup lives in one place.
  function initPopover () {
    var wrapper = document.querySelector('[data-slds-lookup][data-lookup-popover="true"]')
    if (!wrapper) return
    var popover = wrapper.querySelector('.cadence-popover')
    if (!popover) return
    // Same re-mount guard as initLookups, on its own key: this runs
    // second and would otherwise re-bind the panels' typeahead.
    if (popover.dataset.popoverReady === 'true') return
    popover.dataset.popoverReady = 'true'

    // Typeahead, per panel. `data-search-text` is on the <li>; hiding
    // is `[hidden]`, which the stylesheet turns into display:none.
    // After each pass the panel's empty-state shows or hides on the
    // visible count, so zero matches says so rather than going blank.
    popover.querySelectorAll('.cadence-popover__search').forEach(function (input) {
      input.addEventListener('input', function () {
        var q = (input.value || '').toLowerCase().trim()
        var panel = input.closest('.cadence-popover__panel')
        if (!panel) return

        var visibleCount = 0
        panel.querySelectorAll('.slds-listbox__item[data-search-text]').forEach(function (item) {
          var matches = !q || (item.dataset.searchText || '').indexOf(q) > -1
          if (matches) {
            item.removeAttribute('hidden')
            visibleCount++
          } else {
            item.setAttribute('hidden', '')
          }
        })

        var empty = panel.querySelector('.cadence-popover__empty')
        if (empty) {
          if (visibleCount === 0) empty.removeAttribute('hidden')
          else empty.setAttribute('hidden', '')
        }
      })
    })

    // Click-to-pick. Which panel the row was in is stashed on the
    // wrapper as the chosen variant, so a consumer can tell "use this
    // cadence as-is" from "use it, but rewrite the copy" — the chip
    // text is identical either way.
    popover.querySelectorAll('.cadence-popover__list').forEach(function (list) {
      list.addEventListener('click', function (e) {
        var li = e.target.closest('.slds-listbox__item[data-cadence-name]')
        if (!li || !list.contains(li)) return

        var records = window[wrapper.dataset.sldsLookup] || []
        var item = null
        for (var i = 0; i < records.length; i++) {
          if (records[i] && records[i].name === li.dataset.cadenceName) { item = records[i]; break }
        }
        if (!item) return

        var panel = li.closest('.cadence-popover__panel')
        wrapper.dataset.lookupActionVariant =
          (panel && panel.dataset.panel) === 'cadence-mode-optimize' ? 'optimize' : 'use-as-is'

        if (typeof wrapper._lookupSelect === 'function') wrapper._lookupSelect(item)
      })
    })

    // Generate's Confirm. Routes through the action path so the field
    // shows the sparkle chip — the visible difference between a
    // cadence that was chosen and one the agent was asked to build.
    var submit = popover.querySelector('.cadence-popover__prompt-submit')
    var promptEl = popover.querySelector('.cadence-popover__prompt')
    if (submit) {
      submit.addEventListener('click', function () {
        var action = null
        for (var i = 0; i < AGENT_ACTIONS.length; i++) {
          if (AGENT_ACTIONS[i].id === 'generate') { action = AGENT_ACTIONS[i]; break }
        }
        if (!action) return

        wrapper.dataset.lookupActionVariant = 'generate'
        if (promptEl) wrapper.dataset.lookupGeneratePrompt = promptEl.value || ''
        if (typeof wrapper._lookupSelectAction === 'function') wrapper._lookupSelectAction(action)
      })
    }
  }

  // No auto-boot. The caller sets the record globals from the card's
  // JSON blocks first, then calls this; initLookups seeds each field's
  // default chip out of those arrays, so running earlier would leave
  // both fields empty.
  window.ShLookups = {
    init: function () {
      initLookups()
      initPopover()
    }
  }
}())
