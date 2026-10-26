/* ══════════════════════════════════════════════════════════════════════
   Background shader — /style_lab/agent_at_work.html
   ----------------------------------------------------------------------
   Mounts whichever pick Home's header gear last saved (`sh:shader`),
   falling back to simplex. Tuner panel stays on Home; this page just
   wants the same settled look the feed sits on. Saved presets
   (`sh:shaderState:<name>`) carry over so a Save on Home shows here.

   Fails soft. If WebGL is unavailable or the CDN is unreachable the
   canvas never mounts, and `.aaw-lab`'s own background colour is what
   shows.
   ══════════════════════════════════════════════════════════════════════ */

import {
  ShaderMount,
  godRaysFragmentShader,
  meshGradientFragmentShader,
  staticRadialGradientFragmentShader,
  simplexNoiseFragmentShader,
  getShaderColorFromString as toVec4,
  getShaderNoiseTexture,
  ShaderFitOptions
} from 'https://cdn.jsdelivr.net/npm/@paper-design/shaders@0.0.77/+esm'

const DEFAULT_SHADER = 'simplex'

const loadSavedState = (shader) => {
  try {
    const raw = window.localStorage.getItem('sh:shaderState:' + shader)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const MESH_DEFAULTS = {
  colors: ['#e5edff', '#1f9eff', '#50c2f7', '#8097ff', '#ffc7eb', '#a28fff', '#5cecff', '#c7d2fe', '#e0e7ff', '#f0f9ff'],
  colorsCount: 7,
  distortion: 0.35, swirl: 0.32,
  grainMixer: 0.03, grainOverlay: 0.07,
  speed: 0.08, scale: 1.28, rotation: 32,
  offsetX: -0.12, offsetY: 0.04
}

const RADIAL_DEFAULTS = {
  colors: ['#c2efff85', '#6ac8e7', '#dbeafe', '#bae6fd', '#a5f3fc', '#c7d2fe', '#e0e7ff', '#f0f9ff', '#ecfeff', '#f5f3ff'],
  colorsCount: 2,
  colorBack: '#f0f9ffff',
  radius: 0.75, focalDistance: 0.11, focalAngle: 0,
  falloff: -0.1, mixing: 1,
  distortion: 0, distortionShift: -1, distortionFreq: 9,
  grainMixer: 0, grainOverlay: 0,
  offsetX: 0, offsetY: -0.24
}

const SIMPLEX_DEFAULTS = {
  colors: ['#ffffffff', '#e0edff12', '#fbe5ff12', '#dcb8ff12', '#3df2ff12', '#00aaff12', '#4d4dff12', '#ce6bff12', '#ff00aa12', '#ff52bf12'],
  colorsCount: 10,
  stepsPerColor: 10, softness: 1,
  speed: 2.4, scale: 4, rotation: 0,
  offsetX: 0, offsetY: 0
}

const GODRAYS_DEFAULTS = {
  colors: ['#148effa6', '#c3defebf', '#c380d1', '#33fff5', '#7ad8fa'],
  colorsCount: 5,
  colorBack: '#ffffff',
  colorBloom: '#ffa8f3',
  bloom: 0, intensity: 0, density: 0.06, spotty: 0.98,
  midSize: 0.51, midIntensity: 0.24,
  scale: 0.71, rotation: 152, offsetX: 0, offsetY: 0,
  speed: 1.09, blur: 5
}

const padPalette = (state, n, fill = '#ffffffff') => {
  while (state.colors.length < n) state.colors.push(fill)
  state.colors.length = n
}

const bg = document.querySelector('[data-aaw-shader-host]')
if (!bg) { /* page chrome missing — nothing to mount */ }
else {
  let storedShader = null
  try { storedShader = window.localStorage.getItem('sh:shader') } catch { /* private mode */ }
  const ACTIVE_SHADER = new URLSearchParams(location.search).get('shader') || storedShader || DEFAULT_SHADER
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')

  try {
    if (ACTIVE_SHADER === 'mesh') {
      const state = { ...MESH_DEFAULTS, ...(loadSavedState('mesh') || {}) }
      padPalette(state, 10)
      const uniforms = () => ({
        u_colors: state.colors.map(toVec4),
        u_colorsCount: state.colorsCount,
        u_distortion: state.distortion,
        u_swirl: state.swirl,
        u_grainMixer: state.grainMixer,
        u_grainOverlay: state.grainOverlay,
        u_scale: state.scale,
        u_rotation: state.rotation,
        u_offsetX: state.offsetX,
        u_offsetY: state.offsetY,
        u_fit: ShaderFitOptions.cover,
        u_originX: 0.5, u_originY: 0.5,
        u_worldWidth: 0, u_worldHeight: 0
      })
      const mount = new ShaderMount(
        bg, meshGradientFragmentShader, uniforms(), undefined,
        reduce.matches ? 0 : state.speed, 0
      )
      reduce.addEventListener('change', () => {
        mount.setUniforms(uniforms())
        mount.setSpeed(reduce.matches ? 0 : state.speed)
        if (state.speed === 0 || reduce.matches) {
          try { mount.requestRender() } catch {}
        }
      })
    } else if (ACTIVE_SHADER === 'radial') {
      const state = { ...RADIAL_DEFAULTS, ...(loadSavedState('radial') || {}) }
      padPalette(state, 10)
      const uniforms = () => ({
        u_colorBack: toVec4(state.colorBack),
        u_colors: state.colors.map(toVec4),
        u_colorsCount: state.colorsCount,
        u_radius: state.radius,
        u_focalDistance: state.focalDistance,
        u_focalAngle: state.focalAngle,
        u_falloff: state.falloff,
        u_mixing: state.mixing,
        u_distortion: state.distortion,
        u_distortionShift: state.distortionShift,
        u_distortionFreq: state.distortionFreq,
        u_grainMixer: state.grainMixer,
        u_grainOverlay: state.grainOverlay,
        u_fit: ShaderFitOptions.cover,
        u_scale: 1, u_rotation: 0,
        u_offsetX: state.offsetX, u_offsetY: state.offsetY,
        u_originX: 0.5, u_originY: 0.5,
        u_worldWidth: 0, u_worldHeight: 0
      })
      const mount = new ShaderMount(bg, staticRadialGradientFragmentShader, uniforms(), undefined, 0, 0)
      try { mount.requestRender() } catch {}
    } else if (ACTIVE_SHADER === 'simplex') {
      const state = { ...SIMPLEX_DEFAULTS, ...(loadSavedState('simplex') || {}) }
      padPalette(state, 10)
      const uniforms = () => ({
        u_colors: state.colors.map(toVec4),
        u_colorsCount: state.colorsCount,
        u_stepsPerColor: state.stepsPerColor,
        u_softness: state.softness,
        u_scale: state.scale,
        u_rotation: state.rotation,
        u_offsetX: state.offsetX,
        u_offsetY: state.offsetY,
        u_fit: ShaderFitOptions.cover,
        u_originX: 0.5, u_originY: 0.5,
        u_worldWidth: 0, u_worldHeight: 0
      })
      const mount = new ShaderMount(
        bg, simplexNoiseFragmentShader, uniforms(), undefined,
        reduce.matches ? 0 : state.speed, 0
      )
      reduce.addEventListener('change', () => {
        mount.setUniforms(uniforms())
        mount.setSpeed(reduce.matches ? 0 : state.speed)
        if (state.speed === 0 || reduce.matches) {
          try { mount.requestRender() } catch {}
        }
      })
    } else {
      const state = { ...GODRAYS_DEFAULTS, ...(loadSavedState('godrays') || {}) }
      padPalette(state, 5)
      let noise
      try { noise = getShaderNoiseTexture(document) } catch { noise = getShaderNoiseTexture() }
      const wait = (!(noise.complete && noise.naturalWidth))
        ? (typeof noise.decode === 'function'
          ? noise.decode()
          : new Promise((ok, no) => {
            noise.addEventListener('load', ok, { once: true })
            noise.addEventListener('error', no, { once: true })
          }))
        : Promise.resolve()

      wait.then(() => {
        const uniforms = () => ({
          u_noiseTexture: noise,
          u_offsetY: state.offsetY,
          u_colors: state.colors.map(toVec4),
          u_colorsCount: state.colorsCount,
          u_colorBack: toVec4(state.colorBack),
          u_colorBloom: toVec4(state.colorBloom),
          u_intensity: state.intensity,
          u_density: state.density,
          u_spotty: state.spotty,
          u_midSize: state.midSize,
          u_midIntensity: state.midIntensity,
          u_bloom: state.bloom,
          u_scale: state.scale,
          u_rotation: state.rotation,
          u_offsetX: state.offsetX,
          u_fit: ShaderFitOptions.cover,
          u_originX: 0.5, u_originY: 0.5,
          u_worldWidth: 0, u_worldHeight: 0
        })
        const mount = new ShaderMount(
          bg, godRaysFragmentShader, uniforms(), undefined,
          reduce.matches ? 0 : state.speed, 0,
          state.blur > 0 ? 1 : 2
        )
        bg.style.filter = `blur(${state.blur}px)`
        reduce.addEventListener('change', () => {
          mount.setUniforms(uniforms())
          mount.setSpeed(reduce.matches ? 0 : state.speed)
          if (state.speed === 0 || reduce.matches) {
            try { mount.requestRender() } catch {}
          }
        })
      }).catch((error) => {
        console.warn('[aaw] god-rays shader did not mount:', error)
      })
    }
  } catch (error) {
    console.warn('[aaw] shader did not mount:', error)
  }
}
