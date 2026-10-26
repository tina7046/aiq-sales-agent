// Two tuners on one page. Chat Composer writes `style:aurora:composer`.
// Feed Container writes `style:aurora:feed`. Each previews on its own card.
(function () {
  'use strict'

  var DESCRIPTIONS = {
    direct: 'Cursor position maps directly to gradient positions in a narrow range. Activates on mouseenter, full opacity immediately.',
    proximity: 'Aurora fades in as the cursor approaches — opacity and blur scale with distance. No hard on/off boundary.',
    combined: 'Fades in like Proximity on the way in. Once the pointer is inside, opacity and blur match Direct Map, including the Blur slider.',
    'gray-to-color': 'A neutral gray glow is always visible. On hover, color fades in over the gray and follows the cursor. The shadow never disappears — it just gains color.'
  }

  var SLIDERS = [
    { id: 'card-opacity', key: 'cardOpacity', unit: '%' },
    { id: 'color-opacity', key: 'colorOpacity', unit: '%' },
    { id: 'saturation', key: 'saturation', unit: '%' },
    { id: 'blur', key: 'blur', unit: 'px' },
    { id: 'spread', key: 'spread', unit: '%' }
  ]

  function bindPanel (panel) {
    var target = panel.getAttribute('data-aurora-target') === 'composer' ? 'composer' : 'feed'
    var card = panel.querySelector('[data-aurora-preview]')
    var stage = panel.querySelector('.aurora-lab__stage')
    var buttons = panel.querySelectorAll('[data-pick]')
    var description = panel.querySelector('[data-aurora-description]')
    if (!card || !stage || !description || !window.SHAurora) return

    var config = window.SHAurora.read(target)
    var api = window.SHAurora.mount(card, {
      track: stage,
      cardOpacity: 'fill',
      config: config,
      target: target
    })

    function publish () {
      window.SHAurora.write(target, config)
      api.setConfig(config)
    }

    function selectMode (mode) {
      config.mode = mode
      for (var i = 0; i < buttons.length; i++) {
        var on = buttons[i].getAttribute('data-pick') === mode
        buttons[i].setAttribute('aria-checked', on ? 'true' : 'false')
        buttons[i].tabIndex = on ? 0 : -1
      }
      description.textContent = DESCRIPTIONS[mode] || ''
      publish()
    }

    for (var s = 0; s < SLIDERS.length; s++) {
      (function (slider) {
        var input = panel.querySelector('[data-aurora-slider="' + slider.id + '"]')
        var output = panel.querySelector('[data-aurora-output="' + slider.id + '"]')
        if (!input || !output) return
        input.value = String(config[slider.key])
        output.textContent = config[slider.key] + slider.unit
        input.addEventListener('input', function () {
          config[slider.key] = Number(input.value)
          output.textContent = input.value + slider.unit
          publish()
        })
      })(SLIDERS[s])
    }

    selectMode(config.mode)

    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (event) {
        selectMode(event.currentTarget.getAttribute('data-pick'))
      })
      buttons[i].addEventListener('keydown', function (event) {
        var key = event.key
        if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'ArrowDown' && key !== 'ArrowUp') return
        event.preventDefault()
        var current = 0
        for (var j = 0; j < buttons.length; j++) {
          if (buttons[j] === event.currentTarget) current = j
        }
        var dir = (key === 'ArrowRight' || key === 'ArrowDown') ? 1 : -1
        var next = buttons[(current + dir + buttons.length) % buttons.length]
        next.focus()
        selectMode(next.getAttribute('data-pick'))
      })
    }

    var reset = panel.querySelector('[data-aurora-reset]')
    if (reset) {
      reset.addEventListener('click', function () {
        var defaults = window.SHAurora.defaults(target)
        config.mode = defaults.mode
        config.cardOpacity = defaults.cardOpacity
        config.colorOpacity = defaults.colorOpacity
        config.saturation = defaults.saturation
        config.blur = defaults.blur
        config.spread = defaults.spread
        for (var k = 0; k < SLIDERS.length; k++) {
          var slider = SLIDERS[k]
          var input = panel.querySelector('[data-aurora-slider="' + slider.id + '"]')
          var output = panel.querySelector('[data-aurora-output="' + slider.id + '"]')
          var value = config[slider.key]
          if (input) input.value = String(value)
          if (output) output.textContent = value + slider.unit
        }
        selectMode(config.mode)
      })
    }
  }

  function boot () {
    var panels = document.querySelectorAll('[data-aurora-panel]')
    for (var i = 0; i < panels.length; i++) bindPanel(panels[i])
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
