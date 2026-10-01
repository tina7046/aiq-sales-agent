// ─────────────────────────────────────────────────────────────────────────
// Seller Home — Skill detail / editor page controller
// (/skill_detail.html)
//
// Thin caller that:
//   1. Reads `?id=<id>` or `?new=1` off the URL.
//   2. Reads the inlined page config (catalog + toolLibrary +
//      agentLibrary + statusLibrary + copy) from the
//      `#sh-skill-detail-config`
//      <script type="application/json"> block emitted by the template.
//   3. Resolves the matching skill row (by exact `id`) inside the
//      catalog, or a locally created SkillStore record.
//   4. Either
//        a. hydrates the three-block canvas (name / description /
//           instructions), breadcrumb, badges, action clusters, and
//           Save / Cancel / beforeunload / draft wiring, OR
//        b. shows the empty create canvas (`?new=1`), OR
//        c. shows the "not found" state and stops.
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
//   • Schedule     — opens the scheduling conversation (or a
//                    placeholder if that script is missing).
//   • More         — Share / Duplicate / Details (placeholders) and
//                    Delete (confirms, then returns to /skills.html).
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

  // ── Skill badge icon (inline SVG) ────────────────────────────────────
  // Per the Figma Resource Chip (node 11930:29439) the skill glyph sits
  // on a circular indigo disc (SLDS `--slds-g-color-palette-indigo-30`,
  // #2f2cb7) in white. The glyph itself is the two `<path>` runs Figma
  // ships — a scroll body + a diamond sparkle — each wrapped in a
  // `<g transform>` (so re-syncing from a future export is a raw-path
  // drop-in, no coordinate arithmetic) and re-tinted white here.
  //
  // Kept as valid XML (every attribute valued, xmlns declared) so it
  // survives the editor's `image/svg+xml` DOMParser path — this exact
  // string feeds the @-mention menu.
  var SKILL_MENTION_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="12" fill="#2f2cb7"/><g fill="#ffffff" transform="translate(5.2 5.2) scale(0.85)"><g transform="translate(0.616 0.9232)"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.4591 0C12.434 0 13.2409 0.758083 13.3017 1.73107L13.8242 10.0922H13.8462C14.3702 10.0922 14.7692 10.5235 14.7692 11.0231V12.277C14.7692 13.2992 13.9569 14.1538 12.9231 14.1538H5.23077V14.153C5.21938 14.1532 5.20797 14.1538 5.19652 14.1538C4.19111 14.1538 3.39997 13.3304 3.38523 12.3402L2.92969 4.61538H0.923077C0.413277 4.61538 0 4.20212 0 3.69231V1.84615C0 0.826551 0.826551 0 1.84615 0H11.4591ZM7.0084 12.3119C7.0084 12.5253 6.97191 12.731 6.90535 12.9231H12.9231C13.2487 12.9231 13.5384 12.6482 13.5385 12.277V11.323H7.0084V12.3119ZM3.88643 1.23077C3.95646 1.42473 3.99597 1.63301 3.99911 1.84916L4.61418 12.2758L4.61538 12.2939V12.3119C4.61538 12.6638 4.88978 12.923 5.19652 12.9231C5.50326 12.9231 5.77763 12.6638 5.77763 12.3119V11.0231C5.77763 10.5235 6.17674 10.0923 6.70071 10.0922H12.591L12.0733 1.80769C12.053 1.4834 11.7841 1.23077 11.4591 1.23077H3.88643ZM1.84615 1.23077C1.50629 1.23077 1.23077 1.50629 1.23077 1.84615V3.38462H2.85726L2.77043 1.91316L2.76923 1.89513V1.8768C2.76917 1.50559 2.47945 1.23077 2.15385 1.23077H1.84615Z"/></g><g transform="translate(5.8464 3.6928)"><path d="M2.80839 0.135688C2.89334 -0.0416965 3.14762 -0.0461579 3.23867 0.128181L3.8826 1.36166C4.07491 1.73298 4.3835 2.03049 4.76153 2.2096L6.01722 2.80997C6.19473 2.89483 6.1991 3.14889 6.02473 3.23993L4.79067 3.88387C4.41913 4.07609 4.12131 4.38437 3.94211 4.76218L3.34143 6.01729C3.25651 6.1947 3.00223 6.19917 2.91116 6.0248L2.26691 4.79132C2.07463 4.42006 1.7663 4.12249 1.38833 3.94338L0.135619 3.3427C-0.0416732 3.25778 -0.046135 3.00409 0.128111 2.91304L1.36217 2.2691C1.73371 2.07689 2.03147 1.76535 2.21073 1.3908L2.80839 0.135688Z"/></g></g></svg>';

  // Inline-chip variant of the same badge. The @-mention icon is parsed
  // as strict XML, so it can't carry the valueless hooks the chip needs;
  // here we inject the class (for CSS sizing) + the `data-*` marker (the
  // chip enrich pass uses it as a duplicate-render guard) into a copy.
  var SKILL_CHIP_BADGE_SVG = SKILL_MENTION_ICON_SVG.replace(
    '<svg xmlns="http://www.w3.org/2000/svg"',
    '<svg xmlns="http://www.w3.org/2000/svg" class="seller-home__skill-chip-icon" data-sh-skill-chip-icon=""'
  );

  // ── Storage keys / knobs ─────────────────────────────────────────────
  // Draft envelope key stays LOCAL to this controller. Committed
  // saves route through `window.SkillStore` (see `skill_store.js`) —
  // that module owns its own key prefix. Keeping the two spaces
  // separate makes it obvious in DevTools which entries are
  // "in-flight draft" vs "committed save".
  var DRAFT_KEY_PREFIX     = 'sh:skills:draft:v1:';
  var AUTOSAVE_DEBOUNCE_MS = 400;
  var CREATE_DRAFT_ID      = '__new__';

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
      d.canvas        = (d.canvas        && typeof d.canvas        === 'object') ? d.canvas        : {};
      d.edited = (d.edited && typeof d.edited === 'object') ? d.edited : {};
      d.edited.template = typeof d.edited.template === 'string' && d.edited.template
        ? d.edited.template
        : 'Edited {updatedAt}';
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

  function readNewFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      var raw = params.get('new');
      return raw === '1' || raw === 'true';
    } catch (_e) {
      return false;
    }
  }

  function makeCreateStub() {
    return {
      id:          null,
      name:        '',
      description: '',
      markdown:    '',
      created:     true,
      canEdit:     true,
      canShare:    true,
      canDelete:   true,
      createdBy:   DEFAULT_CURRENT_USER,
      actions:     ['edit', 'schedule', 'duplicate', 'share', 'delete']
    };
  }

  function mintSkillId() {
    return 'sk-new-' + Date.now();
  }

  function fieldText(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function setFieldText(el, text) {
    if (!el) return;
    var next = String(text == null ? '' : text);
    el.textContent = next;
    syncEmptyClass(el);
  }

  function syncEmptyClass(el) {
    if (!el) return;
    var empty = !String(el.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (empty) el.classList.add('is-empty');
    else el.classList.remove('is-empty');
  }

  function normalizePlain(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  // Split a stored markdown blob into the three canvas fields.
  // Leading `# Name` becomes the name field (unless `skill.name`
  // already supplies it). The first paragraph is treated as the
  // description when it duplicates `skill.description` (or when
  // description is missing). Remainder is instructions.
  function splitSkillDocument(skill) {
    var md = String(skill && skill.markdown || '');
    var name = String(skill && skill.name || '').trim();
    var description = String(skill && skill.description || '').trim();
    var lines = md.replace(/\r\n?/g, '\n').split('\n');
    var i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    var h1 = /^\s*#\s+(.+?)\s*#*\s*$/.exec(lines[i] || '');
    if (h1) {
      if (!name) name = String(h1[1] || '').trim();
      i++;
      while (i < lines.length && lines[i].trim() === '') i++;
    }
    var paraStart = i;
    var paraLines = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*#{1,6}\s/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    var firstPara = paraLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!description) description = firstPara;
    var skipPara = !!(firstPara && description && normalizeTitle(firstPara) === normalizeTitle(description));
    if (!skipPara) {
      i = paraStart;
    } else {
      while (i < lines.length && lines[i].trim() === '') i++;
    }
    var instructions = lines.slice(i).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    return { name: name, description: description, instructions: instructions };
  }

  function joinSkillDocument(name, description, instructions) {
    var n = String(name || '').trim();
    var d = String(description || '').trim();
    var body = String(instructions || '').replace(/^\n+/, '').replace(/\n+$/, '');
    var parts = [];
    if (n) parts.push('# ' + n);
    if (d) parts.push(d);
    if (body) parts.push(body);
    return parts.length ? parts.join('\n\n') + '\n' : '';
  }

  function findSkill(catalog, id) {
    if (!id || !Array.isArray(catalog)) return null;
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i] && catalog[i].id === id) return catalog[i];
    }
    return null;
  }

  // ── Edited stamp ─────────────────────────────────────────────────────
  // Header-right “Edited Mar 13” (Figma 11606:25114). Compact the
  // skill's `updatedAt` into a short date: today/yesterday become
  // month+day, and a trailing “ at 4:00 PM” is dropped so the stamp
  // stays one line beside the 32 px action group.
  var EDITED_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function formatMonthDay(when) {
    var w = (when instanceof Date) ? when : new Date();
    return EDITED_MONTHS[w.getMonth()] + ' ' + w.getDate();
  }

  function compactEditedDate(updatedAt) {
    var s = String(updatedAt || '').trim();
    if (!s) return '';
    var now = new Date();
    if (/^today\b/i.test(s)) return formatMonthDay(now);
    if (/^yesterday\b/i.test(s)) {
      return formatMonthDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    }
    var atIdx = s.indexOf(' at ');
    if (atIdx > 0) return s.slice(0, atIdx);
    return s;
  }

  function formatEditedLabel(template, skill) {
    if (!skill) return '';
    var stamp = compactEditedDate(skill.updatedAt);
    if (!stamp) return '';
    var tpl = String(template || 'Edited {updatedAt}');
    if (tpl.indexOf('{updatedAt}') === -1) return (tpl + ' ' + stamp).trim();
    return tpl.split('{updatedAt}').join(stamp);
  }

  function paintEdited(el, skill, template) {
    if (!el) return;
    var label = formatEditedLabel(template, skill);
    if (label) {
      el.textContent = label;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  // ── Activity popover ─────────────────────────────────────────────────
  // Fills the hover panel behind the "Edited …" stamp: an "Edited by"
  // row (updatedBy + compacted updatedAt) and a "Created by" row
  // (createdBy + createdAt). Dates fall back to hidden when the skill
  // carries none. `wrap` is the hover container; hidden when there is no
  // skill to describe (create mode / not-found).
  function paintActivity(wrap, skill) {
    if (!wrap) return;
    if (!skill) {
      wrap.hidden = true;
      return;
    }

    var editedBy = (skill.updatedBy && String(skill.updatedBy).trim()) ||
      (skill.createdBy && String(skill.createdBy).trim()) || DEFAULT_CURRENT_USER;
    var createdBy = (skill.createdBy && String(skill.createdBy).trim()) || DEFAULT_CURRENT_USER;
    var editedAt = compactEditedDate(skill.updatedAt);
    var createdAt = (skill.createdAt && String(skill.createdAt).trim()) || '';

    var editedByEl  = wrap.querySelector('[data-sh-activity-edited-by]');
    var editedAtEl  = wrap.querySelector('[data-sh-activity-edited-at]');
    var createdByEl = wrap.querySelector('[data-sh-activity-created-by]');
    var createdAtEl = wrap.querySelector('[data-sh-activity-created-at]');

    if (editedByEl)  editedByEl.textContent  = editedBy;
    if (createdByEl) createdByEl.textContent = createdBy;
    if (editedAtEl) {
      editedAtEl.textContent = editedAt;
      editedAtEl.hidden = !editedAt;
    }
    if (createdAtEl) {
      createdAtEl.textContent = createdAt;
      createdAtEl.hidden = !createdAt;
    }
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
  function getDraftKey(id) {
    var logical = DRAFT_KEY_PREFIX + String(id);
    return (window.SH && typeof window.SH.storageKey === 'function')
      ? window.SH.storageKey(logical)
      : logical;
  }

  function readDraft(id, currentBaseline) {
    if (!id) return null;
    try {
      var raw = window.localStorage.getItem(getDraftKey(id));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.v !== 2 && parsed.v !== 3) { clearDraft(id); return null; }
      if (typeof parsed.markdown !== 'string') return null;
      if (typeof parsed.baseline !== 'string') { clearDraft(id); return null; }
      var baseline = String(currentBaseline == null ? '' : currentBaseline);
      if (parsed.baseline !== baseline) {
        clearDraft(id);
        return null;
      }
      if (parsed.v === 2) {
        return { markdown: parsed.markdown, name: null, description: null, legacy: true };
      }
      return {
        markdown:    parsed.markdown,
        name:        typeof parsed.name === 'string' ? parsed.name : '',
        description: typeof parsed.description === 'string' ? parsed.description : '',
        legacy:      false
      };
    } catch (_e) { return null; }
  }

  function writeDraft(id, payload, baseline) {
    if (!id) return;
    try {
      var envelope = JSON.stringify({
        v:           3,
        name:        String(payload && payload.name != null ? payload.name : ''),
        description: String(payload && payload.description != null ? payload.description : ''),
        markdown:    String(payload && payload.markdown != null ? payload.markdown : ''),
        baseline:    String(baseline == null ? '' : baseline),
        savedAt:     Date.now()
      });
      window.localStorage.setItem(getDraftKey(id), envelope);
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
  // rename like "Pipeline Snapshot" vs "Pipeline  Snapshot"
  // (extra whitespace on paste) doesn't fire a false
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
  var pendingDraftAiHandler      = null;
  var pendingConditionHandler    = null;

  // Static index of dialog-kind → { modalId, backdropId }. Callers
  // pass a `kind` and the dispatcher routes close/dismiss/backdrop
  // clicks + escape without a growing switch. Adding a new dialog
  // means adding one row here + a case in `resolveConfirmHandler`.
  var DIALOG_REGISTRY = {
    'placeholder':    { modalId: 'skills-placeholder-modal',      backdropId: 'skills-placeholder-backdrop' },
    'delete':         { modalId: 'skills-delete-modal',           backdropId: 'skills-delete-backdrop' },
    'discard':        { modalId: 'skills-discard-modal',          backdropId: 'skills-discard-backdrop' },
    'title-mismatch': { modalId: 'skills-title-mismatch-modal',   backdropId: 'skills-title-mismatch-backdrop' },
    'leave':          { modalId: 'skills-leave-modal',            backdropId: 'skills-leave-backdrop' },
    'draft-ai':       { modalId: 'skills-draft-ai-modal',         backdropId: 'skills-draft-ai-backdrop' },
    'condition':      { modalId: 'skills-condition-modal',        backdropId: 'skills-condition-backdrop' }
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

  // Discard-unsaved-changes confirmation. Called from the header
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

  function openDraftAiDialog(copy, returnFocusTo, onGenerate) {
    var titleEl = document.querySelector('[data-sh-skill-draft-ai-title]');
    var labelEl = document.querySelector('[data-sh-skill-draft-ai-label]');
    var promptEl = document.querySelector('[data-sh-skill-draft-ai-prompt]');
    var generateBtn = document.querySelector('[data-sh-skill-draft-ai-generate]');
    var cancelBtn = document.querySelector('[data-sh-skill-draft-ai-cancel]');
    var cfg = copy || {};
    if (titleEl) titleEl.textContent = cfg.dialogTitle || cfg.title || 'Draft with AI';
    if (labelEl) labelEl.textContent = cfg.promptLabel || 'Describe the skill you want';
    if (promptEl) {
      promptEl.placeholder = cfg.promptPlaceholder || '';
      promptEl.value = '';
    }
    if (generateBtn && cfg.generateLabel) generateBtn.textContent = cfg.generateLabel;
    if (cancelBtn && cfg.cancelLabel) cancelBtn.textContent = cfg.cancelLabel;
    pendingDraftAiHandler = typeof onGenerate === 'function' ? onGenerate : null;
    openDialog(
      'skills-draft-ai-modal',
      'skills-draft-ai-backdrop',
      promptEl || generateBtn,
      returnFocusTo
    );
  }

  // Condition entry dialog. Opened from the block menu's If / Else If
  // items; collects a single free-text condition and hands it back so
  // the caller can insert a styled conditional block. `cfg` carries the
  // per-branch title/label/placeholder copy.
  function openConditionDialog(cfg, returnFocusTo, onSubmit) {
    var titleEl = document.querySelector('[data-sh-skill-condition-title]');
    var labelEl = document.querySelector('[data-sh-skill-condition-label]');
    var inputEl = document.querySelector('[data-sh-skill-condition-input]');
    var addBtn  = document.querySelector('[data-sh-skill-condition-add]');
    var c = cfg || {};
    if (titleEl) titleEl.textContent = c.title || 'Add a condition';
    if (labelEl) labelEl.textContent = c.label || 'When should this apply?';
    if (inputEl) {
      inputEl.placeholder = c.placeholder || '';
      inputEl.value = '';
    }
    if (addBtn && c.addLabel) addBtn.textContent = c.addLabel;
    pendingConditionHandler = typeof onSubmit === 'function' ? onSubmit : null;
    openDialog(
      'skills-condition-modal',
      'skills-condition-backdrop',
      inputEl || addBtn,
      returnFocusTo
    );
  }

  // Read the condition field, close the dialog, and fire the pending
  // handler. Shared by the Add button and the input's Enter key.
  function submitConditionDialog() {
    var inputEl = document.querySelector('[data-sh-skill-condition-input]');
    var value = inputEl ? String(inputEl.value || '') : '';
    var handler = pendingConditionHandler;
    pendingConditionHandler = null;
    closeDialog('skills-condition-modal', 'skills-condition-backdrop', null);
    if (handler) { try { handler(value); } catch (_e) {} }
    currentDialogTrigger = null;
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

      var draftAiBtn = closest(event.target, '[data-sh-skill-draft-ai-generate]');
      if (draftAiBtn) {
        event.preventDefault();
        var promptEl = document.querySelector('[data-sh-skill-draft-ai-prompt]');
        var promptValue = promptEl ? String(promptEl.value || '') : '';
        var draftAiHandler = pendingDraftAiHandler;
        pendingDraftAiHandler = null;
        closeDialog('skills-draft-ai-modal', 'skills-draft-ai-backdrop', null);
        if (draftAiHandler) {
          try { draftAiHandler(promptValue); } catch (_e) {}
        }
        currentDialogTrigger = null;
        return;
      }

      var conditionBtn = closest(event.target, '[data-sh-skill-condition-add]');
      if (conditionBtn) {
        event.preventDefault();
        submitConditionDialog();
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
      // Enter in the condition field submits, matching the Add button.
      if (event.key === 'Enter' && closest(event.target, '[data-sh-skill-condition-input]')) {
        event.preventDefault();
        submitConditionDialog();
        return;
      }
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
      pendingLeaveSaveHandler    = null;
      pendingLeaveDiscardHandler = null;
      closeDialog('skills-leave-modal', 'skills-leave-backdrop', currentDialogTrigger);
      currentDialogTrigger = null;
    } else if (kind === 'draft-ai') {
      pendingDraftAiHandler = null;
      closeDialog('skills-draft-ai-modal', 'skills-draft-ai-backdrop', currentDialogTrigger);
      currentDialogTrigger = null;
    } else if (kind === 'condition') {
      pendingConditionHandler = null;
      closeDialog('skills-condition-modal', 'skills-condition-backdrop', currentDialogTrigger);
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
    enrichToolMentionLinks(articleEl, toolLibrary);
    enrichConnectionsAndAccess(articleEl, toolLibrary);
    decorateSupportingSkillsGroup(articleEl);
    decorateConnectionsGroup(articleEl, toolLibrary);
  }

  // Inline `@`-mentions of a tool serialize as `[Salesforce](#tool/sf)`.
  // Post-render we turn those anchors into the same chip treatment the
  // supporting-skill links get, but with the tool's icon. Idempotent so
  // live-preview re-renders don't compound state.
  function enrichToolMentionLinks(articleEl, toolLibrary) {
    var lib = (toolLibrary && typeof toolLibrary === 'object') ? toolLibrary : {};
    var anchors = articleEl.querySelectorAll('a[href^="#tool/"]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = a.getAttribute('href') || '';
      var key = decodeURIComponent(href.replace(/^#tool\//, ''));
      var tool = Object.prototype.hasOwnProperty.call(lib, key) ? (lib[key] || {}) : null;
      if (!a.classList.contains('seller-home__skill-chip')) {
        a.classList.add('seller-home__skill-chip');
      }
      a.setAttribute('contenteditable', 'false');
      a.setAttribute('draggable', 'false');
      if (tool) {
        a.classList.add('seller-home__skill-chip_known');
        a.classList.remove('seller-home__skill-chip_missing');
        a.removeAttribute('aria-disabled');
        a.removeAttribute('tabindex');
        a.setAttribute('title', 'Tool: ' + (tool.name || key));
        // Icon as a background-image span (NOT an <img>) so the anchor
        // round-trips to `[label](#tool/key)` — see the CSS note.
        var iconSrc = tool.iconRef || tool.icon;
        if (iconSrc && !a.querySelector('[data-sh-skill-tool-chip-icon]')) {
          var icon = document.createElement('span');
          icon.className = 'seller-home__skill-tool-chip-icon';
          icon.setAttribute('data-sh-skill-tool-chip-icon', '');
          icon.setAttribute('aria-hidden', 'true');
          icon.style.backgroundImage = 'url("' + iconSrc + '")';
          a.insertBefore(icon, a.firstChild);
        }
      } else {
        a.classList.remove('seller-home__skill-chip_known');
        a.classList.add('seller-home__skill-chip_missing');
        a.setAttribute('aria-disabled', 'true');
        a.setAttribute('tabindex', '-1');
        a.setAttribute('title', 'Tool not found: ' + key);
        var oldIcon = a.querySelector('[data-sh-skill-tool-chip-icon]');
        if (oldIcon && oldIcon.parentNode) oldIcon.parentNode.removeChild(oldIcon);
      }
    }
  }

  function enrichSupportingSkillLinks(articleEl, catalog) {
    var anchors = articleEl.querySelectorAll('a[href*="skill_detail.html?id="]');
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
        a.setAttribute('contenteditable', 'false');
        a.setAttribute('draggable', 'false');
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
          // `src/aiq-sales-agent/assets/images/skill-chip.svg`; this string is a
          // verbatim inline copy so we skip a runtime fetch. Keep
          // in sync when the SVG is refreshed. The `class` and
          // `data-*` hooks match the previous <img> so the
          // duplicate-render guard, sizing rules, and remove-on-
          // "missing" path all continue to apply.
          a.insertAdjacentHTML(
            'afterbegin',
            SKILL_CHIP_BADGE_SVG
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

  // Build the grouped resource list the editor's @-mention picker
  // renders: every catalog skill (bar the one being edited) plus every
  // tool in the library. Skill hrefs point at the detail page; tool
  // hrefs use the `#tool/<key>` fragment enrichToolMentionLinks reads.
  function buildMentionResources(config, activeSkill) {
    var groups = [];
    var catalog = Array.isArray(config.catalog) ? config.catalog : [];
    var currentId = (activeSkill && activeSkill.id) || '';
    var seen = {};
    var skillItems = [];
    for (var i = 0; i < catalog.length; i++) {
      var s = catalog[i];
      if (!s || !s.id || s.id === currentId || seen[s.id]) continue;
      seen[s.id] = true;
      skillItems.push({
        label: s.name || s.id,
        href:  window.SH.userUrl('/skill_detail.html?id=' + encodeURIComponent(s.id)),
        // Self-contained circular indigo skill badge (white glyph baked in).
        iconSvg: SKILL_MENTION_ICON_SVG,
        iconBadge: 'skill'
      });
    }
    if (skillItems.length) groups.push({ label: 'Skills', items: skillItems });

    // Tools group temporarily hidden from the @-mention menu. Flip
    // SHOW_TOOLS_MENTION_GROUP back to true to restore it.
    var SHOW_TOOLS_MENTION_GROUP = false;
    if (SHOW_TOOLS_MENTION_GROUP) {
      var lib = (config.toolLibrary && typeof config.toolLibrary === 'object') ? config.toolLibrary : {};
      var toolItems = [];
      for (var key in lib) {
        if (!Object.prototype.hasOwnProperty.call(lib, key)) continue;
        var entry = lib[key] || {};
        toolItems.push({
          label:   entry.name || key,
          href:    '#tool/' + encodeURIComponent(key),
          iconRef: entry.iconRef || entry.icon || ''
        });
      }
      if (toolItems.length) groups.push({ label: 'Tools', items: toolItems });
    }
    return groups;
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

    function markChipAtomic(chip) {
      if (!chip || chip.nodeType !== 1) return;
      chip.setAttribute('contenteditable', 'false');
      chip.setAttribute('draggable', 'false');
    }

    for (var c = 0; c < chipNodes.length; c++) markChipAtomic(chipNodes[c]);

    // Chips-only paragraph: keep the chips in the original <p> so
    // the block body stays contenteditable. Native Backspace /
    // Delete / undo then treat each chip as an atomic unit.
    if (lastKeepIdx < 0) {
      p.classList.add('seller-home__skill-chip-row');
      p.setAttribute('role', 'group');
      p.setAttribute('aria-label', 'Supporting skills');
      p.setAttribute('data-sh-skill-chip-lifted', '1');
      return;
    }

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
    row.setAttribute('contenteditable', 'true');
    row.setAttribute('data-sh-skill-block-body', '');
    for (var j = 0; j < toMove.length; j++) {
      row.appendChild(toMove[j]);
    }
    // Trim trailing whitespace inside the kept paragraph.
    while (p.lastChild && p.lastChild.nodeType === 3 && /^\s*$/.test(p.lastChild.nodeValue || '')) {
      p.removeChild(p.lastChild);
    }
    p.parentNode.insertBefore(row, p.nextSibling);
    p.setAttribute('data-sh-skill-chip-lifted', '1');
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
    li.setAttribute('contenteditable', 'false');
    li.setAttribute('draggable', 'false');
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
          window.location.href = window.SH.userUrl(draft.url);
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
  }

  // Header overflow: Share / Duplicate / Details / Delete.
  // Share, Duplicate, and Details are labeled placeholders until
  // those surfaces ship. Delete confirms, then returns to the
  // Skills list — this page has no catalog row to remove in-place.
  function wireMoreActions(root, skill, actionsCopy) {
    var moreCopy = (actionsCopy && actionsCopy.more) || {};
    var placeholders = moreCopy.placeholders || {};
    var moreBtn = root.querySelector('[data-sh-skill-detail-more-menu]');
    var items = root.querySelectorAll('[data-sh-skill-detail-more-item]');
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        item.addEventListener('click', function (e) {
          e.preventDefault();
          var itemId = item.getAttribute('data-sh-skill-detail-more-item') || '';
          var wrap = closest(item, '.slds-dropdown-trigger');
          var trigger = wrap && wrap.querySelector('[aria-haspopup="menu"]');
          if (wrap && wrap.classList.contains('slds-is-open')) {
            wrap.classList.remove('slds-is-open');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
          }
          var returnFocus = trigger || moreBtn;
          if (itemId === 'delete') {
            openDeleteDialog(returnFocus, function () {
              window.location.href = window.SH.userUrl('/skills.html');
            });
            return;
          }
          var copy = placeholders[itemId] || {};
          openPlaceholderDialog({
            title: copy.title || (item.textContent || '').trim() || 'Action',
            body:  copy.body || 'This action isn\u2019t wired up yet.'
          }, returnFocus);
          try {
            document.dispatchEvent(new CustomEvent('sh:skill-action', {
              detail: { action: itemId, skillId: skill.id, trigger: returnFocus }
            }));
          } catch (_e) { /* swallow */ }
        });
      }(items[i]));
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

  // "Updated yesterday". Same resilience rule as the header metadata
  // caption: an empty source field is dropped rather than rendered
  // with a hole in it.
  function switcherMeta(skill, copy) {
    var out = { updated: '' };
    if (copy.updatedTemplate && skill.updatedAt) {
      out.updated = copy.updatedTemplate.replace('{updatedAt}', skill.updatedAt);
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
        a.href = window.SH.userUrl('/skill_detail.html?id=' + encodeURIComponent(skill.id));
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
        if (metaParts.updated) {
          var meta = document.createElement('span');
          meta.className = 'seller-home__skill-detail-switcher-link-meta';

          var updSpan = document.createElement('span');
          updSpan.className = 'seller-home__skill-detail-switcher-link-updated';
          updSpan.textContent = metaParts.updated;
          meta.appendChild(updSpan);

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
        try {
          document.dispatchEvent(new CustomEvent('sh:skills-create', {
            detail: { source: 'skill-switcher' }
          }));
        } catch (_e) { /* CustomEvent unsupported? Skip. */ }
        window.location.href = window.SH.userUrl('/skill_detail.html?new=1');
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

  function hydrateFound(root, skill, config, options) {
    var detail = config.detail || {};
    var canvasCopy = detail.canvas || {};
    var untitledLabel = canvasCopy.untitledLabel || 'Untitled';
    var isCreateMode = !!(options && options.isCreate);

    var crumbEl    = root.querySelector('[data-sh-skill-detail-crumb]');
    var titleEl    = root.querySelector('[data-sh-skill-detail-title]');
    var editedEl   = root.querySelector('[data-sh-skill-detail-edited]');
    var editedWrapEl = root.querySelector('[data-sh-skill-detail-edited-wrap]');
    var canvasEl   = root.querySelector('[data-sh-skill-canvas]');
    var articleEl  = root.querySelector('[data-sh-skill-editor-doc]');
    var toolbarEl  = null;
    var notFoundEl = root.querySelector('[data-sh-skill-detail-notfound]');
    var commitEl   = root.querySelector('[data-sh-skill-detail-commit]');
    var saveBtn    = root.querySelector('[data-sh-skill-detail-save]');
    var cancelBtn  = root.querySelector('[data-sh-skill-detail-cancel]');
    var statusEl   = root.querySelector('[data-sh-skill-detail-status]');
    var nameEl     = root.querySelector('[data-sh-skill-canvas-name]');
    var descEl     = root.querySelector('[data-sh-skill-canvas-description]');
    var starterEl  = root.querySelector('[data-sh-skill-starter-cards]');
    var actionGroupEl = root.querySelector('[data-sh-skill-detail-action-group]');
    var editedTemplate = (detail.edited && detail.edited.template) || 'Edited {updatedAt}';

    function refreshEdited() {
      var sk = isCreateMode ? null : activeSkill;
      paintEdited(editedEl, sk, editedTemplate);
      // Show the hover wrapper only when the stamp itself has a label.
      paintActivity(editedWrapEl, (editedEl && !editedEl.hidden) ? sk : null);
      if (editedWrapEl) editedWrapEl.hidden = !!(editedEl && editedEl.hidden);
    }

    // ── Effective baseline resolution ────────────────────────────────
    var loaded = (skill && skill.id) ? loadEffectiveSkill(skill) : { record: skill, hasLocalOverride: false };
    var activeSkill = loaded.record || skill || makeCreateStub();
    var parts = splitSkillDocument(activeSkill);
    var savedName = parts.name;
    var savedDesc = parts.description;
    var savedInstructions = parts.instructions;
    var effectiveBase = joinSkillDocument(savedName, savedDesc, savedInstructions);

    function paintHeaderTitle(name) {
      var label = String(name || '').trim() || untitledLabel;
      if (titleEl) titleEl.textContent = label;
      if (crumbEl && crumbEl !== titleEl) crumbEl.textContent = label;
      document.title = label;
    }

    paintHeaderTitle(savedName);

    if (isCreateMode) {
      paintAgentBadge(root, null, config.agentLibrary);
      paintStatusBadge(root, null, config.statusLibrary);
      refreshEdited();
      if (actionGroupEl) actionGroupEl.hidden = true;
    } else {
      paintAgentBadge(root, skill, config.agentLibrary);
      paintStatusBadge(root, skill, config.statusLibrary);
      refreshEdited();
      if (actionGroupEl) actionGroupEl.hidden = false;
    }

    if (canvasEl)   canvasEl.hidden   = false;
    if (notFoundEl) notFoundEl.hidden = true;

    setFieldText(nameEl, savedName);
    setFieldText(descEl, savedDesc);

    var errorEl = root.querySelector('[data-sh-skill-detail-save-error]');
    var errorTitleEl = root.querySelector('[data-sh-skill-detail-save-error-title]');
    var errorMessageEl = root.querySelector('[data-sh-skill-detail-save-error-message]');
    var errorDismissEl = root.querySelector('[data-sh-skill-detail-save-error-dismiss]');
    var toastEl = root.querySelector('[data-sh-skill-detail-toast]');
    var toastMessageEl = root.querySelector('[data-sh-skill-detail-toast-message]');
    var toastCloseEl = root.querySelector('[data-sh-skill-detail-toast-close]');

    function showCommit() { if (commitEl) commitEl.hidden = false; }
    function hideCommit() { if (commitEl) commitEl.hidden = true;  }
    function hideSaveError() {
      if (errorEl && !errorEl.hidden) errorEl.hidden = true;
    }

    var canEdit = skill.canEdit !== false;
    if (!canEdit) {
      if (commitEl) commitEl.hidden = true;
      if (nameEl) nameEl.setAttribute('contenteditable', 'false');
      if (descEl) descEl.setAttribute('contenteditable', 'false');
    }

    function draftStorageId() {
      return (activeSkill && activeSkill.id) ? activeSkill.id : CREATE_DRAFT_ID;
    }

    function combinedIsDirty() {
      if (normalizePlain(fieldText(nameEl)) !== normalizePlain(savedName)) return true;
      if (normalizePlain(fieldText(descEl)) !== normalizePlain(savedDesc)) return true;
      return !!(editor && editor.isDirty());
    }

    function refreshCommit() {
      if (!canEdit) return;
      if (combinedIsDirty()) showCommit();
      else hideCommit();
    }

    function syncArticleEmpty() {
      if (!articleEl) return;
      var md = editor ? editor.getMarkdown() : savedInstructions;
      if (!String(md || '').trim()) articleEl.classList.add('is-empty');
      else articleEl.classList.remove('is-empty');
    }

    function hideStarterCards() {
      if (starterEl) starterEl.hidden = true;
    }

    function showStarterCards() {
      if (starterEl) starterEl.hidden = false;
    }

    var editor = window.SkillMarkdownEditor.create({
      root:            canvasEl,
      article:         articleEl,
      toolbar:         toolbarEl,
      initialMarkdown: savedInstructions,
      canEdit:         canEdit,
      blockCopy:       canvasCopy.blocks || {},
      resources:       buildMentionResources(config, activeSkill),

      onPlaceholder: function (kind, trigger) {
        var copy = (canvasCopy.blocks || {});
        if (kind === 'refine') {
          openPlaceholderDialog({
            title: copy.refineTitle || 'Refine with AI',
            body:  copy.refineBody || 'Inline AI refinement is not connected in this prototype.'
          }, trigger);
        } else if (kind === 'conditional') {
          // Which branch fired? The trigger is the menu button; its
          // data-convert distinguishes if / elseif / else.
          var branch = (trigger && trigger.getAttribute)
            ? (trigger.getAttribute('data-convert') || 'if')
            : 'if';
          if (branch === 'else') {
            // "Else" carries no condition — insert directly.
            editor.insertConditional('else', '');
            hideStarterCards();
            syncArticleEmpty();
            refreshCommit();
          } else {
            var isElseIf = branch === 'elseif';
            openConditionDialog({
              title:       isElseIf ? (copy.elseIfTitle || 'Add an Else If condition') : (copy.ifTitle || 'Add an If condition'),
              label:       copy.conditionLabel || 'When should this apply?',
              placeholder: copy.conditionPlaceholder || 'e.g. the account is in Healthcare',
              addLabel:    copy.conditionAddLabel || 'Add'
            }, trigger, function (value) {
              // insertConditional already drops the caret into the new
              // block, so no editor.focus() (that would jump to the top).
              editor.insertConditional(branch, value);
              hideStarterCards();
              syncArticleEmpty();
              refreshCommit();
            });
          }
        } else if (kind === 'draft') {
          openDraftAiDialog(canvasCopy.draftWithAi || {}, trigger, function () {
            var sample = (canvasCopy.draftWithAi && canvasCopy.draftWithAi.sample) || '';
            hideStarterCards();
            editor.setDraft(sample);
            syncArticleEmpty();
            refreshCommit();
            editor.focus();
          });
        }
      },

      onDirtyChange: function (isDirty) {
        if (!canEdit) return;
        refreshCommit();
        if (isDirty) hideSaveError();
        syncArticleEmpty();
        if (isDirty && editor && String(editor.getMarkdown() || '').trim()) {
          hideStarterCards();
        }
      },
      onCancel: function () {
        clearDraft(draftStorageId());
        announce(statusEl,
          (detail.status && detail.status.discardedMessage)
            || 'Unsaved changes discarded.');
      },
      onRender: function (article) {
        enrichPreview(article, config.catalog, config.toolLibrary, fieldText(nameEl) || savedName);
        syncArticleEmpty();
      }
    });

    if (!editor) return;

    syncArticleEmpty();
    if (isCreateMode && !String(savedInstructions || '').trim()) {
      showStarterCards();
    } else {
      hideStarterCards();
    }

    if (canEdit) {
      var draft = readDraft(draftStorageId(), effectiveBase);
      if (draft) {
        var restoredInstructions = draft.markdown;
        var restoredName = draft.name;
        var restoredDesc = draft.description;
        if (draft.legacy) {
          var splitDraft = splitSkillDocument({
            name: savedName,
            description: savedDesc,
            markdown: draft.markdown
          });
          restoredName = splitDraft.name;
          restoredDesc = splitDraft.description;
          restoredInstructions = splitDraft.instructions;
        }
        var sameAsSaved =
          normalizePlain(restoredName) === normalizePlain(savedName) &&
          normalizePlain(restoredDesc) === normalizePlain(savedDesc) &&
          String(restoredInstructions || '') === String(savedInstructions || '');
        if (!sameAsSaved) {
          if (restoredName != null) setFieldText(nameEl, restoredName);
          if (restoredDesc != null) setFieldText(descEl, restoredDesc);
          editor.setDraft(restoredInstructions);
          paintHeaderTitle(fieldText(nameEl));
          if (String(restoredInstructions || '').trim()) hideStarterCards();
          refreshCommit();
          announce(statusEl,
            (detail.status && detail.status.restoredMessage)
              || 'Restored unsaved changes from your previous session.');
        }
      }
    }

    if (canEdit) {
      var flushAutosave = debounce(function () {
        if (combinedIsDirty()) {
          writeDraft(draftStorageId(), {
            name: fieldText(nameEl),
            description: fieldText(descEl),
            markdown: editor.getMarkdown()
          }, effectiveBase);
        }
      }, AUTOSAVE_DEBOUNCE_MS);
      if (articleEl) articleEl.addEventListener('input', flushAutosave);
      if (nameEl) nameEl.addEventListener('input', flushAutosave);
      if (descEl) descEl.addEventListener('input', flushAutosave);
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
      if (isSaving) return;
      if (!combinedIsDirty()) return;

      var name = fieldText(nameEl);
      var desc = fieldText(descEl);
      var instructions = editor.getMarkdown();
      var copy = detail.validation || {};

      if (!name) {
        showSaveError(detail.saveError || {}, {
          code: 'missing_name',
          message: copy.missingName || 'Name is required.'
        });
        return;
      }
      if (!desc) {
        showSaveError(detail.saveError || {}, {
          code: 'missing_description',
          message: copy.missingDescription || 'Add a description to help your agent identify this skill.'
        });
        return;
      }

      var md = joinSkillDocument(name, desc, instructions);
      var validation = validateMarkdown(md, {
        displayName: name,
        catalog: config.catalog,
        copy: copy
      });

      if (!validation.ok) {
        showSaveError(detail.saveError || {}, validation.errors[0]);
        return;
      }

      performPersist(md, source, name, desc, instructions);
    }

    // Actual persistence — validation already passed. Wraps the
    // SkillStore.save() promise and manages the save state, error
    // banner, toast, dirty-flag reconciliation, and metadata
    // refresh.
    function performPersist(md, source, name, desc, instructions) {
      isSaving = true;
      setSaveState('saving');
      hideSaveError();
      announce(statusEl,
        (detail.status && detail.status.savingMessage) || 'Saving your changes\u2026');

      var scrollHost = root.querySelector('[data-sh-skill-canvas-body]');
      var priorScrollTop = scrollHost ? scrollHost.scrollTop : 0;

      var currentUserName = readCurrentUserName(config, activeSkill);
      var skillId = activeSkill.id;
      var minted = false;
      if (!skillId) {
        skillId = mintSkillId();
        minted = true;
      }

      window.SkillStore.save(skillId, {
        markdown:         md,
        name:             name,
        description:      desc,
        created:          isCreateMode || activeSkill.created === true,
        currentUserName:  currentUserName,
        previousVersion:  activeSkill.version || ''
      }).then(function (record) {
        if (minted) {
          clearDraft(CREATE_DRAFT_ID);
          activeSkill.id = skillId;
          isCreateMode = false;
          if (actionGroupEl) actionGroupEl.hidden = false;
          try {
            window.history.replaceState(
              null,
              '',
              window.SH.userUrl('/skill_detail.html?id=' + encodeURIComponent(skillId))
            );
          } catch (_e) { /* ignore */ }
        }

        applyPersistedRecord(record);
        savedName = name;
        savedDesc = desc;
        savedInstructions = instructions;
        effectiveBase = md;
        activeSkill.name = name;
        activeSkill.description = desc;
        editor.setMarkdown(instructions);
        paintHeaderTitle(name);
        hideStarterCards();
        clearDraft(skillId);

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
    // other field (name, description, connectedTools, ownership…)
    // stays as-shipped. Also refreshes the header edited stamp so
    // the seller sees the new date inline.
    function applyPersistedRecord(record) {
      if (!record) return;
      activeSkill.markdown  = record.markdown;
      activeSkill.updatedAt = record.updatedAt;
      activeSkill.updatedBy = record.updatedBy;
      activeSkill.version   = record.version;
      if (typeof record.name === 'string') activeSkill.name = record.name;
      if (typeof record.description === 'string') activeSkill.description = record.description;
      if (record.created === true) activeSkill.created = true;

      refreshEdited();
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
        err.code === 'missing_name' ||
        err.code === 'missing_description' ||
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
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
      toastEl.removeAttribute('data-sh-toast-visible');
      // Wait out the fade before removing from the a11y tree so
      // the announcement isn't cut short.
      setTimeout(function () {
        if (toastEl.getAttribute('data-sh-toast-visible') !== 'true') {
          toastEl.hidden = true;
        }
      }, 220);
    }

    // Trailing close button dismisses the toast immediately (and
    // cancels the pending auto-dismiss timer via hideToast).
    if (toastCloseEl) {
      toastCloseEl.addEventListener('click', function () { hideToast(); });
    }

    function isCanvasEmpty() {
      return !fieldText(nameEl) && !fieldText(descEl) && !String(editor.getMarkdown() || '').trim();
    }

    function leaveToSkills() {
      window.location.href = window.SH.userUrl((detail.back && detail.back.href) || '/skills.html');
    }

    function revertCanvas() {
      setFieldText(nameEl, savedName);
      setFieldText(descEl, savedDesc);
      paintHeaderTitle(savedName);
      editor.cancel();
      syncArticleEmpty();
      refreshCommit();
      if (isCreateMode && !String(savedInstructions || '').trim()) showStarterCards();
    }

    if (canEdit && saveBtn) {
      saveBtn.addEventListener('click', function (e) {
        e.preventDefault();
        attemptSave('button');
      });
    }
    if (canEdit && cancelBtn) {
      cancelBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (isCreateMode && !combinedIsDirty() && isCanvasEmpty()) {
          leaveToSkills();
          return;
        }
        if (!combinedIsDirty()) return;
        openDiscardDialog(cancelBtn, function onDiscardConfirmed() {
          revertCanvas();
          if (isCreateMode && isCanvasEmpty()) leaveToSkills();
        });
      });
    }

    if (canEdit) {
      document.addEventListener('keydown', function (e) {
        if (e.key !== 's' && e.key !== 'S') return;
        if (!(e.metaKey || e.ctrlKey)) return;
        if (e.shiftKey || e.altKey) return;
        if (e.repeat) return;
        e.preventDefault();
        if (combinedIsDirty()) attemptSave('keyboard');
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

    if (canEdit) {
      window.addEventListener('beforeunload', function (e) {
        if (combinedIsDirty()) {
          e.preventDefault();
          e.returnValue = (detail.status && detail.status.unloadMessage) || '';
          return e.returnValue;
        }
      });
    }

    if (canEdit && nameEl) {
      nameEl.addEventListener('input', function () {
        syncEmptyClass(nameEl);
        paintHeaderTitle(fieldText(nameEl));
        refreshCommit();
        if (combinedIsDirty()) hideSaveError();
      });
      nameEl.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (descEl) descEl.focus();
      });
      nameEl.addEventListener('blur', function () {
        if (!fieldText(nameEl)) {
          nameEl.textContent = '';
          syncEmptyClass(nameEl);
        }
      });
      nameEl.addEventListener('paste', function (e) {
        if (!e.clipboardData) return;
        e.preventDefault();
        var text = e.clipboardData.getData('text/plain').replace(/\s+/g, ' ').trim();
        document.execCommand('insertText', false, text);
      });
    }

    if (canEdit && descEl) {
      descEl.addEventListener('input', function () {
        syncEmptyClass(descEl);
        refreshCommit();
        if (combinedIsDirty()) hideSaveError();
      });
      descEl.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        editor.focus();
      });
      descEl.addEventListener('blur', function () {
        if (!fieldText(descEl)) {
          descEl.textContent = '';
          syncEmptyClass(descEl);
        }
      });
    }

    var dividerEl = root.querySelector('[data-sh-skill-canvas-divider]');
    if (canEdit && dividerEl) {
      dividerEl.addEventListener('click', function () {
        editor.focus();
      });
    }

    if (canEdit && starterEl) {
      starterEl.addEventListener('click', function (e) {
        var card = closest(e.target, '[data-sh-skill-starter]');
        if (!card) return;
        var kind = card.getAttribute('data-sh-skill-starter');
        if (kind === 'outline') {
          var template = (canvasCopy.outline && canvasCopy.outline.template) || '';
          hideStarterCards();
          editor.setDraft(template);
          syncArticleEmpty();
          refreshCommit();
          editor.focus();
        } else if (kind === 'draft-ai') {
          openDraftAiDialog(canvasCopy.draftWithAi || {}, card, function () {
            var sample = (canvasCopy.draftWithAi && canvasCopy.draftWithAi.sample) || '';
            hideStarterCards();
            editor.setDraft(sample);
            syncArticleEmpty();
            refreshCommit();
            editor.focus();
          });
        }
      });
    }

    var editorBridge = canEdit ? {
      isDirty: function () { return combinedIsDirty(); },
      save:    function () { attemptSave('leave-dialog'); },
      discardChanges: function () {
        revertCanvas();
      }
    } : null;

    // ── Action wiring (header cluster) ───────────────────────────────
    var actionsCopy = detail.actions || {};
    wireUseInChat(root, activeSkill, actionsCopy);
    wireScheduleAction(root, activeSkill, actionsCopy, editorBridge);
    wireMoreActions(root, activeSkill, actionsCopy);
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

  // Best-effort current-user resolver for the prototype. Precedence:
  //   1. `config.currentUserName` (inlined from the URL user's catalog).
  //   2. `window.SH_USER.name` (same catalog, from the path prefix).
  //   3. `skill.updatedBy` (edits keep the last updater's name).
  //   4. `skill.createdBy` (first-time edit uses the creator).
  //   5. Static fallback (`"You"`).
  function readCurrentUserName(config, skill) {
    if (config && typeof config.currentUserName === 'string' && config.currentUserName.trim()) {
      return config.currentUserName.trim();
    }
    if (window.SH_USER && typeof window.SH_USER.name === 'string' && window.SH_USER.name.trim()) {
      return window.SH_USER.name.trim();
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
    var editedEl   = root.querySelector('[data-sh-skill-detail-edited]');
    var canvasEl   = root.querySelector('[data-sh-skill-canvas]');
    var notFoundEl = root.querySelector('[data-sh-skill-detail-notfound]');
    var commitEl   = root.querySelector('[data-sh-skill-detail-commit]');
    var useInChatBtn = root.querySelector('[data-sh-skill-detail-use-in-chat]');
    var scheduleBtn  = root.querySelector('[data-sh-skill-detail-schedule]');
    var moreChevron = root.querySelector('[data-sh-skill-detail-more-menu]');

    if (canvasEl) canvasEl.hidden = true;
    if (commitEl) commitEl.hidden = true;

    // Blank the header title + edited stamp so leftover copy doesn't
    // peek above the not-found panel. `crumbEl` and `titleEl` may
    // resolve to the same element (they share the header H1 today)
    // — the second write is a harmless no-op.
    if (titleEl) titleEl.textContent = '';
    if (crumbEl && crumbEl !== titleEl) crumbEl.textContent = '';
    paintEdited(editedEl, null, '');
    var editedWrapEl = root.querySelector('[data-sh-skill-detail-edited-wrap]');
    if (editedWrapEl) editedWrapEl.hidden = true;

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
    var actionButtons = [useInChatBtn, scheduleBtn, moreChevron];
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
    var isNew = readNewFromUrl();
    var skill = findSkill(config.catalog, id);

    if (!skill && id && window.SkillStore && typeof window.SkillStore.loadCreated === 'function') {
      try { skill = window.SkillStore.loadCreated(id); }
      catch (_e) { skill = null; }
    }

    if (isNew && !id) {
      hydrateFound(root, makeCreateStub(), config, { isCreate: true });
    } else if (skill) {
      hydrateFound(root, skill, config, { isCreate: false });
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
