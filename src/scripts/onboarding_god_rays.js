/* ══════════════════════════════════════════════════════════════════════
   God-rays shader — onboarding landing
   ----------------------------------------------------------------------
   Same settled mount as the inline module at the bottom of
   views/index.html, plus that page's live Controls panel.

   Isolated from Seller Home on purpose:
     • mounts on `[data-onboarding-god-rays]`, never `[data-sh-god-rays]`
     • panel ids are `onboarding-*`, never `#panel`
     • state lives in this module; nothing is written to localStorage
       or to `window.godRays`
     • this file is loaded only by onboarding.html

   There is no composer on this page, so the vertical focal point is
   `focalFallbackPx` measured from the top of the shell — the same
   branch index.html takes on any page without one. The Shape slider
   exposes that key (index.html's panel exposes `focalOffsetPx`
   instead, because that page has a composer).

   Fails soft. If WebGL is unavailable or the CDN is unreachable the
   canvas never mounts, and `.seller-home`'s own background colour is
   what shows — which is why that colour matches the shader's
   `colorBack`.
   ══════════════════════════════════════════════════════════════════════ */

import {
  ShaderMount,
  godRaysFragmentShader,
  getShaderColorFromString as toVec4,
  getShaderNoiseTexture,
  ShaderFitOptions
} from 'https://cdn.jsdelivr.net/npm/@paper-design/shaders@0.0.77/+esm'

const DEFAULTS = {
  colors: ['#148effa6', '#c3defebf', '#c380d1', '#33fff5', '#7ad8fa'],
  colorsCount: 5,
  colorBack: '#ffffff',
  colorBloom: '#ffa8f3',
  bloom: 0.1, intensity: 0.04, density: 0.1, spotty: 0.98,
  midSize: 0.51, midIntensity: 0.08,
  scale: 0.59, rotation: 152, offsetX: 0,
  // Signed distance from the top of the shell down to the convergence
  // point. Tuned via the Controls panel for this page (deeper than
  // index.html's fallback so the rays fan further down the shell).
  focalFallbackPx: 700,
  speed: 1.09, blur: 18,
  wedge: 90, feather: 22,
  hole: 0, holeFeather: 0,
  // No cones cleared — the full circle of rays.
  north: false, east: false, south: false, west: false
}

// key, uniform (null = not a shader uniform), min, max, step
const SLIDERS = [
  ['intensity', 'u_intensity', 0, 1, 0.01],
  ['density', 'u_density', 0, 1, 0.005],
  ['spotty', 'u_spotty', 0, 1, 0.01],
  ['midSize', 'u_midSize', 0, 1, 0.01],
  ['midIntensity', 'u_midIntensity', 0, 1, 0.01],
  ['bloom', 'u_bloom', 0, 1, 0.01],
  ['scale', 'u_scale', 0.1, 4, 0.01],
  ['rotation', 'u_rotation', 0, 360, 1],
  ['offsetX', 'u_offsetX', -1, 1, 0.01],
  ['focalFallbackPx', null, -300, 700, 5],
  ['speed', null, 0, 3, 0.01],
  ['blur', null, 0, 60, 1],
  ['wedge', null, 5, 180, 1],
  ['feather', null, 0, 60, 1],
  ['hole', null, 0, 45, 1],
  ['holeFeather', null, 0, 45, 1]
]

const CONES = [['north', 0], ['east', 90], ['south', 180], ['west', 270]]

const splitHex = (h) => {
  let s = String(h).replace('#', '')
  if (s.length === 3) s = [...s].map((c) => c + c).join('')
  if (s.length === 6) s += 'ff'
  return { rgb: '#' + s.slice(0, 6), a: parseInt(s.slice(6, 8), 16) / 255 }
}
const joinHex = (rgb, a) =>
  rgb + Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0')

function el (tag, className) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

const bg = document.querySelector('[data-onboarding-god-rays]')
const panel = document.getElementById('onboarding-panel')
const errEl = document.getElementById('onboarding-shader-err')

