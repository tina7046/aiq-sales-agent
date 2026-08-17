/* ══════════════════════════════════════════════════════════════════════
   God-rays shader — PROTOTYPE mount
   ----------------------------------------------------------------------
   Puts the same animated background behind the "Your agent at work" lab
   page that Seller Home runs, so the component is judged over the
   surface it will actually sit on rather than flat grey.

   Ported from the inline module at the bottom of views/index.html, with
   the tuning panel and its sliders left behind — the prototype wants the
   settled look, not the controls. Every number in DEFAULTS is copied
   verbatim from there; changing one here changes only this page.

   One real difference: Seller Home anchors the point where the rays
   converge to the chat composer's measured position. There's no composer
   on this page, so it falls back to `focalFallbackPx` measured from the
   top of the shell — the same branch index.html takes on any page
   without one.

   Fails soft. If WebGL is unavailable or the CDN is unreachable the
   canvas never mounts, and `.aaw-lab`'s own background colour is what
   shows — which is why that colour matches the shader's `colorBack`.
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
  bloom: 0, intensity: 0, density: 0.06, spotty: 0.98,
  midSize: 0.51, midIntensity: 0.24,
  scale: 0.71, rotation: 152, offsetX: 0,
  // Signed distance from the top of the shell down to the convergence
  // point. Seller Home measures from its composer instead and keeps this
  // only as a no-composer fallback, where it sits at 415; here it's the
  // only path, and negative parks the focal point above the page so the
  // rays fan down across the list rather than converging inside it.
  focalFallbackPx: -240,
  speed: 1.09, blur: 5,
  wedge: 90, feather: 22,   // angular mask, in degrees — CSS, not a uniform
  hole: 0, holeFeather: 0,  // radial mask hole, in vmin — 0 disables it
  north: true, east: false, south: false, west: false // cones cleared of rays
}

// Which state keys are shader uniforms, and under what name.
const UNIFORMS = {
  intensity: 'u_intensity',
  density: 'u_density',
  spotty: 'u_spotty',
  midSize: 'u_midSize',
  midIntensity: 'u_midIntensity',
  bloom: 'u_bloom',
  scale: 'u_scale',
  rotation: 'u_rotation',
  offsetX: 'u_offsetX'
}

// Cone centres, in conic-gradient degrees (0 = 12 o'clock, clockwise).
const CONES = [['north', 0], ['east', 90], ['south', 180], ['west', 270]]

const state = DEFAULTS
const bg = document.querySelector('[data-aaw-god-rays]')

if (bg) {
  const shell = bg.parentElement

  try {
    // ShaderMount rejects a texture that hasn't decoded, so wait for it.
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

    // Solve for the shader offset that puts the focal point where
    // `focalFallbackPx` asks, in the CURRENT box. Inverts
    // `focalY = h / 2 + offsetY * max(w, h)`.
    //
    // Measured against the host's own rect rather than assumed, which
    // spares this file a duplicated copy of the overscan constant from
    // the stylesheet — the gap is read live.
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
        // Always send all 5 slots (the shader declares vec4 u_colors[5]);
        // u_colorsCount decides how many get used.
        u_colors: state.colors.map(toVec4),
        u_colorsCount: state.colorsCount,
        u_colorBack: toVec4(state.colorBack),
        u_colorBloom: toVec4(state.colorBloom),
        u_fit: ShaderFitOptions.cover,
        u_originX: 0.5, u_originY: 0.5,
        u_worldWidth: 0, u_worldHeight: 0
      }
      for (const key in UNIFORMS) u[UNIFORMS[key]] = state[key]
      return u
    }

    const reduce = matchMedia('(prefers-reduced-motion: reduce)')

    const mount = new ShaderMount(
      bg, godRaysFragmentShader, uniformsFor(), undefined,
      reduce.matches ? 0 : state.speed, 0,
      state.blur > 0 ? 1 : 2 // minPixelRatio
    )

    // Where the rays converge, as percentages of the host, so the mask
    // can be pinned to the focal point instead of the box centre.
    //
    // The shader puts the focal point where its object UV hits zero, and
    // `u_fit: cover` with a 1:1 world ratio makes the object box a square
    // of the canvas's longer side. Both axes then land on the same tidy
    // form: 0.5 + offset / S.
    const focalPct = () => {
      const { width: w, height: h } = bg.getBoundingClientRect()
      if (!w || !h) return { x: 50, y: 50 }
      const longest = Math.max(w, h)
      return {
        x: (0.5 + state.offsetX / (w / longest)) * 100,
        y: (0.5 + offsetY / (h / longest)) * 100
      }
    }

    // A conic mask CLEARS the enabled cones — each becomes a wedge with
    // no rays, ±`wedge` degrees wide — while rays fill everything else.
    // Masking beats overlaying white shapes: it stays transparent, so it
    // works over any background and adds no layer to blur.
    const applyMask = () => {
      const layers = []
      const on = CONES.filter(([k]) => state[k])
      const { x: cx, y: cy } = focalPct()
      const at = `${cx.toFixed(2)}% ${cy.toFixed(2)}%`

      // Nothing cleared means the full circle of rays — no conic layer.
      if (on.length) {
        const centers = on.map(([, deg]) => deg).sort((a, b) => a - b)

        const gapAfter = (i) => {
          const next = centers[(i + 1) % centers.length]
          return ((next - centers[i]) % 360 + 360) % 360 || 360
        }

        // Cleared cones must not merge, so cap the half-extent at half
        // the tightest gap between neighbours.
        let minGap = 360, seam = 0, widest = -1
        for (let i = 0; i < centers.length; i++) {
          const g = gapAfter(i)
          minGap = Math.min(minGap, g)
          if (g > widest) { widest = g; seam = centers[i] + g / 2 }
        }
        const limit = centers.length === 1 ? 179 : minGap / 2 - 0.5
        const w = Math.min(state.wedge, limit)
        const f = Math.min(state.feather, limit - w)

        // Anchoring the seam in the widest gap means no cone straddles
        // the 0/360 boundary, so the stops stay monotonic.
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
      // Layers must intersect, not stack. Safari wants the legacy keyword.
      bg.style.maskComposite = layers.length > 1 ? 'intersect' : 'add'
      bg.style.webkitMaskComposite = layers.length > 1 ? 'source-in' : 'source-over'
    }

    bg.style.filter = `blur(${state.blur}px)`
    applyMask()

    // Re-solve the offset and re-place the mask on it. `setUniforms`
    // renders immediately, so this works even while the animation loop is
    // stopped for reduced motion.
    const syncFocal = () => {
      offsetY = focalOffsetY()
      mount.setUniforms({ u_offsetY: offsetY })
      applyMask()
    }

    reduce.addEventListener('change', () => {
      mount.setSpeed(reduce.matches ? 0 : state.speed)
      if (reduce.matches) { try { mount.requestRender() } catch {} }
    })

    // Re-solve whenever the box or the content column could have moved:
    // a window resize changes the host, and anything that reflows the
    // list changes where the focal point should land relative to it.
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(syncFocal)
      ro.observe(bg)
      const column = document.querySelector('.aaw-lab__inner')
      if (column) ro.observe(column)
    }
  } catch (error) {
    // Leave the host empty; `.aaw-lab`'s background colour stands in.
    console.warn('[aaw] god-rays shader did not mount:', error)
  }
}
