// ──────────────────────────────────────────────────────────────────────
// Live waveform — canvas visualizer for microphone input
// =====================================================================
// Vanilla port of ElevenLabs UI's React LiveWaveform
// (apps/www/registry/elevenlabs-ui/ui/live-waveform.tsx). Same canvas
// + Web Audio behavior: getUserMedia when active, FFT bars, static
// (mirrored) and scrolling modes, a processing animation, HiDPI
// resize, and stream teardown. Not speech-to-text — the mic stream
// only drives the bars.
//
// Usage:
//   var api = ShLiveWaveform.mount(container, {
//     active: true,
//     mode: 'static',
//     height: 40,
//     onError: function (err) { api.setProcessing(true) }
//   })
//   api.setActive(true)
//   api.setProcessing(true)
//   api.destroy()
// ──────────────────────────────────────────────────────────────────────

(function () {
  'use strict'

  var DEFAULTS = {
    active: false,
    processing: false,
    barWidth: 3,
    barHeight: 4,
    barGap: 1,
    barRadius: 1.5,
    barColor: null,
    fadeEdges: true,
    fadeWidth: 24,
    height: 64,
    sensitivity: 1,
    smoothingTimeConstant: 0.8,
    fftSize: 256,
    historySize: 60,
    updateRate: 30,
    mode: 'static',
    onError: null,
    onStreamReady: null,
    onStreamEnd: null
  }

  function assign (target, source) {
    if (!source) return target
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
        target[key] = source[key]
      }
    }
    return target
  }

  function mount (container, options) {
    if (!container) return null

    var opts = assign({}, DEFAULTS)
    assign(opts, options)

    var canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.className = 'sh-live-waveform__canvas'
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'

    container.classList.add('sh-live-waveform')
    container.style.position = 'relative'
    container.style.width = '100%'
    if (!container.style.height) {
      container.style.height = typeof opts.height === 'number' ? opts.height + 'px' : String(opts.height)
    }
    container.setAttribute('role', container.getAttribute('role') || 'img')
    container.appendChild(canvas)
    updateLabel()

    var history = []
    var analyser = null
    var audioContext = null
    var stream = null
    var animationId = 0
    var lastUpdate = 0
    var processingAnimationId = 0
    var lastActiveData = []
    var transitionProgress = 0
    var staticBars = []
    var needsRedraw = true
    var gradientCache = null
    var lastWidth = 0
    var destroyed = false
    var resizeObserver = null

    function updateLabel () {
      var label = opts.active
        ? 'Live audio waveform'
        : opts.processing
          ? 'Processing audio'
          : 'Audio waveform idle'
      container.setAttribute('aria-label', label)
    }

    function resizeCanvas () {
      var rect = container.getBoundingClientRect()
      var dpr = window.devicePixelRatio || 1
      var width = Math.max(0, rect.width)
      var height = Math.max(0, rect.height)
      if (width < 1 || height < 1) return
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      var ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      gradientCache = null
      lastWidth = width
      padScrollHistory(width)
      needsRedraw = true
    }

    function padScrollHistory (width) {
      if (opts.mode !== 'scrolling') return
      var count = barCountForWidth(width || lastWidth || 0)
      opts.historySize = count
      while (history.length < count) history.unshift(0.05)
      while (history.length > count) history.shift()
    }

    var ResizeObserverCtor = window.ResizeObserver
    if (typeof ResizeObserverCtor === 'function') {
      resizeObserver = new ResizeObserverCtor(resizeCanvas)
      resizeObserver.observe(container)
    } else {
      window.addEventListener('resize', resizeCanvas)
    }
    resizeCanvas()

    function barCountForWidth (width) {
      return Math.max(1, Math.floor(width / (opts.barWidth + opts.barGap)))
    }

    function processingValues (barCount, time) {
      var values = []
      var i
      var normalizedPosition
      var centerWeight
      var wave1
      var wave2
      var wave3
      var combinedWave
      var processingValue
      var finalValue
      var lastValue
      var lastIndex
      if (opts.mode === 'static') {
        var halfCount = Math.floor(barCount / 2) || 1
        for (i = 0; i < barCount; i++) {
          normalizedPosition = (i - halfCount) / halfCount
          centerWeight = 1 - Math.abs(normalizedPosition) * 0.4
          wave1 = Math.sin(time * 1.5 + normalizedPosition * 3) * 0.25
          wave2 = Math.sin(time * 0.8 - normalizedPosition * 2) * 0.2
          wave3 = Math.cos(time * 2 + normalizedPosition) * 0.15
          combinedWave = wave1 + wave2 + wave3
          processingValue = (0.2 + combinedWave) * centerWeight
          finalValue = processingValue
          if (lastActiveData.length > 0 && transitionProgress < 1) {
            lastIndex = Math.min(i, lastActiveData.length - 1)
            lastValue = lastActiveData[lastIndex] || 0
            finalValue = lastValue * (1 - transitionProgress) + processingValue * transitionProgress
          }
          values.push(Math.max(0.05, Math.min(1, finalValue)))
        }
      } else {
        for (i = 0; i < barCount; i++) {
          normalizedPosition = (i - barCount / 2) / (barCount / 2 || 1)
          centerWeight = 1 - Math.abs(normalizedPosition) * 0.4
          wave1 = Math.sin(time * 1.5 + i * 0.15) * 0.25
          wave2 = Math.sin(time * 0.8 - i * 0.1) * 0.2
          wave3 = Math.cos(time * 2 + i * 0.05) * 0.15
          combinedWave = wave1 + wave2 + wave3
          processingValue = (0.2 + combinedWave) * centerWeight
          finalValue = processingValue
          if (lastActiveData.length > 0 && transitionProgress < 1) {
            lastIndex = Math.floor((i / barCount) * lastActiveData.length)
            lastValue = lastActiveData[lastIndex] || 0
            finalValue = lastValue * (1 - transitionProgress) + processingValue * transitionProgress
          }
          values.push(Math.max(0.05, Math.min(1, finalValue)))
        }
      }
      return values
    }

    function stopProcessingLoop () {
      if (processingAnimationId) {
        window.cancelAnimationFrame(processingAnimationId)
        processingAnimationId = 0
      }
    }

    function startProcessingLoop () {
      stopProcessingLoop()
      var time = 0
      transitionProgress = 0
      function tick () {
        if (destroyed || !opts.processing || opts.active) return
        time += 0.03
        transitionProgress = Math.min(1, transitionProgress + 0.02)
        var width = container.getBoundingClientRect().width || 200
        var values = processingValues(barCountForWidth(width), time)
        if (opts.mode === 'static') staticBars = values
        else history = values
        needsRedraw = true
        processingAnimationId = window.requestAnimationFrame(tick)
      }
      tick()
    }

    function fadeToIdle () {
      var hasData = opts.mode === 'static' ? staticBars.length > 0 : history.length > 0
      if (!hasData) return
      var fadeProgress = 0
      function tick () {
        if (destroyed || opts.active || opts.processing) return
        fadeProgress += 0.03
        if (fadeProgress < 1) {
          if (opts.mode === 'static') {
            staticBars = staticBars.map(function (value) { return value * (1 - fadeProgress) })
          } else {
            history = history.map(function (value) { return value * (1 - fadeProgress) })
          }
          needsRedraw = true
          window.requestAnimationFrame(tick)
        } else {
          staticBars = []
          history = []
          needsRedraw = true
        }
      }
      tick()
    }

    function stopTracks () {
      if (stream) {
        var tracks = stream.getTracks()
        for (var t = 0; t < tracks.length; t++) tracks[t].stop()
        stream = null
        if (typeof opts.onStreamEnd === 'function') opts.onStreamEnd()
      }
      if (audioContext && audioContext.state !== 'closed') {
        try { audioContext.close() } catch (e) { /* already closed */ }
        audioContext = null
      }
      analyser = null
    }

    function setupMicrophone () {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        if (typeof opts.onError === 'function') {
          opts.onError(new Error('Microphone is not available'))
        }
        return
      }
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }).then(function (mediaStream) {
        if (destroyed || !opts.active) {
          var extra = mediaStream.getTracks()
          for (var i = 0; i < extra.length; i++) extra[i].stop()
          return
        }
        stream = mediaStream
        if (typeof opts.onStreamReady === 'function') opts.onStreamReady(mediaStream)
        var Ctor = window.AudioContext || window.webkitAudioContext
        if (!Ctor) {
          if (typeof opts.onError === 'function') opts.onError(new Error('Web Audio is not available'))
          return
        }
        audioContext = new Ctor()
        analyser = audioContext.createAnalyser()
        analyser.fftSize = opts.fftSize
        analyser.smoothingTimeConstant = opts.smoothingTimeConstant
        var source = audioContext.createMediaStreamSource(mediaStream)
        source.connect(analyser)
        history = []
      }).catch(function (error) {
        if (typeof opts.onError === 'function') opts.onError(error)
      })
    }

    function drawBar (ctx, x, y, width, height, radius, color, alpha) {
      ctx.fillStyle = color
      ctx.globalAlpha = alpha
      if (radius > 0 && typeof ctx.roundRect === 'function') {
        ctx.beginPath()
        ctx.roundRect(x, y, width, height, radius)
        ctx.fill()
      } else {
        ctx.fillRect(x, y, width, height)
      }
    }

    function animate (currentTime) {
      if (destroyed) return
      var ctx = canvas.getContext('2d')
      if (!ctx) {
        animationId = window.requestAnimationFrame(animate)
        return
      }
      var rect = canvas.getBoundingClientRect()
      var i
      var value
      var dataIndex
      var barHeight
      var y
      var x

      if (opts.active && currentTime - lastUpdate > opts.updateRate) {
        lastUpdate = currentTime
        if (analyser) {
          var dataArray = new Uint8Array(analyser.frequencyBinCount)
          analyser.getByteFrequencyData(dataArray)
          var startFreq = Math.floor(dataArray.length * 0.05)
          var endFreq = Math.floor(dataArray.length * 0.4)
          var relevantData = dataArray.slice(startFreq, endFreq)
          var count = barCountForWidth(rect.width)
          if (opts.mode === 'static') {
            var halfCount = Math.floor(count / 2)
            var newBars = []
            for (i = halfCount - 1; i >= 0; i--) {
              dataIndex = Math.floor((i / (halfCount || 1)) * relevantData.length)
              value = Math.min(1, (relevantData[dataIndex] / 255) * opts.sensitivity)
              newBars.push(Math.max(0.05, value))
            }
            for (i = 0; i < halfCount; i++) {
              dataIndex = Math.floor((i / (halfCount || 1)) * relevantData.length)
              value = Math.min(1, (relevantData[dataIndex] / 255) * opts.sensitivity)
              newBars.push(Math.max(0.05, value))
            }
            staticBars = newBars
            lastActiveData = newBars.slice()
          } else {
            var sum = 0
            for (i = 0; i < relevantData.length; i++) sum += relevantData[i]
            var average = relevantData.length
              ? (sum / relevantData.length / 255) * opts.sensitivity
              : 0
            history.push(Math.min(1, Math.max(0.05, average)))
            lastActiveData = history.slice()
            padScrollHistory(rect.width)
          }
          needsRedraw = true
        }
      }

      if (!needsRedraw && !opts.active && !opts.processing) {
        animationId = window.requestAnimationFrame(animate)
        return
      }

      needsRedraw = opts.active || opts.processing
      ctx.clearRect(0, 0, rect.width, rect.height)

      var computedBarColor = opts.barColor
      if (!computedBarColor) {
        var style = window.getComputedStyle(container)
        computedBarColor = (style && style.color) || '#5c5c5c'
      }

      var step = opts.barWidth + opts.barGap
      var barCount = Math.floor(rect.width / step)
      var centerY = rect.height / 2

      if (opts.mode === 'static') {
        var dataToRender = staticBars
        for (i = 0; i < barCount && i < dataToRender.length; i++) {
          value = dataToRender[i] || 0.1
          x = i * step
          barHeight = Math.max(opts.barHeight, value * rect.height * 0.8)
          y = centerY - barHeight / 2
          drawBar(ctx, x, y, opts.barWidth, barHeight, opts.barRadius, computedBarColor, 0.4 + value * 0.6)
        }
      } else {
        for (i = 0; i < barCount && i < history.length; i++) {
          var dataIdx = history.length - 1 - i
          value = history[dataIdx] || 0.1
          x = rect.width - (i + 1) * step
          barHeight = Math.max(opts.barHeight, value * rect.height * 0.8)
          y = centerY - barHeight / 2
          drawBar(ctx, x, y, opts.barWidth, barHeight, opts.barRadius, computedBarColor, 0.4 + value * 0.6)
        }
      }

      if (opts.fadeEdges && opts.fadeWidth > 0 && rect.width > 0) {
        if (!gradientCache || lastWidth !== rect.width) {
          var gradient = ctx.createLinearGradient(0, 0, rect.width, 0)
          var fadePercent = Math.min(0.3, opts.fadeWidth / rect.width)
          gradient.addColorStop(0, 'rgba(255,255,255,1)')
          gradient.addColorStop(fadePercent, 'rgba(255,255,255,0)')
          gradient.addColorStop(1 - fadePercent, 'rgba(255,255,255,0)')
          gradient.addColorStop(1, 'rgba(255,255,255,1)')
          gradientCache = gradient
          lastWidth = rect.width
        }
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = gradientCache
        ctx.fillRect(0, 0, rect.width, rect.height)
        ctx.globalCompositeOperation = 'source-over'
      }

      ctx.globalAlpha = 1
      animationId = window.requestAnimationFrame(animate)
    }

    animationId = window.requestAnimationFrame(animate)

    function syncAudio () {
      stopProcessingLoop()
      if (opts.active) {
        setupMicrophone()
        return
      }
      stopTracks()
      if (opts.processing) startProcessingLoop()
      else fadeToIdle()
    }

    function setActive (next) {
      next = !!next
      if (opts.active === next) return
      opts.active = next
      if (next) opts.processing = false
      updateLabel()
      syncAudio()
    }

    function setProcessing (next) {
      next = !!next
      if (opts.processing === next) return
      opts.processing = next
      if (next) opts.active = false
      updateLabel()
      syncAudio()
    }

    function destroy () {
      if (destroyed) return
      destroyed = true
      opts.active = false
      opts.processing = false
      stopProcessingLoop()
      stopTracks()
      if (animationId) window.cancelAnimationFrame(animationId)
      animationId = 0
      if (resizeObserver) resizeObserver.disconnect()
      else window.removeEventListener('resize', resizeCanvas)
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }

    if (opts.active || opts.processing) syncAudio()

    return {
      setActive: setActive,
      setProcessing: setProcessing,
      destroy: destroy
    }
  }

  window.ShLiveWaveform = { mount: mount }
}())
