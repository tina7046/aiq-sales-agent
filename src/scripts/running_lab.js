/*
 * "Running item → agent at work" — timed simulation engine
 * =====================================================================
 * Plays the completed "Found new prospects" run (conv-001) from start to
 * finish in ~3 minutes (about a minute per phase), structured as three
 * phases: Research Accounts → Find Prospects → Draft Cadences.
 *
 * The reasoning itself is data: `window.RUNNING_LAB_RUN` (serialised from
 * data/running_lab.json in running_lab.html) holds the phases and, per
 * phase, an ordered list of `steps`. A step is one source/tool activity:
 * it reveals its own row, cycles its `cycle` micro-texts on the row label
 * (reusing the text-swap animation) and tweens its right-hand number
 * 0 → n across the step's dwell, then settles (final label + count = n)
 * and the next step reveals. The engine walks the steps on a timer — the
 * timer IS the agent, mirroring home_conversation.js's playBeat loop.
 *
 * Each phase header carries a blue→violet spinner, the phase's `running`
 * label ("Researching accounts…") painted with the shimmer sweep, and the
 * phase's own elapsed timer; its source rows accumulate in the body
 * beneath. The spinner is an icon-swap (chevron on hover) that folds the
 * card down to just the active step (`is-collapsed`). Finished phases
 * collapse to their name with a blue check and stay expandable; upcoming
 * phases sit dimmed. When the run ends, a "Completed — summary" title
 * appears above the three done phases, the finished result (the real
 * conv-001 messages in [data-rl-result]) is revealed, Pause retires, and
 * Restart appears.
 *
 * A Pause/Resume control (prototyping) freezes the step scheduler, the
 * count/micro-text ticker, and the elapsed timer, and resumes in place.
 */
