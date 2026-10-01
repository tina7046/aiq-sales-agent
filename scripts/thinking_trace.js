/*
 * ThinkingTrace — reusable "agent at work" reasoning-trace component
 * =====================================================================
 * A config-driven simulation, extracted from the flat running-lab. Renders
 * a streaming first-person narrative over an accordion of steps (each with
 * a spinner that settles to a check, a cycling label, and expandable
 * sub-steps), then folds into a completed header with a closing summary.
 *
 * Usage:
 *   var api = ThinkingTrace.mount(container, {
 *     completedLabel: "Worked for 2 hours",
 *     finalSummary:   "All done — …",
 *     steps: [
 *       { narrative, icon, label, count, cycle:[…],
 *         substeps: [ { img|source|icon, label }, … ] }, …
 *     ],
 *     timings: { leadMs, stepGapMs, totalMs /* or stepMs *\/ },
 *     controls: true,        // render skip / pause / restart (default true)
 *     autoCollapse: true,    // fold into completed header on finish (default true)
 *     onComplete: function (api) { … reveal page-owned result … },
 *   });
 *   // api => { restart, skip, pause, resume, destroy, el }
 *
 * Depends on app globals: window.ShStream (conversation_stream.js) and the
 * index.css utilities (.sh-spinner, .t-stream-w, .t-text-swap, sh-typing-sweep).
 */
