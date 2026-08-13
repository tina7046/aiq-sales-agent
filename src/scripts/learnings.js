/**
 * Learnings page controller
 * =====================================================================
 * Drives /learnings.html — the tabbed Auto-Learning prototype. The pill
 * tabs are the global ShTabNav component (wired in _template.html); this
 * listens for tab changes and renders the selected document's markdown
 * in-page, into a `.hunter-agent-knowledge__article` container so it
 * picks up the same prose styling the detail page uses.
 *
 * Also provides:
 *   • A pencil Edit / Preview toggle — swaps the article for a plain
 *     textarea of the raw markdown; edits are session-scoped per doc.
 *   • An "On this page" TOC ported from the Knowledge detail page:
 *     collapsible h2/h3 sections, a blue rail indicator, click-to-scroll
 *     and scroll-spy. Reuses the detail page's TOC partial + CSS; the
 *     build/accordion/scroll-spy logic is adapted from
 *     knowledge_document_view.js (that module is a single-doc editor and
 *     can't be reused directly for a tabbed reader).
 *
 * Self-contained markdown renderer (the subset the docs use, documented
 * in knowledge.json): `#`/`##`/`###` headings, paragraphs, `-`/`*`
 * unordered lists, `1.` ordered lists, inline `**bold**`, `*italic*`,
 * `` `code` ``, `[text](url)`. Classic script + IIFE; no-ops when its
 * roots aren't present.
 */
