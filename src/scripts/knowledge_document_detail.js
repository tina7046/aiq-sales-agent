// ─────────────────────────────────────────────────────────────────────────
// Seller Home — Knowledge document detail page controller
// (/knowledge_document_detail.html)
//
// This is a thin caller that:
//   1. Reads the `?id=<id>` query param off the URL.
//   2. Reads the inlined page config (catalog + copy) from the
//      `#sh-knowledge-doc-detail-config` <script type="application/json">
//      block that the template emits.
//   3. Resolves the matching document row (by exact `id`).
//   4. Either
//        a. hydrates the outer article header (title + updated caption),
//           optionally rehydrates the textarea from a localStorage draft
//           left over from a previous session, and hands the resulting
//           state to the shared `KnowledgeDocumentView.create()` factory
//           plus the Save / Cancel / beforeunload / autosave wiring
//           documented below, OR
//        b. shows the "not found" state and stops.
//
// Save / Cancel / dirty tracking / beforeunload / localStorage
// persistence contract (Step 4):
//
//   • Baseline. The module treats the row's shipped `doc.markdown` as
//     the "saved" baseline — this is the value the textarea reverts to
//     on Cancel. If a localStorage draft is found on load, we hydrate
//     the textarea to the draft AFTER `create()` returns; the module
//     sees `textarea.value !== savedSource` and fires
//     `onDirtyChange(true)` on the resulting input event.
//   • Dirty visibility. The Save + Cancel buttons stay `hidden` while
//     the module reports a clean state and reveal themselves only when
//     `onDirtyChange(true)` fires. `hidden` (not `disabled`) so
//     keyboard users don't tab into no-op controls when nothing is
//     unsaved.
//   • Autosave. A debounced `input` listener writes the current
//     textarea value to `localStorage["sh:knowledge:draft:v1:<id>"]`
//     ~400ms after the seller stops typing. This is not a commit —
//     the entry only survives until Save or Cancel clears it.
//   • Save. `save()` snapshots the current value as the new baseline
//     and fires `onSave(value)`. Our handler clears the localStorage
//     entry and announces "Changes saved." through the aria-live
//     region. Nothing persists to a server — this is prototype scope.
//   • Cancel. Before calling `cancel()` we `window.confirm()` when
//     dirty. Once confirmed the module reverts the textarea + re-
//     renders both surfaces + fires `onDirtyChange(false)` and
//     `onCancel()`. Our handler clears the localStorage entry and
//     announces "Unsaved changes discarded.".
//   • beforeunload. A single `beforeunload` listener is registered on
//     init and gated by `view.isDirty()`. While dirty, the browser
//     shows its native "leave site?" prompt. When clean, the handler
//     no-ops and the tab closes / reloads / navigates without a
//     prompt.
//
// Known limitations (called out for a future follow-up):
//   • The localStorage draft anchors itself to the exact `doc.markdown`
//     it was authored against (envelope schema v: 2, field `baseline`).
//     If a later build ships new `doc.markdown`, `readDraft()` detects
//     the divergence, drops the stale entry from storage, and returns
//     null so the seller sees the shipped markdown instead of a draft
//     that references a version of the doc that no longer exists.
//     Legacy v: 1 envelopes (no baseline) are also treated as stale.
//   • Two tabs open on the same doc will each read/write the same
//     draft key with a last-writer-wins policy. A `storage` event
//     listener + conflict UI is out of scope for this prototype.
//
// Scope: this file runs ONLY on /knowledge_document_detail.html (the
// page template loads it via `{% block scripts_extra %}`). Every other
// page ignores it because the `[data-sh-knowledge-doc-detail]` root
// isn't in the DOM.
// ─────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // Defensive guard — the shared module MUST be loaded before this
  // file (the template loads them in the right order). Without the
  // module we can't hydrate the reader/editor, so we bail with a
  // console warning instead of silently erroring on the first API
  // call. Same guard `knowledge_agent.js` uses.
  if (!window.KnowledgeDocumentView || typeof window.KnowledgeDocumentView.create !== 'function') {
    // eslint-disable-next-line no-console
    console.warn('[knowledge-doc-detail] KnowledgeDocumentView module not loaded; skipping init.');
    return;
  }

  // ── Constants ───────────────────────────────────────────────────────
  // Bumping the version segment invalidates every previously-stored
  // draft — use this as an escape hatch if the storage envelope shape
  // ever changes in a backwards-incompatible way.
  var DRAFT_KEY_PREFIX = 'sh:knowledge:draft:v1:';
  // Debounce window for the autosave listener. 400 ms is short enough
  // that a fast tab-switch preserves in-progress edits and long enough
  // that a burst of keystrokes doesn't hammer localStorage.
  var AUTOSAVE_DEBOUNCE_MS = 400;

  // ── Config-block reader ─────────────────────────────────────────────
  // The template inlines the shared documents[] catalog + this page's
  // copy strings as a single JSON blob so the client doesn't need a
  // second fetch. Wrapped in try/catch so a malformed payload doesn't
  // crash the whole page — we fall back to an empty config and let
  // the "not found" branch below take over.
  function readConfig() {
    var node = document.getElementById('sh-knowledge-doc-detail-config');
    if (!node) return null;
    try {
      var parsed = JSON.parse(node.textContent || '{}');
      if (!parsed || typeof parsed !== 'object') return null;
      parsed.catalog = Array.isArray(parsed.catalog) ? parsed.catalog : [];
      parsed.updatedLabelTemplate = typeof parsed.updatedLabelTemplate === 'string'
        ? parsed.updatedLabelTemplate
        : 'Last edited by {updatedBy} · {updatedAt}';
      parsed.fallbackTitle = typeof parsed.fallbackTitle === 'string'
        ? parsed.fallbackTitle
        : 'Document';
      parsed.notFound = (parsed.notFound && typeof parsed.notFound === 'object') ? parsed.notFound : {};
      // `cancel` / `status` land in the config from Step 4 onward.
      // Fall back to empty objects so every downstream lookup below
      // (e.g. `config.status.savedMessage`) still short-circuits to
      // the hard-coded default rather than throwing on `undefined`
      // property access.
      parsed.cancel = (parsed.cancel && typeof parsed.cancel === 'object') ? parsed.cancel : {};
      parsed.status = (parsed.status && typeof parsed.status === 'object') ? parsed.status : {};
      // Legacy-id alias table (Step 16 of the Auto-Learning split
      // refactor). Consulted by `resolveDocId` when a direct catalog
      // lookup misses — see the field-level comment on
      // `documentAliases` in knowledge.json. An empty object here
      // means "no aliases", which is the correct behavior for any
      // future page that reuses this config shape without ships-set
      // legacy ids.
      parsed.documentAliases = (parsed.documentAliases && typeof parsed.documentAliases === 'object')
        ? parsed.documentAliases
        : {};
      return parsed;
    } catch (_e) {
      // eslint-disable-next-line no-console
      console.warn('[knowledge-doc-detail] Malformed config JSON; falling back to not-found state.');
      return null;
    }
  }

  // ── Query-param reader ──────────────────────────────────────────────
  // Uses URLSearchParams (widely supported — IE11 was dropped years
  // ago; every Chromium/Firefox/Safari the prototype targets ships
  // it natively). Empty / whitespace-only ids collapse to null so the
  // not-found branch below fires immediately.
  function readIdFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      var raw = params.get('id');
      if (!raw) return null;
      var trimmed = String(raw).trim();
      return trimmed ? trimmed : null;
    } catch (_e) {
      return null;
    }
  }

  // ── Catalog lookup ──────────────────────────────────────────────────
  // Linear scan is fine here — the catalog is a hand-curated list of
  // ~a dozen docs, and this runs exactly once per page load. Match is
  // an exact string compare on `id` (kebab-case in the shipped data)
  // so a case-mismatch on the URL returns null and takes the not-
  // found branch, preventing accidental fuzzy matches.
  function findDoc(catalog, id) {
    if (!id || !Array.isArray(catalog)) return null;
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i] && catalog[i].id === id) return catalog[i];
    }
    return null;
  }

  // ── Alias-aware resolver ────────────────────────────────────────────
  // Wraps `findDoc` with a single legacy-id fallback: when the direct
  // lookup misses, consult `aliases[id]` and retry once with the
  // aliased id. Returns `{ doc, resolvedId, aliased }` so the caller
  // can distinguish "hit on the original id" from "hit via an alias"
  // and — for the aliased case — correct the URL bar to the canonical
  // route (see `init()` below).
  //
  // Only ONE alias hop is honored. If `aliases[id]` also happens to
  // be an alias, we do NOT recurse — that would let a broken alias
  // chain silently mask a "not found" state, and the shipped table
  // never needs multi-hop resolution (every legacy id maps directly
  // to a current doc). If future data requires chaining, extend here
  // rather than at the caller so the URL-correction step still
  // reflects the final resolved id.
  function resolveDocId(catalog, aliases, id) {
    var direct = findDoc(catalog, id);
    if (direct) return { doc: direct, resolvedId: id, aliased: false };
    if (!aliases || typeof aliases !== 'object') {
      return { doc: null, resolvedId: id, aliased: false };
    }
    var aliasedId = aliases[id];
    if (!aliasedId || aliasedId === id) {
      return { doc: null, resolvedId: id, aliased: false };
    }
    var aliasedDoc = findDoc(catalog, aliasedId);
    if (aliasedDoc) {
      return { doc: aliasedDoc, resolvedId: aliasedId, aliased: true };
    }
    return { doc: null, resolvedId: id, aliased: false };
  }

  // ── URL correction ──────────────────────────────────────────────────
  // After an alias resolves, replace the current history entry with the
  // canonical `?id=<resolvedId>` route so the address bar, share-menu,
  // and any subsequent reload land on the current stable route rather
  // than the legacy one. `replaceState` (not `pushState`) keeps the
  // back button behavior identical to a direct load — the seller can
  // still hit Back to return to the Knowledge index without stepping
  // through an intermediate legacy-URL entry.
  //
  // Wrapped in a try/catch because `replaceState` can throw on very
  // old browsers with History API turned off (rare, but the drill-in
  // must never crash on load).
  function replaceUrlToCanonical(resolvedId) {
    if (!resolvedId || !window.history || typeof window.history.replaceState !== 'function') return;
    try {
      var params = new URLSearchParams(window.location.search || '');
      params.set('id', resolvedId);
      var newSearch = '?' + params.toString();
      // Preserve hash so #section-id deep links survive the correction.
      var newUrl = window.location.pathname + newSearch + (window.location.hash || '');
      window.history.replaceState(window.history.state || null, '', newUrl);
    } catch (_e) {
      // Silent — URL correction is a polish, not a correctness
      // requirement. The content still hydrates from the aliased doc.
    }
  }

  // ── Text formatting ─────────────────────────────────────────────────
  // Fill `{updatedBy}` / `{updatedAt}` slots in the template string.
  // If a value is missing we leave the token intact rather than
  // rendering "undefined"; a downstream QA sweep will catch a missing
  // author faster than a silent blank.
  function formatUpdatedLabel(template, doc) {
    if (!doc) return '';
    return String(template || '')
      .replace('{updatedBy}', doc.updatedBy || '{updatedBy}')
      .replace('{updatedAt}', doc.updatedAt || '{updatedAt}');
  }

  // ── Draft persistence (localStorage) ────────────────────────────────
  // A single JSON envelope per doc id so a future schema tweak has
  // room to grow without another migration key. Every read/write is
  // wrapped in try/catch so:
  //   • Private-mode Safari (throws on any set) never crashes.
  //   • Sandboxed contexts where storage is blocked degrade to a
  //     "no autosave" experience rather than a broken page.
  //   • A stored blob authored by a future version is ignored (bad
  //     JSON → null → treated as "no draft").

  function getDraftKey(id) {
    return DRAFT_KEY_PREFIX + String(id);
  }

  // Envelope schema:
  //   v: 2         — schema version. Older `v: 1` envelopes lacked a
  //                  baseline anchor, so a draft authored against an
  //                  older `doc.markdown` would silently overwrite the
  //                  current shipped markdown on load. v: 2 stores the
  //                  baseline the draft was authored against and
  //                  invalidates the draft when the current baseline
  //                  no longer matches.
  //   markdown     — the user's unsaved edits.
  //   baseline     — the `doc.markdown` value that was on-disk at the
  //                  moment `writeDraft` ran. Serves as the anchor for
  //                  detecting shipped-markdown changes across
  //                  sessions.
  //   savedAt      — wall-clock timestamp for future TTL logic.
  //
  // Read path returns the draft's `markdown` ONLY when the caller's
  // `currentBaseline` matches the stored `baseline`. When they diverge,
  // the entry is stale (the shipped doc changed underneath the draft)
  // and we both (a) return null so the caller falls back to the shipped
  // markdown, and (b) clear the stale entry from storage so future
  // loads don't keep rediscarding it.
  function readDraft(id, currentBaseline) {
    if (!id) return null;
    try {
      var raw = window.localStorage.getItem(getDraftKey(id));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      // v: 1 envelopes had no baseline. Treat them as stale
      // unconditionally — the ONE case where restoring one would still
      // be correct is if the shipped markdown hasn't changed since it
      // was authored, which we can't verify without the baseline. The
      // safe default is to drop them; the seller re-loses at most one
      // session of unsaved edits.
      if (parsed.v !== 2) {
        clearDraft(id);
        return null;
      }
      if (typeof parsed.markdown !== 'string') return null;
      if (typeof parsed.baseline !== 'string') {
        clearDraft(id);
        return null;
      }

      var baseline = String(currentBaseline == null ? '' : currentBaseline);
      if (parsed.baseline !== baseline) {
        // Shipped markdown changed since this draft was written.
        // The draft is anchored to a version of the doc that no
        // longer exists — silently drop it.
        clearDraft(id);
        return null;
      }

      return parsed.markdown;
    } catch (_e) {
      return null;
    }
  }

  function writeDraft(id, markdown, baseline) {
    if (!id) return;
    try {
      var payload = JSON.stringify({
        v: 2,
        markdown: String(markdown == null ? '' : markdown),
        baseline: String(baseline == null ? '' : baseline),
        savedAt: Date.now()
      });
      window.localStorage.setItem(getDraftKey(id), payload);
    } catch (_e) {
      // Storage full / disabled / cross-origin sandbox — silently
      // skip. The next save / cancel still works; only the
      // "restore across sessions" affordance degrades.
    }
  }

  function clearDraft(id) {
    if (!id) return;
    try {
      window.localStorage.removeItem(getDraftKey(id));
    } catch (_e) {
      // Same tolerance as writeDraft — no state to clean up if the
      // remove call is what's failing.
    }
  }

  // ── Small helpers ───────────────────────────────────────────────────
  // Debounce factory. Trailing-only (fires after the last call plus
  // the delay). Kept generic — used by the autosave listener today
  // and available for any future keystroke-driven hook.
  function debounce(fn, delayMs) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(ctx, args);
      }, delayMs);
    };
  }

  // Announcement helper. Writes text into the aria-live region so
  // screen readers pick up the transition. Setting textContent to an
  // empty string first + reassigning after a microtask is what forces
  // some AT engines (VoiceOver in particular) to re-announce the same
  // message twice in a row — without the reset a second "Saved" a
  // few seconds after the first would go silent.
  function announce(statusEl, message) {
    if (!statusEl || !message) return;
    // Reset first so back-to-back identical messages re-announce.
    statusEl.textContent = '';
    // Defer the actual write until the next microtask so the DOM
    // diff registers as a change.
    Promise.resolve().then(function () {
      statusEl.textContent = String(message);
    });
  }

  // ── DOM hydration paths ─────────────────────────────────────────────
  // Two mutually-exclusive branches: `hydrateFound` (a doc resolved,
  // show the reader + editor + wire dirty tracking) and
  // `hydrateNotFound` (nothing matched, show the empty state and
  // stop). Kept as separate functions so a future test can drive
  // each one in isolation.

  function hydrateFound(root, doc, config) {
    var titleEl   = root.querySelector('[data-sh-knowledge-doc-detail-title]');
    var updatedEl = root.querySelector('[data-sh-knowledge-doc-detail-updated]');
    var previewEl = root.querySelector('[data-knowledge-preview]');
    var editEl    = root.querySelector('[data-knowledge-edit]');
    var notFoundEl = root.querySelector('[data-sh-knowledge-doc-detail-notfound]');
    var commitEl  = root.querySelector('[data-sh-knowledge-doc-detail-commit]');
    var saveBtn   = root.querySelector('[data-sh-knowledge-doc-detail-save]');
    var cancelBtn = root.querySelector('[data-sh-knowledge-doc-detail-cancel]');
    var statusEl  = root.querySelector('[data-sh-knowledge-doc-detail-status]');
    var textareaEl = root.querySelector('[data-knowledge-editor-textarea]');

    // Overwrite the article-header slot with the matched doc's name.
    // `textContent` (not innerHTML) so a name that contains markdown
    // / HTML syntax renders verbatim in the title.
    if (titleEl && doc.name) {
      titleEl.textContent = doc.name;
    }

    // Updated caption. Hidden entirely when we don't have both fields
    // to fill (rather than rendering a template with unresolved
    // tokens).
    if (updatedEl) {
      if (doc.updatedBy && doc.updatedAt) {
        updatedEl.textContent = formatUpdatedLabel(config.updatedLabelTemplate, doc);
        updatedEl.hidden = false;
      } else {
        updatedEl.textContent = '';
        updatedEl.hidden = true;
      }
    }

    // Sync the document-level title with the doc name so the browser
    // tab, bookmark, and back-forward history all show the doc name
    // instead of the generic "Knowledge Document" fallback.
    if (doc.name) {
      document.title = doc.name;
    }

    // Reveal Preview + Edit; keep the not-found block hidden.
    if (previewEl) previewEl.hidden = false;
    if (editEl) editEl.hidden = false;
    if (notFoundEl) notFoundEl.hidden = true;

    // Toggle helpers for the commit cluster. Kept as small closures
    // so both the module callback and the click handlers below share
    // one implementation.
    function showCommit() {
      if (commitEl) commitEl.hidden = false;
    }
    function hideCommit() {
      if (commitEl) commitEl.hidden = true;
    }

    // Hand off to the shared module. `initialSource` is the row's
    // shipped `doc.markdown` — this becomes the module's baseline for
    // Cancel + dirty tracking. If a localStorage draft is found
    // below, we REHYDRATE the textarea to the draft AFTER create()
    // returns; the module then sees a divergence and fires
    // `onDirtyChange(true)` naturally.
    //
    // `scrollRoot` points at the body region (the actual scroll
    // container on this page). Without this the module's
    // IntersectionObserver would key off the viewport, which is a
    // parent of the body but never scrolls here (viewport-lock rule
    // on `.seller-home--knowledge-detail`), so the "active section"
    // indicator would never update.
    var view = window.KnowledgeDocumentView.create({
      root:         root,
      initialSource: doc.markdown || '',

      // Preview surface.
      preview:       previewEl,
      article:       root.querySelector('[data-knowledge-article]'),
      toc:           root.querySelector('[data-knowledge-toc]'),
      tocList:       root.querySelector('[data-knowledge-toc-list]'),
      tocBody:       root.querySelector('[data-knowledge-toc-body]'),
      railIndicator: root.querySelector('[data-knowledge-toc-rail-indicator]'),

      // Edit surface.
      edit:         editEl,
      editorRoot:   root.querySelector('[data-knowledge-editor-root]'),
      textarea:     textareaEl,
      highlight:    root.querySelector('[data-knowledge-editor-highlight]'),
      gutter:       root.querySelector('[data-knowledge-editor-gutter]'),
      code:         root.querySelector('[data-knowledge-editor-code]'),
      currentLine:  root.querySelector('[data-knowledge-editor-current-line]'),

      // View toggle + toolbar. The toggle buttons live inside the
      // outer chrome header (which is a sibling of the body, not a
      // child of it), so we still look them up from `root` — the
      // outer `.seller-home__knowledge-doc-detail` wrapper contains
      // both the header and the body.
      toggleButtons:         root.querySelectorAll('[data-knowledge-view]'),
      toolbarFormatButtons:  root.querySelectorAll('[data-knowledge-format]'),
      toolbarHistoryButtons: root.querySelectorAll('[data-knowledge-history]'),
      toolbarMenus:          root.querySelectorAll('[data-knowledge-toolbar-menu]'),

      // The body region owns `overflow-y: auto` — pass the element,
      // not a selector, so a future rename doesn't break the wiring.
      scrollRoot: root.querySelector('[data-sh-knowledge-doc-detail-body]'),

      // ── Dirty / save / cancel callbacks ─────────────────────────
      //
      // `onDirtyChange` fires on EDGE transitions (clean → dirty
      // and dirty → clean). We use it to reveal / hide the commit
      // cluster — no per-keystroke dedupe needed here because the
      // module already suppresses repeat notifications while the
      // dirty state stays stable.
      onDirtyChange: function (isDirty) {
        if (isDirty) showCommit();
        else         hideCommit();
      },

      // `onSave(markdown)` fires after the module has snapshotted
      // the current textarea as the new baseline. We clear the
      // corresponding localStorage draft so a page refresh doesn't
      // resurrect the just-saved state as an "unsaved edit", and
      // announce the transition through the aria-live region.
      onSave: function (_markdown) {
        clearDraft(doc.id);
        var msg = (config.status && config.status.savedMessage) || 'Changes saved.';
        announce(statusEl, msg);
      },

      // `onCancel` fires after the module has reverted the
      // textarea + re-rendered both surfaces. Clear the draft so
      // the discarded state doesn't resurface on refresh, and
      // announce the transition.
      onCancel: function () {
        clearDraft(doc.id);
        var msg = (config.status && config.status.discardedMessage) || 'Unsaved changes discarded.';
        announce(statusEl, msg);
      }
    });

    // If the module refused to init (missing required nodes), bail.
    // The commit + autosave wiring below all assume a valid view.
    if (!view) return;

    // ── Restore any draft left by a previous session ────────────────
    // Runs AFTER create() so we can dispatch a synthetic `input`
    // event on the textarea and let the module's own listener rebuild
    // the overlay + gutter + fire `onDirtyChange(true)`. We also call
    // `view.renderPreview()` so the article + TOC reflect the draft
    // (the module's input listener refreshes the highlight overlay
    // but doesn't re-parse the preview).
    //
    // Short-circuit when the draft equals the shipped markdown — no
    // point in triggering a dirty→clean cycle on load when the two
    // are already identical.
    var draft = readDraft(doc.id, doc.markdown || '');
    if (draft !== null && draft !== (doc.markdown || '')) {
      if (textareaEl) {
        textareaEl.value = draft;
        // Rebuild the preview surface from the new textarea value.
        // Order matters: `renderPreview` first (rebuilds article +
        // TOC + scroll-spy), then dispatch input so the module's
        // overlay refresh + dirty-check fire against the settled
        // textarea state.
        try { view.renderPreview(); } catch (_e) {}
        try { textareaEl.dispatchEvent(new Event('input', { bubbles: true })); }
        catch (_e) {
          // IE fallback (unlikely in this codebase) — call the
          // module's snapshot-adjacent methods directly. Left as a
          // no-op branch because the dispatchEvent path works on
          // every browser this prototype targets.
        }
      }
      var restoredMsg = (config.status && config.status.restoredMessage)
        || 'Restored unsaved changes from your previous session.';
      announce(statusEl, restoredMsg);
    }

    // ── Autosave (debounced input listener) ─────────────────────────
    // Writes the current textarea value to localStorage ~400 ms after
    // the seller stops typing. Only writes when the module reports
    // dirty — a clean state means we shouldn't be persisting a
    // draft at all (Save / Cancel clears the entry; letting a clean
    // state re-write it would defeat the "no leftover drafts"
    // guarantee).
    //
    // Attached AFTER the module's own input listener (which was set
    // during create()) so the module's dirty-check + overlay refresh
    // run first — this callback sees the settled state.
    if (textareaEl) {
      var flushAutosave = debounce(function () {
        if (view.isDirty()) {
          // Anchor the draft to whatever shipped markdown this doc
          // was hydrated from. If `doc.markdown` changes in a later
          // build, readDraft() will detect the mismatch and drop
          // this envelope on the next load.
          writeDraft(doc.id, view.getSource(), doc.markdown || '');
        }
      }, AUTOSAVE_DEBOUNCE_MS);
      textareaEl.addEventListener('input', flushAutosave);
    }

    // ── Save / Cancel button click handlers ─────────────────────────
    // Both delegate to the module's public API; the callbacks above
    // handle the storage + announcement side effects.
    if (saveBtn) {
      saveBtn.addEventListener('click', function (e) {
        e.preventDefault();
        // Skip if no-op — `save()` on a clean state still snapshots
        // (harmless), but firing onSave (which clears the draft +
        // announces "Saved") on a clean click reads as confusing.
        if (!view.isDirty()) return;
        view.save();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (!view.isDirty()) return;
        var confirmMsg = (config.cancel && config.cancel.confirmMessage)
          || 'You have unsaved changes. Discard them?';
        // Native confirm keeps the prototype dependency-free. A
        // future dialog component can consume the same config
        // string when it lands.
        if (window.confirm(confirmMsg)) {
          view.cancel();
        }
      });
    }

    // ── beforeunload guard ─────────────────────────────────────────
    // Registered once. Every dirty state (including drafts restored
    // on load) triggers the browser's native "leave site?" prompt.
    // Custom text is ignored by every modern engine (Chrome / Firefox
    // / Safari all show their own copy), so we set `returnValue` to
    // an empty string just to opt in to the prompt.
    window.addEventListener('beforeunload', function (e) {
      if (view.isDirty()) {
        e.preventDefault();
        // Chrome + Edge require both `preventDefault` AND
        // `returnValue`; older Firefox / Safari respect just
        // `returnValue`. Setting both is the belt-and-suspenders
        // move that works everywhere.
        e.returnValue = (config.status && config.status.unloadMessage) || '';
        return e.returnValue;
      }
    });
  }

  function hydrateNotFound(root) {
    var titleEl   = root.querySelector('[data-sh-knowledge-doc-detail-title]');
    var updatedEl = root.querySelector('[data-sh-knowledge-doc-detail-updated]');
    var previewEl = root.querySelector('[data-knowledge-preview]');
    var editEl    = root.querySelector('[data-knowledge-edit]');
    var notFoundEl = root.querySelector('[data-sh-knowledge-doc-detail-notfound]');
    var commitEl  = root.querySelector('[data-sh-knowledge-doc-detail-commit]');

    // Hide Preview + Edit — they'd render the fallback article shell
    // with placeholder text, which reads as a half-loaded doc rather
    // than an intentional "not found" surface. Zero them from the
    // flow entirely.
    if (previewEl) previewEl.hidden = true;
    if (editEl) editEl.hidden = true;

    // Hide the commit cluster too — no doc means nothing to save or
    // discard, and leaving it visible would offer a nonsense action.
    if (commitEl) commitEl.hidden = true;

    // Blank the outer article header so the fallback title from the
    // template doesn't peek through above the empty state.
    if (titleEl) titleEl.textContent = '';
    if (updatedEl) {
      updatedEl.textContent = '';
      updatedEl.hidden = true;
    }

    // Reveal the not-found block. Copy is already rendered from JSON
    // at build time — nothing else to fill in from JS.
    if (notFoundEl) notFoundEl.hidden = false;
  }

  // ── Bootstrap ───────────────────────────────────────────────────────
  // Wraps everything above in the standard "wait for DOMContentLoaded"
  // guard so `[data-sh-knowledge-doc-detail]` is present when we look
  // for it. The rest of the page's scripts (home.js, the shared
  // module) don't depend on any state this file writes, so their own
  // init order is independent.
  function init() {
    var root = document.querySelector('[data-sh-knowledge-doc-detail]');
    if (!root) return; // Not on this page.

    var config = readConfig();
    if (!config) {
      // Malformed / missing config — fall back to the not-found state
      // so the seller still sees a meaningful surface instead of a
      // half-hydrated reader.
      hydrateNotFound(root);
      return;
    }

    var id = readIdFromUrl();
    var resolved = resolveDocId(config.catalog, config.documentAliases, id);
    if (resolved.doc) {
      // When the incoming id was aliased, swap the address bar over to
      // the current stable route before hydration so a page reload or
      // shared URL lands directly on the canonical doc instead of
      // making another alias hop.
      if (resolved.aliased) {
        replaceUrlToCanonical(resolved.resolvedId);
      }
      hydrateFound(root, resolved.doc, config);
    } else {
      hydrateNotFound(root);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
