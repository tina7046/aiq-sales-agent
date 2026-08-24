/*
 * "Running item → agent at work" — timed simulation engine
 * =====================================================================
 * Plays the completed "Found new prospects" run (conv-001) from start to
 * finish in ~1 minute, structured as three phases:
 *   Research Accounts → Find Prospects → Draft Cadences.
 *
 * The reasoning itself is data: `window.RUNNING_LAB_RUN` (serialised from
 * data/running_lab.json in running_lab.html) holds the phases and, per
 * phase, an ordered list of beats. A beat sets the active phase's name
 * to the current thought and optionally appends tool/source rows. The
 * run header shows that phase's `running` label ("Researching
 * accounts…"). The engine walks the beats on a timer — the timer IS the
 * agent, mirroring the conversation page's playOpening/playBeat loop
 * (home_conversation.js).
 *
 * The run status and the chain-of-thought are ONE component: the status
 * row (spinner + "Run Started" + timer) is the accordion header. Its icon
 * slot holds two stacked glyphs (spinner + chevron) that crossfade with
 * the icon-swap recipe — the chevron reveals on hover while running and
 * becomes the resting glyph once the run completes (all in CSS; this file
 * only toggles `is-complete`). The three phase sections are the accordion
 * body — active phase live, finished phases collapsed to a summary and
 * individually expandable (their topic icon swaps to a chevron on hover),
 * upcoming ones dimmed. When the run ends the finished result (the real
 * conv-001 messages in [data-rl-result]) is revealed, the body folds shut,
 * the Pause control retires and a Restart control appears.
 *
 * A Pause/Resume control (prototyping) freezes the beat scheduler and the
 * elapsed timer and resumes from the same beat.
 */