(function () {
  "use strict";

  var SPRITE = "/aiq-sales-agent/assets/icons/utility-sprite/svg/symbols.svg";
  var SOURCE_ICON_BASE = "/aiq-sales-agent/assets/images/source_icons/";
  var SOURCE_ICONS = {
    "6sense": "source_6sense.svg",
    Apollo: "source_apollo.svg",
    Demandbase: "source_demandbase.svg",
    G2: "source_g2.svg",
    Gmail: "source_gmail.svg",
    Gong: "source_gong.svg",
    LinkedIn: "conn_linkedin.png",
    "Moody\u2019s": "source_moodys.svg",
    Salesforce: "source_salesforce.svg",
    SalesIntel: "source_salesintel.svg",
    Slack: "source_slack.svg",
    Web: "source_web.svg",
    ZoomInfo: "source_zoominfo.svg",
  };

  var CHECK_SVG =
    '<svg class="thinking-trace__check" aria-hidden="true"><use xlink:href="' + SPRITE + '#success"></use></svg>';
  var CHEVRON_SVG =
    '<svg aria-hidden="true"><use xlink:href="' + SPRITE + '#chevronright"></use></svg>';

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseCount(str) {
    var raw = str == null ? "" : String(str);
    var m = raw.match(/^\s*(\d[\d,]*)\s*(.*)$/);
    if (!m) return { target: null, suffix: "", raw: raw };
    return {
      target: parseInt(m[1].replace(/,/g, ""), 10),
      suffix: m[2] ? " " + m[2] : "",
      raw: raw,
    };
  }

  // ── Icon markup for a sub-step: custom raster (mask-tinted), source
  //    brand logo, or utility-sprite glyph. ───────────────────────────
  function substepIconHtml(sub) {
    if (sub.img) {
      return (
        '<span class="thinking-trace__icon thinking-trace__icon--source" title="' + esc(sub.label) + '">' +
        '<span class="thinking-trace__mask-img" style="-webkit-mask-image:url(' + esc(sub.img) + ');mask-image:url(' + esc(sub.img) + ')" aria-hidden="true"></span>' +
        '<span class="slds-assistive-text">' + esc(sub.label) + "</span></span>"
      );
    }
    if (sub.source) {
      var srcFile = SOURCE_ICONS[sub.source] || SOURCE_ICONS.Salesforce;
      return (
        '<span class="thinking-trace__icon thinking-trace__icon--source" title="' + esc(sub.label) + '">' +
        '<img class="thinking-trace__source-img" src="' + SOURCE_ICON_BASE + srcFile + '" alt="" aria-hidden="true">' +
        '<span class="slds-assistive-text">' + esc(sub.source) + "</span></span>"
      );
    }
    return (
      '<span class="thinking-trace__icon thinking-trace__icon--glyph" title="' + esc(sub.label) + '">' +
      '<svg class="thinking-trace__glyph" aria-hidden="true"><use xlink:href="' + SPRITE + "#" + esc(sub.icon || "record") + '"></use></svg>' +
      '<span class="slds-assistive-text">' + esc(sub.label) + "</span></span>"
    );
  }

  function substepsHtml(substeps) {
    if (!substeps || !substeps.length) return "";
    var rows = substeps.map(function (sub) {
      return (
        '<div class="thinking-trace__row thinking-trace__substep is-done">' +
        substepIconHtml(sub) +
        '<p class="thinking-trace__label" title="' + esc(sub.label) + '">' + esc(sub.label) + "</p>" +
        "</div>"
      );
    });
    return '<div class="thinking-trace__substeps">' + rows.join("") + "</div>";
  }

  function mount(container, config) {
    if (!container) return null;
    config = config || {};
    var steps = (config.steps || []).slice();
    if (!steps.length) return null;

    var reduceMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var controlsOn = config.controls !== false;
    var autoCollapse = config.autoCollapse !== false;
    var onComplete = typeof config.onComplete === "function" ? config.onComplete : null;
    // Static label if provided; otherwise the header shows the real elapsed
    // time ("Worked for 12s") computed at finish.
    var completedLabel = config.completedLabel || null;

    var timings = config.timings || {};
    var stepGapMs = timings.stepGapMs != null ? timings.stepGapMs : 200;
    var leadMs = timings.leadMs != null ? timings.leadMs : 500;
    var totalMs = timings.totalMs || 40000;
    var stepDurMs = timings.stepMs
      ? timings.stepMs
      : Math.max(1200, Math.round((totalMs - leadMs) / steps.length - stepGapMs));

    var clamp = function (v, lo, hi) {
      return v < lo ? lo : v > hi ? hi : v;
    };

    // ── Build DOM ──────────────────────────────────────────────────
    var controlsHtml = controlsOn
      ? '<div class="thinking-trace__controls">' +
        '<button type="button" class="slds-button slds-button_neutral" data-tt-skip title="Skip to complete">Skip to complete</button>' +
        '<button type="button" class="slds-button slds-button_icon slds-button_icon-border-filled thinking-trace__pause" data-tt-pause title="Pause run" aria-label="Pause run" hidden>' +
        '<svg class="slds-button__icon" aria-hidden="true" data-tt-pause-icon><use xlink:href="' + SPRITE + '#pause"></use></svg>' +
        "</button>" +
        '<button type="button" class="slds-button slds-button_icon slds-button_icon-border-filled thinking-trace__restart" data-tt-restart title="Restart run" aria-label="Restart run" hidden>' +
        '<svg class="slds-button__icon" aria-hidden="true"><use xlink:href="' + SPRITE + '#refresh"></use></svg>' +
        "</button>" +
        "</div>"
      : "";

    container.innerHTML =
      controlsHtml +
      '<div class="thinking-trace" data-tt-root>' +
        '<button type="button" class="thinking-trace__head" data-tt-head aria-expanded="true">' +
          '<span class="thinking-trace__heading">' +
            '<span class="thinking-trace__toggle-icon" aria-hidden="true">' +
              '<svg class="thinking-trace__chevron"><use xlink:href="' + SPRITE + '#chevronright"></use></svg>' +
            "</span>" +
            '<span class="thinking-trace__status" data-tt-status>Working for 0s</span>' +
          "</span>" +
        "</button>" +
        '<p class="thinking-trace__narrative" data-tt-narrative></p>' +
        '<div class="thinking-trace__steps" data-tt-steps></div>' +
        '<p class="thinking-trace__final" data-tt-final hidden></p>' +
      "</div>";

    var box = container.querySelector("[data-tt-root]");
    var headEl = container.querySelector("[data-tt-head]");
    var statusEl = container.querySelector("[data-tt-status]");
    var narrativeEl = container.querySelector("[data-tt-narrative]");
    var stepsEl = container.querySelector("[data-tt-steps]");
    var finalEl = container.querySelector("[data-tt-final]");
    var pauseBtn = container.querySelector("[data-tt-pause]");
    var restartBtn = container.querySelector("[data-tt-restart]");
    var skipBtn = container.querySelector("[data-tt-skip]");

    // ── The single in-flight scheduled beat (pause-aware) ──────────
    var step = null; // { fn, ms, start, id, remaining }
    var schedule = function (fn, ms) {
      step = { fn: fn, ms: ms, start: Date.now(), id: null, remaining: ms };
      step.id = setTimeout(function () {
        step = null;
        fn();
      }, ms);
    };
    var clearStep = function () {
      if (step && step.id) clearTimeout(step.id);
      step = null;
    };

    // ── Elapsed-time counter ───────────────────────────────────────
    var timerId = null;
    var timerStart = 0;
    // Compact elapsed: "1s" / "45s" → "3m 2s" → "1h 23m 1s". Always shows
    // down to seconds; minutes appear once there's a minute, hours once
    // there's an hour.
    var fmt = function (total) {
      total = Math.max(0, Math.floor(total));
      var h = Math.floor(total / 3600);
      var m = Math.floor((total % 3600) / 60);
      var s = total % 60;
      if (h > 0) return h + "h " + m + "m " + s + "s";
      if (m > 0) return m + "m " + s + "s";
      return s + "s";
    };
    var runElapsedSec = function () {
      return Math.floor((Date.now() - timerStart) / 1000);
    };
    var runElapsedMs = function () {
      return Date.now() - timerStart;
    };
    var tick = function () {
      if (statusEl) statusEl.textContent = "Working for " + fmt(runElapsedSec());
    };
    var startInterval = function () {
      if (timerId) clearInterval(timerId);
      tick();
      timerId = setInterval(tick, 1000);
    };
    var startTimer = function () {
      timerStart = Date.now();
      startInterval();
    };
    var stopTimer = function () {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    // ── Text swap (cycling label) ──────────────────────────────────
    var swapDur = (function () {
      var raw = getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur");
      var n = parseFloat(raw);
      if (!n) return 150;
      if (String(raw).indexOf("ms") === -1 && String(raw).indexOf("s") !== -1) return n * 1000;
      return n;
    })();
    var cancelSwap = function (el) {
      if (!el) return;
      if (el._ttSwapTimer) {
        clearTimeout(el._ttSwapTimer);
        el._ttSwapTimer = null;
      }
      el.classList.remove("is-exit", "is-enter-start");
    };
    var applyLabel = function (el, str) {
      el.textContent = str;
      if (el.hasAttribute("data-text")) el.setAttribute("data-text", str);
    };
    var swapText = function (el, next) {
      if (!el) return;
      var nextStr = next == null ? "" : String(next);
      if (el.textContent === nextStr) return;
      if (reduceMotion) {
        cancelSwap(el);
        applyLabel(el, nextStr);
        return;
      }
      cancelSwap(el);
      el.classList.add("is-exit");
      el._ttSwapTimer = setTimeout(function () {
        el._ttSwapTimer = null;
        applyLabel(el, nextStr);
        el.classList.remove("is-exit");
        el.classList.add("is-enter-start");
        void el.offsetHeight;
        el.classList.remove("is-enter-start");
      }, swapDur);
    };

    // ── Streaming reasoning narrative (replace model) ──────────────
    var narrativeSpans = [];
    var narrativeIdx = 0;
    var narrativeTimer = null;
    var narrativeDone = null;
    var wordGapMs =
      window.ShStream && typeof window.ShStream.gapMs === "function"
        ? window.ShStream.gapMs()
        : 60;
    var clearNarrativeTimer = function () {
      if (narrativeTimer) {
        clearTimeout(narrativeTimer);
        narrativeTimer = null;
      }
    };
    var fireNarrativeDone = function () {
      if (narrativeDone) {
        var cb = narrativeDone;
        narrativeDone = null;
        cb();
      }
    };
    var revealNextWord = function () {
      if (narrativeIdx >= narrativeSpans.length) {
        narrativeTimer = null;
        fireNarrativeDone();
        return;
      }
      var span = narrativeSpans[narrativeIdx];
      span.style.display = "";
      void span.offsetWidth; // eslint-disable-line no-unused-expressions
      span.classList.add("is-in");
      narrativeIdx++;
      narrativeTimer = setTimeout(revealNextWord, wordGapMs);
    };
    var streamNarrative = function (text, onDone) {
      if (!narrativeEl) return;
      clearNarrativeTimer();
      narrativeSpans = [];
      narrativeIdx = 0;
      narrativeDone = onDone || null;
      var txt = text == null ? "" : String(text);
      narrativeEl.textContent = txt;
      if (!txt) {
        fireNarrativeDone();
        return;
      }
      if (window.ShStream && typeof window.ShStream.wrapWords === "function") {
        narrativeSpans = window.ShStream.wrapWords(narrativeEl, []);
      }
      if (reduceMotion || !narrativeSpans.length) {
        narrativeSpans.forEach(function (s) {
          s.classList.add("is-in");
        });
        narrativeIdx = narrativeSpans.length;
        fireNarrativeDone();
        return;
      }
      narrativeSpans.forEach(function (s) {
        s.style.display = "none";
      });
      revealNextWord();
    };

    // ── Step row rendering ─────────────────────────────────────────
    var renderStep = function (stepData) {
      if (!stepsEl) return null;
      var count = parseCount(stepData.count);
      var cyc = stepData.cycle && stepData.cycle.length ? stepData.cycle : null;
      var firstLabel = cyc ? cyc[0] : stepData.label || "";
      var wrap = document.createElement("div");
      wrap.className = "thinking-trace__step is-active";
      wrap.innerHTML =
        '<div class="thinking-trace__step-head" role="status" aria-expanded="false">' +
          '<span class="thinking-trace__icon thinking-trace__icon--swap" title="' + esc(stepData.label) + '">' +
            '<span class="thinking-trace__spinner sh-spinner" aria-hidden="true"></span>' +
            '<span class="thinking-trace__mark" aria-hidden="true">' + CHECK_SVG + "</span>" +
            '<span class="thinking-trace__step-chevron" aria-hidden="true">' + CHEVRON_SVG + "</span>" +
            '<span class="slds-assistive-text">' + esc(stepData.label) + "</span>" +
          "</span>" +
          '<p class="thinking-trace__label t-text-swap" data-tt-step-label data-text="' + esc(firstLabel) + '" title="' + esc(stepData.label) + '">' + esc(firstLabel) + "</p>" +
        "</div>" +
        '<div class="thinking-trace__step-body">' + substepsHtml(stepData.substeps) + "</div>";
      stepsEl.appendChild(wrap);
      if (!reduceMotion) {
        wrap.style.opacity = "0";
        window.requestAnimationFrame(function () {
          wrap.style.transition = "opacity 260ms ease";
          wrap.style.opacity = "1";
        });
      }
      return {
        wrap: wrap,
        labelEl: wrap.querySelector("[data-tt-step-label]"),
        countEl: wrap.querySelector("[data-tt-step-count]"),
        cycle: cyc,
        count: count,
        label: stepData.label || "",
        _i: -1,
      };
    };

    // ── Active-row visuals (count-up + micro-text cycle) ───────────
    var curStep = null;
    var stepStartMs = 0;
    var stepTicker = null;
    var clearStepTicker = function () {
      if (stepTicker) {
        clearInterval(stepTicker);
        stepTicker = null;
      }
    };
    var renderCurrentStepProgress = function () {
      if (!curStep) return;
      var p = clamp((runElapsedMs() - stepStartMs) / stepDurMs, 0, 1);
      if (curStep.count.target != null && curStep.countEl) {
        curStep.countEl.textContent = Math.round(curStep.count.target * p) + curStep.count.suffix;
      }
      if (curStep.cycle && curStep.cycle.length && curStep.labelEl) {
        var i = Math.min(Math.floor(p * curStep.cycle.length), curStep.cycle.length - 1);
        if (i !== curStep._i) {
          curStep._i = i;
          swapText(curStep.labelEl, curStep.cycle[i]);
        }
      }
    };
    var startStepTicker = function () {
      clearStepTicker();
      renderCurrentStepProgress();
      stepTicker = setInterval(renderCurrentStepProgress, 50);
    };
    var settleStep = function () {
      clearStepTicker();
      if (!curStep) return;
      if (curStep.labelEl) swapText(curStep.labelEl, curStep.label || "");
      if (curStep.countEl) {
        curStep.countEl.textContent =
          curStep.count.target != null
            ? curStep.count.target + curStep.count.suffix
            : curStep.count.raw || "";
      }
      if (curStep.wrap) {
        curStep.wrap.classList.remove("is-active");
        curStep.wrap.classList.add("is-done");
      }
      curStep = null;
    };

    // ── Pause / Resume ─────────────────────────────────────────────
    var paused = false;
    var pausedElapsed = 0;
    var updatePauseBtn = function () {
      if (!pauseBtn) return;
      var use = pauseBtn.querySelector("[data-tt-pause-icon] use");
      var glyph = paused ? "play" : "pause";
      var label = paused ? "Resume run" : "Pause run";
      if (use) {
        var href = SPRITE + "#" + glyph;
        use.setAttribute("xlink:href", href);
        use.setAttribute("href", href);
      }
      pauseBtn.setAttribute("title", label);
      pauseBtn.setAttribute("aria-label", label);
    };
    var pauseRun = function () {
      if (paused) return;
      paused = true;
      stopTimer();
      clearNarrativeTimer();
      clearStepTicker();
      pausedElapsed = timerStart ? Date.now() - timerStart : 0;
      if (step && step.id) {
        clearTimeout(step.id);
        step.remaining = Math.max(0, step.ms - (Date.now() - step.start));
        step.id = null;
      }
      if (box) box.classList.add("is-paused");
      updatePauseBtn();
    };
    var resumeRun = function () {
      if (!paused) return;
      paused = false;
      timerStart = Date.now() - pausedElapsed;
      startInterval();
      if (narrativeIdx < narrativeSpans.length) revealNextWord();
      if (curStep) startStepTicker();
      if (step && step.fn && step.id === null) {
        schedule(step.fn, step.remaining);
      }
      if (box) box.classList.remove("is-paused");
      updatePauseBtn();
    };

    // ── Header collapse toggle + step expand delegation ────────────
    var onHeadClick = function () {
      var collapsed = box.classList.toggle("is-collapsed");
      headEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
    };
    if (headEl) headEl.addEventListener("click", onHeadClick);

    var onStepsClick = function (e) {
      var head = e.target.closest && e.target.closest(".thinking-trace__step-head");
      if (!head || !stepsEl.contains(head)) return;
      var wrap = head.parentNode;
      if (!wrap || wrap.className.indexOf("is-done") === -1) return; // only once done
      var expanded = wrap.classList.toggle("is-expanded");
      head.setAttribute("aria-expanded", expanded ? "true" : "false");
    };
    if (stepsEl) stepsEl.addEventListener("click", onStepsClick);

    // ── Playback ───────────────────────────────────────────────────
    var ti = 0;
    var finishCollapseTimer = null;
    var resultRevealTimer = null;
    var clearFinishTimers = function () {
      if (finishCollapseTimer) {
        clearTimeout(finishCollapseTimer);
        finishCollapseTimer = null;
      }
      if (resultRevealTimer) {
        clearTimeout(resultRevealTimer);
        resultRevealTimer = null;
      }
    };

    var revealFinal = function () {
      if (!finalEl || !config.finalSummary) return;
      finalEl.textContent = config.finalSummary;
      finalEl.hidden = false;
      if (!reduceMotion) {
        finalEl.style.opacity = "0";
        window.requestAnimationFrame(function () {
          finalEl.style.transition = "opacity 300ms ease";
          finalEl.style.opacity = "1";
        });
      }
    };

    var finish = function () {
      clearStep();
      clearStepTicker();
      stopTimer();
      clearNarrativeTimer();
      narrativeDone = null;
      if (curStep) settleStep();
      paused = false;
      if (box) box.classList.remove("is-paused", "is-collapsed");
      if (statusEl) statusEl.textContent = completedLabel || ("Worked for " + fmt(runElapsedSec()));
      if (box) box.classList.add("is-complete");
      if (headEl) headEl.setAttribute("aria-expanded", "true");
      if (pauseBtn) pauseBtn.hidden = true;
      if (restartBtn) restartBtn.hidden = false;

      // After a beat: fold into the completed header (if autoCollapse),
      // reveal the closing line, then hand off to onComplete so the page
      // can continue its own thread (e.g. a result table).
      clearFinishTimers();
      finishCollapseTimer = setTimeout(function () {
        finishCollapseTimer = null;
        if (autoCollapse) {
          if (box) box.classList.add("is-collapsed");
          if (headEl) headEl.setAttribute("aria-expanded", "false");
        }
        revealFinal();
        resultRevealTimer = setTimeout(function () {
          resultRevealTimer = null;
          if (onComplete) onComplete(api);
        }, 550);
      }, autoCollapse ? 800 : 200);
    };

    var playTask = function () {
      var t = steps[ti];
      if (!t) {
        finish();
        return;
      }
      streamNarrative(t.narrative || "", function () {
        curStep = renderStep(t);
        stepStartMs = runElapsedMs();
        startStepTicker();
        if (curStep && curStep.wrap && curStep.wrap.scrollIntoView) {
          curStep.wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        schedule(function () {
          settleStep();
          ti++;
          if (ti < steps.length) schedule(playTask, stepGapMs);
          else finish();
        }, stepDurMs);
      });
    };

    var skipToComplete = function () {
      clearStep();
      clearStepTicker();
      clearNarrativeTimer();
      narrativeDone = null;
      stopTimer();
      curStep = null;
      paused = false;
      pausedElapsed = 0;

      if (stepsEl) stepsEl.innerHTML = "";
      steps.forEach(function (t) {
        var refs = renderStep(t);
        if (!refs) return;
        if (refs.labelEl) {
          cancelSwap(refs.labelEl);
          applyLabel(refs.labelEl, refs.label || "");
        }
        if (refs.countEl) {
          refs.countEl.textContent =
            refs.count.target != null
              ? refs.count.target + refs.count.suffix
              : refs.count.raw || "";
        }
        refs.wrap.classList.remove("is-active");
        refs.wrap.classList.add("is-done");
      });
      if (narrativeEl) narrativeEl.textContent = "";
      narrativeSpans = [];
      narrativeIdx = 0;

      var totalRun = leadMs + steps.length * (stepDurMs + stepGapMs);
      timerStart = Date.now() - totalRun;
      ti = steps.length;
      finish();
    };

    var resetRun = function () {
      clearStep();
      clearStepTicker();
      clearNarrativeTimer();
      clearFinishTimers();
      narrativeDone = null;
      stopTimer();
      curStep = null;
      paused = false;
      pausedElapsed = 0;

      if (stepsEl) stepsEl.innerHTML = "";
      if (narrativeEl) narrativeEl.textContent = "";
      narrativeSpans = [];
      narrativeIdx = 0;
      if (statusEl) statusEl.textContent = "Working for " + fmt(0);
      if (finalEl) {
        finalEl.hidden = true;
        finalEl.textContent = "";
        finalEl.style.opacity = "";
        finalEl.style.transition = "";
      }

      if (box) box.classList.remove("is-complete", "is-paused", "is-collapsed");
      if (headEl) headEl.setAttribute("aria-expanded", "true");
      if (pauseBtn) pauseBtn.hidden = false;
      if (restartBtn) restartBtn.hidden = true;
      updatePauseBtn();

      ti = 0;
    };

    var startRun = function () {
      resetRun();
      startTimer();
      schedule(playTask, leadMs);
    };

    // ── Controls wiring ────────────────────────────────────────────
    if (pauseBtn) {
      pauseBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (paused) resumeRun();
        else pauseRun();
      });
    }
    if (restartBtn) {
      restartBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        startRun();
      });
    }
    if (skipBtn) {
      skipBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        skipToComplete();
      });
    }

    // ── Public controller ──────────────────────────────────────────
    var destroy = function () {
      clearStep();
      clearStepTicker();
      clearNarrativeTimer();
      clearFinishTimers();
      stopTimer();
      if (headEl) headEl.removeEventListener("click", onHeadClick);
      if (stepsEl) stepsEl.removeEventListener("click", onStepsClick);
      container.innerHTML = "";
    };

    var api = {
      el: box,
      restart: startRun,
      skip: skipToComplete,
      pause: pauseRun,
      resume: resumeRun,
      destroy: destroy,
    };

    // Boot.
    startRun();

    return api;
  }

  window.ThinkingTrace = { mount: mount };
})();
