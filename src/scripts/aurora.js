// Aurora pointer effect. The lab page (/style_lab/aurora_lab.html) writes one setting
// per target; the style sandbox reads them separately for the feed and
// the chat composer. Loaded as a classic script: window.SHAurora.
(function (global) {
  'use strict'

  var KEYS = {
    feed: 'style:aurora:feed',
    composer: 'style:aurora:composer'
  }
  // Earlier builds stored the feed under this single key.
  var LEGACY_KEY = 'style:aurora'
  var MAX_DISTANCE = 120
  var QUADRANTS = [
    { xRange: [10, 45], yRange: [10, 45], xVar: 4 },
    { xRange: [55, 90], yRange: [10, 45], xVar: 5 },
    { xRange: [10, 45], yRange: [55, 90], xVar: 6 },
    { xRange: [55, 90], yRange: [55, 90], xVar: 7 }
  ]

  var DEFAULTS = {
    composer: {
      mode: 'combined',
      cardOpacity: 100,
      colorOpacity: 100,
      saturation: 100,
      blur: 35,
      spread: 53
    },
    feed: {
      mode: 'combined',
      cardOpacity: 100,
      colorOpacity: 80,
      saturation: 100,
      blur: 54,
      spread: 50
    }
  }

  var MODES = { direct: true, proximity: true, combined: true, 'gray-to-color': true }

  function clamp (value, min, max) {
    var n = Number(value)
    if (isNaN(n)) return min
    if (n < min) return min
    if (n > max) return max
    return n
  }

  function defaultsFor (target) {
    var name = target === 'composer' ? 'composer' : 'feed'
    return DEFAULTS[name]
  }

  function normalize (raw, target) {
    var base = defaultsFor(target)
    raw = raw || {}
    return {
      mode: MODES[raw.mode] ? raw.mode : base.mode,
      cardOpacity: clamp(raw.cardOpacity == null ? base.cardOpacity : raw.cardOpacity, 0, 100),
      colorOpacity: clamp(raw.colorOpacity == null ? base.colorOpacity : raw.colorOpacity, 0, 100),
      saturation: clamp(raw.saturation == null ? base.saturation : raw.saturation, 0, 100),
      blur: clamp(raw.blur == null ? base.blur : raw.blur, 5, 80),
      spread: clamp(raw.spread == null ? base.spread : raw.spread, 20, 80)
    }
  }

  function targetName (target) {
    return target === 'composer' ? 'composer' : 'feed'
  }

  function storageKey (target) {
    return KEYS[targetName(target)]
  }

  function read (target) {
    var name = targetName(target)
    try {
      var raw = global.localStorage.getItem(storageKey(name))
      if (!raw && name === 'feed') raw = global.localStorage.getItem(LEGACY_KEY)
      if (!raw) return normalize(null, name)
      return normalize(JSON.parse(raw), name)
    } catch (e) {
      return normalize(null, name)
    }
  }

  function write (target, config) {
    if (target && typeof target === 'object') {
      config = target
      target = 'feed'
    }
    try {
      global.localStorage.setItem(storageKey(target), JSON.stringify(normalize(config, target)))
    } catch (e) {}
  }

  function distanceToBox (mx, my, rect) {
    var cx = Math.max(rect.left, Math.min(mx, rect.right))
    var cy = Math.max(rect.top, Math.min(my, rect.bottom))
    var dx = mx - cx
    var dy = my - cy
    return Math.sqrt(dx * dx + dy * dy)
  }

  // root: the host (.sh-aurora). options.track is the element whose
  // pointer proximity counts (the stage on the lab page, the scrolling
  // main column on the feed). options.cardOpacity is 'fade' (scale the
  // feed's wash) or 'fill' (fade the preview card's own background).
  function mount (root, options) {
    options = options || {}
    var glow = root.querySelector('[data-sh-aurora-glow]')
    var gray = root.querySelector('[data-sh-aurora-gray]')
    var track = options.track || root
    var cardMode = options.cardOpacity === 'fill' ? 'fill' : 'fade'
    var target = targetName(options.target)
    var config = normalize(options.config || read(target), target)
    var blurBase = config.blur
    var hovering = false
    var lastPoint = null

    function applyPaint () {
      root.style.setProperty('--sh-aurora-alpha', (config.colorOpacity / 100).toFixed(2))
      root.style.setProperty('--sh-aurora-sat', Math.round(config.saturation * 0.97) + '%')
      root.style.setProperty('--sh-aurora-blur', blurBase + 'px')
      root.style.setProperty('--sh-aurora-spread', config.spread + '%')
      if (gray) gray.hidden = config.mode !== 'gray-to-color'
      if (cardMode === 'fade') {
        root.style.setProperty('--sh-aurora-card-opacity', String(config.cardOpacity / 100))
        return
      }
      if (config.cardOpacity >= 100) {
        root.style.removeProperty('background')
        root.style.removeProperty('background-clip')
        return
      }
      root.style.background = 'rgba(var(--sh-aurora-card-rgb, 255, 255, 255), ' + (config.cardOpacity / 100) + ')'
      root.style.backgroundClip = 'padding-box'
    }

    function mapGradients (nx, ny) {
      var span = 15
      for (var i = 0; i < QUADRANTS.length; i++) {
        var q = QUADRANTS[i]
        var cx = (q.xRange[0] + q.xRange[1]) / 2
        var cy = (q.yRange[0] + q.yRange[1]) / 2
        var x = cx + (nx - 0.5) * span * 2
        var y = cy + (ny - 0.5) * span * 2
        root.style.setProperty('--sh-aurora-x' + q.xVar, Math.max(q.xRange[0], Math.min(x, q.xRange[1])) + '%')
        root.style.setProperty('--sh-aurora-y' + q.xVar, Math.max(q.yRange[0], Math.min(y, q.yRange[1])) + '%')
      }
    }

    function rest () {
      if (glow) glow.style.opacity = '0'
      root.style.setProperty('--sh-aurora-blur', blurBase + 'px')
      root.style.setProperty('--sh-aurora-gray-opacity', '1')
    }

    function paintPointer () {
      if (!lastPoint) {
        rest()
        return
      }
      var rect = root.getBoundingClientRect()
      var nx = rect.width ? (lastPoint.x - rect.left) / rect.width : 0.5
      var ny = rect.height ? (lastPoint.y - rect.top) / rect.height : 0.5

      if (approaches()) {
        var dist = distanceToBox(lastPoint.x, lastPoint.y, rect)
        if (dist > MAX_DISTANCE) {
          rest()
          return
        }
        var t = 1 - dist / MAX_DISTANCE
        if (glow) glow.style.opacity = String(Math.pow(t, 1.5))
        // Proximity stays sharper than the slider once you are inside
        // (75% of it). Combined arrives at the slider value at the edge,
        // so inside it matches Direct Map.
        var blur = config.mode === 'combined'
          ? blurBase * (1.5 - 0.5 * t)
          : blurBase * 1.5 - t * blurBase * 0.75
        root.style.setProperty('--sh-aurora-blur', blur + 'px')
        mapGradients(Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)))
        return
      }

      if (!hovering) {
        rest()
        return
      }

      if (glow) glow.style.opacity = '1'
      if (config.mode === 'gray-to-color') {
        root.style.setProperty('--sh-aurora-gray-opacity', '0')
      }
      mapGradients(nx, ny)
    }

    function remember (event) {
      lastPoint = { x: event.clientX, y: event.clientY }
    }

    function approaches () {
      return config.mode === 'proximity' || config.mode === 'combined'
    }

    function onRootEnter (event) {
      if (approaches()) return
      hovering = true
      remember(event)
      paintPointer()
    }

    function onRootLeave () {
      if (approaches()) return
      hovering = false
      lastPoint = null
      rest()
    }

    function onRootMove (event) {
      if (approaches()) return
      remember(event)
      paintPointer()
    }

    function onTrackMove (event) {
      if (!approaches()) return
      remember(event)
      paintPointer()
    }

    function onTrackLeave () {
      if (!approaches()) return
      lastPoint = null
      rest()
    }

    root.addEventListener('mouseenter', onRootEnter)
    root.addEventListener('mouseleave', onRootLeave)
    root.addEventListener('mousemove', onRootMove)
    track.addEventListener('mousemove', onTrackMove)
    track.addEventListener('mouseleave', onTrackLeave)

    applyPaint()
    rest()

    return {
      setConfig: function (next) {
        config = normalize(next, target)
        blurBase = config.blur
        if (config.mode === 'proximity' || config.mode === 'combined') {
          hovering = false
        } else if (lastPoint) {
          var rect = root.getBoundingClientRect()
          hovering = lastPoint.x >= rect.left && lastPoint.x <= rect.right &&
            lastPoint.y >= rect.top && lastPoint.y <= rect.bottom
        }
        applyPaint()
        paintPointer()
      },
      destroy: function () {
        root.removeEventListener('mouseenter', onRootEnter)
        root.removeEventListener('mouseleave', onRootLeave)
        root.removeEventListener('mousemove', onRootMove)
        track.removeEventListener('mousemove', onTrackMove)
        track.removeEventListener('mouseleave', onTrackLeave)
      }
    }
  }

  var mounted = []

  function boot () {
    var nodes = document.querySelectorAll('[data-sh-aurora-root]')
    for (var i = 0; i < nodes.length; i++) {
      var root = nodes[i]
      if (root.getAttribute('data-sh-aurora-bound') === 'true') continue
      root.setAttribute('data-sh-aurora-bound', 'true')
      var target = targetName(root.getAttribute('data-sh-aurora-target'))
      var track = root.closest('.seller-home__main') || root
      var cardOpacity = root.getAttribute('data-sh-aurora-card') === 'fill' ? 'fill' : 'fade'
      mounted.push({
        target: target,
        api: mount(root, { track: track, cardOpacity: cardOpacity, config: read(target), target: target })
      })
    }
  }

  global.addEventListener('storage', function (event) {
    var target = null
    if (event.key === KEYS.composer) target = 'composer'
    else if (event.key === KEYS.feed || event.key === LEGACY_KEY) target = 'feed'
    else return
    var config = read(target)
    for (var i = 0; i < mounted.length; i++) {
      if (mounted[i].target === target) mounted[i].api.setConfig(config)
    }
  })

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }

  global.SHAurora = {
    DEFAULTS: DEFAULTS,
    defaults: function (target) {
      var base = defaultsFor(target)
      return {
        mode: base.mode,
        cardOpacity: base.cardOpacity,
        colorOpacity: base.colorOpacity,
        saturation: base.saturation,
        blur: base.blur,
        spread: base.spread
      }
    },
    KEYS: KEYS,
    read: read,
    write: write,
    mount: mount
  }
})(window)