(function () {
  "use strict";

  var stage = document.querySelector("[data-rl-stage]");
  if (!stage) return;

  // ── Shared element refs ───────────────────────────────────────────
  var box = document.querySelector("[data-rl-status]");
  var accordion = document.querySelector("[data-rl-cot-accordion]");
  var toggle = document.querySelector("[data-rl-cot-toggle]");
  var pauseBtn = document.querySelector("[data-rl-pause]");
  var restartBtn = document.querySelector("[data-rl-restart]");
  var skipBtn = document.querySelector("[data-rl-skip]");
  var result = document.querySelector("[data-rl-result]");
  var elapsedEl = document.querySelector("[data-rl-elapsed]");
  // The reasoning shimmer lives in the run header (the title), showing
  // the active phase's `running` label so it stays visible when collapsed.
  var cycleEl = document.querySelector("[data-rl-cot-cycle]");

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
  var fmt = function (total) {
    var pick = function (value, unit) {
      return value + " " + unit + (value === 1 ? "" : "s");
    };
    if (total < 60) return pick(total, "sec");
    if (total < 3600) return pick(Math.floor(total / 60), "min");
    return pick(Math.floor(total / 3600), "hr");
  };
  var tick = function () {
    if (elapsedEl) {
      elapsedEl.textContent = fmt(Math.floor((Date.now() - timerStart) / 1000));
    }
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

  // ── Reasoning headline: the active phase's `running` label ────────
  // The shimmer animates on its own (index.scss); this just swaps the
  // copy as phases change. Hidden on completion (the summary takes over).
  var setHeadline = function (p) {
    if (!cycleEl) return;
    cycleEl.textContent = (p && (p.running || p.name)) || "";
  };

  // ── Accordion toggle (whole run) ──────────────────────────────────
  // The header button is the accessible control; clicks on the card's
  // padding also toggle. Clicks inside the phase list do not — those
  // belong to the per-phase toggles.
  if (accordion) {
    accordion.addEventListener("click", function (e) {
      if (e.target.closest("[data-rl-cot-sections]")) return;
      var collapsed = accordion.classList.toggle("is-collapsed");
      if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }

  // ── The beat script ───────────────────────────────────────────────
  var run = window.RUNNING_LAB_RUN;
  if (!run || !run.phases || !run.phases.length) return;

  var beatMs = run.beatMs || 2000;
  var phaseGapMs = run.phaseGapMs || 600;

  // Index each phase's live nodes once.
  var sections = {};
  run.phases.forEach(function (p) {
    var el = stage.querySelector('[data-rl-phase="' + p.key + '"]');
    if (!el) return;
    sections[p.key] = {
      el: el,
      toggle: el.querySelector("[data-rl-phase-toggle]"),
      name: el.querySelector("[data-rl-phase-name]"),
      thought: el.querySelector("[data-rl-thought] p"),
      tools: el.querySelector("[data-rl-tools]"),
    };
  });

  // ── Per-phase accordion ───────────────────────────────────────────
  // A finished (is-done) phase expands to reveal its details; pending /
  // active phases ignore the click.
  Object.keys(sections).forEach(function (key) {
    var sec = sections[key];
    if (!sec.toggle) return;
    sec.toggle.addEventListener("click", function () {
      if (!sec.el.classList.contains("is-done")) return;
      var expanded = sec.el.classList.toggle("is-expanded");
      sec.toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
  });

  var esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  // Tool/source row — same markup as the CoT tool rows in the template
  // (feed_components.html's agent-reasoning__tool pattern).
  var appendTool = function (sec, t) {
    if (!sec.tools) return;
    var iconClass = String(t.icon || "").replace(/_/g, "-");
    var sprite = "/assets/icons/utility-sprite/svg/symbols.svg#" + t.icon;
    var html =
      '<div class="slds-grid slds-grid_vertical-align-center slds-text-color_weak slds-p-left_xxx-small agent-reasoning__tool" role="status">' +
      '<span class="slds-icon_container slds-icon-utility-' + iconClass + ' agent-reasoning__tool-icon" title="' + esc(t.label) + '">' +
      '<svg class="slds-icon slds-icon-text-default slds-icon_x-small" aria-hidden="true">' +
      '<use xlink:href="' + sprite + '"></use></svg>' +
      '<span class="slds-assistive-text">' + esc(t.label) + "</span></span>" +
      '<p class="slds-col slds-text-body_small slds-p-horizontal_x-small slds-truncate" title="' + esc(t.label) + '">' + esc(t.label) + "</p>" +
      (t.count ? '<p class="slds-col_bump-left slds-text-body_small">' + esc(t.count) + "</p>" : "") +
      "</div>";
    sec.tools.insertAdjacentHTML("beforeend", html);
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

  var activatePhase = function (p, sec) {
    if (!sec) return;
    sec.el.classList.remove("is-pending", "is-done", "is-expanded");
    sec.el.classList.add("is-active");
    if (sec.toggle) sec.toggle.setAttribute("aria-expanded", "false");
    setHeadline(p);
    if (sec.el.scrollIntoView) sec.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  var completePhase = function (p, sec) {
    if (!sec) return;
    sec.el.classList.remove("is-active");
    sec.el.classList.add("is-done");
    if (sec.name) swapText(sec.name, p.name || "");
  };

  var finish = function () {
    stopTimer();
    // Any lingering pause state is moot once the run is done.
    paused = false;
    if (box) box.classList.remove("is-paused");

    // The spinner → chevron swap is CSS off `is-complete`; nothing to do
    // to the icon here.
    var label = document.querySelector("[data-rl-status-label]");
    if (label) label.textContent = run.summary ? "Completed — " + run.summary : "Completed";
    if (box) box.classList.add("is-complete");

    // Reveal the real finished result and fold the chain-of-thought shut.
    if (result) result.hidden = false;
    if (accordion) accordion.classList.add("is-collapsed");
    if (toggle) toggle.setAttribute("aria-expanded", "false");

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
    stopTimer();
    paused = false;
    pausedElapsed = 0;

    var elapsedMs = 500;
    run.phases.forEach(function (p, i) {
      var sec = sections[p.key];
      elapsedMs += ((p.beats && p.beats.length) || 0) * beatMs + beatMs;
      if (i < run.phases.length - 1) elapsedMs += phaseGapMs;
      if (!sec) return;

      if (sec.tools) sec.tools.innerHTML = "";
      var lastThought = "";
      (p.beats || []).forEach(function (beat) {
        if (beat.thought) lastThought = beat.thought;
        (beat.tools || []).forEach(function (t) { appendTool(sec, t); });
      });
      if (sec.thought) sec.thought.textContent = lastThought;
      if (sec.name) {
        cancelSwap(sec.name);
        sec.name.textContent = p.name || "";
      }
      sec.el.classList.remove("is-pending", "is-active", "is-expanded");
      sec.el.classList.add("is-done");
      if (sec.toggle) sec.toggle.setAttribute("aria-expanded", "false");
    });

    if (elapsedEl) elapsedEl.textContent = fmt(Math.floor(elapsedMs / 1000));
    pi = run.phases.length;
    bi = 0;
    finish();
  };

  // Tear the completed state back down to the start state.
  var resetRun = function () {
    clearStep();
    stopTimer();
    paused = false;
    pausedElapsed = 0;

    run.phases.forEach(function (p) {
      var sec = sections[p.key];
      if (!sec) return;
      sec.el.classList.remove("is-active", "is-done", "is-expanded");
      sec.el.classList.add("is-pending");
      if (sec.toggle) sec.toggle.setAttribute("aria-expanded", "false");
      if (sec.tools) sec.tools.innerHTML = "";
      if (sec.thought) sec.thought.textContent = "";
      if (sec.name) {
        cancelSwap(sec.name);
        sec.name.textContent = p.name || "";
      }
    });

    // Reset the header title: clear the terminal summary and rewind the
    // reasoning shimmer to the first phase's running label (is-complete
    // removal below re-reveals it).
    var label = document.querySelector("[data-rl-status-label]");
    if (label) label.textContent = "";
    setHeadline(run.phases[0]);
    if (box) box.classList.remove("is-complete", "is-paused");
    if (accordion) accordion.classList.remove("is-collapsed");
    if (toggle) toggle.setAttribute("aria-expanded", "true");

    // Pause available again for the fresh run; Restart hidden.
    if (pauseBtn) pauseBtn.hidden = false;
    if (restartBtn) restartBtn.hidden = true;
    updatePauseBtn();
    if (result) result.hidden = true;

    pi = 0;
    bi = 0;
  };

  // Walk phase pi, beat bi.
  var pi = 0;
  var bi = 0;

  var playBeat = function () {
    var p = run.phases[pi];
    var sec = sections[p.key];
    if (!sec) { // section missing — skip to next phase
      pi++;
      bi = 0;
      if (pi < run.phases.length) {
        activatePhase(run.phases[pi], sections[run.phases[pi].key]);
        schedule(playBeat, phaseGapMs);
      } else {
        finish();
      }
      return;
    }

    var beat = p.beats[bi] || {};
    if (sec.name) swapText(sec.name, beat.thought || p.name || "");
    if (sec.thought) sec.thought.textContent = beat.thought || "";
    (beat.tools || []).forEach(function (t) { appendTool(sec, t); });
    if (sec.el.scrollIntoView) sec.el.scrollIntoView({ behavior: "smooth", block: "nearest" });

    bi++;
    if (bi < p.beats.length) {
      schedule(playBeat, beatMs);
      return;
    }

    // End of this phase: hold on the last beat, then collapse + advance.
    schedule(function () {
      completePhase(p, sec);
      pi++;
      bi = 0;
      if (pi < run.phases.length) {
        activatePhase(run.phases[pi], sections[run.phases[pi].key]);
        schedule(playBeat, phaseGapMs);
      } else {
        finish();
      }
    }, beatMs);
  };

  var startRun = function () {
    resetRun();
    startTimer();
    activatePhase(run.phases[0], sections[run.phases[0].key]);
    schedule(playBeat, 500);
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
