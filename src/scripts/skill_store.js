// ─────────────────────────────────────────────────────────────────────────
// Seller Home — SkillStore: isolated persistence layer for the skill
// detail / editor page.
//
// The detail-page controller (`skill_detail.js`) NEVER writes directly to
// localStorage anymore for committed saves — it goes through this module.
// That keeps the save/validation flow and the storage strategy on
// opposite sides of one small surface (`load`, `save`, `hasLocalOverride`,
// `revert`) so a real API implementation can drop in behind the same
// method names without touching the caller.
//
// ── Prototype scope ─────────────────────────────────────────────────────
// This is a LOCAL prototype. Persistence is client-only:
//   • Commit envelope   → localStorage["sh:skills:store:v1:<id>"].
//   • Envelope contains { markdown, updatedAt, updatedBy, version }.
//   • Nothing is sent to a server. Nothing is shared across browsers /
//     devices / tabs (each tab shares one origin's localStorage, so tabs
//     see each other's saves, but a private-mode window or a different
//     browser starts from the shipped JSON baseline).
//   • Wiping localStorage or `SkillStore.revert(id)` restores the
//     shipped JSON baseline; there's no undo / audit log beyond that.
//
// ── Save contract ───────────────────────────────────────────────────────
// `save(id, { markdown, currentUserName })` returns a Promise so callers
// can:
//   • await a real API without a code change when the backend lands
//   • prevent concurrent submissions while the write is in flight
//   • await settlement to update the header caption from the RESOLVED
//     record (in the local case: version+1, updatedAt: now, updatedBy:
//     currentUserName). The returned record is authoritative — callers
//     replace their in-memory saved baseline with it (spec item 10).
//
// The version increment lives inside `save()` and fires EXACTLY ONCE
// per successful persist. Validation and dirty-state gating are the
// caller's responsibility; if the caller invokes `save()` with clean
// content the version still bumps, so gate on `isDirty()` upstream.
//
// ── Failure modes ───────────────────────────────────────────────────────
// The Promise rejects with `{ code, message }` for:
//   • storage_unavailable — the browser rejected the write (private
//                            mode, quota exceeded, storage blocked).
//   • invalid_input       — the caller passed a non-string markdown or
//                            an empty skill id.
//
// The caller is expected to keep the draft intact, keep Save + Cancel
// visible, surface the message to the user, and let them retry.
// ─────────────────────────────────────────────────────────────────────────

