// ─────────────────────────────────────────────────────────────────────────
// Seller Home — Skill detail / editor page controller
// (/skill_detail.html)
//
// Thin caller that:
//   1. Reads `?id=<id>` off the URL.
//   2. Reads the inlined page config (catalog + toolLibrary +
//      agentLibrary + statusLibrary + copy) from the
//      `#sh-skill-detail-config`
//      <script type="application/json"> block emitted by the template.
//   3. Resolves the matching skill row (by exact `id`) inside the
//      catalog.
//   4. Either
//        a. hydrates the breadcrumb, title, owning-agent + lifecycle
//           badges, metadata caption, and action clusters, wires the header
//           dialogs, and hands the
//           resulting state to the shared
//           `KnowledgeDocumentView.create({ alwaysEdit, livePreview })`
//           factory PLUS the Save / Cancel / beforeunload / draft /
//           saved-value wiring documented below, OR
//        b. shows the "not found" state and stops.
//
// Persistence model (prototype-scoped, no backend):
//   • Baseline. `skill.markdown` (from JSON) is the shipped baseline.
//     If a SESSION-scoped saved value exists it supersedes shipped.
//   • Draft. On every keystroke a debounced writer stores the current
//     textarea value to localStorage["sh:skills:draft:v1:<id>"] with
//     the current effective baseline embedded, so a subsequent load
//     can detect a stale draft and drop it.
//   • Load precedence:
//       1. sessionStorage saved value — last commit in this tab
//       2. skill.markdown             — shipped JSON baseline
//     Then, if a localStorage draft exists whose baseline still
//     matches the effective baseline, the textarea rehydrates to
//     the draft and the module flips into a dirty state.
//   • Save. Snapshots current textarea as the module baseline, writes
//     to sessionStorage, clears the draft, announces "Changes saved.".
//   • Cancel. Reverts the textarea to the module baseline, clears
//     the draft, announces "Unsaved changes discarded.".
//   • beforeunload. Registered once, gated by `view.isDirty()`.
//
// Actions:
//   • Use in Chat  — dispatch `sh:skill-use-in-chat` + navigate to
//                    /home.html#skill=<id>. Composer-prefill is a
//                    future follow-up.
//   • Schedule     — split button. Primary opens the "Schedule skill"
//                    placeholder from _skills_dialogs.html. Chevron
//                    opens a small dropdown seeded with "Schedule…" /
//                    "Manage schedule" (stub events).
//   • Kebab        — Duplicate / Share / Delete, gated by permission
//                    flags. Duplicate + Share are placeholders; Delete
//                    confirms via the destructive modal, then navigates
//                    back to /skills.html.
//
// Scope: runs ONLY on /skill_detail.html (the template loads it via
// `{% block scripts_extra %}`). Every other page ignores it because
// the `[data-sh-skill-detail]` root isn't in the DOM.
// ─────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // The page's editor is `SkillMarkdownEditor` — an always-editable
  // Markdown canvas that renders formatted content AND accepts direct
  // in-place edits. If the module didn't load (script tag missing, or
  // a syntax error somewhere upstream) we bail loudly: the page would
  // otherwise silently show the "not found" panel even for a valid
  // `?id=<id>` because there's nothing to hydrate the body with.
  if (!window.SkillMarkdownEditor || typeof window.SkillMarkdownEditor.create !== 'function') {
    // eslint-disable-next-line no-console
    console.warn('[skill-detail] SkillMarkdownEditor module not loaded; skipping init.');
    return;
  }

  // ── Supporting-skill chip icon (inline SVG) ──────────────────────────
  // Figma 9891:29260 "Resource Chip / Icon" — the design ships the
  // glyph as two separate `<path>` runs:
  //
  //   • Scroll body (14.7692 × 14.1538) positioned inside the 16-px
  //     container at inset (3.85%, 5.77%) → translate(0.616 0.9232).
  //   • Diamond sparkle (6.15296 × 6.153) positioned at
  //     top: 23.08%, left: 36.54%, right: 25%, bottom: 38.46%
  //     → translate(5.8464 3.6928).
  //
  // Both runs are wrapped in a `<g transform>` rather than manually
  // baked into the `d` coordinates so re-syncing from a future
  // Figma export just means dropping in the raw path string, no
  // arithmetic. `fill="currentColor"` on the root cascades to both
  // paths (the Figma export uses `#1B96FF` inline; we strip that so
  // CSS can drive the tint from `.seller-home__skill-chip-icon`).
  //
  // Verbatim inline copy of `src/assets/images/skill-chip.svg` —
  // keep the two in sync so any downstream consumer of the file (or
  // an offline tooling script that reads it) sees the same geometry.
  // Rendered via `insertAdjacentHTML('afterbegin', …)` inside each
  // supporting-skill anchor by `enrichSupportingSkillLinks`.
  var SKILL_CHIP_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" class="seller-home__skill-chip-icon" data-sh-skill-chip-icon viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><g transform="translate(0.616 0.9232)"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.4591 0C12.434 0 13.2409 0.758083 13.3017 1.73107L13.8242 10.0922H13.8462C14.3702 10.0922 14.7692 10.5235 14.7692 11.0231V12.277C14.7692 13.2992 13.9569 14.1538 12.9231 14.1538H5.23077V14.153C5.21938 14.1532 5.20797 14.1538 5.19652 14.1538C4.19111 14.1538 3.39997 13.3304 3.38523 12.3402L2.92969 4.61538H0.923077C0.413277 4.61538 0 4.20212 0 3.69231V1.84615C0 0.826551 0.826551 0 1.84615 0H11.4591ZM7.0084 12.3119C7.0084 12.5253 6.97191 12.731 6.90535 12.9231H12.9231C13.2487 12.9231 13.5384 12.6482 13.5385 12.277V11.323H7.0084V12.3119ZM3.88643 1.23077C3.95646 1.42473 3.99597 1.63301 3.99911 1.84916L4.61418 12.2758L4.61538 12.2939V12.3119C4.61538 12.6638 4.88978 12.923 5.19652 12.9231C5.50326 12.9231 5.77763 12.6638 5.77763 12.3119V11.0231C5.77763 10.5235 6.17674 10.0923 6.70071 10.0922H12.591L12.0733 1.80769C12.053 1.4834 11.7841 1.23077 11.4591 1.23077H3.88643ZM1.84615 1.23077C1.50629 1.23077 1.23077 1.50629 1.23077 1.84615V3.38462H2.85726L2.77043 1.91316L2.76923 1.89513V1.8768C2.76917 1.50559 2.47945 1.23077 2.15385 1.23077H1.84615Z"/></g><g transform="translate(5.8464 3.6928)"><path d="M2.80839 0.135688C2.89334 -0.0416965 3.14762 -0.0461579 3.23867 0.128181L3.8826 1.36166C4.07491 1.73298 4.3835 2.03049 4.76153 2.2096L6.01722 2.80997C6.19473 2.89483 6.1991 3.14889 6.02473 3.23993L4.79067 3.88387C4.41913 4.07609 4.12131 4.38437 3.94211 4.76218L3.34143 6.01729C3.25651 6.1947 3.00223 6.19917 2.91116 6.0248L2.26691 4.79132C2.07463 4.42006 1.7663 4.12249 1.38833 3.94338L0.135619 3.3427C-0.0416732 3.25778 -0.046135 3.00409 0.128111 2.91304L1.36217 2.2691C1.73371 2.07689 2.03147 1.76535 2.21073 1.3908L2.80839 0.135688Z"/></g></svg>';

  // ── Storage keys / knobs ─────────────────────────────────────────────
  // Draft envelope key stays LOCAL to this controller. Committed
  // saves route through `window.SkillStore` (see `skill_store.js`) —
  // that module owns its own key prefix. Keeping the two spaces
  // separate makes it obvious in DevTools which entries are
  // "in-flight draft" vs "committed save".
  var DRAFT_KEY_PREFIX     = 'sh:skills:draft:v1:';
  var AUTOSAVE_DEBOUNCE_MS = 400;

  // Placeholder identity for the "current user" in the prototype.
  // Real deployments overwrite this by reading the seller's name
  // out of the global shell (or a `?userName=` override for demos).
  // Wired through `SkillStore.save({ currentUserName })` so the
  // committed `updatedBy` reflects who actually edited.
  var DEFAULT_CURRENT_USER = 'You';

  // ── Config-block reader ──────────────────────────────────────────────
  function readConfig() {
    var node = document.getElementById('sh-skill-detail-config');
    if (!node) return null;
    try {
      var parsed = JSON.parse(node.textContent || '{}');
      if (!parsed || typeof parsed !== 'object') return null;
      parsed.catalog     = Array.isArray(parsed.catalog) ? parsed.catalog : [];
      parsed.toolLibrary = (parsed.toolLibrary && typeof parsed.toolLibrary === 'object')
        ? parsed.toolLibrary
        : {};
      // Keyed registry of owning agents (`{ sales: { label } }`). The
      // resolved skill's `agent` key indexes into it for the header
      // badge. An empty object is a valid state, not a failure: it
      // just means no skill can resolve a label, so the badge stays
      // hidden — see `paintAgentBadge()`.
      parsed.agentLibrary = (parsed.agentLibrary && typeof parsed.agentLibrary === 'object')
        ? parsed.agentLibrary
        : {};
      // Keyed registry of lifecycle statuses (`{ published: { label } }`),
      // read by the `status` key the same way — see
      // `paintStatusBadge()`.
      parsed.statusLibrary = (parsed.statusLibrary && typeof parsed.statusLibrary === 'object')
        ? parsed.statusLibrary
        : {};
      // `tabs` powers the breadcrumb switcher's scope picklist. It
      // is the SAME block /skills.html renders its tab row from, so
      // the two surfaces can never drift apart on which ownership
      // buckets exist or what they're called.
      parsed.tabs = (parsed.tabs && typeof parsed.tabs === 'object') ? parsed.tabs : {};
      parsed.tabs.items = Array.isArray(parsed.tabs.items) ? parsed.tabs.items : [];
      var d = (parsed.detail && typeof parsed.detail === 'object') ? parsed.detail : {};
      d.fallbackTitle = typeof d.fallbackTitle === 'string' ? d.fallbackTitle : 'Skill';
      d.notFound        = (d.notFound        && typeof d.notFound        === 'object') ? d.notFound        : {};
      d.cancel          = (d.cancel          && typeof d.cancel          === 'object') ? d.cancel          : {};
      d.status          = (d.status          && typeof d.status          === 'object') ? d.status          : {};
      d.actions         = (d.actions         && typeof d.actions         === 'object') ? d.actions         : {};
      // Save flow copy blocks (added 2026-08-11 with the Save +
      // validation + versioning implementation). Each defends to
      // an empty object so `detail.<key>.<field>` reads with the
      // OR-fallback pattern above stay safe when a caller ships an
      // older config JSON.
      d.save          = (d.save          && typeof d.save          === 'object') ? d.save          : {};
      d.toast         = (d.toast         && typeof d.toast         === 'object') ? d.toast         : {};
      d.saveError     = (d.saveError     && typeof d.saveError     === 'object') ? d.saveError     : {};
      d.titleMismatch = (d.titleMismatch && typeof d.titleMismatch === 'object') ? d.titleMismatch : {};
      d.validation    = (d.validation    && typeof d.validation    === 'object') ? d.validation    : {};
      d.switcher      = (d.switcher      && typeof d.switcher      === 'object') ? d.switcher      : {};
      // Metadata caption. Defined as PARTS on the JSON side (each
      // part is a template referencing skill fields) and assembled
      // by `assembleMetadata()` below. Falls back to a sensible
      // default part set so callers with missing detail blocks
      // still render something meaningful.
      d.metadata = (d.metadata && typeof d.metadata === 'object') ? d.metadata : {};
      d.metadata.separator = typeof d.metadata.separator === 'string' ? d.metadata.separator : ' \u00b7 ';
      d.metadata.parts     = Array.isArray(d.metadata.parts) ? d.metadata.parts : [
        { id: 'createdBy', template: 'Created by {createdBy}' },
        { id: 'updated',   template: 'Last updated {updatedAt} by {updatedBy}' },
        { id: 'version',   template: '{version}' }
      ];
      parsed.detail = d;
      return parsed;
    } catch (_e) {
      // eslint-disable-next-line no-console
      console.warn('[skill-detail] Malformed config JSON; falling back to not-found state.');
      return null;
    }
  }

  // ── URL / catalog / text helpers ─────────────────────────────────────
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

  function findSkill(catalog, id) {
    if (!id || !Array.isArray(catalog)) return null;
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i] && catalog[i].id === id) return catalog[i];
    }
    return null;
  }

  // ── Metadata assembly ────────────────────────────────────────────────
  // Header metadata caption is assembled at render time from
  // individual fields on the skill record — no pre-composed sentence
  // lives in JSON. Each PART carries a template with `{placeholder}`
  // slots. `resolvePart()` fills the placeholders against the skill;
  // if ANY placeholder resolves to an empty value, the part returns
  // `null` and the caller drops it from the output. Non-empty parts
  // are joined by the configured separator.
  //
  // The `keys` returned by `metadataKeysOf()` are the fields
  // referenced by each part's template — precomputed once so the
  // hot path is a straight string.replace loop.
  function metadataKeysOf(template) {
    var keys = [];
    var re = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
    var m;
    while ((m = re.exec(String(template || ''))) !== null) {
      if (keys.indexOf(m[1]) < 0) keys.push(m[1]);
    }
    return keys;
  }

  function resolvePart(part, skill) {
    if (!part || typeof part.template !== 'string' || !skill) return null;
    var keys = metadataKeysOf(part.template);
    if (keys.length === 0) return part.template.trim() || null;
    var out = part.template;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var value = skill[key];
      // Treat undefined / null / "" / whitespace as missing. If any
      // required key is missing, the part is dropped entirely (we
      // don't want to render "Created by " with a dangling
      // trailing space).
      if (value == null || String(value).trim() === '') return null;
      out = out.split('{' + key + '}').join(String(value));
    }
    return out.trim() || null;
  }

  function assembleMetadata(metadataCfg, skill) {
    if (!skill) return '';
    var parts     = Array.isArray(metadataCfg && metadataCfg.parts) ? metadataCfg.parts : [];
    var separator = typeof (metadataCfg && metadataCfg.separator) === 'string'
      ? metadataCfg.separator
      : ' \u00b7 ';
    var resolved = [];
    for (var i = 0; i < parts.length; i++) {
      var p = resolvePart(parts[i], skill);
      if (p) resolved.push(p);
    }
    return resolved.join(separator);
  }

  // ── Title badges ─────────────────────────────────────────────────────
  // Pills annotating a skill's name: which agent owns it, and where it
  // sits in its publishing lifecycle. The agent pill is drawn in two
  // places — the header, beside the page title, and every row of the
  // breadcrumb switcher's list — and both mirror, at runtime, what
  // `_skill_list.html` does at render time on the list page: same
  // `agentLibrary` registry, same class names, same tints. The status
  // pill is header-only (see the `status` note in skills.json).
  //
  // Every failure mode lands on "no badge" rather than a half-painted
  // one: no key on the skill, a key with no registry entry (a typo), an
  // entry with no usable label, or a dead `?id=`. That matches the list
  // page, where the pill is gated on the same lookup resolving.
  var AGENT_BADGE_BASE_CLASS  = 'slds-badge seller-home__skill-agent-badge';
  var STATUS_BADGE_BASE_CLASS = 'slds-badge seller-home__skill-status-badge';

  // Resolves `skill[field]` against a keyed registry to `{ key, label }`,
  // where an empty `label` is the signal for "draw nothing". Every
  // caller below gates on it, so the rule for what counts as a
  // paintable badge lives in exactly one place for both registries.
  function registryEntryOf(skill, field, library) {
    var key   = (skill && typeof skill[field] === 'string') ? skill[field].trim() : '';
    var entry = (key && library) ? library[key] : null;
    var label = (entry && typeof entry.label === 'string') ? entry.label.trim() : '';
    return { key: key, label: label };
  }

  function agentBadgeClass(key, extraClass) {
    return AGENT_BADGE_BASE_CLASS +
      (extraClass ? ' ' + extraClass : '') +
      (key ? ' seller-home__skill-agent-badge--' + key : '');
  }

  function statusBadgeClass(key) {
    return STATUS_BADGE_BASE_CLASS +
      (key ? ' seller-home__skill-status-badge--' + key : '');
  }

  // Header badges. Unlike the switcher rows, these elements already
  // exist in the template (shipped empty + hidden, because the page is
  // generic until `?id=` resolves), so they are repainted rather than
  // built.
  //
  // Both assign the whole `className` (rather than adding a variant
  // class), which makes them idempotent: the previous tint drops
  // without either function needing to know the list of variants to
  // remove. Today they run once per load — the switcher navigates
  // rather than swapping the skill in place — so that is insurance,
  // not a live requirement.
  function paintAgentBadge(root, skill, agentLibrary) {
    var badgeEl = root.querySelector('[data-sh-skill-detail-agent]');
    if (!badgeEl) return;

    // The label goes in an inner span so the assistive-text prefix
    // ("Owned by") beside it survives every repaint.
    var labelEl = badgeEl.querySelector('[data-sh-skill-detail-agent-label]') || badgeEl;
    var agent   = registryEntryOf(skill, 'agent', agentLibrary);

    badgeEl.className = agentBadgeClass(
      agent.label ? agent.key : '',
      'seller-home__skill-detail-agent-badge'
    );
    labelEl.textContent = agent.label;
    badgeEl.hidden = !agent.label;
  }

  // Same shape as the agent badge above, one registry over. The inner
  // label span matters more here: this pill also holds the status dot
  // and an assistive-text prefix, neither of which may be clobbered by
  // a repaint.
  function paintStatusBadge(root, skill, statusLibrary) {
    var badgeEl = root.querySelector('[data-sh-skill-detail-status-badge]');
    if (!badgeEl) return;

    var labelEl = badgeEl.querySelector('[data-sh-skill-detail-status-badge-label]');
    var status  = registryEntryOf(skill, 'status', statusLibrary);

    badgeEl.className = statusBadgeClass(status.label ? status.key : '');
    if (labelEl) labelEl.textContent = status.label;
    badgeEl.hidden = !status.label;
  }

  // Switcher-row badge. Returns a fresh element, or null when the skill
  // has no resolvable agent — the caller appends only what it gets, so
  // an unowned row keeps its bare name exactly as before.
  //
  // No size modifier here, so it inherits the base 10 px / 20 px pill.
  // That is deliberate: these rows carry a 14-px name, the same as the
  // list rows, and the badge is sized against the title it annotates.
  // The header's larger 12/25 goes with its 20-px page heading.
  function createAgentBadge(skill, agentLibrary) {
    var agent = registryEntryOf(skill, 'agent', agentLibrary);
    if (!agent.label) return null;

    var badge = document.createElement('span');
    badge.className = agentBadgeClass(agent.key);
    badge.textContent = agent.label;
    return badge;
  }

  // ── Draft persistence (localStorage) ─────────────────────────────────
  // Envelope shape mirrors Knowledge's draft envelope so failures
  // degrade identically in blocked-storage / private-mode contexts.
  function getDraftKey(id) { return DRAFT_KEY_PREFIX + String(id); }

  function readDraft(id, currentBaseline) {
    if (!id) return null;
    try {
      var raw = window.localStorage.getItem(getDraftKey(id));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.v !== 2) { clearDraft(id); return null; }
      if (typeof parsed.markdown !== 'string') return null;
      if (typeof parsed.baseline !== 'string') { clearDraft(id); return null; }
      var baseline = String(currentBaseline == null ? '' : currentBaseline);
      if (parsed.baseline !== baseline) {
        clearDraft(id);
        return null;
      }
      return parsed.markdown;
    } catch (_e) { return null; }
  }

  function writeDraft(id, markdown, baseline) {
    if (!id) return;
    try {
      var payload = JSON.stringify({
        v: 2,
        markdown: String(markdown == null ? '' : markdown),
        baseline: String(baseline == null ? '' : baseline),
        savedAt:  Date.now()
      });
      window.localStorage.setItem(getDraftKey(id), payload);
    } catch (_e) { /* silent — same tolerance Knowledge uses. */ }
  }

  function clearDraft(id) {
    if (!id) return;
    try { window.localStorage.removeItem(getDraftKey(id)); }
    catch (_e) { /* nothing to clean up. */ }
  }

  // ── Saved persistence (SkillStore) ───────────────────────────────────
  // Committed saves route through `window.SkillStore`. See
  // `skill_store.js` for the envelope shape + versioning. This
  // controller never reads or writes the committed-save space
  // directly.
  //
  // Refresh survival: SkillStore persists to LOCALSTORAGE, so a
  // subsequent load (same origin, same browser) restores the saved
  // markdown / version / metadata. Private-mode browsers and any
  // browser with storage disabled fall back to the shipped JSON
  // baseline on each page load — SkillStore.save() rejects with
  // `code === 'storage_unavailable'` in that case and the save
  // flow surfaces the message to the user.
  function loadEffectiveSkill(skill) {
    if (!skill) return { record: skill, hasLocalOverride: false };
    if (!window.SkillStore || typeof window.SkillStore.load !== 'function') {
      return { record: skill, hasLocalOverride: false };
    }
    try { return window.SkillStore.load(skill.id, skill); }
    catch (_e) { return { record: skill, hasLocalOverride: false }; }
  }

  // ── Small helpers ────────────────────────────────────────────────────
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

  function announce(statusEl, message) {
    if (!statusEl || !message) return;
    statusEl.textContent = '';
    Promise.resolve().then(function () { statusEl.textContent = String(message); });
  }

  function closest(node, selector) {
    while (node && node.nodeType === 1) {
      if (node.matches && node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  // ── Validation ───────────────────────────────────────────────────────
  // Runs BEFORE persistence. Callers pass the current draft markdown
  // + a small options bag; we return `{ ok, errors, warnings }`.
  //
  // Rules:
  //   • Empty document      — reject.
  //   • Missing H1          — reject (a skill must name itself).
  //   • H1 mismatch         — WARN (user confirms via title-mismatch
  //                           dialog). Never rewritten silently.
  //   • Unsafe HTML tags    — reject any raw `<script>`, `<iframe>`,
  //                           `<object>`, `<embed>`, `<style>`,
  //                           `<link>`, `<meta>`, or on-* event
  //                           handlers.
  //   • Unsafe link URL     — reject `javascript:`, `data:`,
  //                           `vbscript:`, or file: protocols.
  //                           Allow http/https/mailto/tel/relative.
  //   • Missing referenced  — WARN if a supporting-skill link points
  //     supporting-skill IDs   at an id not in the catalog.
  //
  // We deliberately DO NOT enforce structural requirements beyond an
  // H1 — the spec says "Do not reject ordinary Markdown because an
  // optional section is missing." Section headings like "What this
  // skill does" or "Guardrails" are conventions, not gates.
  var UNSAFE_HTML_RE = /<\s*(script|iframe|object|embed|style|link|meta|base|form)\b[^>]*>/i;
  var UNSAFE_EVENT_ATTR_RE = /<[^>]+\son[a-z]+\s*=/i;
  // Match markdown link (`[…](URL)`) OR image (`![…](URL)`), capture
  // the URL group. The URL group ends before a closing paren OR a
  // whitespace/title character. We do NOT try to be a full Markdown
  // parser — this is a defensive check against `[label](javascript:…)`
  // style injection.
  var MARKDOWN_LINK_URL_RE = /!?\[[^\]\n]*\]\(\s*([^\s)]+)/g;
  var UNSAFE_URL_RE = /^\s*(javascript|vbscript|data|file):/i;
  // Allow inline data:image/... in Markdown image URLs (small
  // decorative SVGs) — everything else in the data: scheme is
  // rejected outright.
  var SAFE_DATA_IMAGE_RE = /^\s*data:image\//i;

  function validateMarkdown(md, options) {
    var errors   = [];
    var warnings = [];
    var text     = String(md || '');
    var opts     = options || {};
    var copy     = opts.copy || {};
    var catalog  = Array.isArray(opts.catalog) ? opts.catalog : [];
    var name     = String(opts.displayName || '').trim();

    // ── 1. Empty document ────────────────────────────────────────────
    if (!text.trim()) {
      errors.push({
        code:    'empty',
        message: copy.emptyDocument
          || 'Add some content before saving. The document can\u2019t be empty.'
      });
      return { ok: false, errors: errors, warnings: warnings };
    }

    // ── 2. Missing H1 ────────────────────────────────────────────────
    // Match either `# Title` (ATX) or a Setext underline (`===`).
    // Match at line start; guard against `#` inside code fences by
    // stripping fenced blocks before scanning.
    var stripped = stripFencedCode(text);
    var atxMatch = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(stripped);
    var setextMatch = /^([^\s\n][^\n]*)\n=+\s*$/m.exec(stripped);
    var h1Text = null;
    if (atxMatch) h1Text = String(atxMatch[1]).trim();
    else if (setextMatch) h1Text = String(setextMatch[1]).trim();

    if (!h1Text) {
      errors.push({
        code:    'missing_h1',
        message: copy.missingH1
          || 'Add a top-level heading (H1) that names this skill before saving.'
      });
    }

    // ── 3. Unsafe HTML ───────────────────────────────────────────────
    if (UNSAFE_HTML_RE.test(text) || UNSAFE_EVENT_ATTR_RE.test(text)) {
      errors.push({
        code:    'unsafe_html',
        message: copy.unsafeHtml
          || 'Remove embedded HTML like <script>, <iframe>, or <style> tags. Scripts and framed content aren\u2019t allowed.'
      });
    }

    // ── 4. Unsafe URL protocols ──────────────────────────────────────
    var m;
    MARKDOWN_LINK_URL_RE.lastIndex = 0;
    while ((m = MARKDOWN_LINK_URL_RE.exec(text)) !== null) {
      var url = m[1];
      if (UNSAFE_URL_RE.test(url)) {
        var isImage = text.charAt(m.index) === '!';
        // The one narrow exception: `![alt](data:image/…)` for a
        // legitimate inline image asset. Everything else is a hard
        // reject.
        if (!(isImage && SAFE_DATA_IMAGE_RE.test(url))) {
          errors.push({
            code:    'unsafe_link',
            message: copy.unsafeLink
              || 'One or more links use an unsafe protocol. Only http, https, mailto, tel, and site-relative URLs are allowed.'
          });
          break; // one message covers the batch — no per-URL spam.
        }
      }
    }

    // ── 5. Title mismatch (warning) ──────────────────────────────────
    if (h1Text && name && normalizeTitle(h1Text) !== normalizeTitle(name)) {
      warnings.push({
        code:    'h1_mismatch',
        message: '',
        h1:      h1Text,
        name:    name
      });
    }

    // ── 6. Supporting-skill references (warning) ─────────────────────
    // Only warn when the link is authored with the canonical
    // detail-route href pattern — that's the structural form. Free-
    // form external links are out of scope.
    var supportingRe = /!?\[[^\]\n]*\]\(\s*\/skill_detail\.html\?id=([^)\s]+)/g;
    var missingIds = [];
    var mm;
    while ((mm = supportingRe.exec(text)) !== null) {
      var id = decodeURIComponent(mm[1]);
      if (!findSkill(catalog, id) && missingIds.indexOf(id) < 0) {
        missingIds.push(id);
      }
    }
    if (missingIds.length) {
      warnings.push({
        code:      'missing_supporting_skills',
        message:   '',
        missingIds: missingIds
      });
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  }

  // Strip fenced code blocks so a `#` inside a code fence doesn't
  // masquerade as a real H1. Handles ``` and ~~~ fences with any
  // language hint.
  function stripFencedCode(md) {
    return String(md || '').replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
  }

  // Case-insensitive, whitespace-collapsed title compare so a
  // rename like "Daily Pipeline Snapshot" vs "Daily  Pipeline
  // Snapshot" (extra whitespace on paste) doesn't fire a false
  // warning.
  function normalizeTitle(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // ── Dialog primitives ────────────────────────────────────────────────
  // Self-contained because the skillActionRouter on /skills.html that
  // owns the shared dialogs is scoped to that page's grid root. On
  // /skill_detail.html there is no grid, so the router never runs and
  // its document-level dismiss handlers never register. We recreate
  // the minimum: open/close, click dismissal, Escape dismissal.
  var currentDialogTrigger = null;
  var pendingDeleteHandler = null;
  // One pending-handler slot per confirmation dialog. Kept as
  // separate globals rather than a `Map` so a bad state (e.g. a
  // discard confirm firing while a save-confirm is queued) is
  // impossible: each dialog reads/writes its own slot.
  var pendingDiscardHandler = null;
  var pendingTitleMismatchHandler = null;
  var pendingTitleMismatchDismiss = null;
  // Leave-without-saving dialog (Schedule click while dirty). Two
  // handler slots — one for the primary "Save and leave" branch,
  // one for the destructive "Discard changes" branch — kept
  // separate for the same reason the other dialogs use per-branch
  // slots (an accidental cross-fire is architecturally impossible).
  var pendingLeaveSaveHandler    = null;
  var pendingLeaveDiscardHandler = null;

  // Static index of dialog-kind → { modalId, backdropId }. Callers
  // pass a `kind` and the dispatcher routes close/dismiss/backdrop
  // clicks + escape without a growing switch. Adding a new dialog
  // means adding one row here + a case in `resolveConfirmHandler`.
  var DIALOG_REGISTRY = {
    'placeholder':    { modalId: 'skills-placeholder-modal',      backdropId: 'skills-placeholder-backdrop' },
    'delete':         { modalId: 'skills-delete-modal',           backdropId: 'skills-delete-backdrop' },
    'discard':        { modalId: 'skills-discard-modal',          backdropId: 'skills-discard-backdrop' },
    'title-mismatch': { modalId: 'skills-title-mismatch-modal',   backdropId: 'skills-title-mismatch-backdrop' },
    'leave':          { modalId: 'skills-leave-modal',            backdropId: 'skills-leave-backdrop' }
  };

  function openDialog(modalId, backdropId, initialFocusTarget, returnFocusTo) {
    var modal = document.getElementById(modalId);
    var backdrop = document.getElementById(backdropId);
    if (!modal || !backdrop) return null;

    modal.classList.remove('slds-hide');
    modal.classList.add('slds-fade-in-open');
    backdrop.classList.remove('slds-hide');
    backdrop.classList.add('slds-backdrop_open');

    if (initialFocusTarget && typeof initialFocusTarget.focus === 'function') {
      initialFocusTarget.focus();
    } else if (typeof modal.focus === 'function') {
      modal.focus();
    }
    currentDialogTrigger = returnFocusTo || null;
    return modal;
  }

  function closeDialog(modalId, backdropId, returnFocusTo) {
    var modal = document.getElementById(modalId);
    var backdrop = document.getElementById(backdropId);
    if (modal) {
      modal.classList.add('slds-hide');
      modal.classList.remove('slds-fade-in-open');
    }
    if (backdrop) {
      backdrop.classList.add('slds-hide');
      backdrop.classList.remove('slds-backdrop_open');
    }
    if (returnFocusTo && typeof returnFocusTo.focus === 'function') {
      returnFocusTo.focus();
    }
  }

  function openPlaceholderDialog(copy, returnFocusTo) {
    var titleEl = document.querySelector('[data-sh-skills-placeholder-title]');
    var bodyEl  = document.querySelector('[data-sh-skills-placeholder-body]');
    if (titleEl) titleEl.textContent = copy.title;
    if (bodyEl)  bodyEl.textContent  = copy.body;
    openDialog('skills-placeholder-modal', 'skills-placeholder-backdrop', null, returnFocusTo);
  }

  function openDeleteDialog(returnFocusTo, onConfirm) {
    // Focus the Cancel button first so a stray Enter can't
    // destroy — same safety Knowledge's destructive confirm uses.
    var cancelBtn = document.querySelector(
      '#skills-delete-modal [data-sh-skills-dialog-close].slds-button_neutral'
    );
    pendingDeleteHandler = typeof onConfirm === 'function' ? onConfirm : null;
    openDialog('skills-delete-modal', 'skills-delete-backdrop', cancelBtn, returnFocusTo);
  }

  // Discard-unsaved-changes confirmation. Called from the toolbar
  // Cancel button when the editor is dirty. Focus starts on the
  // SECONDARY "Keep editing" button so a stray Enter press
  // preserves the draft — matching the delete-dialog safety.
  function openDiscardDialog(returnFocusTo, onConfirm) {
    var keepEditingBtn = document.querySelector(
      '#skills-discard-modal [data-sh-skills-dialog-close].slds-button_neutral'
    );
    pendingDiscardHandler = typeof onConfirm === 'function' ? onConfirm : null;
    openDialog('skills-discard-modal', 'skills-discard-backdrop', keepEditingBtn, returnFocusTo);
  }

  // Leave-without-saving prompt (Schedule click while dirty). Two
  // confirm branches — `onSave` runs the save flow + navigates once
  // it resolves; `onDiscard` reverts the editor to `savedMarkdown`
  // + navigates immediately. Focus starts on the SECONDARY "Keep
  // editing" button so a stray Enter press doesn't destroy work.
  function openLeaveDialog(returnFocusTo, onSave, onDiscard) {
    var keepEditingBtn = document.querySelector(
      '#skills-leave-modal [data-sh-skills-dialog-close].slds-button_neutral'
    );
    pendingLeaveSaveHandler    = typeof onSave    === 'function' ? onSave    : null;
    pendingLeaveDiscardHandler = typeof onDiscard === 'function' ? onDiscard : null;
    openDialog('skills-leave-modal', 'skills-leave-backdrop', keepEditingBtn, returnFocusTo);
  }

  // Title-mismatch warning dialog. Called from the save flow when
  // validation surfaces a warning (H1 doesn't match display name).
  // Body copy is a template so the actual H1 + name are quoted.
  // Focus starts on SECONDARY ("Return to editor") so Enter is a
  // no-op instead of "save with mismatched title".
  function openTitleMismatchDialog(returnFocusTo, warning, template, onConfirm, onDismiss) {
    var bodyEl = document.querySelector('[data-sh-skills-title-mismatch-body]');
    if (bodyEl && template) {
      var h1   = String((warning && warning.h1)   || '');
      var name = String((warning && warning.name) || '');
      bodyEl.textContent = String(template)
        .split('{h1}').join(h1)
        .split('{name}').join(name);
    }
    var returnBtn = document.querySelector(
      '#skills-title-mismatch-modal [data-sh-skills-dialog-close].slds-button_neutral'
    );
    pendingTitleMismatchHandler = typeof onConfirm === 'function' ? onConfirm : null;
    pendingTitleMismatchDismiss = typeof onDismiss === 'function' ? onDismiss : null;
    openDialog('skills-title-mismatch-modal', 'skills-title-mismatch-backdrop', returnBtn, returnFocusTo);
  }

  // Cleanly close + fire the dismiss callback for a title-mismatch
  // dialog. Shared by the close-button / backdrop / escape paths so
  // callers can differentiate "user confirmed save-anyway" from
  // "user returned to editor" and re-focus the Save action in the
  // latter case.
  function dismissTitleMismatch() {
    var dismiss = pendingTitleMismatchDismiss;
    pendingTitleMismatchHandler = null;
    pendingTitleMismatchDismiss = null;
    closeDialog('skills-title-mismatch-modal', 'skills-title-mismatch-backdrop', currentDialogTrigger);
    if (dismiss) { try { dismiss(); } catch (_e) {} }
    currentDialogTrigger = null;
  }

  function initDialogListeners() {
    document.addEventListener('click', function (event) {
      // Delete confirm.
      var confirmBtn = closest(event.target, '[data-sh-skills-delete-confirm]');
      if (confirmBtn) {
        event.preventDefault();
        var handler = pendingDeleteHandler;
        pendingDeleteHandler = null;
        closeDialog('skills-delete-modal', 'skills-delete-backdrop', null);
        if (handler) { try { handler(); } catch (_e) {} }
        currentDialogTrigger = null;
        return;
      }

      // Discard-unsaved-changes confirm.
      var discardBtn = closest(event.target, '[data-sh-skills-discard-confirm]');
      if (discardBtn) {
        event.preventDefault();
        var discardHandler = pendingDiscardHandler;
        pendingDiscardHandler = null;
        closeDialog('skills-discard-modal', 'skills-discard-backdrop', null);
        if (discardHandler) { try { discardHandler(); } catch (_e) {} }
        currentDialogTrigger = null;
        return;
      }

      // Title-mismatch save-anyway confirm.
      var titleMismatchBtn = closest(event.target, '[data-sh-skills-title-mismatch-confirm]');
      if (titleMismatchBtn) {
        event.preventDefault();
        var titleHandler = pendingTitleMismatchHandler;
        pendingTitleMismatchHandler = null;
        pendingTitleMismatchDismiss = null;
        closeDialog('skills-title-mismatch-modal', 'skills-title-mismatch-backdrop', null);
        if (titleHandler) { try { titleHandler(); } catch (_e) {} }
        currentDialogTrigger = null;
        return;
      }

      // Leave-without-saving: "Save and leave" primary branch.
      // Consumes the pending handler + closes; the handler runs
      // the save flow and (on success) fires the navigation. If
      // save fails, `sh:skill-save-error` re-focuses the seller
      // on the editor and the navigation is dropped.
      var leaveSaveBtn = closest(event.target, '[data-sh-skills-leave-save]');
      if (leaveSaveBtn) {
        event.preventDefault();
        var leaveSave = pendingLeaveSaveHandler;
        pendingLeaveSaveHandler    = null;
        pendingLeaveDiscardHandler = null;
        closeDialog('skills-leave-modal', 'skills-leave-backdrop', null);
        if (leaveSave) { try { leaveSave(); } catch (_e) {} }
        currentDialogTrigger = null;
        return;
      }

      // Leave-without-saving: "Discard changes" destructive branch.
      // Reverts the editor + navigates immediately.
      var leaveDiscardBtn = closest(event.target, '[data-sh-skills-leave-discard]');
      if (leaveDiscardBtn) {
        event.preventDefault();
        var leaveDiscard = pendingLeaveDiscardHandler;
        pendingLeaveSaveHandler    = null;
        pendingLeaveDiscardHandler = null;
        closeDialog('skills-leave-modal', 'skills-leave-backdrop', null);
        if (leaveDiscard) { try { leaveDiscard(); } catch (_e) {} }
        currentDialogTrigger = null;
        return;
      }

      // Generic close (X, secondary button).
      var closeBtn = closest(event.target, '[data-sh-skills-dialog-close]');
      if (closeBtn) {
        event.preventDefault();
        var host = closest(closeBtn, '[data-sh-skills-dialog]');
        var kind = host && host.getAttribute('data-sh-skills-dialog');
        dismissByKind(kind);
        return;
      }

      // Backdrop click.
      var backdrop = closest(event.target, '[data-sh-skills-dialog-backdrop]');
      if (backdrop) {
        var kindB = backdrop.getAttribute('data-sh-skills-dialog-backdrop');
        dismissByKind(kindB);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' && event.key !== 'Esc') return;
      // Dismiss whichever dialog is currently visible. Order
      // doesn't matter — dialogs are mutually exclusive because
      // the shared backdrop pattern makes stacking impossible.
      var kinds = Object.keys(DIALOG_REGISTRY);
      for (var i = 0; i < kinds.length; i++) {
        var reg = DIALOG_REGISTRY[kinds[i]];
        var modal = document.getElementById(reg.modalId);
        if (modal && !modal.classList.contains('slds-hide')) {
          event.preventDefault();
          dismissByKind(kinds[i]);
          return;
        }
      }
    });
  }

  // Cleanly dismiss a dialog by kind. Cancels any pending confirm
  // handler and returns focus to the trigger. For title-mismatch
  // dismissals we route through `dismissTitleMismatch` so the
  // dismiss callback fires (so the save-flow can re-focus the
  // Save action, per spec).
  function dismissByKind(kind) {
    if (kind === 'delete') {
      pendingDeleteHandler = null;
      closeDialog('skills-delete-modal', 'skills-delete-backdrop', currentDialogTrigger);
      currentDialogTrigger = null;
    } else if (kind === 'discard') {
      pendingDiscardHandler = null;
      closeDialog('skills-discard-modal', 'skills-discard-backdrop', currentDialogTrigger);
      currentDialogTrigger = null;
    } else if (kind === 'title-mismatch') {
      dismissTitleMismatch();
    } else if (kind === 'placeholder') {
      closeDialog('skills-placeholder-modal', 'skills-placeholder-backdrop', currentDialogTrigger);
      currentDialogTrigger = null;
    } else if (kind === 'leave') {
      // Backdrop / Escape / X on the "Leave without saving?"
      // dialog is equivalent to "Keep editing" — cancel both
      // pending branches, close, restore focus to the trigger.
      pendingLeaveSaveHandler    = null;
      pendingLeaveDiscardHandler = null;
      closeDialog('skills-leave-modal', 'skills-leave-backdrop', currentDialogTrigger);
      currentDialogTrigger = null;
    }
  }

  // ── Dropdown primitives ──────────────────────────────────────────────
  // The schedule chevron + kebab both use the SLDS click-trigger
  // pattern. One "click outside closes everything" document listener
  // dismisses any open dropdown on the page. Escape closes + restores
  // focus to the trigger.
  function initDropdownListeners(root) {
    var triggers = Array.prototype.slice.call(
      root.querySelectorAll('[aria-haspopup="menu"]')
    );

    triggers.forEach(function (trigger) {
      var wrap = closest(trigger, '.slds-dropdown-trigger');
      if (!wrap) return;
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        triggers.forEach(function (other) {
          if (other === trigger) return;
          var otherWrap = closest(other, '.slds-dropdown-trigger');
          if (otherWrap && otherWrap.classList.contains('slds-is-open')) {
            otherWrap.classList.remove('slds-is-open');
            other.setAttribute('aria-expanded', 'false');
          }
        });
        var opened = wrap.classList.toggle('slds-is-open');
        trigger.setAttribute('aria-expanded', opened ? 'true' : 'false');
        if (opened) {
          var firstItem = wrap.querySelector('[role="menuitem"]');
          if (firstItem && typeof firstItem.focus === 'function') firstItem.focus();
        }
      });
    });

    document.addEventListener('click', function (e) {
      triggers.forEach(function (trigger) {
        var wrap = closest(trigger, '.slds-dropdown-trigger');
        if (!wrap || !wrap.classList.contains('slds-is-open')) return;
        if (wrap.contains(e.target)) return;
        wrap.classList.remove('slds-is-open');
        trigger.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      triggers.forEach(function (trigger) {
        var wrap = closest(trigger, '.slds-dropdown-trigger');
        if (!wrap || !wrap.classList.contains('slds-is-open')) return;
        wrap.classList.remove('slds-is-open');
        trigger.setAttribute('aria-expanded', 'false');
        if (typeof trigger.focus === 'function') trigger.focus();
      });
    });
  }

  // ── Post-render enrichment ───────────────────────────────────────────
  // Two decorative passes over the rendered article. Both are
  // idempotent so calling them on every render (including live-preview
  // keystrokes) doesn't compound state.
  //
  //   1. Supporting-skill chips. Any `<a href="/skill_detail.html?id=<id>">`
  //      inside the article gets the `seller-home__skill-chip` class +
  //      a small leading glyph. Known ids gain `_known` + a friendly
  //      tooltip; unknown ids gain a "Skill not found" tooltip.
  //   2. Tool bullets. Bullets inside a `## Connections and access`
  //      section that match a `toolLibrary` label get an inline chip
  //      with the tool's icon. Kept as bullets (not chips) in the
  //      Markdown source so the file stays valid Markdown.
  function enrichPreview(articleEl, catalog, toolLibrary, _skillName) {
    if (!articleEl) return;
    // NB: We deliberately DO NOT strip the leading `<h1>` here. Per
    // the Figma frame `9744:24896`, the document body opens with a
    // large H1 rendering of the skill name (32-px semibold, matching
    // `--slds-g-font-scale-6`) followed by a lead paragraph — that
    // H1 is the document's primary heading. The breadcrumb H1 in the
    // page header is a navigation heading; the two coexist by
    // design.
    enrichSupportingSkillLinks(articleEl, catalog);
    enrichConnectionsAndAccess(articleEl, toolLibrary);
    decorateSupportingSkillsGroup(articleEl);
    decorateConnectionsGroup(articleEl, toolLibrary);
  }

  function enrichSupportingSkillLinks(articleEl, catalog) {
    var anchors = articleEl.querySelectorAll('a[href^="/skill_detail.html?id="]');
    if (!anchors.length) return;
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = a.getAttribute('href') || '';
      var m = href.match(/[?&]id=([^&#]+)/);
      var id = m ? decodeURIComponent(m[1]) : '';
      var target = findSkill(catalog, id);
      if (target) {
        // Known target — apply the chip treatment + a friendly
        // tooltip. Idempotent so live-preview re-renders don't
        // compound state. Explicitly clear any "missing" attributes
        // a previous render may have set (the case where a live
        // edit renames the id back to a known target).
        if (!a.classList.contains('seller-home__skill-chip')) {
          a.classList.add('seller-home__skill-chip');
        }
        a.classList.add('seller-home__skill-chip_known');
        a.classList.remove('seller-home__skill-chip_missing');
        a.removeAttribute('aria-disabled');
        a.removeAttribute('tabindex');
        a.setAttribute('title', 'Open ' + (target.name || 'skill'));
        if (!a.querySelector('[data-sh-skill-chip-icon]')) {
          // Chip glyph — custom skills icon supplied by design,
          // inlined as SVG so `fill="currentColor"` on the root
          // cascades down to every rect and the icon inherits the
          // chip's accent-blue text colour automatically (and
          // re-tints on hover / focus without a duplicate asset).
          // Source-of-truth asset is
          // `src/assets/images/skill-chip.svg`; this string is a
          // verbatim inline copy so we skip a runtime fetch. Keep
          // in sync when the SVG is refreshed. The `class` and
          // `data-*` hooks match the previous <img> so the
          // duplicate-render guard, sizing rules, and remove-on-
          // "missing" path all continue to apply.
          a.insertAdjacentHTML(
            'afterbegin',
            SKILL_CHIP_ICON_SVG
          );
        }
      } else {
        // Unknown target. Per spec: "If a referenced skill does not
        // exist, show non-interactive text instead of a broken
        // link." We KEEP the `<a>` element in the DOM (so the
        // underlying Markdown source round-trips — the serializer
        // still emits `[text](/skill_detail.html?id=<id>)` on
        // save), but neutralize the interaction surface:
        //   • `aria-disabled="true"` communicates the state to AT.
        //   • `tabindex="-1"` drops the anchor out of the keyboard
        //     tab order.
        //   • `pointer-events: none` (via the `_missing` modifier
        //     class in home.scss) blocks the click.
        // A future edit that renames the id back to a known target
        // must clear these attributes — the classlist toggles above
        // in the `if (target)` branch handle the "back to known"
        // path idempotently.
        a.classList.remove('seller-home__skill-chip_known');
        a.classList.add('seller-home__skill-chip');
        a.classList.add('seller-home__skill-chip_missing');
        a.setAttribute('aria-disabled', 'true');
        a.setAttribute('tabindex', '-1');
        a.setAttribute('title', 'Skill not found: ' + id);
        var oldIcon = a.querySelector('[data-sh-skill-chip-icon]');
        if (oldIcon && oldIcon.parentNode) oldIcon.parentNode.removeChild(oldIcon);
      }
    }
  }

  // Find an H2 (from either renderer variant) whose text starts with
  // a given prefix (case-insensitive). We match on prefix rather than
  // exact string so a future rename ("Connections and access · 2
  // sources") still routes to the right enrichment pass.
  function findHeadingByText(articleEl, tag, textPrefix) {
    var nodes = articleEl.querySelectorAll(tag);
    var needle = String(textPrefix || '').trim().toLowerCase();
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].textContent || '').trim().toLowerCase();
      if (t.indexOf(needle) === 0) return nodes[i];
    }
    return null;
  }

  function enrichConnectionsAndAccess(articleEl, toolLibrary) {
    var heading = findHeadingByText(articleEl, 'h2', 'connections and access');
    if (!heading) return;
    var sibling = heading.nextElementSibling;
    while (sibling && sibling.tagName !== 'H2') {
      if (sibling.tagName === 'UL') {
        var lis = sibling.querySelectorAll('li');
        for (var j = 0; j < lis.length; j++) {
          decorateToolBullet(lis[j], toolLibrary);
        }
      }
      sibling = sibling.nextElementSibling;
    }
  }

  // ── Supporting-skills chip row ────────────────────────────────────
  // Per Figma frame 9744:24896, the three supporting-skill chips
  // under "How this skill works" render as a horizontal flex row
  // beneath the intro paragraph. In the Markdown source they're
  // authored as inline links inside a single paragraph — so post-
  // render, if we find a paragraph whose only meaningful content is
  // supporting-skill anchors, we split it: the leading text stays
  // as a paragraph, and the trailing anchors get lifted into a
  // horizontal `.seller-home__skill-chip-row` container. The
  // Markdown round-trips because the container preserves the
  // anchor structure and the plain-text serializer treats an
  // unknown wrapper as inline content on the same block.
  function decorateSupportingSkillsGroup(articleEl) {
    if (!articleEl) return;
    var chips = articleEl.querySelectorAll('a.seller-home__skill-chip_known');
    if (!chips.length) return;
    // Group chips by their nearest ancestor <p>.
    var seen = [];
    for (var i = 0; i < chips.length; i++) {
      var chip = chips[i];
      var p = chip.parentElement;
      while (p && p !== articleEl && p.tagName !== 'P') p = p.parentElement;
      if (!p || p.tagName !== 'P') continue;
      if (seen.indexOf(p) < 0) seen.push(p);
    }
    for (var k = 0; k < seen.length; k++) {
      liftChipsFromParagraph(seen[k]);
    }
  }

  function liftChipsFromParagraph(p) {
    if (!p || !p.parentNode) return;
    // Skip if we've already lifted this paragraph (idempotent).
    if (p.getAttribute('data-sh-skill-chip-lifted') === '1') return;
    // Walk the paragraph's children — separate leading text (kept
    // in the paragraph) from trailing chip anchors (lifted into a
    // sibling flex row).
    var chipNodes = [];
    var trailing = [];
    var kids = Array.prototype.slice.call(p.childNodes);
    // Find the LAST non-chip node — everything after that is chip
    // content (chips + whitespace). Anything before stays in `p`.
    var lastKeepIdx = -1;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 1 && n.tagName === 'A' && n.classList
          && n.classList.contains('seller-home__skill-chip')) {
        chipNodes.push(n);
      } else if (n.nodeType === 3 && /^\s*$/.test(n.nodeValue || '')) {
        // Whitespace between chips — group with chips only if we've
        // already seen one.
        trailing.push(n);
      } else {
        // Non-chip, non-whitespace node — this is content we keep
        // in the paragraph. Reset chip capture.
        chipNodes = [];
        trailing = [];
        lastKeepIdx = i;
      }
    }
    if (chipNodes.length === 0) return;

    // Split point: everything AFTER `lastKeepIdx` moves to the row.
    // KEEP whitespace text nodes between chips: the CSS flex `gap`
    // handles visual spacing, but the DOM → Markdown serializer
    // relies on those spaces to round-trip the original
    // "[a] [a] [a]" single-line syntax (see `serializeBlock`'s
    // inline-only branch in skill_markdown_editor.js).
    var toMove = kids.slice(lastKeepIdx + 1);
    var row = document.createElement('div');
    row.className = 'seller-home__skill-chip-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Supporting skills');
    for (var j = 0; j < toMove.length; j++) {
      row.appendChild(toMove[j]);
    }
    // Trim trailing whitespace inside the kept paragraph.
    while (p.lastChild && p.lastChild.nodeType === 3 && /^\s*$/.test(p.lastChild.nodeValue || '')) {
      p.removeChild(p.lastChild);
    }
    // If the paragraph is now empty (chips-only paragraph), replace
    // it entirely with the row.
    if (!p.childNodes.length) {
      p.parentNode.replaceChild(row, p);
    } else {
      p.parentNode.insertBefore(row, p.nextSibling);
      p.setAttribute('data-sh-skill-chip-lifted', '1');
    }
  }

  // ── Connections & access chip row ─────────────────────────────────
  // Convert the `- Salesforce` / `- Gmail` bullet list under
  // "Connections and access" into a horizontal chip row. Round-trips
  // to the same bullet-list Markdown because the DOM keeps
  // `<ul><li>` semantics — the CSS class just changes the visual
  // layout. Tool icons are added inside each LI via
  // `decorateToolBullet` above (`sf` / `gmail` / … lookup).
  function decorateConnectionsGroup(articleEl, toolLibrary) {
    if (!articleEl) return;
    var heading = findHeadingByText(articleEl, 'h2', 'connections and access');
    if (!heading) return;
    var sibling = heading.nextElementSibling;
    while (sibling && sibling.tagName !== 'H2') {
      if (sibling.tagName === 'UL') {
        sibling.classList.add('seller-home__skill-tool-row');
      }
      sibling = sibling.nextElementSibling;
    }
  }

  function decorateToolBullet(li, toolLibrary) {
    if (li.hasAttribute('data-sh-skill-tool')) return;
    var raw = (li.textContent || '').trim();
    if (!raw) return;
    var lookupKey = raw.toLowerCase();
    var matchedKey = null;
    for (var key in toolLibrary) {
      if (!Object.prototype.hasOwnProperty.call(toolLibrary, key)) continue;
      var entry = toolLibrary[key] || {};
      if ((entry.name || '').toLowerCase() === lookupKey) {
        matchedKey = key;
        break;
      }
    }
    if (!matchedKey) return;
    var tool = toolLibrary[matchedKey] || {};
    li.setAttribute('data-sh-skill-tool', matchedKey);
    li.classList.add('seller-home__skill-tool-bullet');
    // Accept either `iconRef` (canonical JSON field name) or
    // `icon` (legacy fallback) so a future tool registry that
    // renames the field stays compatible.
    var iconSrc = tool.iconRef || tool.icon;
    if (iconSrc && !li.querySelector('[data-sh-skill-tool-icon]')) {
      var img = document.createElement('img');
      img.className = 'seller-home__skill-tool-icon';
      img.setAttribute('data-sh-skill-tool-icon', '');
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.src = iconSrc;
      li.insertBefore(img, li.firstChild);
      // Add a visually-hidden text label so AT still hears the
      // tool name if the icon has empty alt.
      var srLabel = document.createElement('span');
      srLabel.className = 'slds-assistive-text';
      srLabel.textContent = tool.name || raw;
      li.appendChild(srLabel);
    }
  }

  // ── Action wiring ────────────────────────────────────────────────────
  function wireUseInChat(root, skill, actionsCopy) {
    var btn = root.querySelector('[data-sh-skill-detail-use-in-chat]');
    if (!btn) return;
    var useCopy = (actionsCopy && actionsCopy.useInChat) || {};
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      // Always fire the semantic event so a future consumer can
      // wire up a real chat-open handler without touching this
      // file. The event carries `skillId` (associates the button
      // with the current record) and does NOT trigger a run.
      try {
        document.dispatchEvent(new CustomEvent('sh:skill-use-in-chat', {
          detail: { skillId: skill.id }
        }));
      } catch (_e) { /* CustomEvent unsupported? Skip. */ }

      // No `/home.html` handler consumes `#skill=<id>` today. A
      // silent navigation there would land the seller on the home
      // page with no visible sign the skill selection worked, so
      // we open a labeled local placeholder instead. When the
      // chat consumer ships, replace this branch with the real
      // navigation call (`window.location.href = '/home.html
      // #skill=' + encodeURIComponent(skill.id)`).
      openPlaceholderDialog({
        title: useCopy.placeholderTitle || useCopy.label || 'Use in Chat',
        body:  useCopy.placeholderBody
          || 'Opening this skill inside a chat isn\u2019t wired up yet.'
      }, btn);
    });
  }

  // Primary Schedule action + chevron menu items on the Skill
  // detail header.
  //
  // The primary "Schedule" button opens the conversational panel
  // (/home_conversation.html?id=<draftConvId>) with a prefilled
  // composer — the scheduling flow lives ENTIRELY inside the
  // existing chat surface. No second scheduler UI to maintain.
  //
  // `SellerHomeScheduling` (from schedule_conversation.js) owns the
  // draft envelope + Recents-list mirror; this handler just resolves
  // the skill, creates/reuses the draft, guards against unsaved
  // skill edits, and hands off navigation. If schedule_conversation.js
  // is somehow missing (e.g. failed script load), we fall back to
  // the placeholder dialog so the seller isn't left with a dead
  // button — a defensive branch, not the expected path.
  //
  // Chevron menu items ("Every weekday at 8:00 AM", "Every Monday
  // at 9:00 AM", "Choose a custom schedule") still open the
  // placeholder for now; the header pill IS the entry point per the
  // Schedule spec, and wiring each preset to preselect a cadence is
  // a follow-up.
  function wireScheduleAction(root, skill, actionsCopy, editorBridge) {
    var scheduleBtn = root.querySelector('[data-sh-skill-detail-schedule]');
    if (scheduleBtn) {
      scheduleBtn.addEventListener('click', function (e) {
        e.preventDefault();
        try {
          document.dispatchEvent(new CustomEvent('sh:skill-action', {
            detail: { action: 'schedule', skillId: skill.id, trigger: scheduleBtn }
          }));
        } catch (_e) { /* swallow */ }

        var api = window.SellerHomeScheduling;
        if (!api || typeof api.createDraftForSkill !== 'function') {
          // Defensive fallback — script tag missing or module load
          // failed. Should never fire in production; keeps the
          // affordance labelled instead of silently dead.
          openPlaceholderDialog({
            title: (actionsCopy.schedule && actionsCopy.schedule.label) || 'Schedule skill',
            body:  'Scheduling isn\u2019t available on this build.'
          }, scheduleBtn);
          return;
        }

        // Navigation helper — creates (or reuses) the draft
        // envelope, then hands off to the browser. Wrapped so both
        // the clean-editor path and the "Save and leave" /
        // "Discard changes" branches funnel through the same code.
        function proceedToScheduleConversation() {
          var draft = api.createDraftForSkill(skill);
          if (!draft || !draft.url) return;
          window.location.href = draft.url;
        }

        // Read-only skill (canEdit === false) or no editor on
        // page: navigate immediately, no dirty check possible.
        if (!editorBridge || typeof editorBridge.isDirty !== 'function') {
          proceedToScheduleConversation();
          return;
        }

        if (!editorBridge.isDirty()) {
          proceedToScheduleConversation();
          return;
        }

        // Dirty editor: prompt "Leave without saving?" with three
        // branches. Keep-editing is the neutral close (does
        // nothing beyond dismissing the modal + returning focus).
        openLeaveDialog(scheduleBtn,
          function onSaveAndLeave() {
            // Wire one-shot listeners for the save result before
            // triggering the save. `sh:skill-save` resolves the
            // navigation; `sh:skill-save-error` bails and leaves
            // the seller on the editor. `{ once: true }` ensures
            // stale listeners can't intercept a future save.
            function cleanup() {
              document.removeEventListener('sh:skill-save',       onSaved);
              document.removeEventListener('sh:skill-save-error', onFailed);
            }
            function onSaved () { cleanup(); proceedToScheduleConversation(); }
            function onFailed() { cleanup(); /* stay on editor */ }
            document.addEventListener('sh:skill-save',       onSaved,  { once: true });
            document.addEventListener('sh:skill-save-error', onFailed, { once: true });
            try { editorBridge.save(); } catch (_e) {
              cleanup();
            }
          },
          function onDiscardAndLeave() {
            try {
              if (typeof editorBridge.discardChanges === 'function') {
                editorBridge.discardChanges();
              }
            } catch (_e) { /* swallow */ }
            proceedToScheduleConversation();
          }
        );
      });
    }

    var scheduleItems = root.querySelectorAll('[data-sh-skill-detail-schedule-item]');
    for (var i = 0; i < scheduleItems.length; i++) {
      (function (item) {
        item.addEventListener('click', function (e) {
          e.preventDefault();
          var itemId = item.getAttribute('data-sh-skill-detail-schedule-item') || '';
          var wrap = closest(item, '.slds-dropdown-trigger');
          var trigger = wrap && wrap.querySelector('[aria-haspopup="menu"]');
          if (wrap && wrap.classList.contains('slds-is-open')) {
            wrap.classList.remove('slds-is-open');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
          }
          openPlaceholderDialog({
            title: (item.textContent || '').trim() || 'Schedule',
            body: 'Click Schedule to open the scheduling conversation. Preset shortcuts aren\u2019t wired yet.'
          }, trigger || scheduleBtn);
          try {
            document.dispatchEvent(new CustomEvent('sh:skill-schedule-menu', {
              detail: { itemId: itemId, skillId: skill.id }
            }));
          } catch (_e) { /* swallow */ }
        });
      }(scheduleItems[i]));
    }
  }

  // ── Hydration paths ──────────────────────────────────────────────────
  // ── Breadcrumb skill switcher ────────────────────────────────────────
  // The chevron beside the current skill name opens a panel with a
  // scope picklist (My / Learned / Shared), a search field, and the
  // matching skills. Picking one navigates to its detail page, so a
  // seller can move sideways through the catalog without bouncing
  // off /skills.html.
  //
  // Rows are real `<a href="/skill_detail.html?id=…">` links. That
  // buys ⌘-click / middle-click / "open in new tab" for free, and it
  // means the unsaved-changes `beforeunload` guard registered further
  // down already covers switching away from a dirty editor — no
  // second confirmation path to keep in sync.
  //
  // `activeSkill` may be null: the not-found branch renders the
  // switcher too, since it's the quickest way out of a dead URL.

  // Skills whose `ownership` falls in `ownerships`. An EMPTY list
  // means "no filter" — that's how the parked "All" tab is authored.
  function skillsInScope(catalog, ownerships) {
    var out = [];
    for (var i = 0; i < catalog.length; i++) {
      var s = catalog[i];
      if (!s || !s.id) continue;
      if (ownerships.length && ownerships.indexOf(s.ownership) === -1) continue;
      out.push(s);
    }
    return out;
  }

  // Visible tabs → scope descriptors, each carrying its own resolved
  // skill list so the count beside the picklist and the rendered rows
  // can never disagree.
  function switcherScopes(config, catalog) {
    var items = (config.tabs && config.tabs.items) || [];
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var t = items[i];
      if (!t || t.hidden || !t.id) continue;
      var owns = Array.isArray(t.ownerships) ? t.ownerships : [];
      out.push({
        id:     t.id,
        label:  typeof t.label === 'string' ? t.label : t.id,
        skills: skillsInScope(catalog, owns)
      });
    }
    return out;
  }

  // "Updated yesterday · Uses 3 other skills". Same resilience rule
  // as the header metadata caption: a part whose source field is
  // empty is dropped rather than rendered with a hole in it.
  //
  // Returns the two segments as separate strings (instead of one
  // pre-joined string) so the caller can paint them in different
  // colours — Figma 10625:61336 gives the update-time portion the
  // neutral on-surface-1 grey and the "Uses N other skills" portion
  // the accent-tinted on-surface-3 navy, and both need to sit inside
  // the same visual line-height without wrapping the separator into
  // an extra text node the picker has to hunt for.
  function switcherMeta(skill, copy) {
    var out = { updated: '', uses: '' };
    if (copy.updatedTemplate && skill.updatedAt) {
      out.updated = copy.updatedTemplate.replace('{updatedAt}', skill.updatedAt);
    }
    var uses = Number(skill.referencedSkillCount);
    if (isFinite(uses) && uses > 0) {
      var tpl = uses === 1 ? copy.usesTemplateOne : copy.usesTemplate;
      if (tpl) out.uses = tpl.replace('{referencedSkillCount}', String(uses));
    }
    return out;
  }

  function switcherMatches(skill, query) {
    if (!query) return true;
    var haystack = String(skill.name || '') + ' ' + String(skill.description || '');
    return haystack.toLowerCase().indexOf(query) !== -1;
  }

  function wireSkillSwitcher(root, activeSkill, config) {
    var wrap = root.querySelector('[data-sh-skill-switcher]');
    if (!wrap) return;

    var trigger = wrap.querySelector('[data-sh-skill-switcher-trigger]');
    var panel   = wrap.querySelector('[data-sh-skill-switcher-panel]');
    var scopeEl = wrap.querySelector('[data-sh-skill-switcher-scope]');
    var countEl = wrap.querySelector('[data-sh-skill-switcher-count]');
    var countSr = wrap.querySelector('[data-sh-skill-switcher-count-sr]');
    var searchEl= wrap.querySelector('[data-sh-skill-switcher-search]');
    var listEl  = wrap.querySelector('[data-sh-skill-switcher-list]');
    var emptyEl = wrap.querySelector('[data-sh-skill-switcher-empty]');
    var newBtn  = wrap.querySelector('[data-sh-skill-switcher-new]');
    if (!trigger || !panel || !scopeEl || !listEl) return;

    var copy    = (config.detail && config.detail.switcher) || {};
    var catalog = config.catalog || [];
    var scopes  = switcherScopes(config, catalog);

    // Nothing to switch between — drop the chevron entirely rather
    // than advertise a control that opens an empty panel.
    if (!scopes.length || catalog.length < 2) {
      wrap.hidden = true;
      return;
    }

    // Open on the scope that actually contains the current skill so
    // the seller's own position is visible on the first paint. Falls
    // back to the authored default tab, then to the first scope.
    function initialScopeIndex() {
      var i;
      if (activeSkill) {
        for (i = 0; i < scopes.length; i++) {
          if (findSkill(scopes[i].skills, activeSkill.id)) return i;
        }
      }
      var defaultId = (config.tabs && config.tabs.defaultTabId) || '';
      for (i = 0; i < scopes.length; i++) {
        if (scopes[i].id === defaultId) return i;
      }
      return 0;
    }

    for (var s = 0; s < scopes.length; s++) {
      var opt = document.createElement('option');
      opt.value = scopes[s].id;
      opt.textContent = scopes[s].label;
      scopeEl.appendChild(opt);
    }
    scopeEl.selectedIndex = initialScopeIndex();

    function currentScope() {
      return scopes[scopeEl.selectedIndex] || scopes[0];
    }

    function render() {
      var scope = currentScope();
      var query = searchEl ? String(searchEl.value || '').trim().toLowerCase() : '';

      // The count reports the SCOPE total, not the filtered total —
      // it labels the list the picklist selects, and a number that
      // shifted on every keystroke would read as a search result
      // count instead.
      if (countEl) countEl.textContent = String(scope.skills.length);
      if (countSr) {
        countSr.textContent = scope.skills.length + ' ' +
          (copy.scopeCountLabel || 'skills in this list');
      }

      while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

      var shown = 0;
      for (var i = 0; i < scope.skills.length; i++) {
        var skill = scope.skills[i];
        if (!switcherMatches(skill, query)) continue;
        shown++;

        var li = document.createElement('li');
        var a  = document.createElement('a');
        a.className = 'seller-home__skill-detail-switcher-link';
        a.href = '/skill_detail.html?id=' + encodeURIComponent(skill.id);
        a.setAttribute('data-sh-skill-switcher-link', skill.id);
        if (activeSkill && skill.id === activeSkill.id) {
          a.setAttribute('aria-current', 'true');
        }

        // Name + owning-agent pill share a row, so the badge reads as
        // an annotation on the name rather than a third line of meta.
        // The row wrapper exists even for an unowned skill: a one-child
        // flex row lays out identically to the bare `<span>` it
        // replaced, which keeps every row on one geometry.
        var titleRow = document.createElement('span');
        titleRow.className = 'seller-home__skill-detail-switcher-link-title';

        var name = document.createElement('span');
        name.className = 'seller-home__skill-detail-switcher-link-name';
        name.textContent = skill.name || skill.id;
        titleRow.appendChild(name);

        // Appended INSIDE the anchor, so the label joins the link's
        // accessible name ("Prepare for Meetings Sales Updated
        // yesterday…"). The list page reaches the same result through
        // its row `aria-label`; here there is no aria-label to
        // override the text, so plain content is enough.
        var rowBadge = createAgentBadge(skill, config.agentLibrary);
        if (rowBadge) titleRow.appendChild(rowBadge);

        a.appendChild(titleRow);

        var metaParts = switcherMeta(skill, copy);
        if (metaParts.updated || metaParts.uses) {
          var meta = document.createElement('span');
          meta.className = 'seller-home__skill-detail-switcher-link-meta';

          if (metaParts.updated) {
            var updSpan = document.createElement('span');
            updSpan.className = 'seller-home__skill-detail-switcher-link-updated';
            updSpan.textContent = metaParts.updated;
            meta.appendChild(updSpan);
          }

          // Separator lives in its own span so screen readers get a
          // clean pause between the two prose segments and CSS can
          // hide it if we ever want the two pieces to sit on
          // separate lines (e.g. a narrower breakpoint).
          if (metaParts.updated && metaParts.uses) {
            var sepChar = typeof copy.metaSeparator === 'string' ? copy.metaSeparator : ' \u00b7 ';
            var sepSpan = document.createElement('span');
            sepSpan.className = 'seller-home__skill-detail-switcher-link-sep';
            sepSpan.setAttribute('aria-hidden', 'true');
            sepSpan.textContent = sepChar;
            meta.appendChild(sepSpan);
          }

          if (metaParts.uses) {
            var usesSpan = document.createElement('span');
            usesSpan.className = 'seller-home__skill-detail-switcher-link-uses';
            usesSpan.textContent = metaParts.uses;
            meta.appendChild(usesSpan);
          }

          a.appendChild(meta);
        }

        li.appendChild(a);
        listEl.appendChild(li);
      }

      if (emptyEl) emptyEl.hidden = shown > 0;
      listEl.hidden = shown === 0;
    }

    function links() {
      return Array.prototype.slice.call(
        listEl.querySelectorAll('[data-sh-skill-switcher-link]')
      );
    }

    function isOpen() {
      return wrap.classList.contains('slds-is-open');
    }

    function open() {
      // Reset the filter on every open so the panel always starts
      // showing the whole scope — a stale query from a previous open
      // would look like a broken (half-empty) list.
      if (searchEl) searchEl.value = '';
      render();
      wrap.classList.add('slds-is-open');
      trigger.setAttribute('aria-expanded', 'true');
      if (searchEl && typeof searchEl.focus === 'function') searchEl.focus();
    }

    // `returnFocus` is false for dismissals the seller drove with the
    // pointer elsewhere on the page — yanking focus back to the
    // chevron there would fight what they just clicked.
    function close(returnFocus) {
      if (!isOpen()) return;
      wrap.classList.remove('slds-is-open');
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus && typeof trigger.focus === 'function') trigger.focus();
    }

    // The click is deliberately allowed to keep bubbling: the
    // document-level dismissal in `initDropdownListeners` is what
    // closes the Schedule split-button menu when the seller opens
    // this one instead. Our own document listener below already
    // ignores clicks landing inside `wrap`, so letting the event
    // through costs us nothing.
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      if (isOpen()) close(true);
      else open();
    });

    scopeEl.addEventListener('change', render);
    if (searchEl) searchEl.addEventListener('input', render);

    // Roving arrow-key movement across the rows, with the search
    // field as the entry point (ArrowDown from the field lands on
    // row 1). Tab is deliberately left alone so the panel stays a
    // normal, escapable part of the page's tab order.
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.stopPropagation();
        close(true);
        return;
      }

      var isDown = e.key === 'ArrowDown' || e.key === 'Down';
      var isUp   = e.key === 'ArrowUp'   || e.key === 'Up';
      var isHome = e.key === 'Home';
      var isEnd  = e.key === 'End';
      if (!isDown && !isUp && !isHome && !isEnd) return;

      var items = links();
      if (!items.length) return;

      // Home / End inside the search field belong to the text
      // caret, not to the list.
      if ((isHome || isEnd) && e.target === searchEl) return;

      var index = items.indexOf(e.target);
      var next;
      if (isHome)       next = 0;
      else if (isEnd)   next = items.length - 1;
      else if (index === -1) next = isDown ? 0 : items.length - 1;
      else if (isDown)  next = Math.min(index + 1, items.length - 1);
      else              next = Math.max(index - 1, 0);

      e.preventDefault();
      items[next].focus();
    });

    // Selecting the skill already on screen is a no-op — close
    // instead of reloading the page (which would also trip the
    // unsaved-changes prompt for nothing).
    listEl.addEventListener('click', function (e) {
      var link = closest(e.target, '[data-sh-skill-switcher-link]');
      if (!link) return;
      if (activeSkill && link.getAttribute('data-sh-skill-switcher-link') === activeSkill.id) {
        e.preventDefault();
        close(true);
      }
    });

    if (newBtn) {
      newBtn.addEventListener('click', function (e) {
        e.preventDefault();
        close(false);
        // Creation isn't wired in the prototype. Fire the same
        // semantic event /skills.html's "Create Skill" pill fires so
        // one future handler can serve both entry points, then show
        // the shared placeholder rather than dead-ending the click.
        try {
          document.dispatchEvent(new CustomEvent('sh:skills-create', {
            detail: { source: 'skill-switcher' }
          }));
        } catch (_e) { /* CustomEvent unsupported? Skip. */ }
        openPlaceholderDialog({
          title: copy.newPlaceholderTitle || copy.newLabel || 'Create skill',
          body:  copy.newPlaceholderBody  || ''
        }, trigger);
      });
    }

    // Dismiss on a click anywhere outside the trigger + panel.
    //
    // Registered in the CAPTURE phase on purpose. The Schedule
    // split-button's handler calls `stopPropagation()`, so a
    // bubble-phase listener here never sees that click and the two
    // popups would sit open on top of each other. Capture runs
    // before any target handler, so we get every click regardless of
    // who stops it later.
    document.addEventListener('click', function (e) {
      if (!isOpen() || wrap.contains(e.target)) return;
      close(false);
    }, true);

    // Dismiss when focus leaves the panel entirely (Tab past the
    // last row, or a click that moved focus into another control).
    // `relatedTarget` is null when focus left the document — the
    // panel should survive a window blur, so bail in that case.
    wrap.addEventListener('focusout', function (e) {
      if (!isOpen()) return;
      if (!e.relatedTarget) return;
      if (wrap.contains(e.relatedTarget)) return;
      close(false);
    });

    render();
  }

  function hydrateFound(root, skill, config) {
    var detail = config.detail || {};

    var crumbEl    = root.querySelector('[data-sh-skill-detail-crumb]');
    var titleEl    = root.querySelector('[data-sh-skill-detail-title]');
    var metadataEl = root.querySelector('[data-sh-skill-detail-metadata]');
    var canvasEl   = root.querySelector('[data-sh-skill-canvas]');
    var articleEl  = root.querySelector('[data-sh-skill-editor-doc]');
    var toolbarEl  = root.querySelector('[data-sh-skill-editor-toolbar]');
    var notFoundEl = root.querySelector('[data-sh-skill-detail-notfound]');
    var commitEl   = root.querySelector('[data-sh-skill-detail-commit]');
    var saveBtn    = root.querySelector('[data-sh-skill-detail-save]');
    var cancelBtn  = root.querySelector('[data-sh-skill-detail-cancel]');
    var statusEl   = root.querySelector('[data-sh-skill-detail-status]');

    // ── Effective baseline resolution ────────────────────────────────
    // SkillStore is the single source of truth for committed saves.
    // If it holds a local override, its record wins for
    // `markdown / updatedAt / updatedBy / version`; otherwise we
    // fall through to the shipped JSON. We hold the merged record
    // in `activeSkill` for the rest of the flow so header metadata
    // reads see the post-save fields immediately after a successful
    // persist (see `applyPersistedRecord` below).
    var loaded        = loadEffectiveSkill(skill);
    var activeSkill   = loaded.record;
    var effectiveBase = activeSkill.markdown || '';

    // Title cell carries BOTH `data-sh-skill-detail-crumb` and
    // `-title` (it IS the page's H1 and the breadcrumb "current"
    // node in one). Set once — the two selectors resolve to the
    // same element today, but if a future design splits them
    // apart, either query already owns the write.
    if (titleEl && activeSkill.name) titleEl.textContent = activeSkill.name;
    if (crumbEl && crumbEl !== titleEl && activeSkill.name) crumbEl.textContent = activeSkill.name;

    // Owning-agent + lifecycle pills beside the title. Both read the
    // SHIPPED record, not the merged one: ownership and publish state
    // are catalog metadata that a local edit cannot change (the editor
    // only touches markdown), so `skill` and `activeSkill` agree here —
    // using `skill` keeps it that way even if SkillStore ever starts
    // persisting more fields. Worth noting for the status pill in
    // particular: an unsaved draft in the editor does NOT make a
    // published skill "Draft", since the badge describes the catalog
    // record and the draft is local, unpublished state.
    paintAgentBadge(root, skill, config.agentLibrary);
    paintStatusBadge(root, skill, config.statusLibrary);

    if (metadataEl) {
      // Assemble from parts — each part is skipped when its
      // referenced skill fields are missing. If EVERY part is
      // skipped the caption stays hidden entirely rather than
      // showing an empty separator string. Reads the merged
      // record so a refreshed page shows the last locally-saved
      // version + updatedAt + updatedBy.
      var caption = assembleMetadata(detail.metadata, activeSkill);
      if (caption) {
        metadataEl.textContent = caption;
        metadataEl.hidden = false;
      } else {
        metadataEl.textContent = '';
        metadataEl.hidden = true;
      }
    }

    if (activeSkill.name) document.title = activeSkill.name;
    if (canvasEl)   canvasEl.hidden   = false;
    if (notFoundEl) notFoundEl.hidden = true;

    // Grab handles for the inline error banner + success toast up
    // front so the save flow can flip them without re-querying on
    // every call. Missing nodes degrade gracefully (banner-less
    // save-error path still shows an aria-live announcement).
    var errorEl = root.querySelector('[data-sh-skill-detail-save-error]');
    var errorTitleEl = root.querySelector('[data-sh-skill-detail-save-error-title]');
    var errorMessageEl = root.querySelector('[data-sh-skill-detail-save-error-message]');
    var errorDismissEl = root.querySelector('[data-sh-skill-detail-save-error-dismiss]');
    var toastEl = root.querySelector('[data-sh-skill-detail-toast]');
    var toastMessageEl = root.querySelector('[data-sh-skill-detail-toast-message]');

    function showCommit() { if (commitEl) commitEl.hidden = false; }
    function hideCommit() { if (commitEl) commitEl.hidden = true;  }
    function hideSaveError() {
      if (errorEl && !errorEl.hidden) errorEl.hidden = true;
    }

    // Read-only surface. Callers that ship `canEdit: false` get the
    // same rendered document but no editing affordances (no
    // contenteditable, no toolbar, no Save / Cancel).
    var canEdit = skill.canEdit !== false;
    if (!canEdit) {
      if (commitEl) commitEl.hidden = true;
    }

    var editor = window.SkillMarkdownEditor.create({
      root:            canvasEl,
      article:         articleEl,
      toolbar:         toolbarEl,
      initialMarkdown: effectiveBase,
      canEdit:         canEdit,

      onDirtyChange: function (isDirty) {
        if (!canEdit) return;
        if (isDirty) {
          showCommit();
        } else {
          hideCommit();
        }
        // Any dirty-state change clears a stale save-error banner —
        // the seller has moved on. Storage-error banners auto-clear
        // on the next successful save (see `attemptSave` below).
        if (isDirty) hideSaveError();
      },
      onCancel: function () {
        clearDraft(activeSkill.id);
        announce(statusEl,
          (detail.status && detail.status.discardedMessage)
            || 'Unsaved changes discarded.');
      },
      onRender: function (article) {
        enrichPreview(article, config.catalog, config.toolLibrary, activeSkill.name);
      }
      // NB: no `onSave` — the host owns the commit sequence now
      // (validate → persist → snapshot → update metadata → toast).
      // The editor's `save()` method is unused; the host calls
      // `setMarkdown(persisted.markdown)` after `SkillStore.save()`
      // resolves so the baseline reflects the persisted result.
    });

    if (!editor) return;

    // ── Restore draft ────────────────────────────────────────────────
    // Runs AFTER create() so `setDraft()` sees the initial rendered
    // baseline and flips the dirty flag from a clean → dirty state
    // once the draft content is applied. `readDraft()` is guarded by
    // baseline-envelope matching so a stale draft (against a
    // different effective baseline) is dropped and never reapplied.
    if (canEdit) {
      var draft = readDraft(activeSkill.id, effectiveBase);
      if (draft !== null && draft !== effectiveBase) {
        editor.setDraft(draft);
        announce(statusEl,
          (detail.status && detail.status.restoredMessage)
            || 'Restored unsaved changes from your previous session.');
      }
    }

    // ── Autosave (debounced) ─────────────────────────────────────────
    // Writes the current draft Markdown to localStorage ~400 ms after
    // the seller stops typing. We hook off the `input` event on the
    // contenteditable article — the editor's own listener has
    // already run by then and `getMarkdown()` returns the current
    // draft synchronously.
    //
    // NB: this is the DRAFT autosave (unsaved edits), not the
    // committed-save path. SkillStore.save() only runs when the
    // user explicitly clicks Save / hits Cmd+S.
    if (canEdit && articleEl) {
      var flushAutosave = debounce(function () {
        if (editor.isDirty()) {
          writeDraft(activeSkill.id, editor.getMarkdown(), effectiveBase);
        }
      }, AUTOSAVE_DEBOUNCE_MS);
      articleEl.addEventListener('input', flushAutosave);
    }

    // ── Save state ───────────────────────────────────────────────────
    // `isSaving` is the concurrency guard. Any Save trigger (button,
    // Cmd/Ctrl+S, "Save and leave") is a no-op while a persist is in
    // flight. `savingSince` is used to guarantee the "Saving…" state
    // renders for at least one animation frame even on ultra-fast
    // resolves (prevents a visible flash where the button flickers
    // before the toast appears).
    var isSaving = false;

    // Save button labels flip during the async operation. Restore
    // point captured once so we know what to swap back to.
    var saveCopy = detail.save || {};
    var savedLabel  = saveCopy.label || (saveBtn && saveBtn.textContent) || 'Save';
    var savingLabel = saveCopy.savingLabel || 'Saving\u2026';

    // ── Public save entry ────────────────────────────────────────────
    // `source` is diagnostic — passed to the `sh:skill-save` event
    // + dispatched to `console.debug` in dev so we can trace which
    // affordance triggered a given save (button vs. cmd-s vs.
    // save-and-leave).
    function attemptSave(source) {
      if (!canEdit) return;
      if (isSaving) return;                // ← concurrency guard
      if (!editor.isDirty()) return;       // ← nothing to save

      // 1. Serialize current draft.
      var md = editor.getMarkdown();

      // 2. Validate. Errors reject; warnings surface a confirmation.
      var validation = validateMarkdown(md, {
        displayName: activeSkill.name,
        catalog: config.catalog,
        copy: detail.validation || {}
      });

      if (!validation.ok) {
        showSaveError(detail.saveError || {}, validation.errors[0]);
        return;
      }

      // Warnings that need user confirmation. Only ONE gate today
      // (title mismatch); missing-supporting-skill warnings are
      // informational — we don't block save because a broken link
      // is still valid Markdown.
      var titleWarn = firstWarning(validation.warnings, 'h1_mismatch');
      if (titleWarn) {
        openTitleMismatchDialog(
          saveBtn,
          titleWarn,
          (detail.titleMismatch && detail.titleMismatch.bodyTemplate)
            || 'The document\u2019s title (\u201c{h1}\u201d) doesn\u2019t match this skill\u2019s display name (\u201c{name}\u201d). Save anyway?',
          function onConfirmSaveAnyway() {
            performPersist(md, source);
          },
          function onReturnToEditor() {
            if (saveBtn && typeof saveBtn.focus === 'function') saveBtn.focus();
          }
        );
        return;
      }

      performPersist(md, source);
    }

    // Actual persistence — validation already passed. Wraps the
    // SkillStore.save() promise and manages the save state, error
    // banner, toast, dirty-flag reconciliation, and metadata
    // refresh.
    function performPersist(md, source) {
      isSaving = true;
      setSaveState('saving');
      hideSaveError();
      announce(statusEl,
        (detail.status && detail.status.savingMessage) || 'Saving your changes\u2026');

      // Preserve the current scroll position of the canvas so a
      // repaint (via `editor.setMarkdown(persisted.markdown)`) at
      // the end of the save doesn't jump the seller back to the
      // top. Recorded on the canvas body — the scroll host in the
      // Skill detail layout.
      var scrollHost = root.querySelector('[data-sh-skill-canvas-body]');
      var priorScrollTop = scrollHost ? scrollHost.scrollTop : 0;

      var currentUserName = readCurrentUserName(config, activeSkill);

      window.SkillStore.save(activeSkill.id, {
        markdown:         md,
        currentUserName:  currentUserName,
        previousVersion:  activeSkill.version || ''
      }).then(function (record) {
        // 3. Persist succeeded — apply the returned record to the
        //    in-memory skill so subsequent renders (Cancel, chip
        //    enrichment) reflect the new metadata.
        applyPersistedRecord(record);

        // 4. Replace `savedMarkdown` with the persisted result and
        //    synchronize `draftMarkdown` to match. `setMarkdown()`
        //    fires `onDirtyChange(false)` internally, which hides
        //    the commit cluster.
        editor.setMarkdown(record.markdown);
        clearDraft(activeSkill.id);

        // 5. Restore scroll position if it was captured.
        if (scrollHost && priorScrollTop) {
          try { scrollHost.scrollTop = priorScrollTop; } catch (_e) {}
        }

        // 6. Success feedback: aria-live announcement + visible
        //    toast. The toast auto-dismisses; the aria-live
        //    announcement fires once.
        announce(statusEl,
          (detail.toast && detail.toast.assistiveText)
            || (detail.status && detail.status.savedMessage)
            || 'Changes saved.');
        showToast(
          (detail.toast && detail.toast.savedLabel) || 'Skill saved',
          (detail.toast && typeof detail.toast.dismissAfterMs === 'number')
            ? detail.toast.dismissAfterMs : 4000
        );

        // 7. Diagnostic event so downstream QA / analytics can
        //    observe the save. Never awaited — a listener throwing
        //    doesn't affect the flow.
        try {
          document.dispatchEvent(new CustomEvent('sh:skill-save', {
            detail: {
              skillId: activeSkill.id,
              source:  source || 'button',
              version: record.version
            }
          }));
        } catch (_e) { /* swallow */ }
      }).catch(function (err) {
        // Failure: draft intact, Save + Cancel still visible,
        // savedMarkdown untouched, no version bump. Inline error
        // banner surfaces the message; focus moves to it so
        // keyboard users don't miss it. Retry is a plain click on
        // Save.
        showSaveError(detail.saveError || {}, {
          code: (err && err.code) || 'unknown',
          message: (err && err.message)
            || (detail.status && detail.status.saveErrorMessage)
            || 'Save failed. Your draft is preserved.'
        });
        // Cross-flow signal so "Save and leave" (Schedule action)
        // can bail on its pending navigation and leave the seller
        // on the editor with the full draft intact.
        try {
          document.dispatchEvent(new CustomEvent('sh:skill-save-error', {
            detail: {
              skillId: activeSkill.id,
              source:  source || 'button',
              error:   err || null
            }
          }));
        } catch (_e) { /* swallow */ }
      }).then(function () {
        // Finally-esque. `then(onFinally)` because we support
        // older browsers without `Promise.prototype.finally`.
        isSaving = false;
        setSaveState('idle');
      });
    }

    // Apply a persisted record back to the in-memory active skill.
    // Only the four fields SkillStore returns are touched — every
    // other field (name, description, connectedSkills, ownership…)
    // stays as-shipped. Also refreshes the header metadata caption
    // so the seller sees the version bump + new updatedAt inline.
    function applyPersistedRecord(record) {
      if (!record) return;
      activeSkill.markdown  = record.markdown;
      activeSkill.updatedAt = record.updatedAt;
      activeSkill.updatedBy = record.updatedBy;
      activeSkill.version   = record.version;

      if (metadataEl) {
        var caption = assembleMetadata(detail.metadata, activeSkill);
        if (caption) {
          metadataEl.textContent = caption;
          metadataEl.hidden = false;
        }
      }
    }

    // Save-button state manager. Rendered as attribute + label
    // swap so CSS can style the "saving" state via a data-selector
    // (see `[data-sh-skill-detail-save][data-sh-skill-detail-saving]`
    // in home.scss for the pulse dot).
    function setSaveState(state) {
      if (!saveBtn) return;
      if (state === 'saving') {
        saveBtn.setAttribute('data-sh-skill-detail-saving', 'true');
        saveBtn.setAttribute('aria-busy', 'true');
        saveBtn.setAttribute('disabled', '');
        saveBtn.textContent = savingLabel;
        if (commitEl) commitEl.setAttribute('aria-busy', 'true');
      } else {
        saveBtn.removeAttribute('data-sh-skill-detail-saving');
        saveBtn.removeAttribute('aria-busy');
        saveBtn.removeAttribute('disabled');
        saveBtn.textContent = savedLabel;
        if (commitEl) commitEl.removeAttribute('aria-busy');
      }
    }

    // ── Inline error banner ──────────────────────────────────────────
    // Two flavours by title: validation errors use `titleValidation`;
    // persistence errors use `titleServer`. The message body is the
    // error's own `message` (so a per-rule copy string surfaces
    // directly). Focus moves to the banner so keyboard users don't
    // have to hunt for the message.
    function showSaveError(errorCopy, err) {
      if (!errorEl) {
        announce(statusEl,
          (err && err.message)
            || (detail.status && detail.status.saveErrorMessage)
            || 'Save failed.');
        return;
      }
      var isValidation = err && (
        err.code === 'empty' ||
        err.code === 'missing_h1' ||
        err.code === 'unsafe_html' ||
        err.code === 'unsafe_link'
      );
      if (errorTitleEl) {
        errorTitleEl.textContent = isValidation
          ? (errorCopy.titleValidation || 'Can\u2019t save yet')
          : (errorCopy.titleServer     || 'We couldn\u2019t save your changes');
      }
      if (errorMessageEl) {
        errorMessageEl.textContent = (err && err.message)
          || errorCopy.genericMessage
          || 'Please try again.';
      }
      errorEl.hidden = false;
      // `focus()` on a `tabindex="-1"` region surfaces the region
      // to screen readers + brings the outline into view for
      // sighted keyboard users. Queued in a microtask so the
      // `hidden` attribute has landed first.
      Promise.resolve().then(function () {
        try { errorEl.focus(); } catch (_e) {}
      });
    }

    // ── Toast ────────────────────────────────────────────────────────
    // Show / auto-dismiss. Uses a data-attribute for the visible
    // state so CSS transitions animate the fade. `dismissAfterMs`
    // = 0 means "sticky" — no auto-dismiss.
    var toastTimer = null;
    function showToast(message, dismissAfterMs) {
      if (!toastEl) return;
      if (toastMessageEl) toastMessageEl.textContent = String(message || '');
      toastEl.hidden = false;
      // Force a reflow before flipping the visible attr so the
      // opacity transition runs (rather than the toast snapping
      // straight to visible with no fade). One `offsetWidth` read
      // is enough — it's a cheap layout query, not a paint.
      /* eslint-disable-next-line no-unused-expressions */
      toastEl.offsetWidth;
      toastEl.setAttribute('data-sh-toast-visible', 'true');

      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
      if (dismissAfterMs > 0) {
        toastTimer = setTimeout(function () {
          hideToast();
        }, dismissAfterMs);
      }
    }
    function hideToast() {
      if (!toastEl) return;
      toastEl.removeAttribute('data-sh-toast-visible');
      // Wait out the fade before removing from the a11y tree so
      // the announcement isn't cut short.
      setTimeout(function () {
        if (toastEl.getAttribute('data-sh-toast-visible') !== 'true') {
          toastEl.hidden = true;
        }
      }, 220);
    }

    // ── Save / Cancel click handlers ─────────────────────────────────
    if (canEdit && saveBtn) {
      saveBtn.addEventListener('click', function (e) {
        e.preventDefault();
        attemptSave('button');
      });
    }
    if (canEdit && cancelBtn) {
      cancelBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (!editor.isDirty()) return;
        openDiscardDialog(cancelBtn, function onDiscardConfirmed() {
          // Restore the last successfully saved Markdown. The
          // editor's `cancel()` method repaints from
          // `savedMarkdown` (= the persisted or shipped baseline),
          // clears the dirty flag, and fires `onCancel` which
          // clears the localStorage draft.
          editor.cancel();
        });
      });
    }

    // ── Cmd/Ctrl+S ───────────────────────────────────────────────────
    // Global keydown that only fires on this page (the root check
    // in `init()` ensures we're on the detail page). Ignores
    // shift-modified variants (Save As), lets the browser handle
    // the fallback when there's nothing to save.
    if (canEdit) {
      document.addEventListener('keydown', function (e) {
        if (e.key !== 's' && e.key !== 'S') return;
        if (!(e.metaKey || e.ctrlKey)) return;
        if (e.shiftKey || e.altKey) return;
        // Ignore key repeats to reduce chatter — a held Cmd+S
        // shouldn't queue multiple saves (the concurrency guard
        // covers this too, but early-return is cheaper).
        if (e.repeat) return;
        e.preventDefault();
        if (editor.isDirty()) attemptSave('keyboard');
      });
    }

    // ── Save-error dismiss ───────────────────────────────────────────
    if (errorDismissEl) {
      errorDismissEl.addEventListener('click', function (e) {
        e.preventDefault();
        hideSaveError();
        if (saveBtn && typeof saveBtn.focus === 'function') saveBtn.focus();
      });
    }

    // ── beforeunload guard ───────────────────────────────────────────
    if (canEdit) {
      window.addEventListener('beforeunload', function (e) {
        if (editor.isDirty()) {
          e.preventDefault();
          e.returnValue = (detail.status && detail.status.unloadMessage) || '';
          return e.returnValue;
        }
      });
    }

    // ── Editor bridge for external actions ───────────────────────────
    // Header affordances that navigate away from the detail page
    // (Schedule, and future analogous actions) need to consult the
    // editor's dirty flag and, if unsaved edits exist, route the
    // navigation through the "Leave without saving?" dialog. Rather
    // than exposing `attemptSave`/`editor` globally, we hand each
    // wiring function a small `editorBridge` capability object with
    // JUST the operations it needs — `isDirty()`, `save()`,
    // `discardChanges()`. `null` when the surface is read-only
    // (`canEdit === false`) so callers can bypass the guard cleanly.
    var editorBridge = canEdit ? {
      isDirty: function () { return editor.isDirty(); },
      save:    function () { attemptSave('leave-dialog'); },
      discardChanges: function () {
        // Mirror the toolbar Cancel path: revert to `savedMarkdown`
        // + clear the localStorage draft. `editor.cancel()` fires
        // `onCancel`, which already calls `clearDraft(...)`.
        editor.cancel();
      }
    } : null;

    // ── Action wiring (header cluster) ───────────────────────────────
    var actionsCopy = detail.actions || {};
    wireUseInChat(root, activeSkill, actionsCopy);
    wireScheduleAction(root, activeSkill, actionsCopy, editorBridge);
    wireSkillSwitcher(root, activeSkill, config);
  }

  // First warning of a given code, or null.
  function firstWarning(warnings, code) {
    if (!Array.isArray(warnings)) return null;
    for (var i = 0; i < warnings.length; i++) {
      if (warnings[i] && warnings[i].code === code) return warnings[i];
    }
    return null;
  }

  // Best-effort current-user resolver for the prototype. Real
  // deployments swap this for a real identity lookup. Precedence:
  //   1. `config.currentUserName` if the template inlines one.
  //   2. `skill.updatedBy` (edits keep the last updater's name).
  //   3. `skill.createdBy` (first-time edit uses the creator).
  //   4. Static fallback (`"You"`).
  function readCurrentUserName(config, skill) {
    if (config && typeof config.currentUserName === 'string' && config.currentUserName.trim()) {
      return config.currentUserName.trim();
    }
    if (skill && typeof skill.updatedBy === 'string' && skill.updatedBy.trim()) {
      return skill.updatedBy.trim();
    }
    if (skill && typeof skill.createdBy === 'string' && skill.createdBy.trim()) {
      return skill.createdBy.trim();
    }
    return DEFAULT_CURRENT_USER;
  }

  // `config` is null only when the inlined config blob is missing or
  // malformed — the switcher has no catalog to offer in that case
  // and simply stays hidden.
  function hydrateNotFound(root, config) {
    var crumbEl    = root.querySelector('[data-sh-skill-detail-crumb]');
    var titleEl    = root.querySelector('[data-sh-skill-detail-title]');
    var metadataEl = root.querySelector('[data-sh-skill-detail-metadata]');
    var canvasEl   = root.querySelector('[data-sh-skill-canvas]');
    var notFoundEl = root.querySelector('[data-sh-skill-detail-notfound]');
    var commitEl   = root.querySelector('[data-sh-skill-detail-commit]');
    var useInChatBtn = root.querySelector('[data-sh-skill-detail-use-in-chat]');
    var scheduleBtn  = root.querySelector('[data-sh-skill-detail-schedule]');
    var scheduleChevron = root.querySelector('[data-sh-skill-detail-schedule-menu]');

    if (canvasEl) canvasEl.hidden = true;
    if (commitEl) commitEl.hidden = true;

    // Blank the header title + metadata so the fallback "Skill"
    // string doesn't peek above the not-found panel. `crumbEl` and
    // `titleEl` may resolve to the same element (they share the
    // header H1 today) — the second write is a harmless no-op.
    if (titleEl) titleEl.textContent = '';
    if (crumbEl && crumbEl !== titleEl) crumbEl.textContent = '';
    if (metadataEl) {
      metadataEl.textContent = '';
      metadataEl.hidden = true;
    }

    // No resolved skill means no owner to name and no publish state to
    // report — passing null takes each badge's own "no label" branch,
    // which blanks and hides it.
    paintAgentBadge(root, null, config && config.agentLibrary);
    paintStatusBadge(root, null, config && config.statusLibrary);

    // Hide the breadcrumb separator alongside the empty title so
    // the header doesn't render an orphaned " / " glyph. Uses the
    // `hidden` attribute so the paired `[hidden]{display:none}`
    // CSS rule removes the LI from the flex row.
    var separatorEl = root.querySelector('.seller-home__skill-detail-breadcrumb-separator');
    if (separatorEl) separatorEl.setAttribute('hidden', '');

    // Header actions have nothing to act on — disable them so a
    // seller can't fire actions against a resolved-null id.
    // Use in Chat + Schedule stay visible but `aria-disabled` for
    // AT + click-suppressed for pointer users.
    var actionButtons = [useInChatBtn, scheduleBtn, scheduleChevron];
    for (var i = 0; i < actionButtons.length; i++) {
      var btn = actionButtons[i];
      if (!btn) continue;
      btn.setAttribute('disabled', '');
      btn.setAttribute('aria-disabled', 'true');
    }

    if (notFoundEl) notFoundEl.hidden = false;

    // The switcher stays live on this branch — picking a real skill
    // from it is the fastest way off a dead `?id=`.
    if (config) wireSkillSwitcher(root, null, config);
  }

  // ── Bootstrap ────────────────────────────────────────────────────────
  function init() {
    var root = document.querySelector('[data-sh-skill-detail]');
    if (!root) return; // Not on this page.

    // Register the dialog + dropdown listeners once per page. Safe to
    // register even on the not-found branch — the modals are inert
    // until openDialog runs, and the dropdown listeners iterate over
    // whatever menu triggers happen to be visible at click time.
    initDialogListeners();
    initDropdownListeners(root);

    var config = readConfig();
    if (!config) {
      // Malformed / missing config — fall through to not-found so
      // the seller still sees a meaningful surface.
      hydrateNotFound(root, null);
      return;
    }

    var id = readIdFromUrl();
    var skill = findSkill(config.catalog, id);
    if (skill) {
      hydrateFound(root, skill, config);
    } else {
      hydrateNotFound(root, config);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