(function () {
  'use strict';

  var GROUP_ID = 'auto-learning-customer-interactions';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(text) {
    var t = esc(text);
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    return t;
  }

  // Slug + dedup, mirroring knowledge_document_view.js so heading ids
  // are stable, url-safe, and collision-free within a doc.
  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }
  function makeSlugAllocator() {
    var seen = {};
    return function (text) {
      var base = slugify(text) || 'section';
      var slug = base;
      var i = 2;
      while (seen[slug]) { slug = base + '-' + i++; }
      seen[slug] = true;
      return slug;
    };
  }

  function renderMarkdown(md) {
    var stripped = String(md || '').replace(/^\s*#\s+[^\n]*\n+/, '');
    var lines = stripped.split(/\r?\n/);
    var allocate = makeSlugAllocator();
    var out = [];
    var listTag = null;
    var items = [];
    var para = [];

    function flushPara() {
      if (!para.length) return;
      out.push('<p>' + inline(para.join(' ')) + '</p>');
      para = [];
    }
    function flushList() {
      if (!listTag) return;
      out.push('<' + listTag + '>' + items.map(function (i) {
        return '<li>' + inline(i) + '</li>';
      }).join('') + '</' + listTag + '>');
      listTag = null;
      items = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) { flushPara(); flushList(); continue; }

      var h = raw.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara(); flushList();
        var lvl = Math.min(h[1].length, 6);
        // Only h2/h3 feed the TOC — give them slug ids + a heading hook.
        if (lvl === 2 || lvl === 3) {
          var slug = allocate(h[2]);
          out.push('<h' + lvl + ' id="' + slug + '" data-knowledge-heading="h' + lvl + '">' + inline(h[2]) + '</h' + lvl + '>');
        } else {
          out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>');
        }
        continue;
      }

      var ol = raw.match(/^\d+\.\s+(.*)$/);
      if (ol) {
        flushPara();
        if (listTag && listTag !== 'ol') flushList();
        listTag = 'ol';
        items.push(ol[1]);
        continue;
      }

      var ul = raw.match(/^[-*]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (listTag && listTag !== 'ul') flushList();
        listTag = 'ul';
        items.push(ul[1]);
        continue;
      }

      flushList();
      para.push(raw);
    }
    flushPara();
    flushList();
    return out.join('\n');
  }

  function readConfig() {
    var node = document.getElementById('sh-learnings-config');
    if (!node) return [];
    try { return JSON.parse(node.textContent) || []; }
    catch (e) { return []; }
  }

  function toggleBtnHtml(isEdit) {
    var label = isEdit ? 'Preview' : 'Edit';
    var icon = isEdit ? 'preview' : 'edit';
    return '<div class="seller-home__learnings-toolbar">' +
      '<button type="button" ' +
        'class="slds-button slds-button_icon slds-button_icon-border-filled seller-home__learnings-toggle" ' +
        'data-sh-learnings-toggle aria-pressed="' + (isEdit ? 'true' : 'false') + '" ' +
        'title="' + label + '" aria-label="' + label + '">' +
        '<svg class="slds-button__icon" aria-hidden="true">' +
          '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#' + icon + '"></use>' +
        '</svg>' +
        '<span class="slds-assistive-text">' + label + '</span>' +
      '</button>' +
    '</div>';
  }

  function init() {
    var host = document.querySelector('[data-sh-learnings-panel]');
    var bar = document.querySelector('[data-sh-learnings-tabs]');
    if (!host || !bar) return;

    var layout = document.querySelector('[data-sh-learnings-layout]');
    var scrollRoot = document.querySelector('.seller-home__knowledge-body');

    // TOC shell nodes (from _knowledge_toc.html).
    var tocEl = document.querySelector('[data-knowledge-toc]');
    var tocList = document.querySelector('[data-knowledge-toc-list]');
    var tocBody = document.querySelector('[data-knowledge-toc-body]');
    var railIndicator = document.querySelector('[data-knowledge-toc-rail-indicator]');

    var docs = readConfig().filter(function (d) {
      return d && d.sourceGroupId === GROUP_ID;
    });
    if (!docs.length) return;

    var byId = {};
    docs.forEach(function (d) { byId[d.id] = d; });

    var edits = {};
    var activeId = null;
    var mode = 'preview';
    var railActiveId = null;
    var observer = null;

    function sourceOf(id) {
      var doc = byId[id];
      if (!doc) return '';
      return edits[id] != null ? edits[id] : (doc.markdown || '');
    }
    function captureEdit() {
      if (mode !== 'edit') return;
      var ta = host.querySelector('[data-sh-learnings-textarea]');
      if (ta) edits[activeId] = ta.value;
    }

    // ── TOC: rail indicator ────────────────────────────────────────────
    function applyRail(id, animate) {
      if (!railIndicator || !tocBody) return;
      var link = tocList.querySelector('a[data-knowledge-toc-link="' + id + '"]');
      if (!link) return;
      var bodyRect = tocBody.getBoundingClientRect();
      if (!bodyRect.height) return;
      var linkRect = link.getBoundingClientRect();
      var top = linkRect.top - bodyRect.top;
      var height = linkRect.height;
      if (animate === false) {
        railIndicator.style.transition = 'none';
        railIndicator.getBoundingClientRect();
        railIndicator.style.transform = 'translateY(' + top + 'px)';
        railIndicator.style.height = height + 'px';
        railIndicator.getBoundingClientRect();
        railIndicator.style.transition = '';
      } else {
        railIndicator.style.transform = 'translateY(' + top + 'px)';
        railIndicator.style.height = height + 'px';
      }
      railActiveId = id;
    }
    function refreshRail(animate) {
      var id = railActiveId;
      if (!id) {
        var first = tocList.querySelector('a[data-knowledge-toc-link]');
        id = first && first.getAttribute('data-knowledge-toc-link');
      }
      if (id) applyRail(id, animate);
    }
    function resetRail() {
      if (railIndicator) {
        railIndicator.style.transform = 'translateY(0px)';
        railIndicator.style.height = '0px';
      }
      railActiveId = null;
    }

    // ── TOC: active state (self + ancestor), with fold onto a collapsed
    // parent when the active h3 is hidden. ────────────────────────────
    function setActive(id) {
      if (!id) return;
      var links = tocList.querySelectorAll('[data-knowledge-toc-link]');
      var selfAnchor = null;
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var linkId = a.getAttribute('data-knowledge-toc-link');
        var isSelf = linkId === id;
        var isAncestor = false;
        if (!isSelf) {
          var li = a.closest('li');
          var sub = li && li.querySelector('.hunter-agent-knowledge__toc-sublist');
          if (sub && sub.querySelector('[data-knowledge-toc-link="' + id + '"]')) isAncestor = true;
        }
        a.classList.toggle('is-active', isSelf || isAncestor);
        if (isSelf) selfAnchor = a;
      }
      var target = id;
      if (selfAnchor) {
        var hiddenSub = selfAnchor.closest('.hunter-agent-knowledge__toc-sublist');
        if (hiddenSub && hiddenSub.hasAttribute('hidden')) {
          var section = hiddenSub.closest('.hunter-agent-knowledge__toc-item--collapsible');
          var parentAnchor = section && section.querySelector('.hunter-agent-knowledge__toc-item-row > a[data-knowledge-toc-link]');
          if (parentAnchor) target = parentAnchor.getAttribute('data-knowledge-toc-link');
        }
      }
      applyRail(target, true);
    }

    function setSectionExpanded(li, expanded) {
      if (!li) return;
      li.classList.toggle('is-expanded', !!expanded);
      var btn = li.querySelector('[data-knowledge-toc-toggle]');
      if (btn) {
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        var cur = btn.getAttribute('aria-label') || '';
        if (expanded && cur.indexOf('Expand ') === 0) btn.setAttribute('aria-label', 'Collapse ' + cur.slice(7));
        else if (!expanded && cur.indexOf('Collapse ') === 0) btn.setAttribute('aria-label', 'Expand ' + cur.slice(9));
      }
      var sub = li.querySelector('.hunter-agent-knowledge__toc-sublist');
      if (sub) { if (expanded) sub.removeAttribute('hidden'); else sub.setAttribute('hidden', ''); }
      refreshRail(true);
    }

    function buildTOC(articleEl) {
      if (!tocList) return;
      var headings = articleEl.querySelectorAll('[data-knowledge-heading="h2"], [data-knowledge-heading="h3"]');
      if (!headings.length) {
        tocList.innerHTML = '';
        if (tocEl) tocEl.setAttribute('hidden', '');
        resetRail();
        return;
      }
      if (tocEl) tocEl.removeAttribute('hidden');

      var frags = [];
      var currentSub = null;
      for (var i = 0; i < headings.length; i++) {
        var hEl = headings[i];
        var level = hEl.getAttribute('data-knowledge-heading');
        var item = { level: level, text: hEl.textContent || '', id: hEl.id };
        if (level === 'h2') { currentSub = []; item.children = currentSub; frags.push(item); }
        else { (currentSub || frags).push(item); }
      }

      var html = frags.map(function (item) {
        var anchor = '<a href="#' + item.id + '" data-knowledge-toc-link="' + item.id + '">' +
          '<span class="hunter-agent-knowledge__toc-label" title="' + esc(item.text) + '">' + esc(item.text) + '</span></a>';
        if (!item.children || !item.children.length) return '<li>' + anchor + '</li>';
        var sectionId = 'toc-section-' + item.id;
        var chevron = '<button type="button" class="hunter-agent-knowledge__toc-chevron" ' +
          'data-knowledge-toc-toggle="' + item.id + '" aria-expanded="false" aria-controls="' + sectionId + '" ' +
          'aria-label="Expand ' + esc(item.text) + '">' +
          '<svg class="hunter-agent-knowledge__toc-chevron-icon" aria-hidden="true">' +
          '<use xlink:href="/assets/icons/utility-sprite/svg/symbols.svg#chevronright"></use></svg></button>';
        var row = '<div class="hunter-agent-knowledge__toc-item-row">' + chevron + anchor + '</div>';
        var sub = '<ol class="hunter-agent-knowledge__toc-sublist" id="' + sectionId + '" hidden>' +
          item.children.map(function (c) {
            return '<li><a href="#' + c.id + '" data-knowledge-toc-link="' + c.id + '">' +
              '<span class="hunter-agent-knowledge__toc-label" title="' + esc(c.text) + '">' + esc(c.text) + '</span></a></li>';
          }).join('') + '</ol>';
        return '<li class="hunter-agent-knowledge__toc-item hunter-agent-knowledge__toc-item--collapsible">' + row + sub + '</li>';
      }).join('');

      tocList.innerHTML = html;
      railActiveId = null;
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { refreshRail(false); });
      else refreshRail(false);
    }

    function attachScrollSpy(articleEl) {
      if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
      if (typeof IntersectionObserver !== 'function') return;
      var headings = articleEl.querySelectorAll('[data-knowledge-heading="h2"], [data-knowledge-heading="h3"]');
      if (!headings.length) return;
      var visible = [];
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var idx = visible.indexOf(e.target);
          if (e.isIntersecting && idx === -1) visible.push(e.target);
          else if (!e.isIntersecting && idx !== -1) visible.splice(idx, 1);
        });
        if (!visible.length) return;
        var top = null, topY = Infinity;
        visible.forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.top < topY) { topY = r.top; top = el; }
        });
        if (top) setActive(top.id);
      }, { root: scrollRoot || null, rootMargin: '-120px 0px -60% 0px', threshold: 0 });
      for (var i = 0; i < headings.length; i++) observer.observe(headings[i]);
    }

    // TOC interactions — delegated once (the list is repopulated per doc).
    if (tocList) {
      tocList.addEventListener('click', function (e) {
        var toggle = e.target.closest('[data-knowledge-toc-toggle]');
        if (toggle) {
          e.preventDefault();
          var section = toggle.closest('.hunter-agent-knowledge__toc-item--collapsible');
          if (section) setSectionExpanded(section, !section.classList.contains('is-expanded'));
          return;
        }
        var link = e.target.closest('[data-knowledge-toc-link]');
        if (!link) return;
        e.preventDefault();
        var id = link.getAttribute('data-knowledge-toc-link');
        var targetEl = document.getElementById(id);
        if (!targetEl) return;
        try { targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        catch (_) { targetEl.scrollIntoView(true); }
        setActive(id);
      });
    }

    // ── Render ──────────────────────────────────────────────────────────
    function render() {
      var doc = byId[activeId];
      if (!doc) return;
      var src = sourceOf(activeId);
      var isEdit = mode === 'edit';

      if (layout) layout.classList.toggle('is-editing', isEdit);

      if (isEdit) {
        if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
        host.innerHTML = toggleBtnHtml(true) +
          '<textarea class="seller-home__learnings-editor" data-sh-learnings-textarea spellcheck="false"></textarea>';
        var ta = host.querySelector('[data-sh-learnings-textarea]');
        ta.value = src;
        ta.focus();
        return;
      }

      var body = renderMarkdown(src);
      if (!body.replace(/\s/g, '')) {
        body = '<p class="hunter-agent-knowledge__article-placeholder">No learnings written yet.</p>';
      }
      var updated = '';
      if (doc.updatedAt) {
        updated = '<p class="hunter-agent-knowledge__article-updated">Updated ' + esc(doc.updatedAt) +
          (doc.updatedBy ? ' by ' + esc(doc.updatedBy) : '') + '</p>';
      }
      host.innerHTML = toggleBtnHtml(false) +
        '<header class="hunter-agent-knowledge__article-header">' +
          '<h1 class="hunter-agent-knowledge__article-title">' + esc(doc.name) + '</h1>' +
          updated +
        '</header>' +
        '<div class="hunter-agent-knowledge__article" data-rendered="true">' + body + '</div>';
      host.scrollTop = 0;

      var articleEl = host.querySelector('.hunter-agent-knowledge__article');
      railActiveId = null;
      buildTOC(articleEl);
      attachScrollSpy(articleEl);
    }

    host.addEventListener('click', function (e) {
      if (!e.target.closest('[data-sh-learnings-toggle]')) return;
      if (mode === 'edit') { captureEdit(); mode = 'preview'; }
      else { mode = 'edit'; }
      render();
    });

    bar.addEventListener('sh:tabnav-change', function (e) {
      captureEdit();
      activeId = e.detail.value;
      mode = 'preview';
      render();
    });

    var active = bar.querySelector('.slds-item-active');
    activeId = active ? active.getAttribute('data-sh-tabnav-value') : docs[0].id;
    if (!byId[activeId]) activeId = docs[0].id;
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