(function (global) {
  'use strict';

  var STORAGE_KEY_PREFIX = 'sh:skills:store:v1:';

  // Simulate a tiny amount of write latency so the "saving…" state has
  // a visible tick in the prototype. Real backends land here later —
  // then the artificial delay disappears with the mock. 120 ms is short
  // enough to feel snappy on desktop and long enough to render one
  // frame with the spinner.
  var MOCK_LATENCY_MS = 120;

  function keyFor(id) { return STORAGE_KEY_PREFIX + String(id); }

  // Attempt a localStorage read. Never throws; returns null on any
  // failure so callers can fall back to their in-memory shipped
  // baseline without a try/catch of their own.
  function readEnvelope(id) {
    if (!id) return null;
    try {
      var raw = global.localStorage.getItem(keyFor(id));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      // Envelope shape: { v, markdown, updatedAt, updatedBy, version }.
      // A missing / mismatched `v` invalidates the envelope so an
      // older prototype's data can't corrupt this one's flow.
      if (parsed.v !== 1) return null;
      if (typeof parsed.markdown !== 'string') return null;
      return parsed;
    } catch (_e) {
      return null;
    }
  }

  function writeEnvelope(id, envelope) {
    if (!id) throw makeError('invalid_input', 'Skill id is required.');
    global.localStorage.setItem(keyFor(id), JSON.stringify(envelope));
  }

  function makeError(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  // ── Public API ────────────────────────────────────────────────────────

  // load(skillId, shipped)
  //   `shipped` is the JSON-shipped skill record (or null). If a local
  //   override exists, its fields TAKE PRECEDENCE for markdown +
  //   updatedAt + updatedBy + version. Fields the override doesn't
  //   touch (createdBy, name, description, connectedSkills…) fall
  //   through to the shipped record untouched. Returns a merged
  //   plain object; never mutates `shipped`.
  //
  //   Reads are always synchronous (localStorage is sync) — no Promise
  //   here. If we later switch to an async cache this signature
  //   changes to return a Promise, and the caller adapts. Prototype
  //   ergonomics beat premature async wrapping.
  function load(skillId, shipped) {
    var base = (shipped && typeof shipped === 'object') ? shipped : {};
    var env  = readEnvelope(skillId);
    if (!env) {
      return {
        record:          base,
        hasLocalOverride: false
      };
    }
    // Shallow-merge the override onto the base so ONLY the fields the
    // save flow touches get promoted. If a future save writes more
    // fields (e.g. connectedSkills), add them to the override
    // whitelist below rather than merging the whole envelope
    // wholesale.
    var merged = {};
    for (var k in base) {
      if (Object.prototype.hasOwnProperty.call(base, k)) merged[k] = base[k];
    }
    merged.markdown  = env.markdown;
    if (typeof env.updatedAt === 'string') merged.updatedAt = env.updatedAt;
    if (typeof env.updatedBy === 'string') merged.updatedBy = env.updatedBy;
    if (typeof env.version   === 'string') merged.version   = env.version;
    return {
      record:          merged,
      hasLocalOverride: true
    };
  }

  // hasLocalOverride(skillId)
  //   True if a saved envelope exists in local storage for this id.
  //   Useful for showing "This copy has local edits" hints in a future
  //   surface. Not consumed by the current save flow but exposed so
  //   consumers don't have to peek at localStorage directly.
  function hasLocalOverride(skillId) {
    return readEnvelope(skillId) !== null;
  }

  // save(skillId, { markdown, currentUserName })
  //   Returns Promise<{ markdown, updatedAt, updatedBy, version }>.
  //   Rejects with `Error` carrying a `.code` of "storage_unavailable"
  //   or "invalid_input".
  //
  //   Version increments EXACTLY ONCE per successful call. Version
  //   scheme: reads current envelope, extracts a leading integer
  //   from the previous version string ("V8" → 8, "8" → 8), bumps
  //   by 1, prepends "V". If no local envelope exists we start from
  //   the shipped record's version (passed via `previousVersion`
  //   in the payload) and bump that; if that too is unavailable we
  //   fall back to "V1".
  function save(skillId, payload) {
    return new Promise(function (resolve, reject) {
      if (!skillId) {
        reject(makeError('invalid_input', 'Skill id is required.'));
        return;
      }
      if (!payload || typeof payload.markdown !== 'string') {
        reject(makeError('invalid_input', 'Markdown payload is required.'));
        return;
      }

      // Compute next version. Bump from the LATER of: last-local
      // version (envelope), or `previousVersion` supplied by the
      // caller (which reflects the shipped baseline). This makes
      // sure a first save after page load bumps from the current
      // displayed value, even if the local store has never held
      // an envelope for this skill.
      var current = readEnvelope(skillId);
      var baselineVersion = current
        ? String(current.version || '')
        : String(payload.previousVersion || '');
      var next = bumpVersion(baselineVersion);

      var envelope = {
        v:         1,
        markdown:  payload.markdown,
        updatedAt: payload.updatedAtOverride || formatRelativeMoment(new Date()),
        updatedBy: String(payload.currentUserName || 'You'),
        version:   next
      };

      // Simulate write latency so the "saving…" state has a visible
      // pulse. Real backends REPLACE this setTimeout with a fetch —
      // resolve() shape stays identical.
      global.setTimeout(function () {
        try {
          writeEnvelope(skillId, envelope);
        } catch (e) {
          reject(makeError('storage_unavailable',
            'Couldn\u2019t save. Your browser refused to store this change (private mode, blocked storage, or full quota).'));
          return;
        }
        resolve({
          markdown:  envelope.markdown,
          updatedAt: envelope.updatedAt,
          updatedBy: envelope.updatedBy,
          version:   envelope.version
        });
      }, MOCK_LATENCY_MS);
    });
  }

  // revert(skillId)
  //   Delete the local envelope. Restores the shipped JSON baseline
  //   on next `load()`. Silent on failure — nothing to clean up if
  //   the delete throws.
  function revert(skillId) {
    if (!skillId) return;
    try { global.localStorage.removeItem(keyFor(skillId)); }
    catch (_e) { /* nothing to clean up. */ }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  // Extract the leading integer from a version string ("V8", "8",
  // "v12", " 3 ") and bump by 1. Falls back to 1 (rendered "V1") when
  // the previous value is missing / malformed. The prefix is
  // preserved when present so "V8" → "V9"; a bare number gets a
  // leading "V" for display parity with the JSON-shipped shape.
  function bumpVersion(prev) {
    var trimmed = String(prev || '').trim();
    var m = /^(v)?\s*(\d+)/i.exec(trimmed);
    var n = m ? parseInt(m[2], 10) : 0;
    if (!isFinite(n) || n < 0) n = 0;
    return 'V' + (n + 1);
  }

  // Format a Date as a compact human-readable moment for the
  // "Last updated {updatedAt}" caption. Mirrors the phrasing used by
  // the shipped JSON ("today at 4:00 PM", "yesterday at 10:12 AM").
  // Not internationalized — prototype-scoped copy.
  function formatRelativeMoment(when) {
    var w = (when instanceof Date) ? when : new Date();
    var now = new Date();
    var sameDay =
      w.getFullYear() === now.getFullYear() &&
      w.getMonth()    === now.getMonth() &&
      w.getDate()     === now.getDate();
    var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    var wasYesterday =
      w.getFullYear() === yesterday.getFullYear() &&
      w.getMonth()    === yesterday.getMonth() &&
      w.getDate()     === yesterday.getDate();

    var hours = w.getHours();
    var minutes = w.getMinutes();
    var suffix = hours >= 12 ? 'PM' : 'AM';
    var h12 = hours % 12;
    if (h12 === 0) h12 = 12;
    var mm = minutes < 10 ? '0' + minutes : String(minutes);
    var clock = h12 + ':' + mm + ' ' + suffix;

    if (sameDay)       return 'today at ' + clock;
    if (wasYesterday)  return 'yesterday at ' + clock;

    // Fallback — a compact locale-neutral date + time. We deliberately
    // don't reach for Intl.DateTimeFormat here; keeping the format
    // stable across environments matters more than pretty locale
    // rendering in a prototype.
    var mo   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][w.getMonth()];
    return mo + ' ' + w.getDate() + ' at ' + clock;
  }

  global.SkillStore = {
    load:              load,
    save:              save,
    revert:            revert,
    hasLocalOverride:  hasLocalOverride,
    // Exposed for tests / dev tooling — DO NOT wire into production
    // paths. Real backends own their own version stamping.
    _bumpVersion:      bumpVersion,
    _formatRelativeMoment: formatRelativeMoment
  };
})(typeof window !== 'undefined' ? window : this);
