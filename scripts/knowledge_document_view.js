// ─────────────────────────────────────────────────────────────────────────
// Knowledge document view — reusable Preview / Edit / TOC controller.
//
// Extracted from `knowledge_agent.js` so both the agent-scoped Knowledge
// surface (/hunter_agent_knowledge.html) and the Seller Home document
// detail page (/knowledge_document_detail.html) can share the same
// markdown parser, syntax highlighter, table-of-contents builder,
// scroll-spy, and view-swap logic without diverging.
//
// The public API is a single factory:
//
//     var view = KnowledgeDocumentView.create(options)
//
// `options` names every DOM node + configuration knob the controller
// needs so the module never queries the document directly (aside from
// the `beforeunload` / global `click` / global `resize` listeners
// where a scoped selector isn't meaningful). Callers pass in the
// nodes their own template just rendered — this keeps the module
// selector-agnostic and lets two hosts wire it against completely
// different class names.
//
// Public shape of `options`:
//
//   root                — outer wrapper (`data-knowledge-view` lives here).
//   sourceScript        — `<script type="text/markdown">` holding the
//                         initial markdown (JSON-escaped). Optional if
//                         `initialSource` is provided directly.
//   initialSource       — string; overrides `sourceScript`.
//   preview             — element to hide/show in Preview mode.
//   article             — `<article>` that receives rendered HTML.
//   toc                 — outer `<aside>` for the table of contents.
//   tocList             — `<ol>` receiving TOC link fragments.
//   tocBody             — TOC coordinate space for the rail indicator.
//   railIndicator       — the blue 2px active-section block.
//   edit                — element to hide/show in Edit mode.
//   editorRoot          — root of the editor (currently unused, but
//                         reserved for future overlays / focus scoping).
//   textarea            — the real editable input (source of truth).
//   highlight           — `<code>` inside the syntax-highlight `<pre>`.
//   gutter              — inner container of line-number spans.
//   code                — code area wrapper (parent of textarea +
//                         highlight overlay + current-line stripe).
//   currentLine         — 1-row-tall current-line indicator element.
//   toggleButtons       — NodeList / Array of buttons that carry
//                         `data-knowledge-view="preview"|"edit"`.
//   toolbarFormatButtons  — buttons carrying `data-knowledge-format`.
//   toolbarHistoryButtons — buttons carrying `data-knowledge-history`.
//   toolbarMenus        — trigger buttons for dropdown toolbars
//                         (currently the Heading H1/H2/H3 picker).
//   scrollRoot          — Element or CSS selector used as the
//                         `IntersectionObserver` root for scroll-spy.
//                         Pass the closest scrolling ancestor of the
//                         article (Agent Configuration uses
//                         `.hunter-builder__panel-body`; Seller Home
//                         uses `.seller-home__knowledge-doc-detail-body`).
//                         `null` / omitted → viewport.
//   onDirtyChange(dirty)  — optional. Fires with `true` when the
//                           textarea's value diverges from the saved
//                           baseline; fires with `false` after a save
//                           or a `snapshot()` call resets the baseline.
//   onSave(markdown)      — optional. Fires when `save()` is called by
//                           the host (e.g., a Save button in the
//                           header). The host is responsible for
//                           persisting; the module updates the
//                           baseline + fires `onDirtyChange(false)`.
//   onCancel()            — optional. Fires when `cancel()` is called
//                           after the module has reverted to baseline.
//
// Public methods on the returned view:
//   renderPreview()     — re-parse the textarea and rebuild the article + TOC.
//   setView('preview'|'edit') — swap the visible surface.
//   getSource()         — current textarea value.
//   isDirty()           — true when value diverges from baseline.
//   save()              — snapshot current value as new baseline, fire onSave.
//   cancel()            — revert textarea + preview to baseline, fire onCancel.
//   snapshot()          — mark current value as the saved baseline
//                         WITHOUT firing onSave (e.g., after the host
//                         hydrated the textarea from localStorage).
//
// Style: plain script (no bundler in this codebase — no ES modules,
// no top-level await). Uses the same IIFE guard `knowledge_agent.js`
// uses and exposes `KnowledgeDocumentView` on `window`.
// ─────────────────────────────────────────────────────────────────────────

