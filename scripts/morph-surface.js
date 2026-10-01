/**
 * MorphSurface — reusable GSAP-driven surface morph with content crossfade.
 *
 * Animates an element between named dimension states (width, height, borderRadius)
 * and provides fade/crossfade helpers for swapping inner content panels.
 *
 * Requires GSAP 3.x on the global `gsap` object.
 *
 * @example
 *   const morph = new MorphSurface(el, {
 *     states: {
 *       pill:     { width: 'auto', height: 44, borderRadius: 22 },
 *       expanded: { width: 360,    height: 400, borderRadius: 14 },
 *     },
 *     duration: 0.25,
 *     ease: 'power2.out',
 *     fadeInDuration:  0.25,
 *     fadeInEase:      'power2.out',
 *     fadeOutDuration: 0.15,
 *     fadeOutEase:     'power1.out',
 *   });
 *
 *   morph.morphTo('expanded');
 *   morph.crossfade(panelA, panelB);
 */

const DEFAULTS = {
  duration: 0.25,
  ease: "power2.out",
  fadeInDuration: 0.25,
  fadeInEase: "power2.out",
  fadeOutDuration: 0.15,
  fadeOutEase: "power1.out",
};

export class MorphSurface {
  /**
   * @param {HTMLElement} surfaceEl  The element whose dimensions morph.
   * @param {object}      config
   * @param {object}      config.states       Map of state names to { width, height, borderRadius }.
   * @param {number}     [config.duration]     Morph duration in seconds.
   * @param {string}     [config.ease]         GSAP ease for the morph.
   * @param {number}     [config.fadeInDuration]
   * @param {string}     [config.fadeInEase]
   * @param {number}     [config.fadeOutDuration]
   * @param {string}     [config.fadeOutEase]
   */
  constructor(surfaceEl, config = {}) {
    this.el = surfaceEl;
    this.states = config.states || {};
    this.cfg = { ...DEFAULTS, ...config };
    this._morphTween = null;
    this._fadeTweens = new Set();
    this.currentState = null;
  }

  /**
   * Animate the surface to a named state's dimensions.
   * @param {string} stateName
   * @param {object} [opts]           Per-call overrides.
   * @param {number} [opts.duration]
   * @param {string} [opts.ease]
   * @param {number} [opts.delay]
   * @param {function} [opts.onComplete]
   * @returns {gsap.core.Tween}
   */
  morphTo(stateName, opts = {}) {
    const state = this.states[stateName];
    if (!state) throw new Error(`MorphSurface: unknown state "${stateName}"`);

    if (this._morphTween) this._morphTween.kill();

    const vars = {
      duration: opts.duration ?? this.cfg.duration,
      ease: opts.ease ?? this.cfg.ease,
    };
    if (opts.delay != null) vars.delay = opts.delay;
    if (opts.onComplete) vars.onComplete = opts.onComplete;

    if (state.width != null) vars.width = state.width;
    if (state.height != null) vars.height = state.height;
    if (state.borderRadius != null) vars.borderRadius = state.borderRadius;

    this._morphTween = gsap.to(this.el, vars);
    this.currentState = stateName;
    return this._morphTween;
  }

  /**
   * Fade an element in (opacity 0 → 1).
   * @param {HTMLElement|HTMLElement[]} el
   * @param {object} [opts]
   * @returns {gsap.core.Tween}
   */
  fadeIn(el, opts = {}) {
    const tw = gsap.to(el, {
      opacity: 1,
      duration: opts.duration ?? this.cfg.fadeInDuration,
      ease: opts.ease ?? this.cfg.fadeInEase,
      delay: opts.delay ?? 0,
      onComplete: opts.onComplete,
    });
    this._fadeTweens.add(tw);
    tw.then(() => this._fadeTweens.delete(tw));
    return tw;
  }

  /**
   * Fade an element out (opacity → 0).
   * @param {HTMLElement|HTMLElement[]} el
   * @param {object} [opts]
   * @returns {gsap.core.Tween}
   */
  fadeOut(el, opts = {}) {
    const tw = gsap.to(el, {
      opacity: 0,
      duration: opts.duration ?? this.cfg.fadeOutDuration,
      ease: opts.ease ?? this.cfg.fadeOutEase,
      delay: opts.delay ?? 0,
      onComplete: opts.onComplete,
    });
    this._fadeTweens.add(tw);
    tw.then(() => this._fadeTweens.delete(tw));
    return tw;
  }

  /**
   * Crossfade: fade out one element while fading in another, in parallel.
   * @param {HTMLElement|HTMLElement[]} outEl
   * @param {HTMLElement|HTMLElement[]} inEl
   * @param {object} [opts]
   * @returns {gsap.core.Timeline}
   */
  crossfade(outEl, inEl, opts = {}) {
    const tl = gsap.timeline({ delay: opts.delay ?? 0 });

    tl.to(outEl, {
      opacity: 0,
      duration: opts.fadeOutDuration ?? this.cfg.fadeOutDuration,
      ease: opts.fadeOutEase ?? this.cfg.fadeOutEase,
    }, 0);

    tl.to(inEl, {
      opacity: 1,
      duration: opts.fadeInDuration ?? this.cfg.fadeInDuration,
      ease: opts.fadeInEase ?? this.cfg.fadeInEase,
    }, 0);

    if (opts.onComplete) tl.call(opts.onComplete);

    this._fadeTweens.add(tl);
    tl.then(() => this._fadeTweens.delete(tl));
    return tl;
  }

  /**
   * Kill only the in-flight surface morph tween, leaving fades running.
   */
  killMorph() {
    if (this._morphTween) {
      this._morphTween.kill();
      this._morphTween = null;
    }
  }

  /**
   * Kill all in-flight morph and fade tweens.
   */
  kill() {
    this.killMorph();
    for (const tw of this._fadeTweens) tw.kill();
    this._fadeTweens.clear();
  }
}
