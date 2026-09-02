/*
 * "Running item → agent at work" — FLAT variant engine (narrative)
 * =====================================================================
 * A sibling of running_lab.js for running_lab_flat.html. The flat card
 * runs FIVE high-level steps (run.flatSteps): find skills, connect tools,
 * account research, find prospects, draft cadences. Each step is a single
 * row that, while active:
 *   • spins (the conic ring) as the live "working" cue,
 *   • cycles its `cycle` sub-activities on the label, and
 *   • counts its number 0 → n up across the step's dwell.
 * On settle the spinner crossfades to the step's `icon`, the label becomes
 * the done `label`, and the count rests at n — then the next step reveals.
 *
 * Above the list, a first-person `narrative` streams word-by-word (replace
 * model — one thought per step) via the shared streaming engine
 * (window.ShStream, from conversation_stream.js).
 *
 * Pause/Resume, Skip, and Restart mirror the phased engine.
 */
(function () {
  "use strict";

  var box = document.querySelector("[data-rl-status]");
  if (!box) return;

  // ── Element refs ──────────────────────────────────────────────────
  var stepsEl = document.querySelector("[data-rl-steps]"); // step list
  var narrativeEl = document.querySelector("[data-rl-narrative]"); // streaming reasoning
  var startedEl = document.querySelector("[data-rl-started]"); // "Started X ago" (header)
  var flatSummaryEl = document.querySelector("[data-rl-flat-summary]"); // completed counts (header, right)
  var finalEl = document.querySelector("[data-rl-final]"); // persistent closing line (under header)
  var flatHead = document.querySelector("[data-rl-flat-head]");
  var pauseBtn = document.querySelector("[data-rl-pause]");
  var restartBtn = document.querySelector("[data-rl-restart]");
  var skipBtn = document.querySelector("[data-rl-skip]");
  var result = document.querySelector("[data-rl-result]");

  var run = window.RUNNING_LAB_RUN;
  if (!run) return;

  // The five high-level steps. Fall back to flattening phases if an older
  // data file has no `flatSteps`.
  var tasks = run.flatSteps && run.flatSteps.length ? run.flatSteps.slice() : [];
  if (!tasks.length && run.phases) {
    (run.introSteps || []).forEach(function (s) { tasks.push(s); });
    run.phases.forEach(function (p) {
      (p.steps || []).forEach(function (s) { tasks.push(s); });
    });
  }
  if (!tasks.length) return;

  var stepGapMs = run.stepGapMs != null ? run.stepGapMs : 200;
  // Size each step's dwell so the whole chain runs ~flatMs. An explicit
  // `flatStepMs` overrides with a fixed per-step dwell.
  var leadMs = 500;
  var flatTargetMs = run.flatMs || 40000;
  var stepDurMs = run.flatStepMs
    ? run.flatStepMs
    : Math.max(1200, Math.round((flatTargetMs - leadMs) / tasks.length - stepGapMs));

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var clamp = function (v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  };

  // ── The single in-flight scheduled beat (pause-aware) ─────────────
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

  // ── Elapsed-time counter ──────────────────────────────────────────
  var timerId = null;
  var timerStart = 0;
  var fmt = function (total) {
    var pick = function (value, unit) {
      return value + " " + unit + (value === 1 ? "" : "s");
    };
    if (total < 60) return pick(total, "sec");
    if (total < 3600) return pick(Math.floor(total / 60), "min");
    return pick(Math.floor(total / 3600), "hr");
  };
  var runElapsedSec = function () {
    return Math.floor((Date.now() - timerStart) / 1000);
  };
  var runElapsedMs = function () {
    return Date.now() - timerStart;
  };
  var tick = function () {
    if (startedEl) startedEl.textContent = "Started " + fmt(runElapsedSec()) + " ago";
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

  // ── Text swap (transitions.dev text-states-swap) — cycling label ──
  // Keeps `data-text` in sync so the t-think shimmer overlay (::before,
  // content: attr(data-text)) always matches the visible line.
  var swapDur = (function () {
    var raw = getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur");
    var n = parseFloat(raw);
    if (!n) return 150;
    if (String(raw).indexOf("ms") === -1 && String(raw).indexOf("s") !== -1) return n * 1000;
    return n;
  })();
  var cancelSwap = function (el) {
    if (!el) return;
    if (el._rlSwapTimer) {
      clearTimeout(el._rlSwapTimer);
      el._rlSwapTimer = null;
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
    el._rlSwapTimer = setTimeout(function () {
      el._rlSwapTimer = null;
      applyLabel(el, nextStr);
      el.classList.remove("is-exit");
      el.classList.add("is-enter-start");
      void el.offsetHeight;
      el.classList.remove("is-enter-start");
    }, swapDur);
  };

  // ── Streaming reasoning narrative (replace model) ─────────────────
  // A beat streams its `narrative` word-by-word; `narrativeDone` fires once
  // the last word lands, which is when the beat's step row is revealed.
  var narrativeSpans = [];
  var narrativeIdx = 0;
  var narrativeTimer = null;
  var narrativeDone = null; // callback for "streaming finished"
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
    // Bring the word into flow (it was display:none so it reserved no space),
    // force a reflow so the opacity/blur transition actually runs, then fade
    // it in. Revealing words one at a time is what makes the paragraph grow
    // line-by-line and the step list below ride down with the text.
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
    // Hold every word out of flow until it's revealed, so the paragraph is
    // only ever as tall as the visible text (no full-height reservation).
    narrativeSpans.forEach(function (s) {
      s.style.display = "none";
    });
    revealNextWord();
  };

  // ── Row rendering ─────────────────────────────────────────────────
  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };
  var parseCount = function (str) {
    var raw = str == null ? "" : String(str);
    var m = raw.match(/^\s*(\d[\d,]*)\s*(.*)$/);
    if (!m) return { target: null, suffix: "", raw: raw };
    return {
      target: parseInt(m[1].replace(/,/g, ""), 10),
      suffix: m[2] ? " " + m[2] : "",
      raw: raw,
    };
  };
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
    Web: "source_web.svg",
    ZoomInfo: "source_zoominfo.svg",
  };
  // Detail sub-step icon: a custom image (e.g. the left-nav skills icon), a
  // source logo (tools), or a utility glyph.
  var substepIconHtml = function (sub) {
    if (sub.img) {
      return (
        '<span class="rl-step__icon rl-step__icon--source agent-reasoning__tool-icon" title="' + esc(sub.label) + '">' +
        '<img class="rl-step__source-img" src="' + esc(sub.img) + '" alt="" aria-hidden="true">' +
        '<span class="slds-assistive-text">' + esc(sub.label) + "</span></span>"
      );
    }
    if (sub.source) {
      var srcFile = SOURCE_ICONS[sub.source] || SOURCE_ICONS.Salesforce;
      return (
        '<span class="rl-step__icon rl-step__icon--source agent-reasoning__tool-icon" title="' + esc(sub.label) + '">' +
        '<img class="rl-step__source-img" src="/assets/images/source_icons/' + srcFile + '" alt="" aria-hidden="true">' +
        '<span class="slds-assistive-text">' + esc(sub.source) + "</span></span>"
      );
    }
    return (
      '<span class="rl-step__icon rl-step__icon--glyph agent-reasoning__tool-icon" title="' + esc(sub.label) + '">' +
      '<svg class="rl-step__glyph" aria-hidden="true"><use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#' + esc(sub.icon || "record") + '"></use></svg>' +
      '<span class="slds-assistive-text">' + esc(sub.label) + "</span></span>"
    );
  };
  var substepsHtml = function (substeps) {
    if (!substeps || !substeps.length) return "";
    var rows = substeps.map(function (sub) {
      return (
        '<div class="rl-step rl-substep agent-reasoning__tool slds-grid slds-grid_vertical-align-center slds-text-color_weak is-done">' +
        substepIconHtml(sub) +
        '<p class="rl-step__label slds-text-body_regular slds-truncate" title="' + esc(sub.label) + '">' + esc(sub.label) + "</p>" +
        "</div>"
      );
    });
    return '<div class="rl-steps rl-flatstep__substeps">' + rows.join("") + "</div>";
  };
  // Header icon-swap glyphs: the settled blue check + the chevron that
  // replaces it on a done section (hover / expanded).
  var CHECK_SVG =
    '<svg class="rl-step__check" aria-hidden="true"><use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#success"></use></svg>';
  var CHEVRON_SVG =
    '<svg aria-hidden="true"><use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#chevronright"></use></svg>';

  // Each step is an accordion section: a header row (spinner → check →
  // chevron, cycling label, count-up) plus a collapsible body of detail
  // sub-steps (source logos), revealed once the step is done.
  var renderStep = function (stepData) {
    if (!stepsEl) return null;
    var count = parseCount(stepData.count);
    var cyc = stepData.cycle && stepData.cycle.length ? stepData.cycle : null;
    var firstLabel = cyc ? cyc[0] : stepData.label || "";
    var wrap = document.createElement("div");
    wrap.className = "rl-flatstep is-active";
    wrap.innerHTML =
      '<div class="rl-flatstep__head agent-reasoning__tool slds-grid slds-grid_vertical-align-center slds-text-color_weak" role="status" aria-expanded="false">' +
        '<span class="rl-step__icon rl-step__icon--swap agent-reasoning__tool-icon" title="' + esc(stepData.label) + '">' +
          '<span class="rl-step__spinner sh-spinner" aria-hidden="true"></span>' +
          '<span class="rl-step__mark" aria-hidden="true">' + CHECK_SVG + "</span>" +
          '<span class="rl-step__chevron" aria-hidden="true">' + CHEVRON_SVG + "</span>" +
          '<span class="slds-assistive-text">' + esc(stepData.label) + "</span>" +
        "</span>" +
        '<p class="rl-step__label t-text-swap slds-text-body_regular slds-truncate" data-rl-step-label data-text="' + esc(firstLabel) + '" title="' + esc(stepData.label) + '">' + esc(firstLabel) + "</p>" +
      "</div>" +
      '<div class="rl-flatstep__body">' + substepsHtml(stepData.substeps) + "</div>";
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
      labelEl: wrap.querySelector("[data-rl-step-label]"),
      countEl: wrap.querySelector("[data-rl-step-count]"),
      cycle: cyc,
      count: count,
      label: stepData.label || "",
      _i: -1,
    };
  };

  // ── Active-row visuals (count-up + micro-text cycle) ──────────────
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
      curStep.wrap.classList.remove("is-active"); // spinner → check (CSS)
      curStep.wrap.classList.add("is-done"); // header becomes expandable
    }
    curStep = null;
  };

  // ── Pause / Resume ────────────────────────────────────────────────
  var paused = false;
  var pausedElapsed = 0;
  var updatePauseBtn = function () {
    if (!pauseBtn) return;
    var use = pauseBtn.querySelector("[data-rl-pause-icon] use");
    var glyph = paused ? "play" : "pause";
    var label = paused ? "Resume run" : "Pause run";
    if (use) {
      var href = "/assets/icons/utility-sprite/svg/symbols.svg#" + glyph;
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
    if (box) box.classList.add("is-paused"); // also freezes the active spinner (CSS)
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
  if (pauseBtn) {
    pauseBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (paused) resumeRun();
      else pauseRun();
    });
  }

  // Header is a collapse toggle at all times: folds the narrative + list.
  if (flatHead) {
    flatHead.addEventListener("click", function () {
      var collapsed = box.classList.toggle("is-collapsed");
      flatHead.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }

  // Expand/collapse a settled step to reveal its detail sub-steps
  // (delegated — the section headers are created on the fly).
  if (stepsEl) {
    stepsEl.addEventListener("click", function (e) {
      var head = e.target.closest && e.target.closest(".rl-flatstep__head");
      if (!head || !stepsEl.contains(head)) return;
      var wrap = head.parentNode;
      if (!wrap || wrap.className.indexOf("is-done") === -1) return; // only once done
      var expanded = wrap.classList.toggle("is-expanded");
      head.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
  }

  // ── Playback ──────────────────────────────────────────────────────
  var ti = 0; // step index

  // On completion the run folds into its "completed" header (the accordion),
  // then — after a beat — the rest of the thread is revealed. Both are held
  // in timers so a restart can cancel whichever is pending.
  var finishCollapseTimer = null;
  var resultRevealTimer = null;
  var clearFinishCollapse = function () {
    if (finishCollapseTimer) {
      clearTimeout(finishCollapseTimer);
      finishCollapseTimer = null;
    }
    if (resultRevealTimer) {
      clearTimeout(resultRevealTimer);
      resultRevealTimer = null;
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
    // Header → completed skill label + summary counts on the right; the
    // narrative retires (CSS off `is-complete`). Header stays the toggle.
    if (startedEl) startedEl.textContent = run.completedLabel || "Worked for 2 hours";
    if (flatSummaryEl) flatSummaryEl.textContent = run.summary || "";
    if (box) box.classList.add("is-complete");
    if (flatHead) flatHead.setAttribute("aria-expanded", "true");
    if (pauseBtn) pauseBtn.hidden = true;
    if (restartBtn) restartBtn.hidden = false;

    // Auto-collapse the finished run into its completed accordion header
    // after a brief beat, so the last step is seen settling before the body
    // folds away to just the "completed" summary. Clicking the header (or
    // Restart) re-opens it; a restart cancels this pending fold.
    clearFinishCollapse();
    finishCollapseTimer = setTimeout(function () {
      finishCollapseTimer = null;
      if (box) box.classList.add("is-collapsed");
      if (flatHead) flatHead.setAttribute("aria-expanded", "false");
      // Reveal the persistent closing line under the header as the card folds.
      // It lives outside the collapsible content, so it stays put.
      if (finalEl && run.finalSummary) {
        finalEl.textContent = run.finalSummary;
        finalEl.hidden = false;
        if (!reduceMotion) {
          finalEl.style.opacity = "0";
          window.requestAnimationFrame(function () {
            finalEl.style.transition = "opacity 300ms ease";
            finalEl.style.opacity = "1";
          });
        }
      }
      // Then, after a pause, let the thread continue: reveal the agent's
      // summary, the prospect table, and the follow-up suggestions
      // (pre-rendered, hidden until now), fading them in under the header.
      resultRevealTimer = setTimeout(function () {
        resultRevealTimer = null;
        if (result) {
          result.hidden = false;
          if (!reduceMotion) {
            result.style.opacity = "0";
            window.requestAnimationFrame(function () {
              result.style.transition = "opacity 300ms ease";
              result.style.opacity = "1";
            });
          }
        }
      }, 550);
    }, 800);
  };

  var playTask = function () {
    var t = tasks[ti];
    if (!t) {
      finish();
      return;
    }
    // First stream the beat's reasoning. Only once the sentence has fully
    // landed do we reveal the spinning step row + start its count-up, then
    // dwell and advance to the next beat.
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
        if (ti < tasks.length) schedule(playTask, stepGapMs);
        else finish();
      }, stepDurMs);
    });
  };

  var skipToComplete = function () {
    clearStep();
    clearStepTicker();
    clearNarrativeTimer();
    narrativeDone = null; // drop any in-flight "reveal step" callback
    stopTimer();
    curStep = null;
    paused = false;
    pausedElapsed = 0;

    if (stepsEl) stepsEl.innerHTML = "";
    tasks.forEach(function (t) {
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

    var totalMs = leadMs + tasks.length * (stepDurMs + stepGapMs);
    timerStart = Date.now() - totalMs;
    ti = tasks.length;
    finish();
  };

  var resetRun = function () {
    clearStep();
    clearStepTicker();
    clearNarrativeTimer();
    clearFinishCollapse();
    narrativeDone = null;
    stopTimer();
    curStep = null;
    paused = false;
    pausedElapsed = 0;

    if (stepsEl) stepsEl.innerHTML = "";
    if (narrativeEl) narrativeEl.textContent = "";
    narrativeSpans = [];
    narrativeIdx = 0;
    if (startedEl) startedEl.textContent = "Started " + fmt(0) + " ago";
    if (flatSummaryEl) flatSummaryEl.textContent = "";
    if (finalEl) {
      finalEl.hidden = true;
      finalEl.textContent = "";
      finalEl.style.opacity = "";
      finalEl.style.transition = "";
    }

    if (box) box.classList.remove("is-complete", "is-paused", "is-collapsed");
    if (flatHead) flatHead.setAttribute("aria-expanded", "true");
    if (pauseBtn) pauseBtn.hidden = false;
    if (restartBtn) restartBtn.hidden = true;
    updatePauseBtn();
    if (result) {
      result.hidden = true;
      result.style.opacity = "";
      result.style.transition = "";
    }

    ti = 0;
  };

  var startRun = function () {
    resetRun();
    startTimer();
    schedule(playTask, leadMs);
  };

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

  // Boot.
  startRun();
})();