if (bg) {
  const shell = bg.parentElement
  const state = structuredClone(DEFAULTS)

  try {
    let noise
    try { noise = getShaderNoiseTexture(document) } catch { noise = getShaderNoiseTexture() }
    if (!(noise.complete && noise.naturalWidth)) {
      if (typeof noise.decode === 'function') await noise.decode()
      else {
        await new Promise((ok, no) => {
          noise.addEventListener('load', ok, { once: true })
          noise.addEventListener('error', no, { once: true })
        })
      }
    }

    const focalOffsetY = () => {
      const host = bg.getBoundingClientRect()
      if (!host.width || !host.height) return 0

      const fromHostTop =
        (shell.getBoundingClientRect().top - host.top) + state.focalFallbackPx

      return (fromHostTop - host.height / 2) / Math.max(host.width, host.height)
    }

    let offsetY = focalOffsetY()

    const uniformsFor = () => {
      const u = {
        u_noiseTexture: noise,
        u_offsetY: offsetY,
        u_colors: state.colors.map(toVec4),
        u_colorsCount: state.colorsCount,
        u_colorBack: toVec4(state.colorBack),
        u_colorBloom: toVec4(state.colorBloom),
        u_fit: ShaderFitOptions.cover,
        u_originX: 0.5, u_originY: 0.5,
        u_worldWidth: 0, u_worldHeight: 0
      }
      for (const [k, uni] of SLIDERS) if (uni) u[uni] = state[k]
      return u
    }

    const reduce = matchMedia('(prefers-reduced-motion: reduce)')

    const mount = new ShaderMount(
      bg, godRaysFragmentShader, uniformsFor(), undefined,
      reduce.matches ? 0 : state.speed, 0,
      state.blur > 0 ? 1 : 2
    )

    let lastBlur = state.blur

    const focalPct = () => {
      const { width: w, height: h } = bg.getBoundingClientRect()
      if (!w || !h) return { x: 50, y: 50 }
      const longest = Math.max(w, h)
      return {
        x: (0.5 + state.offsetX / (w / longest)) * 100,
        y: (0.5 + offsetY / (h / longest)) * 100
      }
    }

    const applyMask = () => {
      const layers = []
      const on = CONES.filter(([k]) => state[k])
      const { x: cx, y: cy } = focalPct()
      const at = `${cx.toFixed(2)}% ${cy.toFixed(2)}%`

      if (on.length) {
        const centers = on.map(([, deg]) => deg).sort((a, b) => a - b)

        const gapAfter = (i) => {
          const next = centers[(i + 1) % centers.length]
          return ((next - centers[i]) % 360 + 360) % 360 || 360
        }

        let minGap = 360, seam = 0, widest = -1
        for (let i = 0; i < centers.length; i++) {
          const g = gapAfter(i)
          minGap = Math.min(minGap, g)
          if (g > widest) { widest = g; seam = centers[i] + g / 2 }
        }
        const limit = centers.length === 1 ? 179 : minGap / 2 - 0.5
        const w = Math.min(state.wedge, limit)
        const f = Math.min(state.feather, limit - w)

        const stops = [[0, '#000']]
        const rel = centers
          .map((c) => ((c - seam) % 360 + 360) % 360)
          .sort((a, b) => a - b)
        for (const p of rel) {
          stops.push([p - w - f, '#000'], [p - w, 'transparent'],
            [p + w, 'transparent'], [p + w + f, '#000'])
        }
        stops.push([360, '#000'])

        layers.push(`conic-gradient(from ${seam}deg at ${at}, ` +
          stops.map(([d, c]) => `${c} ${d}deg`).join(', ') + ')')
      }

      if (state.hole > 0) {
        const r = state.hole
        const hf = Math.max(state.holeFeather, 0.1)
        layers.push(`radial-gradient(circle at ${at}, transparent 0, transparent ${r}vmin, #000 ${r + hf}vmin)`)
      }

      const img = layers.length ? layers.join(', ') : 'none'
      bg.style.maskImage = img
      bg.style.webkitMaskImage = img
      bg.style.maskComposite = layers.length > 1 ? 'intersect' : 'add'
      bg.style.webkitMaskComposite = layers.length > 1 ? 'source-in' : 'source-over'
    }

    const push = () => {
      offsetY = focalOffsetY()
      mount.setUniforms(uniformsFor())
      mount.setSpeed(reduce.matches ? 0 : state.speed)
      bg.style.filter = `blur(${state.blur}px)`
      applyMask()

      if ((lastBlur > 0) !== (state.blur > 0)) mount.setMinPixelRatio(state.blur > 0 ? 1 : 2)
      lastBlur = state.blur

      if (state.speed === 0 || reduce.matches) { try { mount.requestRender() } catch {} }
    }

    reduce.addEventListener('change', push)

    const syncFocal = () => {
      offsetY = focalOffsetY()
      mount.setUniforms({ u_offsetY: offsetY })
      applyMask()
    }

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(syncFocal)
      ro.observe(bg)
      const column = document.querySelector('.seller-home__main-inner')
      if (column) ro.observe(column)
    }

    // ---- panel ----------------------------------------------------------
    if (panel) {
      const sync = []

      function colorRow (host, label, read, write) {
        const row = el('div', 'onboarding-panel__crow')
        const swatch = el('input')
        swatch.type = 'color'
        const stack = el('div', 'onboarding-panel__stack')
        const hex = el('span', 'onboarding-panel__hex')
        const name = el('span')
        name.textContent = label
        const out = el('span', 'onboarding-panel__val')
        hex.append(name, out)
        const alpha = el('input')
        alpha.type = 'range'
        alpha.min = '0'
        alpha.max = '1'
        alpha.step = '0.01'
        stack.append(hex, alpha)
        row.append(swatch, stack)

        const refresh = () => {
          const { rgb, a } = splitHex(read())
          swatch.value = rgb
          alpha.value = a
          out.textContent = read()
        }
        const change = () => {
          write(joinHex(swatch.value, parseFloat(alpha.value)))
          refresh()
          push()
        }

        swatch.addEventListener('input', change)
        alpha.addEventListener('input', change)
        refresh()
        sync.push(refresh)
        host.appendChild(row)
        return row
      }

      const rayRows = []
      const rayHost = document.getElementById('onboarding-ray-colors')
      for (let i = 0; i < 5; i++) {
        rayRows.push(colorRow(rayHost, `color ${i + 1}`,
          () => state.colors[i], (v) => (state.colors[i] = v)))
      }
      const otherHost = document.getElementById('onboarding-other-colors')
      colorRow(otherHost, 'colorBack', () => state.colorBack, (v) => (state.colorBack = v))
      colorRow(otherHost, 'colorBloom', () => state.colorBloom, (v) => (state.colorBloom = v))

      const dimUnused = () => rayRows.forEach((r, i) =>
        r.classList.toggle('off', i >= state.colorsCount))

      function slider (host, key, min, max, step, after) {
        const row = el('div', 'onboarding-panel__row')
        const lbl = el('span', 'onboarding-panel__lbl')
        const name = el('span')
        name.textContent = key
        const out = el('span', 'onboarding-panel__val')
        lbl.append(name, out)
        const input = el('input')
        input.type = 'range'
        input.min = String(min)
        input.max = String(max)
        input.step = String(step)
        row.append(lbl, input)

        const refresh = () => {
          input.value = state[key]
          out.textContent = state[key]
        }
        input.addEventListener('input', () => {
          state[key] = parseFloat(input.value)
          refresh()
          after?.()
          push()
        })
        refresh()
        sync.push(refresh)
        host.appendChild(row)
      }

      const countRow = document.getElementById('onboarding-count-row')
      slider(countRow.parentElement, 'colorsCount', 1, 5, 1, dimUnused)
      countRow.remove()
      dimUnused()

      const coneHost = document.getElementById('onboarding-cones')
      const coneBtns = {}
      for (const [k] of CONES) {
        const b = el('button', 'onboarding-panel__tog')
        b.type = 'button'
        b.textContent = k
        b.addEventListener('click', () => { state[k] = !state[k]; refreshCones(); push() })
        coneBtns[k] = b
        coneHost.appendChild(b)
      }
      const refreshCones = () => {
        for (const [k] of CONES) coneBtns[k].classList.toggle('on', state[k])
      }
      refreshCones()
      sync.push(refreshCones)

      const rows = document.getElementById('onboarding-rows')
      for (const [k, , min, max, step] of SLIDERS) slider(rows, k, min, max, step)

      document.getElementById('onboarding-panel-toggle').addEventListener('click', () => {
        const closed = panel.classList.toggle('closed')
        for (const id of ['onboarding-panel-copy', 'onboarding-panel-reset']) {
          document.getElementById(id).hidden = closed
        }
      })

      document.getElementById('onboarding-panel-reset').addEventListener('click', () => {
        Object.assign(state, structuredClone(DEFAULTS))
        sync.forEach((f) => f())
        dimUnused()
        push()
      })

      document.getElementById('onboarding-panel-copy').addEventListener('click', async (e) => {
        const q = (v) => (typeof v === 'string' ? `'${v}'` : v)
        const body = Object.keys(DEFAULTS).map((k) => Array.isArray(state[k])
          ? `  ${k}: [${state[k].map(q).join(', ')}],`
          : `  ${k}: ${q(state[k])},`).join('\n')
        await navigator.clipboard.writeText(`const params = {\n${body}\n};`)
        e.target.textContent = 'Copied'
        setTimeout(() => { e.target.textContent = 'Copy' }, 1500)
      })
    }

    push()
  } catch (error) {
    console.warn('[onboarding] god-rays shader did not mount:', error)
    if (errEl) {
      errEl.style.display = 'block'
      errEl.textContent = 'Shader failed to start:\n' + (error?.stack || error)
    }
  }
}