(function (global) {
  'use strict';

  // ── Shared helpers ────────────────────────────────────────────────────
  // Kept at module scope so both the preview renderer and the syntax
  // highlighter can share them without repeated allocation. All three
  // are pure functions — no state, no DOM.
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function makeSlugAllocator() {
    var seen = Object.create(null);
    return function allocate(text) {
      var base = slugify(text) || 'section';
      var slug = base;
      var i = 2;
      while (seen[slug]) { slug = base + '-' + i++; }
      seen[slug] = true;
      return slug;
    };
  }

  var HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/;
  var UL_RE = /^\s*-\s+(.+?)\s*$/;
  var OL_RE = /^\s*(\d+)\.\s+(.+?)\s*$/;

  // ── Factory ───────────────────────────────────────────────────────────
  function create(options) {
    if (!options) return null;

    // Required DOM references. If any of these are missing the module
    // silently returns — same guard `knowledge_agent.js` had, keeps
    // pages that only need part of the surface (e.g. a Preview-only
    // renderer) from throwing on missing editor nodes.
    var root         = options.root;
    var sourceScript = options.sourceScript;
    var previewEl    = options.preview;
    var articleEl    = options.article;
    var tocEl        = options.toc;
    var tocListEl    = options.tocList;
    var tocBodyEl    = options.tocBody;
    var railIndicatorEl = options.railIndicator;

    var editEl        = options.edit;
    var editorRootEl  = options.editorRoot;
    var textareaEl    = options.textarea;
    var highlightEl   = options.highlight;
    var gutterEl      = options.gutter;
    var codeEl        = options.code;
    var currentLineEl = options.currentLine;

    // `highlightEl` in the template is a `<code data-knowledge-editor-highlight>`
    // nested inside a `<pre class="knowledge-editor__highlight">`.
    //
    // The scroll-sync model is a fixed viewport + moving content:
    //
    //   • The outer `<pre>` (`.knowledge-editor__highlight`) is
    //     `position: absolute; inset: 0; overflow: hidden`. It stays put
    //     and clips whatever bleeds outside `.__code`'s 741-ish-px box.
    //     Do NOT transform this element — transforming an element that
    //     has `overflow: hidden` shifts its clipping window along with
    //     the element, so the *same* first-N-lines snapshot slides
    //     upward instead of the next lines scrolling into view. The
    //     symptom is exactly what a seller reported: content past
    //     line 35 never appears no matter how far you scroll.
    //
    //   • The inner `<code>` is `display: block` (see the `> code`
    //     rule inside `.knowledge-editor__highlight` in home.scss) so
    //     it's a proper transformable block box. It carries the full
    //     rendered source (all 443 lines / ~9 000 px tall) and gets
    //     `transform: translate(-x, -y)` on every scroll event —
    //     content moves within the stationary `<pre>` viewport,
    //     revealing whichever line range corresponds to the textarea's
    //     current scroll position.
    //
    // Historical note: an earlier iteration transformed the `<pre>`
    // because `<code>` defaulted to `display: inline` (a non-atomic
    // inline box, non-transformable per the CSS Transforms spec). The
    // `> code { display: block }` companion rule promoted the box to
    // atomic-block, which is what unlocks transforming `<code>` here.
    // If you ever remove that CSS rule, you'll need to revive the
    // wrapper transform — but you'll also reintroduce the clipping bug
    // above, so the better fix is to keep `<code>` block-level.
    var highlightWrapperEl = (highlightEl && highlightEl.parentElement) || highlightEl;

    var toggleButtons        = toArray(options.toggleButtons);
    var toolbarFormatButtons = toArray(options.toolbarFormatButtons);
    var toolbarHistoryButtons = toArray(options.toolbarHistoryButtons);
    var toolbarMenus         = toArray(options.toolbarMenus);

    // Same "any of these missing → give up" check `knowledge_agent.js`
    // ran. Preserves current tolerance for partially-rendered pages.
    if (!articleEl || !textareaEl || !tocListEl || !highlightEl) return null;

    // Callback hooks (Step 4 uses these; Step 1 keeps them optional
    // so existing callers that pass nothing behave identically).
    var onDirtyChange = typeof options.onDirtyChange === 'function' ? options.onDirtyChange : null;
    var onSave        = typeof options.onSave        === 'function' ? options.onSave        : null;
    var onCancel      = typeof options.onCancel      === 'function' ? options.onCancel      : null;

    // Remembered by the rail-indicator code so a resize / TOC rebuild
    // can re-measure the same active row without needing the
    // scroll-spy observer to fire again.
    var railActiveId = null;

    // Baseline for dirty tracking. Set on init and after every save.
    var savedSource = '';
    var wasDirty = false;

    // ── Markdown source parsing ─────────────────────────────────────────
    // Read the JSON-escaped string emitted by the page's
    // `<script type="text/markdown">` tag. Wrapped in try/catch so a
    // malformed payload doesn't crash the whole controller — the rest of
    // the page can still render an empty article/editor if this fails.
    function readInitialSource() {
      if (typeof options.initialSource === 'string') return options.initialSource;
      if (!sourceScript) return '';
      var raw = sourceScript.textContent || '""';
      try {
        var parsed = JSON.parse(raw);
        return typeof parsed === 'string' ? parsed : '';
      } catch (_) {
        return '';
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // Preview mode — markdown → HTML renderer + TOC generator.
    // ────────────────────────────────────────────────────────────────────

    function renderInline(text) {
      // Order matters: code first (its content stays literal), then
      // link, then bold, then italic. All patterns are non-greedy so
      // they don't span past their intended boundaries.
      return text
        .replace(/`([^`]+?)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, function (_, label, href) {
          return '<a href="' + href + '">' + label + '</a>';
        })
        .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    }

    function renderMarkdown(md) {
      // Strip a single leading `# Title` heading — the article header
      // already renders the title separately, so keeping it in the body
      // would duplicate the h1 and pollute the TOC's top-level list.
      var stripped = String(md || '').replace(/^\s*#\s+[^\n]*\n+/, '');
      var lines = stripped.split(/\r?\n/);
      var allocateSlug = makeSlugAllocator();
      var out = [];
      var listType = null;
      var listItems = [];
      var paragraph = [];

      // Evidence-list detector.
      //
      // Every knowledge doc uses the same shape whenever it cites
      // supporting research:
      //
      //   **Evidence:**
      //
      //   1. Mixpanel: … / TravelPerk: … / …
      //
      // We flip `pendingEvidence` on when a paragraph flushes as
      // exactly `**Evidence:**` (case-insensitive, optional colon)
      // and consume it on the next `<ol>` / `<ul>` flush, wrapping
      // each `<li>`'s content in a full-row `.evidence-link` anchor.
      // Any intervening block (another paragraph, a heading, an
      // unrelated list) clears the flag so a stray "Evidence:"
      // paragraph never accidentally hyperlinks an unrelated list
      // that happens to appear later in the file.
      var pendingEvidence = false;
      // Match `**Evidence**` or `**Evidence:**` on its own line,
      // case-insensitive. Paragraph text at flush time is the raw
      // escaped markdown (see `escapeHtml(lines[i])` in the loop
      // below), so the bold marks are still `**`, not `<strong>`.
      var EVIDENCE_HEADING_RE = /^\s*\*\*evidence:?\*\*\s*$/i;

      function flushParagraph() {
        if (!paragraph.length) return;
        var joined = paragraph.join(' ');
        // Detect the Evidence heading BEFORE emitting the paragraph
        // so the next list flush picks it up. The bar-empty paragraph
        // is still emitted normally as `<p><strong>Evidence:</strong></p>`
        // so the visual heading stays put — we only change what
        // happens to the list that follows.
        pendingEvidence = EVIDENCE_HEADING_RE.test(joined);
        out.push('<p>' + renderInline(joined) + '</p>');
        paragraph = [];
      }

      function flushList() {
        if (!listType) return;
        var isEvidence = pendingEvidence;
        // Clear immediately so a doc author following Evidence with
        // TWO consecutive lists (rare) doesn't accidentally hyperlink
        // the second one too.
        pendingEvidence = false;
        var openTag = '<' + listType + (isEvidence ? ' class="knowledge-evidence-list"' : '') + '>';
        out.push(openTag + listItems.map(function (i) {
          var rendered = renderInline(i);
          if (!isEvidence) return '<li>' + rendered + '</li>';
          // The full item content becomes a clickable row —
          // prototype affordance only.
          //
          // Deliberately NO `href` attribute (not even `href="#"`)
          // because a hash-href scrolls to page-top even when we
          // preventDefault in edge cases (middle-click, ctrl-click,
          // AT activations). Instead we emit:
          //
          //   <a role="link" tabindex="0" class="evidence-link"
          //      data-knowledge-evidence-open>…</a>
          //
          // which stays Tab-navigable, receives the same focus-
          // visible outline as a real anchor, and delegates all
          // activation (click, Enter, Space) to `handleEvidenceClick`
          // attached on `articleEl` below.
          //
          // TODO(evidence-routing): Once the markdown ingests
          // transcript IDs / opportunity IDs / source URLs alongside
          // each evidence bullet, thread the destination through
          // here as `href="<sourceUrl>"` and let the browser
          // handle navigation natively. `handleEvidenceClick`
          // can then become a no-op or add analytics only.
          return '<li><a class="evidence-link" role="link" tabindex="0" data-knowledge-evidence-open>' + rendered + '</a></li>';
        }).join('') + '</' + listType + '>');
        listType = null;
        listItems = [];
      }

      function flushAll() { flushParagraph(); flushList(); }

      for (var i = 0; i < lines.length; i++) {
        var line = escapeHtml(lines[i]);
        if (/^\s*$/.test(line)) { flushAll(); continue; }

        var mHeading = line.match(HEADING_RE);
        if (mHeading) {
          flushAll();
          var level = mHeading[1].length;
          // Promote lone h1s in body content to h2 so we never emit a
          // second `<h1>` alongside the article-header title.
          if (level === 1) level = 2;
          var text = mHeading[2];
          var id = allocateSlug(text);
          out.push('<h' + level + ' id="' + id + '" data-knowledge-heading="h' + level + '">' + renderInline(text) + '</h' + level + '>');
          continue;
        }

        var mUL = line.match(UL_RE);
        if (mUL) {
          if (listType && listType !== 'ul') flushList();
          flushParagraph();
          listType = 'ul';
          listItems.push(mUL[1]);
          continue;
        }

        var mOL = line.match(OL_RE);
        if (mOL) {
          if (listType && listType !== 'ol') flushList();
          flushParagraph();
          listType = 'ol';
          listItems.push(mOL[2]);
          continue;
        }

        flushList();
        paragraph.push(line);
      }
      flushAll();
      return out.join('\n');
    }

    var currentObserver = null;

    // ── Evidence-link activation ────────────────────────────────────
    //
    // Every Evidence-list row is rendered as a hrefless anchor
    // (`<a role="link" tabindex="0" class="evidence-link" …>`) so
    // Tab focus, focus-visible outlines, and hover styles all fire
    // natively without triggering a page-top jump.
    //
    // `handleEvidenceClick` is the single activation code path —
    // called from both mouse click and keyboard (Enter / Space)
    // handlers. It:
    //   • Prevents default (defensive; a hrefless anchor has no
    //     browser default, but a future refactor that adds `href`
    //     shouldn't accidentally double-navigate).
    //   • Dispatches a `sh:evidence-open` CustomEvent on articleEl,
    //     bubbling up through the DOM so a downstream drawer or
    //     side-panel can subscribe without touching this module.
    //     Payload is `{ text }` — the raw entry copy — plus the
    //     anchor element itself so a listener can position UI
    //     against it if it wants a popover-style treatment.
    //   • Logs a QA breadcrumb so it's obvious during prototype
    //     testing that the click was received even before the real
    //     route is wired.
    //
    // TODO(evidence-routing): When the knowledge markdown adds
    // per-item metadata (transcript ID, opportunity ID, Salesforce
    // record ID, or explicit source URL), the parser above can
    // emit `<a href="<url>">` and this handler collapses to an
    // analytics-only hook. Do NOT invent external URLs here —
    // wait for the real metadata.
    //
    // Listener attached once on `articleEl` so it survives every
    // preview re-render (setting `articleEl.innerHTML` swaps
    // descendants but leaves listeners on `articleEl` itself in
    // place).
    function handleEvidenceClick(anchor, event) {
      if (event) event.preventDefault();
      var text = (anchor.textContent || '').trim();
      try {
        articleEl.dispatchEvent(new CustomEvent('sh:evidence-open', {
          bubbles: true,
          cancelable: false,
          detail: { anchor: anchor, text: text }
        }));
      } catch (_) { /* older browsers with no CustomEvent constructor */ }
      if (typeof console !== 'undefined' && console.info) {
        // eslint-disable-next-line no-console
        console.info('[knowledge] Evidence clicked (no destination wired yet):', text);
      }
    }

    articleEl.addEventListener('click', function (e) {
      var link = e.target.closest ? e.target.closest('.evidence-link') : null;
      if (link) handleEvidenceClick(link, e);
    });

    // Keyboard activation. `<a>` without `href` doesn't emit a
    // click event on Enter — and Space never fires click on an
    // anchor even with `href` — so we translate both keys into the
    // same handler manually. `e.target` is the focused anchor
    // itself because the anchor carries `tabindex="0"`.
    articleEl.addEventListener('keydown', function (e) {
      var key = e.key;
      if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
      var link = e.target && e.target.closest && e.target.closest('.evidence-link');
      if (!link) return;
      handleEvidenceClick(link, e);
    });

    function renderPreview() {
      var md = textareaEl.value || '';
      var html = renderMarkdown(md);
      articleEl.innerHTML = html;
      articleEl.setAttribute('data-rendered', 'true');
      buildTOC();
      attachScrollSpy();
    }

    function buildTOC() {
      var headings = articleEl.querySelectorAll('[data-knowledge-heading="h2"], [data-knowledge-heading="h3"]');
      if (!headings.length) {
        tocListEl.innerHTML = '';
        rebuildRail();
        return;
      }

      var fragments = [];
      var currentSub = null;
      for (var i = 0; i < headings.length; i++) {
        var h = headings[i];
        var level = h.getAttribute('data-knowledge-heading');
        var text = h.textContent || '';
        var id = h.id;
        if (level === 'h2') {
          currentSub = [];
          fragments.push({ level: 2, text: text, id: id, children: currentSub });
        } else {
          var target = currentSub || fragments;
          target.push({ level: 3, text: text, id: id });
        }
      }

      // Each link carries `data-knowledge-toc-level` so the rail
      // builder can decide which x-column (outer vs inner) to route
      // the path through without needing to walk the parent ol/li
      // nesting.
      //
      // Two top-level shapes:
      //
      //   • Leaf h2 (no children)   — anchor only, same shape as
      //                                the pre-accordion version.
      //   • Collapsible h2 (h3 kids) — chevron toggle + anchor in a
      //                                shared row wrapper, sublist
      //                                rendered but hidden until the
      //                                user opens the section.
      //
      // The chevron is a real `<button>` (not a styled span) so
      // keyboard users can Tab / Enter / Space through the toggle
      // and screen readers hear the `aria-expanded` state. Row
      // wrapper `.__toc-item-row` groups the chevron and anchor so
      // the CSS flex layout can keep them on a single row while the
      // sublist beneath expands / collapses.
      var html = fragments.map(function (item) {
        var attrs = 'href="#' + item.id +
                    '" data-knowledge-toc-link="' + item.id +
                    '" data-knowledge-toc-level="' + item.level + '"';
        var anchor = '<a ' + attrs +
                     '><span class="hunter-agent-knowledge__toc-label" title="' + escapeAttr(item.text) + '">' +
                     escapeHtml(item.text) + '</span></a>';
        var hasChildren = item.children && item.children.length > 0;

        // Leaf h2 — same DOM shape the module always emitted.
        // No chevron, no row wrapper, no sublist. Rail-indicator
        // measurement (which walks the anchor's rect) behaves
        // identically to the pre-accordion path.
        if (!hasChildren) {
          return '<li>' + anchor + '</li>';
        }

        // Collapsible h2 — chevron button + anchor in a shared row,
        // hidden sublist beneath. Section id is deterministic
        // (`toc-section-<slug>`) so aria-controls stays stable
        // across TOC rebuilds triggered by an Edit → Preview
        // round-trip. The `toc-section-` prefix matches the
        // accessibility contract documented on the accordion
        // spec — the button's `aria-controls` and the sublist's
        // own `id` both interpolate `toc-section-${sectionId}`.
        var sectionId = 'toc-section-' + item.id;
        var chevron = '<button type="button" ' +
                        'class="hunter-agent-knowledge__toc-chevron" ' +
                        'data-knowledge-toc-toggle="' + item.id + '" ' +
                        'aria-expanded="false" ' +
                        'aria-controls="' + sectionId + '" ' +
                        'aria-label="Expand ' + escapeAttr(item.text) + '"' +
                      '>' +
                        '<svg class="hunter-agent-knowledge__toc-chevron-icon" focusable="false" aria-hidden="true">' +
                          '<use xlink:href="/aiq-sales-agent/assets/icons/utility-sprite/svg/symbols.svg#chevronright"></use>' +
                        '</svg>' +
                      '</button>';

        var row = '<div class="hunter-agent-knowledge__toc-item-row">' + chevron + anchor + '</div>';

        var sub = '<ol class="hunter-agent-knowledge__toc-sublist" id="' + sectionId + '" hidden>' +
                    item.children.map(function (c) {
                      if (!c || !c.id) return '';
                      var childAttrs = 'href="#' + c.id +
                                       '" data-knowledge-toc-link="' + c.id +
                                       '" data-knowledge-toc-level="' + c.level + '"';
                      return '<li><a ' + childAttrs + '><span class="hunter-agent-knowledge__toc-label" title="' + escapeAttr(c.text) + '">' + escapeHtml(c.text) + '</span></a></li>';
                    }).join('') +
                  '</ol>';

        return '<li class="hunter-agent-knowledge__toc-item hunter-agent-knowledge__toc-item--collapsible">' + row + sub + '</li>';
      }).join('');

      tocListEl.innerHTML = html;

      // Indicator geometry depends on freshly-rendered link rects.
      // Defer to the next frame so the browser has run layout before
      // we measure — reading `getBoundingClientRect` mid-render
      // forces a synchronous layout on a DOM that isn't fully
      // composed yet, and mis-measures on some browsers.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () { refreshRailIndicator(false); });
      } else {
        refreshRailIndicator(false);
      }
    }

    // Called when the TOC has no headings — resets the indicator so a
    // subsequent render doesn't hold a stale position.
    function rebuildRail() {
      if (railIndicatorEl) {
        railIndicatorEl.style.transform = 'translateY(0px)';
        railIndicatorEl.style.height = '0px';
      }
      railActiveId = null;
    }

    // ── TOC active indicator ────────────────────────────────────────────
    // Straight vertical rail (`.__toc-rail` — pure CSS, static) plus a
    // 2px blue block (`.__toc-active-indicator`) positioned via
    // `transform: translateY(<top>px)` + `height: <linkHeight>px`. The
    // block only moves vertically; nesting is expressed through label
    // padding-left in the CSS, not through any horizontal motion here.
    function applyRailIndicator(id, animate) {
      if (!railIndicatorEl || !tocBodyEl) return;
      var link = tocListEl.querySelector('a[data-knowledge-toc-link="' + id + '"]');
      if (!link) return;

      var bodyRect = tocBodyEl.getBoundingClientRect();
      if (!bodyRect.height) return; // Container is `display: none` — skip.
      var linkRect = link.getBoundingClientRect();
      var top = linkRect.top - bodyRect.top;
      var height = linkRect.height;

      if (animate === false) {
        // Disable the transition, flush the styles, re-enable so the
        // indicator snaps to the new row instead of gliding from an
        // unrelated previous position. Used on first paint and after
        // a TOC rebuild (Edit → Preview round-trip).
        railIndicatorEl.style.transition = 'none';
        railIndicatorEl.getBoundingClientRect();
        railIndicatorEl.style.transform = 'translateY(' + top + 'px)';
        railIndicatorEl.style.height = height + 'px';
        railIndicatorEl.getBoundingClientRect();
        railIndicatorEl.style.transition = '';
      } else {
        railIndicatorEl.style.transform = 'translateY(' + top + 'px)';
        railIndicatorEl.style.height = height + 'px';
      }

      railActiveId = id;
    }

    // Re-measures the currently-active row (or falls back to the first
    // link) and re-writes the indicator. Called after TOC rebuilds and
    // container resizes so the block stays glued to its target when the
    // layout underneath shifts.
    function refreshRailIndicator(animate) {
      var id = railActiveId;
      if (!id) {
        var firstLink = tocListEl.querySelector('a[data-knowledge-toc-link]');
        id = firstLink && firstLink.getAttribute('data-knowledge-toc-link');
      }
      if (id) applyRailIndicator(id, animate);
    }

    // Resolve `scrollRoot` lazily each time we attach the observer:
    // callers can pass a selector that only resolves after the module
    // is created (deferred layout), and viewport-fallback (null) works
    // out of the box.
    function resolveScrollRoot() {
      var raw = options.scrollRoot;
      if (!raw) return null;
      if (typeof raw === 'string') return document.querySelector(raw);
      return raw;
    }

    function attachScrollSpy() {
      if (currentObserver) {
        try { currentObserver.disconnect(); } catch (_) {}
        currentObserver = null;
      }
      if (typeof IntersectionObserver !== 'function') return;

      var headings = articleEl.querySelectorAll('[data-knowledge-heading="h2"], [data-knowledge-heading="h3"]');
      if (!headings.length) return;

      var spyRoot = resolveScrollRoot();
      var visible = new Set();

      currentObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        });
        if (!visible.size) return;
        var topmost = null;
        var topmostY = Infinity;
        visible.forEach(function (el) {
          var rect = el.getBoundingClientRect();
          if (rect.top < topmostY) { topmostY = rect.top; topmost = el; }
        });
        if (topmost) setActiveTocLink(topmost.id);
      }, {
        root: spyRoot,
        rootMargin: '-120px 0px -60% 0px',
        threshold: 0
      });

      headings.forEach(function (h) { currentObserver.observe(h); });
    }

    // ── Active-heading vs. expansion — deliberately independent ─────────
    //
    // `currentActiveHeadingId` tracks the scroll-spy's latest hit and
    // drives active text styling + the blue rail. `is-expanded` on
    // each collapsible `<li>` drives the sublist's visibility and the
    // chevron rotation. Scroll-spy NEVER writes to `is-expanded` —
    // the accordion state is user-controlled (chevron click) only.
    //
    // This decoupling matches the design brief:
    //   • Scrolling through subsections does NOT auto-expand anything.
    //   • Manually expanded sections stay expanded even when scroll
    //     leaves them.
    //   • The active parent-Q row still updates as the user scrolls
    //     (see the "fold" logic in `applyActiveState`).
    var currentActiveHeadingId = null;

    function setActiveTocLink(id) {
      currentActiveHeadingId = id;
      applyActiveState();
    }

    // Applies the current active state to the TOC:
    //   • Marks every anchor whose heading is the active heading OR
    //     an ancestor of it (i.e. a Q-section whose sublist contains
    //     the active h3) with `.is-active`. This mirrors the React
    //     example in the design brief:
    //       isActive = activeHeadingId === section.id ||
    //                  section.children.some(c => c.id === activeHeadingId);
    //   • "Folds" the rail target when the active heading is inside a
    //     currently-hidden sublist. The rail can only measure a
    //     visible row, so if the active anchor is `display: none`
    //     (parent collapsed), the rail rides the parent Q's own row
    //     instead. When the user manually expands that Q section,
    //     `setSectionExpanded` re-invokes this function and the rail
    //     un-folds onto the now-visible nested row.
    //
    // Called from:
    //   • `setActiveTocLink` — after scroll-spy updates the active
    //     heading.
    //   • `setSectionExpanded` — after a chevron toggle changes
    //     which anchors are visible.
    function applyActiveState() {
      var id = currentActiveHeadingId;
      // If we've never received a scroll-spy signal, do nothing —
      // the initial-paint `refreshRailIndicator(false)` already
      // parked the rail on the first link. Leaving classes untouched
      // means a manual toggle before any scroll doesn't accidentally
      // strip the initial-paint rail position.
      if (!id) return;

      // Escape the id for use inside a `data-knowledge-toc-link="…"`
      // selector. The slug allocator only emits `[a-z0-9-]`, so this
      // is defensive rather than strictly required.
      var idAttr = id.replace(/"/g, '\\"');

      var links = tocListEl.querySelectorAll('[data-knowledge-toc-link]');
      var selfAnchor = null;
      links.forEach(function (a) {
        var linkId = a.getAttribute('data-knowledge-toc-link');
        var isSelf = (linkId === id);
        // "Ancestor" match: this anchor is a Q-section whose sublist
        // contains the active heading. Only checked for h2s that have
        // a sublist — leaf h2s and h3s can never be ancestors.
        var isAncestor = false;
        if (!isSelf) {
          var itemLi = a.closest('li');
          var sublist = itemLi && itemLi.querySelector('.hunter-agent-knowledge__toc-sublist');
          if (sublist && sublist.querySelector('[data-knowledge-toc-link="' + idAttr + '"]')) {
            isAncestor = true;
          }
        }
        a.classList.toggle('is-active', isSelf || isAncestor);
        var li = a.closest('li');
        // LI-level `.is-active` still tracks the specific heading
        // (kept for backwards compatibility with any consumer that
        // reads it — no CSS rule currently keys off it).
        if (li) li.classList.toggle('is-active', isSelf);
        if (isSelf) selfAnchor = a;
      });

      // Fold: if the active anchor lives inside a `hidden` sublist,
      // ride the parent Q's row instead. Otherwise, the rail targets
      // the active heading's own row.
      var railTargetId = id;
      if (selfAnchor) {
        var hiddenSublist = selfAnchor.closest('.hunter-agent-knowledge__toc-sublist');
        if (hiddenSublist && hiddenSublist.hasAttribute('hidden')) {
          var parentSection = hiddenSublist.closest('.hunter-agent-knowledge__toc-item--collapsible');
          var parentAnchor = parentSection && parentSection.querySelector(
            '.hunter-agent-knowledge__toc-item-row > a[data-knowledge-toc-link]'
          );
          if (parentAnchor) railTargetId = parentAnchor.getAttribute('data-knowledge-toc-link');
        }
      }

      applyRailIndicator(railTargetId, /* animate: */ true);
    }

    // ── Accordion (collapsible top-level sections) ──────────────────────
    //
    // Toggles the `is-expanded` class on the section `<li>`, updates
    // the chevron button's `aria-expanded` + `aria-label`, and
    // shows/hides the sublist via the `hidden` attribute.
    //
    // Only called from the chevron click handler — scroll-spy NEVER
    // invokes this. That decoupling is what preserves the design
    // brief's key property: "scrolling through the markdown must not
    // expand a section." Users own the accordion state entirely.
    function setSectionExpanded(li, expanded) {
      if (!li) return;
      var wasExpanded = li.classList.contains('is-expanded');
      if (wasExpanded === !!expanded) return;

      li.classList.toggle('is-expanded', !!expanded);

      var toggleBtn = li.querySelector('[data-knowledge-toc-toggle]');
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        // Flip Expand/Collapse in the accessible name so screen
        // readers announce the NEXT action, matching the visible
        // chevron rotation.
        var current = toggleBtn.getAttribute('aria-label') || '';
        if (expanded && current.indexOf('Expand ') === 0) {
          toggleBtn.setAttribute('aria-label', 'Collapse ' + current.slice('Expand '.length));
        } else if (!expanded && current.indexOf('Collapse ') === 0) {
          toggleBtn.setAttribute('aria-label', 'Expand ' + current.slice('Collapse '.length));
        }
      }

      var sublist = li.querySelector('.hunter-agent-knowledge__toc-sublist');
      if (sublist) {
        if (expanded) sublist.removeAttribute('hidden');
        else sublist.setAttribute('hidden', '');
      }

      // Rows below the toggled section have just shifted vertically
      // AND the fold decision may have changed (an anchor that was
      // hidden is now visible, or vice versa). Re-run the full
      // active-state application so the rail rides the right row.
      // Falls back to a plain geometry re-measure when there's no
      // active heading yet (initial paint, before any scroll-spy).
      if (currentActiveHeadingId) {
        applyActiveState();
      } else {
        refreshRailIndicator(true);
      }
    }

    // ── Rail resize handling ────────────────────────────────────────────
    // Re-measure the active row whenever the TOC body changes size
    // (viewport resize, font metric shift, label wrap).
    var railResizeTimer = null;
    function scheduleRailRefresh() {
      if (railResizeTimer) clearTimeout(railResizeTimer);
      railResizeTimer = setTimeout(function () { refreshRailIndicator(false); }, 120);
    }

    if (tocBodyEl && typeof ResizeObserver === 'function') {
      try {
        var ro = new ResizeObserver(scheduleRailRefresh);
        ro.observe(tocBodyEl);
      } catch (_) {
        window.addEventListener('resize', scheduleRailRefresh);
      }
    } else {
      window.addEventListener('resize', scheduleRailRefresh);
    }

    tocListEl.addEventListener('click', function (e) {
      // Chevron toggle branch — check FIRST because a chevron click
      // should NEVER fall through to the anchor-scroll code path.
      // The chevron button is a sibling of the anchor inside the
      // shared row wrapper, so a click on the chevron never bubbles
      // through an anchor.
      var toggle = e.target.closest ? e.target.closest('[data-knowledge-toc-toggle]') : null;
      if (toggle) {
        e.preventDefault();
        var section = toggle.closest('.hunter-agent-knowledge__toc-item--collapsible');
        if (section) setSectionExpanded(section, !section.classList.contains('is-expanded'));
        return;
      }

      var link = e.target.closest ? e.target.closest('[data-knowledge-toc-link]') : null;
      if (!link) return;
      e.preventDefault();
      var id = link.getAttribute('data-knowledge-toc-link');
      var target = document.getElementById(id);
      if (!target) return;
      try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch (_) { target.scrollIntoView(true); }
      setActiveTocLink(id);
      try {
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#' + id);
        }
      } catch (_) {}
    });

    // ────────────────────────────────────────────────────────────────────
    // Edit mode — syntax highlighter, gutter, current-line, scroll sync.
    // ────────────────────────────────────────────────────────────────────

    // Highlighter: line-oriented pass that emits per-token `<span
    // class="tok-*">` wrappers matched by the editor's palette in the
    // SCSS. Escaping is done AFTER classification so the regex patterns
    // can key off literal `<`, `>`, `|`, etc.
    function renderHighlight(source) {
      var lines = String(source || '').split('\n');
      var inFence = false;
      return lines.map(function (rawLine) {
        if (/^```/.test(rawLine)) {
          inFence = !inFence;
          return '<span class="tok-fence">' + escapeHtml(rawLine) + '</span>';
        }
        if (inFence) {
          return '<span class="tok-code-fenced">' + escapeHtml(rawLine || ' ') + '</span>';
        }
        var m;
        // ATX heading.
        if ((m = rawLine.match(/^(#{1,6})\s+(.*)$/))) {
          var level = m[1].length;
          return '<span class="tok-heading-mark">' + escapeHtml(m[1]) + ' </span>' +
                 '<span class="tok-heading tok-heading-' + Math.min(level, 3) + '">' + highlightInline(m[2]) + '</span>';
        }
        // Bulleted list.
        if ((m = rawLine.match(/^(\s*)-\s+(.*)$/))) {
          return escapeHtml(m[1]) + '<span class="tok-list-mark">- </span>' + highlightInline(m[2]);
        }
        // Numbered list.
        if ((m = rawLine.match(/^(\s*)(\d+)\.\s+(.*)$/))) {
          return escapeHtml(m[1]) + '<span class="tok-list-mark">' + m[2] + '. </span>' + highlightInline(m[3]);
        }
        // Blockquote.
        if ((m = rawLine.match(/^(\s*)>\s?(.*)$/))) {
          return escapeHtml(m[1]) + '<span class="tok-quote-mark">&gt; </span><span class="tok-quote">' + highlightInline(m[2]) + '</span>';
        }
        // Table row.
        if (rawLine.indexOf('|') > -1 && /\|/.test(rawLine.trim())) {
          var cells = rawLine.split('|');
          var chunks = [];
          for (var i = 0; i < cells.length; i++) {
            chunks.push(highlightInline(cells[i]));
            if (i < cells.length - 1) chunks.push('<span class="tok-table-sep">|</span>');
          }
          return chunks.join('');
        }
        if (rawLine === '') return ' ';
        return highlightInline(rawLine);
      }).join('\n');
    }

    function highlightInline(text) {
      var esc = escapeHtml(text);
      esc = esc.replace(/`([^`]+?)`/g, function (_, code) {
        return '<span class="tok-code">`' + code + '`</span>';
      });
      esc = esc.replace(/!\[([^\]]*?)\]\(([^)]+?)\)/g, function (_, alt, url) {
        return '<span class="tok-image-mark">!</span>' +
               '<span class="tok-link-label">[' + alt + ']</span>' +
               '<span class="tok-link-url">(' + url + ')</span>';
      });
      esc = esc.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, function (_, label, url) {
        return '<span class="tok-link-label">[' + label + ']</span>' +
               '<span class="tok-link-url">(' + url + ')</span>';
      });
      esc = esc.replace(/\*\*([^*]+?)\*\*/g, '<span class="tok-bold">**$1**</span>');
      esc = esc.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<span class="tok-italic">*$2*</span>');
      return esc;
    }

    function renderGutter() {
      if (!gutterEl) return;
      var lineCount = (textareaEl.value || '').split('\n').length;
      var frag = '';
      for (var i = 1; i <= lineCount; i++) frag += '<span>' + i + '</span>';
      gutterEl.innerHTML = frag;
    }

    function updateEditorOverlay() {
      highlightEl.innerHTML = renderHighlight(textareaEl.value || '');
      renderGutter();
      syncScroll();
      updateCurrentLine();
    }

    function syncScroll() {
      var x = textareaEl.scrollLeft;
      var y = textareaEl.scrollTop;
      // Transform the `<code>` (moving content), NOT the `<pre>` (fixed
      // viewport with `overflow: hidden`). See the block comment on the
      // `highlightWrapperEl` declaration at the top of `create()` for
      // the full reasoning — the short version is that transforming
      // the `<pre>` slides its clipping window along with the box, so
      // lines past the initial viewport (roughly line 35 in a 741-px-
      // tall editor) never scroll into view. Transforming the block-
      // level `<code>` moves content within the stationary viewport,
      // which is the intent.
      if (highlightEl) {
        highlightEl.style.transform = 'translate(' + (-x) + 'px, ' + (-y) + 'px)';
      }
      if (gutterEl) gutterEl.style.transform = 'translateY(' + (-y) + 'px)';
    }

    var editorMetrics = null;
    function readEditorMetrics() {
      var cs = window.getComputedStyle(textareaEl);
      var lineHeightStr = cs.lineHeight;
      var lineHeight = parseFloat(lineHeightStr);
      if (isNaN(lineHeight) || lineHeightStr === 'normal') {
        var fs = parseFloat(cs.fontSize) || 14;
        lineHeight = fs * 1.5;
      }
      var padTop = parseFloat(cs.paddingTop) || 0;
      editorMetrics = { lineHeight: lineHeight, paddingTop: padTop };
    }

    function updateCurrentLine() {
      if (!editorMetrics) readEditorMetrics();
      if (!editorMetrics || !currentLineEl) return;
      var caret = textareaEl.selectionStart || 0;
      var upto = textareaEl.value.slice(0, caret);
      var lineIndex = (upto.match(/\n/g) || []).length; // 0-indexed line
      var top = editorMetrics.paddingTop + lineIndex * editorMetrics.lineHeight - textareaEl.scrollTop;
      currentLineEl.style.top = top + 'px';
      currentLineEl.style.height = editorMetrics.lineHeight + 'px';
    }

    // ── Dirty-tracking gate ─────────────────────────────────────────────
    // Runs after every textarea input (and after toolbar commands, which
    // dispatch a synthetic `input` event). Fires `onDirtyChange` only on
    // the edge (clean → dirty or dirty → clean) so hosts don't have to
    // dedupe repeated notifications on every keystroke.
    function notifyDirtyIfChanged() {
      if (!onDirtyChange) return;
      var currentDirty = (textareaEl.value || '') !== savedSource;
      if (currentDirty === wasDirty) return;
      wasDirty = currentDirty;
      try { onDirtyChange(currentDirty); } catch (_) {}
    }

    textareaEl.addEventListener('input', function () {
      highlightEl.innerHTML = renderHighlight(textareaEl.value || '');
      renderGutter();
      syncScroll();
      updateCurrentLine();
      notifyDirtyIfChanged();
    });
    textareaEl.addEventListener('scroll', function () {
      syncScroll();
      updateCurrentLine();
    });
    textareaEl.addEventListener('click', updateCurrentLine);
    textareaEl.addEventListener('keyup', function (e) {
      if (e.key && /Arrow|Home|End|PageUp|PageDown/i.test(e.key)) updateCurrentLine();
    });
    textareaEl.addEventListener('select', updateCurrentLine);

    // Escape while focused in the editor bails to Preview.
    textareaEl.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setView('preview');
      }
    });

    // Note: no custom `wheel` handler is registered here.
    //
    // Native scroll on the textarea (via `overflow-y: auto` in
    // `styles/home.scss`) handles mousewheel and trackpad
    // gestures correctly on its own, and integrates with the
    // browser's built-in delta scaling + kinetic-momentum
    // smoothing. An earlier version of this file registered a
    // `wheel` listener that called `preventDefault()` and
    // applied a 1:1 pixel-per-deltaY scroll. That mapping felt
    // sluggish under Chromium's wheel-delta normalization
    // (deltas as small as 1-12 px per event, especially in
    // embedded Chromium contexts like Cursor's built-in
    // browser), because it bypassed the native scaling that
    // makes wheel scrolling feel natural. The scroll now runs
    // through the browser's default path.

    // ── Toolbar commands ────────────────────────────────────────────────
    function getSelection() {
      var start = textareaEl.selectionStart || 0;
      var end = textareaEl.selectionEnd || 0;
      var value = textareaEl.value;
      return { start: start, end: end, value: value, selected: value.slice(start, end) };
    }

    function replaceRange(start, end, replacement, selStart, selEnd) {
      textareaEl.focus();
      try { textareaEl.setSelectionRange(start, end); } catch (_) {}
      var ok = false;
      try {
        ok = document.execCommand && document.execCommand('insertText', false, replacement);
      } catch (_) { ok = false; }
      if (!ok) {
        textareaEl.value = textareaEl.value.slice(0, start) + replacement + textareaEl.value.slice(end);
      }
      try {
        textareaEl.setSelectionRange(
          typeof selStart === 'number' ? selStart : start + replacement.length,
          typeof selEnd === 'number' ? selEnd : start + replacement.length
        );
      } catch (_) {}
      try { textareaEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }

    function wrapSelection(before, after, placeholder) {
      var s = getSelection();
      var text = s.selected || placeholder || '';
      var replacement = before + text + after;
      var newStart = s.start + before.length;
      var newEnd = newStart + text.length;
      replaceRange(s.start, s.end, replacement, newStart, newEnd);
    }

    function prefixLines(prefix) {
      var s = getSelection();
      var lineStart = s.value.lastIndexOf('\n', Math.max(0, s.start - 1)) + 1;
      var lineEnd = s.value.indexOf('\n', s.end);
      if (lineEnd === -1) lineEnd = s.value.length;

      var block = s.value.slice(lineStart, lineEnd);
      var lines = block.split('\n');
      var isOL = /^\d+\.\s$/.test(prefix);
      var rewritten = lines.map(function (line, i) {
        if (isOL) return (i + 1) + '. ' + line.replace(/^\d+\.\s+/, '');
        var stripped = line.replace(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '');
        return prefix + stripped;
      });

      var nextBlock = rewritten.join('\n');
      replaceRange(lineStart, lineEnd, nextBlock, lineStart, lineStart + nextBlock.length);
    }

    function setHeadingLevel(level) {
      var marker = new Array(Math.max(1, Math.min(3, parseInt(level, 10) || 2)) + 1).join('#') + ' ';
      var s = getSelection();
      var lineStart = s.value.lastIndexOf('\n', Math.max(0, s.start - 1)) + 1;
      var lineEnd = s.value.indexOf('\n', s.start);
      if (lineEnd === -1) lineEnd = s.value.length;
      var current = s.value.slice(lineStart, lineEnd).replace(/^#{1,6}\s+/, '');
      var replacement = marker + current;
      replaceRange(lineStart, lineEnd, replacement, lineStart + marker.length, lineStart + replacement.length);
    }

    function insertLink() {
      var s = getSelection();
      var label = s.selected || 'link text';
      var replacement = '[' + label + '](https://)';
      var urlStart = s.start + label.length + 3;
      var urlEnd = urlStart + 'https://'.length;
      replaceRange(s.start, s.end, replacement, urlStart, urlEnd);
    }

    function insertImage() {
      var s = getSelection();
      var alt = s.selected || 'alt text';
      var replacement = '![' + alt + '](https://)';
      var urlStart = s.start + alt.length + 4;
      var urlEnd = urlStart + 'https://'.length;
      replaceRange(s.start, s.end, replacement, urlStart, urlEnd);
    }

    function insertCodeBlock() {
      var s = getSelection();
      var body = s.selected || 'code';
      var replacement = '\n```\n' + body + '\n```\n';
      var innerStart = s.start + '\n```\n'.length;
      var innerEnd = innerStart + body.length;
      replaceRange(s.start, s.end, replacement, innerStart, innerEnd);
    }

    function insertTable() {
      var replacement =
        '\n| Column 1 | Column 2 | Column 3 |\n' +
        '| --- | --- | --- |\n' +
        '| Cell 1 | Cell 2 | Cell 3 |\n';
      var s = getSelection();
      replaceRange(s.start, s.end, replacement, s.start + replacement.length, s.start + replacement.length);
    }

    toolbarFormatButtons.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var cmd = btn.getAttribute('data-knowledge-format');
        switch (cmd) {
          case 'bold':    wrapSelection('**', '**', 'bold text'); break;
          case 'italic':  wrapSelection('*', '*', 'italic text'); break;
          case 'link':    insertLink(); break;
          case 'image':   insertImage(); break;
          case 'ul':      prefixLines('- '); break;
          case 'ol':      prefixLines('1. '); break;
          case 'quote':   prefixLines('> '); break;
          case 'code':    insertCodeBlock(); break;
          case 'table':   insertTable(); break;
          case 'heading': setHeadingLevel(btn.getAttribute('data-knowledge-format-level') || '2'); break;
        }
        toolbarMenus.forEach(function (m) {
          m.setAttribute('aria-expanded', 'false');
          var wrap = m.closest('.slds-dropdown-trigger');
          if (wrap) wrap.classList.remove('slds-is-open');
        });
      });
    });

    toolbarHistoryButtons.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var cmd = btn.getAttribute('data-knowledge-history');
        textareaEl.focus();
        try { document.execCommand(cmd === 'redo' ? 'redo' : 'undo', false); } catch (_) {}
        updateEditorOverlay();
        notifyDirtyIfChanged();
      });
    });

    // Heading dropdown toggle. Scoped click-outside handler runs on the
    // document so a click anywhere OUTSIDE any of THIS instance's menus
    // closes them — hosts with multiple instances get scoped dismissal.
    toolbarMenus.forEach(function (menuTrigger) {
      var wrap = menuTrigger.closest('.slds-dropdown-trigger');
      menuTrigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!wrap) return;
        var opened = wrap.classList.toggle('slds-is-open');
        menuTrigger.setAttribute('aria-expanded', opened ? 'true' : 'false');
      });
    });

    document.addEventListener('click', function (e) {
      toolbarMenus.forEach(function (menuTrigger) {
        var wrap = menuTrigger.closest('.slds-dropdown-trigger');
        if (!wrap) return;
        if (!wrap.contains(e.target)) {
          wrap.classList.remove('slds-is-open');
          menuTrigger.setAttribute('aria-expanded', 'false');
        }
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // View toggle — flip the outer surface between Preview and Edit.
    // ────────────────────────────────────────────────────────────────────

    function setView(mode) {
      var isEdit = mode === 'edit';
      if (root) root.setAttribute('data-knowledge-view', isEdit ? 'edit' : 'preview');

      if (previewEl) {
        if (isEdit) previewEl.setAttribute('hidden', '');
        else previewEl.removeAttribute('hidden');
      }
      if (editEl) {
        if (isEdit) editEl.removeAttribute('hidden');
        else editEl.setAttribute('hidden', '');
      }

      toggleButtons.forEach(function (b) {
        var isMatch = b.getAttribute('data-knowledge-view') === (isEdit ? 'edit' : 'preview');
        b.classList.toggle('is-active', isMatch);
        b.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
      });

      if (isEdit) {
        // Recompute metrics + refresh overlay on every entry into Edit
        // mode — the editor was `display: none` while Preview was
        // active, so its computed sizes just came back to life.
        readEditorMetrics();
        updateEditorOverlay();

        // Land the caret + scroll position at the TOP of the
        // document on every entry into Edit mode.
        //
        // Background: when `init()` assigns `textareaEl.value =
        // initial`, Chromium leaves the caret at the end of the
        // value (`selectionStart === value.length`). Focusing a
        // textarea then auto-scrolls it to reveal the current
        // caret, so without this reset the textarea lands at
        // `scrollTop === scrollHeight - clientHeight` (the very
        // bottom). The symptom reads to the user as "wheel
        // doesn't scroll" — their first instinct is to scroll
        // DOWN and there is nowhere below the bottom to go.
        //
        // Order matters:
        //   1. Focus with `preventScroll: true` so the browser
        //      does NOT run its focus-reveal auto-scroll.
        //   2. Move the caret to position 0. `setSelectionRange`
        //      only takes effect on a focused element in some
        //      browsers, hence step 2 comes after step 1.
        //   3. Explicitly zero `scrollTop` / `scrollLeft` — cheap
        //      insurance in case a browser still runs a partial
        //      focus-reveal despite `preventScroll: true`, or
        //      `setSelectionRange` triggers its own caret-reveal
        //      scroll.
        //   4. Sync the highlight overlay + gutter transforms so
        //      their `translate(0, 0)` matches the reset.
        //   5. On the next frame, zero `scrollTop` again. Some
        //      browsers defer the focus-reveal scroll to a
        //      microtask / animation frame; without this second
        //      pass the reset can be overridden between the
        //      current turn and the first paint.
        try { textareaEl.focus({ preventScroll: true }); } catch (_) {
          try { textareaEl.focus(); } catch (_) {}
        }
        try { textareaEl.setSelectionRange(0, 0); } catch (_) {}
        textareaEl.scrollTop = 0;
        textareaEl.scrollLeft = 0;
        syncScroll();

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(function () {
            if (textareaEl.scrollTop !== 0 || textareaEl.scrollLeft !== 0) {
              textareaEl.scrollTop = 0;
              textareaEl.scrollLeft = 0;
              syncScroll();
            }
          });
        }
      } else {
        // On the way back to Preview, re-render the article from the
        // (possibly edited) textarea contents.
        renderPreview();
      }
    }

    toggleButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        setView(btn.getAttribute('data-knowledge-view'));
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // Public API — snapshot / save / cancel + init.
    // ────────────────────────────────────────────────────────────────────

    // Snapshot the current textarea value as the "saved baseline"
    // (dirty = false after this). Used by the host after successful
    // save or when hydrating from a persistence layer.
    function snapshot() {
      savedSource = textareaEl.value || '';
      if (wasDirty) {
        wasDirty = false;
        if (onDirtyChange) {
          try { onDirtyChange(false); } catch (_) {}
        }
      }
    }

    function save() {
      var value = textareaEl.value || '';
      snapshot();
      if (onSave) {
        try { onSave(value); } catch (_) {}
      }
    }

    // Revert the textarea to the last snapshot + re-render both
    // surfaces so the reader / editor stop showing stale HTML.
    function cancel() {
      textareaEl.value = savedSource;
      updateEditorOverlay();
      renderPreview();
      notifyDirtyIfChanged();
      if (onCancel) {
        try { onCancel(); } catch (_) {}
      }
    }

    function init() {
      var initial = readInitialSource();
      textareaEl.value = initial;
      savedSource = initial;
      wasDirty = false;

      // Prime both surfaces so their DOM is coherent even before the
      // first toggle. Preview is what the user sees on load.
      renderPreview();
      highlightEl.innerHTML = renderHighlight(textareaEl.value || '');
      renderGutter();
      setView('preview');

      // Deep-link on the URL hash — jump to the matching heading if
      // one exists. Runs after `renderPreview` so the target is in
      // the DOM.
      if (window.location.hash && window.location.hash.length > 1) {
        var id = decodeURIComponent(window.location.hash.slice(1));
        var target = document.getElementById(id);
        if (target) {
          try { target.scrollIntoView({ behavior: 'auto', block: 'start' }); }
          catch (_) { target.scrollIntoView(true); }
          setActiveTocLink(id);
        }
      }
    }

    init();

    return {
      renderPreview: renderPreview,
      setView: setView,
      getSource: function () { return textareaEl.value || ''; },
      isDirty: function () { return (textareaEl.value || '') !== savedSource; },
      snapshot: snapshot,
      save: save,
      cancel: cancel
    };
  }

  // ── Utils ─────────────────────────────────────────────────────────────
  // Consumers can pass either a NodeList, HTMLCollection, or an Array.
  // The Array.from spread would also work but this shape keeps the
  // module IE11-safe alongside the rest of the codebase.
  function toArray(list) {
    if (!list) return [];
    if (Array.isArray(list)) return list.slice();
    return Array.prototype.slice.call(list);
  }

  global.KnowledgeDocumentView = { create: create };
})(window);