(function () {
  "use strict";

  var stage = document.querySelector("[data-rl-stage]");
  if (!stage) return;

  // ── Shared element refs ───────────────────────────────────────────
  var box = document.querySelector("[data-rl-status]");
  var completeEl = document.querySelector("[data-rl-complete]");
  var pauseBtn = document.querySelector("[data-rl-pause]");
  var restartBtn = document.querySelector("[data-rl-restart]");
  var skipBtn = document.querySelector("[data-rl-skip]");
  var result = document.querySelector("[data-rl-result]");
  // Each phase row carries its OWN elapsed slot: it ticks while the phase
  // is active, then freezes as that step's total duration once done. The
  // Completed title carries the whole-run total.
  var elapsedEls = document.querySelectorAll("[data-rl-elapsed]");
  var completeElapsed = completeEl ? completeEl.querySelector("[data-rl-elapsed]") : null;

  // ── The single in-flight step ─────────────────────────────────────
  // The beat loop schedules exactly one next step at a time, so a single
  // handle is enough. Tracking it (rather than a bare setTimeout) lets a
  // restart cancel it cleanly AND lets pause freeze the remaining time
  // and resume reschedule it from where it stopped.
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

  // ── Live elapsed-time counter ─────────────────────────────────────
  // Human-friendly relative elapsed: "3 secs" → "4 mins" → "2 hrs".
  // Computed from a start timestamp rather than a running += so it can't
  // drift; reset on restart, and shifted forward on resume so the pause
  // doesn't count.
  var timerId = null;
  var timerStart = 0;
  // The phase row currently ticking, and the run-elapsed second at which it
  // started — so each row can display its own phase-local time.
  var activeSec = null;
  var phaseStartSec = 0;
  // The source sub-step currently animating (its row refs + parsed count +
  // cycle), the run-elapsed ms it started at, and the visual ticker that
  // tweens its number 0 → n and cycles its micro-texts.
  var curStep = null;
  var stepStartMs = 0;
  var stepTicker = null;
  var clearStepTicker = function () {
    if (stepTicker) {
      clearInterval(stepTicker);
      stepTicker = null;
    }
  };
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
  var clamp = function (v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  };
  var tick = function () {
    var total = runElapsedSec();
    // Active row shows how long THIS step has been running; it settles into
    // its final duration on completion.
    if (activeSec && activeSec.elapsed) {
      activeSec.elapsed.textContent = fmt(Math.max(0, total - phaseStartSec));
    }
    // The Completed title carries the whole-run total.
    if (completeElapsed) completeElapsed.textContent = fmt(total);
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
    pausedElapsed = timerStart ? Date.now() - timerStart : 0;
    // Freeze the in-flight step, banking its remaining time.
    if (step && step.id) {
      clearTimeout(step.id);
      step.remaining = Math.max(0, step.ms - (Date.now() - step.start));
      step.id = null;
    }
    // Freeze the count/micro-text ticker too (it resumes from run-elapsed,
    // which excludes the pause, so progress stays aligned).
    clearStepTicker();
    if (box) box.classList.add("is-paused");
    updatePauseBtn();
  };

  var resumeRun = function () {
    if (!paused) return;
    paused = false;
    // Shift the start forward so the paused span doesn't count.
    timerStart = Date.now() - pausedElapsed;
    startInterval();
    // Reschedule the frozen step for its remaining time.
    if (step && step.fn && step.id === null) {
      schedule(step.fn, step.remaining);
    }
    // Restart the visual ticker for the row still in flight.
    if (curStep) startStepTicker();
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

  // ── The beat script ───────────────────────────────────────────────
  var run = window.RUNNING_LAB_RUN;
  if (!run || !run.phases || !run.phases.length) return;

  // Each phase should fill roughly `phaseTargetMs` of wall-clock, so the
  // ~3-minute run splits into three ~1-minute sections regardless of how
  // many steps a phase has. A step's dwell is derived from its phase's step
  // count (n dwells + (n-1) gaps ≈ phaseTargetMs); `curStepDurMs` holds the
  // dwell for the row currently in flight (used by the count/cycle ticker).
  var stepGapMs = run.stepGapMs != null ? run.stepGapMs : 200;
  var phaseGapMs = run.phaseGapMs || 600;
  var phaseTargetMs = run.phaseMs || run.stepMs || 60000;
  var phaseStepDur = function (phase) {
    var n = ((phase.steps || []).length) || 1;
    return Math.max(300, Math.round((phaseTargetMs - (n - 1) * stepGapMs) / n));
  };
  var curStepDurMs = phaseStepDur(run.phases[0]);

  // Index each phase's live nodes once.
  var sections = {};
  run.phases.forEach(function (p) {
    var el = stage.querySelector('[data-rl-phase="' + p.key + '"]');
    if (!el) return;
    sections[p.key] = {
      el: el,
      toggle: el.querySelector("[data-rl-phase-toggle]"),
      name: el.querySelector("[data-rl-phase-name]"),
      elapsed: el.querySelector("[data-rl-elapsed]"),
      steps: el.querySelector("[data-rl-steps]"),
    };
  });

  // ── Per-phase accordion ───────────────────────────────────────────
  // A finished (is-done) phase expands to reveal its details; pending /
  // active phases ignore the click.
  Object.keys(sections).forEach(function (key) {
    var sec = sections[key];
    if (!sec.toggle) return;
    sec.toggle.addEventListener("click", function () {
      // Active row: the spinner/chevron folds the whole card down to
      // just this in-progress step (and reopens it).
      if (sec.el.classList.contains("is-active")) {
        var collapsed = box.classList.toggle("is-collapsed");
        sec.toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        return;
      }
      // Done row: expand/collapse this finished step's details.
      if (!sec.el.classList.contains("is-done")) return;
      var expanded = sec.el.classList.toggle("is-expanded");
      sec.toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
  });

  // ── Completed accordion ───────────────────────────────────────────
  // After the run finishes, the Completed header folds the finished phases
  // away (reusing the card's `is-collapsed`); its chevron rotates via CSS.
  if (completeEl) {
    completeEl.addEventListener("click", function () {
      var collapsed = box.classList.toggle("is-collapsed");
      completeEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }

  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  // Split a `count` string into a climbable target + kept suffix.
  //   "8 dimensions" -> { target: 8, suffix: " dimensions", raw }
  //   "verified"     -> { target: null, suffix: "", raw: "verified" }
  //   ""/undefined   -> { target: null, suffix: "", raw: "" }
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

  // Colored data-provider marks (src/assets/images/source_icons). Mirrors
  // the build-time SOURCE_ICONS registry in gulpfile.js, plus LinkedIn/Web.
  var SOURCE_ICONS = {
    "6sense": "source_6sense.svg",
    Apollo: "source_apollo.svg",
    Demandbase: "source_demandbase.svg",
    G2: "source_g2.svg",
    Gong: "source_gong.svg",
    LinkedIn: "conn_linkedin.png",
    "Moody\u2019s": "source_moodys.svg",
    Salesforce: "source_salesforce.svg",
    SalesIntel: "source_salesintel.svg",
    Web: "source_web.svg",
    ZoomInfo: "source_zoominfo.svg",
  };

  // The row's leading glyph is always a colored data-provider mark. Steps
  // that name a `source` use that provider; steps without a clear source
  // fall back to the Salesforce mark.
  var stepIconHtml = function (stepData) {
    var srcFile =
      (stepData.source && SOURCE_ICONS[stepData.source]) || SOURCE_ICONS.Salesforce;
    var name = stepData.source || "Salesforce";
    return (
      '<span class="rl-step__icon rl-step__icon--source agent-reasoning__tool-icon" title="' + esc(stepData.label) + '">' +
      '<img class="rl-step__source-img" src="/assets/images/source_icons/' + srcFile + '" alt="" aria-hidden="true">' +
      '<span class="slds-assistive-text">' + esc(name) + " \u2014 " + esc(stepData.label) + "</span></span>"
    );
  };

  // Build + append one source row (reusing the feed's agent-reasoning__tool
  // pattern) with the hooks the sequencer + CSS need: `.rl-step.is-active`,
  // `.rl-step__label.t-text-swap`, `.rl-step__count`. The label starts on
  // the first micro-text (or the label) and the count starts at "0<suffix>".
  var renderStep = function (sec, stepData) {
    if (!sec.steps) return null;
    var count = parseCount(stepData.count);
    var firstLabel =
      stepData.cycle && stepData.cycle.length ? stepData.cycle[0] : stepData.label || "";
    var firstCount = count.target != null ? "0" + count.suffix : "";
    var row = document.createElement("div");
    row.className =
      "rl-step agent-reasoning__tool slds-grid slds-grid_vertical-align-center slds-text-color_weak is-active";
    row.setAttribute("role", "status");
    row.innerHTML =
      stepIconHtml(stepData) +
      '<p class="rl-step__label t-text-swap slds-text-body_regular slds-truncate" data-rl-step-label title="' + esc(stepData.label) + '">' + esc(firstLabel) + "</p>" +
      '<p class="rl-step__count slds-text-body_regular" data-rl-step-count>' + esc(firstCount) + "</p>";
    sec.steps.appendChild(row);
    return {
      row: row,
      labelEl: row.querySelector("[data-rl-step-label]"),
      countEl: row.querySelector("[data-rl-step-count]"),
      cycle: stepData.cycle || null,
      count: count,
      label: stepData.label || "",
      _i: -1,
    };
  };

  // Three-phase text swap (transitions.dev text-states-swap):
  //   1. Add .is-exit              — old text exits up with blur.
  //   2. After --text-swap-dur, swap textContent and add .is-enter-start
  //      (jumps to "below, no transition"), force a reflow.
  //   3. Remove .is-enter-start    — new text animates back to rest.
  // Used for the per-phase thought line, not the run-header title.
  var swapDur = (function () {
    var raw = getComputedStyle(document.documentElement).getPropertyValue("--text-swap-dur");
    var n = parseFloat(raw);
    if (!n) return 150;
    if (String(raw).indexOf("ms") === -1 && String(raw).indexOf("s") !== -1) return n * 1000;
    return n;
  })();
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var cancelSwap = function (el) {
    if (!el) return;
    if (el._rlSwapTimer) {
      clearTimeout(el._rlSwapTimer);
      el._rlSwapTimer = null;
    }
    el.classList.remove("is-exit", "is-enter-start");
  };

  var swapText = function (el, next) {
    if (!el) return;
    var nextStr = next == null ? "" : String(next);
    if (el.textContent === nextStr) return;

    if (reduceMotion) {
      cancelSwap(el);
      el.textContent = nextStr;
      return;
    }

    cancelSwap(el);
    el.classList.add("is-exit");
    el._rlSwapTimer = setTimeout(function () {
      el._rlSwapTimer = null;
      el.textContent = nextStr;
      el.classList.remove("is-exit");
      el.classList.add("is-enter-start");
      void el.offsetHeight;
      el.classList.remove("is-enter-start");
    }, swapDur);
  };

  // ── Active sub-step visuals ───────────────────────────────────────
  // Drive the current row from the pause-excluded run clock: tween the
  // number 0 → n and advance the micro-text cycle across the step's dwell.
  var renderCurrentStepProgress = function () {
    if (!curStep) return;
    var p = clamp((runElapsedMs() - stepStartMs) / curStepDurMs, 0, 1);
    if (curStep.count.target != null && curStep.countEl) {
      curStep.countEl.textContent =
        Math.round(curStep.count.target * p) + curStep.count.suffix;
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
  // Land the row on its resting state: final label, count = n (or the raw
  // non-numeric word), and swap is-active -> is-done.
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
    if (curStep.row) {
      curStep.row.classList.remove("is-active");
      curStep.row.classList.add("is-done");
    }
    curStep = null;
  };

  var activatePhase = function (p, sec) {
    if (!sec) return;
    sec.el.classList.remove("is-pending", "is-done", "is-expanded");
    sec.el.classList.add("is-active");
    if (sec.toggle) sec.toggle.setAttribute("aria-expanded", "false");
    // The active row's label becomes the phase's running string (shimmer).
    if (sec.name) swapText(sec.name, p.running || p.name || "");
    // This row now owns the ticking timer, counting from 0 for the phase.
    activeSec = sec;
    phaseStartSec = runElapsedSec();
    if (sec.elapsed) sec.elapsed.textContent = fmt(0);
    if (sec.el.scrollIntoView) sec.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  var completePhase = function (p, sec) {
    if (!sec) return;
    sec.el.classList.remove("is-active");
    sec.el.classList.add("is-done");
    // Freeze this phase's timer at its total duration and stop ticking it
    // (the next phase's header takes over).
    if (sec.elapsed) sec.elapsed.textContent = fmt(Math.max(0, runElapsedSec() - phaseStartSec));
    if (activeSec === sec) activeSec = null;
    // Restore the resting phase name.
    if (sec.name) swapText(sec.name, p.name || "");
  };

  var finish = function () {
    // Capture the final elapsed into every slot (incl. the Completed
    // title) before the timer stops.
    if (timerStart) tick();
    stopTimer();
    // Any lingering pause / collapse state is moot once the run is done.
    paused = false;
    if (box) box.classList.remove("is-paused", "is-collapsed");

    // Add the "Completed — summary" title above the three finished steps
    // (they stay visible as done); it also carries the final elapsed.
    var label = document.querySelector("[data-rl-status-label]");
    if (label) label.textContent = run.summary ? "Completed — " + run.summary : "Completed";
    if (completeEl) {
      completeEl.hidden = false;
      completeEl.setAttribute("aria-expanded", "true");
    }
    if (box) box.classList.add("is-complete");

    // Reveal the real finished result below the steps.
    if (result) result.hidden = false;

    // Retire Pause, offer Restart.
    if (pauseBtn) pauseBtn.hidden = true;
    if (restartBtn) restartBtn.hidden = false;

    if (result && result.scrollIntoView) {
      result.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Jump to the finished run without playing the beats — lab control so
  // the completed surface can be designed without waiting a minute.
  var skipToComplete = function () {
    clearStep();
    clearStepTicker();
    curStep = null;
    stopTimer();
    paused = false;
    pausedElapsed = 0;
    activeSec = null;

    var totalMs = 500;
    run.phases.forEach(function (p, i) {
      var sec = sections[p.key];
      var steps = p.steps || [];
      // Approximate the time this phase spends: n dwells + (n-1) gaps.
      var dur = phaseStepDur(p);
      var phaseMs = steps.length ? steps.length * dur + (steps.length - 1) * stepGapMs : 0;
      totalMs += phaseMs;
      if (i < run.phases.length - 1) totalMs += phaseGapMs;
      if (!sec) return;

      // Rebuild the phase's rows, each already settled (final label +
      // count = n / word, is-done).
      if (sec.steps) sec.steps.innerHTML = "";
      steps.forEach(function (stepData) {
        var refs = renderStep(sec, stepData);
        if (!refs) return;
        if (refs.labelEl) {
          cancelSwap(refs.labelEl);
          refs.labelEl.textContent = refs.label || "";
        }
        if (refs.countEl) {
          refs.countEl.textContent =
            refs.count.target != null
              ? refs.count.target + refs.count.suffix
              : refs.count.raw || "";
        }
        refs.row.classList.remove("is-active");
        refs.row.classList.add("is-done");
      });

      if (sec.name) {
        cancelSwap(sec.name);
        sec.name.textContent = p.name || "";
      }
      // Freeze this phase's own duration on its header.
      if (sec.elapsed) sec.elapsed.textContent = fmt(Math.floor(phaseMs / 1000));
      sec.el.classList.remove("is-pending", "is-active", "is-expanded");
      sec.el.classList.add("is-done");
      if (sec.toggle) sec.toggle.setAttribute("aria-expanded", "false");
    });

    // Make the frozen total reflect the simulated run length, not the
    // instant Skip was pressed; finish() writes it into the Completed title.
    timerStart = Date.now() - totalMs;
    pi = run.phases.length;
    si = 0;
    finish();
  };

  // Tear the completed state back down to the start state.
  var resetRun = function () {
    clearStep();
    clearStepTicker();
    curStep = null;
    stopTimer();
    paused = false;
    pausedElapsed = 0;

    run.phases.forEach(function (p) {
      var sec = sections[p.key];
      if (!sec) return;
      sec.el.classList.remove("is-active", "is-done", "is-expanded");
      sec.el.classList.add("is-pending");
      if (sec.toggle) sec.toggle.setAttribute("aria-expanded", "false");
      if (sec.steps) sec.steps.innerHTML = "";
      if (sec.name) {
        cancelSwap(sec.name);
        sec.name.textContent = p.name || "";
      }
    });

    // Rewind every timer slot (phase headers + Completed title) to zero and
    // clear the active-phase tracking.
    activeSec = null;
    phaseStartSec = 0;
    for (var i = 0; i < elapsedEls.length; i++) elapsedEls[i].textContent = fmt(0);

    // Clear + hide the Completed title, and drop any complete/paused/
    // collapsed state so the fresh run starts fully expanded.
    var label = document.querySelector("[data-rl-status-label]");
    if (label) label.textContent = "";
    if (completeEl) {
      completeEl.hidden = true;
      completeEl.setAttribute("aria-expanded", "true");
    }
    if (box) box.classList.remove("is-complete", "is-paused", "is-collapsed");

    // Pause available again for the fresh run; Restart hidden.
    if (pauseBtn) pauseBtn.hidden = false;
    if (restartBtn) restartBtn.hidden = true;
    updatePauseBtn();
    if (result) result.hidden = true;

    pi = 0;
    si = 0;
  };

  // Walk phase pi, step si.
  var pi = 0;
  var si = 0;

  // Wrap up the current phase and advance to the next (or finish the run).
  var endPhase = function (p, sec) {
    curStep = null;
    clearStepTicker();
    completePhase(p, sec);
    pi++;
    si = 0;
    if (pi < run.phases.length) {
      activatePhase(run.phases[pi], sections[run.phases[pi].key]);
      schedule(playStep, phaseGapMs);
    } else {
      finish();
    }
  };

  var playStep = function () {
    var p = run.phases[pi];
    var sec = sections[p.key];
    if (!sec) { // section missing — skip to next phase
      pi++;
      si = 0;
      if (pi < run.phases.length) {
        activatePhase(run.phases[pi], sections[run.phases[pi].key]);
        schedule(playStep, phaseGapMs);
      } else {
        finish();
      }
      return;
    }

    var steps = p.steps || [];
    var stepData = steps[si];
    if (!stepData) { // phase has no steps — just complete it
      endPhase(p, sec);
      return;
    }

    // Size this row's dwell so the phase fills ~phaseTargetMs.
    curStepDurMs = phaseStepDur(p);

    // Reveal this row and start its micro-text cycle + count-up.
    curStep = renderStep(sec, stepData);
    stepStartMs = runElapsedMs();
    startStepTicker();
    if (sec.el.scrollIntoView) sec.el.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // After the dwell, settle this row and reveal the next (or end phase).
    schedule(function () {
      settleStep();
      si++;
      if (si < steps.length) {
        schedule(playStep, stepGapMs);
      } else {
        endPhase(p, sec);
      }
    }, curStepDurMs);
  };

  var startRun = function () {
    resetRun();
    startTimer();
    activatePhase(run.phases[0], sections[run.phases[0].key]);
    schedule(playStep, 500);
  };

  // Restart: back to the start state, then replay.
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
