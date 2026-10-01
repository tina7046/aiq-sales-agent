// ─────────────────────────────────────────────────────────────────────────
// SkillMarkdownEditor — always-editable Markdown canvas.
//
// Powers /skill_detail.html. Unlike the split-view Knowledge editor
// (`KnowledgeDocumentView`), this module renders ONE surface that is
// simultaneously the rendered document AND the editing surface. The
// user types directly into the formatted content — no raw-Markdown
// textarea, no Preview / Edit mode toggle.
//
// ── Data model contract ──────────────────────────────────────────────
//
//   savedMarkdown   — Baseline. The last-committed Markdown source.
//                     Mutated ONLY by `save()`, `snapshot()`, or an
//                     explicit `setBaseline()`. Never touched by
//                     keystrokes.
//   draftMarkdown   — Derived from the current DOM on every input.
//                     Read-only from the outside (via `getMarkdown()`);
//                     the module keeps it in sync internally.
//   isDirty         — `normalize(draftMarkdown) !== normalize(saved
//                     Markdown)`. Uses NORMALIZED comparison so
//                     round-tripping a document without meaningful
//                     changes does not flip dirty (idempotent load /
//                     save).
//
// Canonical format is Markdown. The DOM is a working representation
// only. Every editable feature that lives in Markdown round-trips
// through a stable pair:
//
//    parse(md)        — Markdown → HTML string → DOM
//    serialize(root)  — DOM → Markdown string
//
// Unknown Markdown syntax that the visual editor cannot express is
// preserved as text: the parser leaves it as a `<p>` (or the
// container that surrounds it), and the serializer emits the same
// text back. Users can still edit that text as source; the editor
// simply doesn't decorate it. Sanitization strips
// `<script>` / `on*` / `javascript:` from any HTML the user pastes.
//
// ── Public API ───────────────────────────────────────────────────────
//
//   var editor = SkillMarkdownEditor.create({
//     root,               // outer canvas wrapper
//     article,            // instructions article (block host)
//     toolbar,            // optional leftover formatting strip
//     initialMarkdown,    // saved baseline (string)
//     canEdit,            // boolean
//     blockCopy,          // labels for handle / convert menus
//     onPlaceholder,      // fn(kind, triggerEl) for AI / @ / slash stubs
//     onDirtyChange,      // fn(isDirty)
//     onRender,           // fn(articleEl) after each render
//     onSave,             // fn(markdown) after save() commits
//     onCancel            // fn() after cancel() reverts
//   });
//
//   editor.getMarkdown()       — current draftMarkdown
//   editor.getSavedMarkdown()  — savedMarkdown baseline
//   editor.setMarkdown(md)     — replace content + baseline, reset dirty
//   editor.setDraft(md)        — replace content, KEEP baseline
//                                (used for autosave restore)
//   editor.snapshot()          — mark current as baseline (no onSave)
//   editor.save()              — commit + fire onSave
//   editor.cancel()            — revert to baseline + fire onCancel
//   editor.focus()             — move caret into the document
//   editor.isDirty()           — normalized diff test
//   editor.render()            — force a re-render of the current
//                                draftMarkdown (used by post-load
//                                enrichment passes)
//
// Style: plain script, no bundler; IIFE guard, exposes
// `window.SkillMarkdownEditor`.
// ─────────────────────────────────────────────────────────────────────────

(function (global) {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }
  function toArray(x) { return x ? Array.prototype.slice.call(x) : []; }

  // Only http(s), mailto, tel, relative paths, and hash links pass.
  // `javascript:` and `data:` are blocked so a paste can't execute
  // code via `<a href>` or `<img src>`.
  var SAFE_URL_RE = /^(?:https?:|mailto:|tel:|\/|\.\/|\.\.\/|#)/i;
  function isSafeUrl(u) {
    if (u == null) return false;
    var s = String(u).trim();
    if (!s) return false;
    if (/^javascript:/i.test(s)) return false;
    if (/^data:/i.test(s) && !/^data:image\//i.test(s)) return false;
    return SAFE_URL_RE.test(s) || /^data:image\//i.test(s);
  }

  // Normalization for "meaningful changes" detection. Compares two
  // Markdown strings ignoring trailing whitespace, blank-line runs,
  // and terminal newlines.
  function normalizeMarkdown(md) {
    return String(md == null ? '' : md)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (line) { return line.replace(/[ \t]+$/, ''); })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '')
      + '\n';
  }

  // ── Markdown → HTML (parser) ───────────────────────────────────────
  // Small, focused parser that covers exactly the subset we support
  // in the visual editor. Anything outside the grammar is emitted as
  // an escaped paragraph so unknown source is preserved verbatim.
  //
  // Supported block constructs:
  //   • H1 / H2 / H3     — `# text` / `## text` / `### text`
  //   • Paragraph        — anything else that isn't blank
  //   • Ordered list     — `1. item` (renumbered on serialize)
  //   • Unordered list   — `- item`
  //   • Blockquote       — `> text` (contiguous lines merge)
  //   • Horizontal rule  — `---` / `***` on its own line
  //   • Fenced code      — ```lang ... ``` (contents kept literal)
  //
  // Supported inline constructs:
  //   • Bold             — `**text**`
  //   • Italic           — `*text*` / `_text_`
  //   • Inline code      — `` `text` ``
  //   • Link             — `[label](href)`
  //   • Image            — `![alt](src)`
  //
  // Whatever is not one of the above is escaped and rendered as-is.

  var HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/;
  var TASK_RE    = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/;
  var UL_RE      = /^\s*[-*]\s+(.+?)\s*$/;
  var OL_RE      = /^\s*(\d+)\.\s+(.+?)\s*$/;
  var BQ_RE      = /^\s*>\s?(.*)$/;
  var HR_RE      = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
  var FENCE_RE   = /^\s*```(.*)$/;

  function renderInline(text) {
    // Order matters: image before link (they share a delimiter shape),
    // then code (kept literal), then bold before italic.
    return String(text == null ? '' : text)
      // 1. Escape everything first, then re-hydrate the tiny set of
      // Markdown-derived tags below. This is the sole path to HTML.
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      // 2. Images `![alt](src)` — src must be safe.
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, src) {
        if (!isSafeUrl(src)) return escapeHtml('![' + alt + '](' + src + ')');
        return '<img alt="' + escapeAttr(alt) + '" src="' + escapeAttr(src) + '">';
      })
      // 3. Inline code: keep contents literal.
      .replace(/`([^`]+?)`/g, function (_, code) { return '<code>' + code + '</code>'; })
      // 4. Links `[label](href)` — href must be safe.
      .replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, function (_, label, href) {
        if (!isSafeUrl(href)) return escapeHtml('[' + label + '](' + href + ')');
        return '<a href="' + escapeAttr(href) + '">' + label + '</a>';
      })
      // 5. Bold (**text**) before italic so `**foo**` doesn't get
      // grabbed by the italic pass.
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      // 6. Italic — either `*text*` or `_text_`. `_` variant handled
      // separately so intra-word underscores don't accidentally
      // italicize (`foo_bar_baz` stays literal).
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|\s)_([^_\n]+?)_(?=\s|$)/g, '$1<em>$2</em>');
  }

  function renderMarkdown(md) {
    var lines  = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    var out    = [];
    var buf    = [];               // paragraph buffer
    var list   = null;             // 'ul' | 'ol' | null
    var items  = [];               // current list items
    var quote  = null;             // blockquote lines buffer
    var fence  = null;             // { lang, lines: [] } when inside a fence

    function flushParagraph() {
      if (!buf.length) return;
      out.push('<p>' + renderInline(buf.join(' ')) + '</p>');
      buf = [];
    }
    function flushList() {
      if (!list) return;
      if (list === 'checklist') {
        out.push('<ul class="seller-home__skill-check-list" data-sh-check-list="">' + items.map(function (it) {
          return '<li class="seller-home__skill-check-item" data-checked="' + (it.checked ? 'true' : 'false') + '">' +
            '<span class="seller-home__skill-check-box" contenteditable="false" aria-hidden="true"></span>' +
            '<span class="seller-home__skill-check-label">' + renderInline(it.text) + '</span>' +
          '</li>';
        }).join('') + '</ul>');
      } else {
        out.push('<' + list + '>' + items.map(function (it) {
          return '<li>' + renderInline(it) + '</li>';
        }).join('') + '</' + list + '>');
      }
      list = null; items = [];
    }
    function flushQuote() {
      if (!quote) return;
      var joined = quote.join(' ');
      out.push('<blockquote><p>' + renderInline(joined) + '</p></blockquote>');
      quote = null;
    }
    function flushAll() { flushParagraph(); flushList(); flushQuote(); }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];

      // Inside a fenced code block — collect until matching fence,
      // do NOT interpret any Markdown grammar. Content is escaped
      // once at emit time.
      if (fence) {
        if (FENCE_RE.test(raw)) {
          out.push(
            '<pre><code' + (fence.lang ? ' data-lang="' + escapeAttr(fence.lang) + '"' : '') + '>' +
              escapeHtml(fence.lines.join('\n')) +
            '</code></pre>'
          );
          fence = null;
        } else {
          fence.lines.push(raw);
        }
        continue;
      }

      var mFence = raw.match(FENCE_RE);
      if (mFence) {
        flushAll();
        fence = { lang: (mFence[1] || '').trim(), lines: [] };
        continue;
      }

      if (/^\s*$/.test(raw)) { flushAll(); continue; }

      if (HR_RE.test(raw)) {
        flushAll();
        out.push('<hr>');
        continue;
      }

      var mH = raw.match(HEADING_RE);
      if (mH) {
        flushAll();
        var level = mH[1].length;
        out.push('<h' + level + '>' + renderInline(mH[2]) + '</h' + level + '>');
        continue;
      }

      var mBQ = raw.match(BQ_RE);
      if (mBQ) {
        flushParagraph(); flushList();
        if (!quote) quote = [];
        quote.push(mBQ[1] || '');
        continue;
      } else if (quote) {
        flushQuote();
      }

      var mTask = raw.match(TASK_RE);
      if (mTask) {
        if (list && list !== 'checklist') flushList();
        flushParagraph();
        list = 'checklist';
        items.push({ checked: /x/i.test(mTask[1]), text: mTask[2] });
        continue;
      }

      var mUL = raw.match(UL_RE);
      if (mUL) {
        if (list && list !== 'ul') flushList();
        flushParagraph();
        list = 'ul';
        items.push(mUL[1]);
        continue;
      }

      var mOL = raw.match(OL_RE);
      if (mOL) {
        if (list && list !== 'ol') flushList();
        flushParagraph();
        list = 'ol';
        items.push(mOL[2]);
        continue;
      }

      flushList();
      buf.push(raw.trim());
    }
    // EOF — flush pending buffers. An unclosed code fence emits its
    // buffered lines verbatim so the source survives round-trip.
    if (fence) {
      out.push('<pre><code' + (fence.lang ? ' data-lang="' + escapeAttr(fence.lang) + '"' : '') + '>' + escapeHtml(fence.lines.join('\n')) + '</code></pre>');
    }
    flushAll();
    return out.join('');
  }

  // ── DOM → Markdown (serializer) ────────────────────────────────────
  // Walks the editable article and emits Markdown. Blocks are
  // separated by a single blank line; lists are re-numbered from 1;
  // inline treatments (`<strong>`, `<em>`, `<code>`, `<a>`, `<img>`)
  // are mapped to their Markdown source. Unknown block-level elements
  // fall back to their `textContent` so pasted content that survived
  // sanitization still round-trips as plain text.

  function serializeInline(node) {
    if (!node) return '';
    if (node.nodeType === 3) {
      return String(node.nodeValue || '').replace(/\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';
    var tag = node.tagName ? node.tagName.toLowerCase() : '';
    var kids = toArray(node.childNodes).map(serializeInline).join('');
    switch (tag) {
      case 'strong':
      case 'b':
        return kids ? '**' + kids + '**' : '';
      case 'em':
      case 'i':
        return kids ? '*' + kids + '*' : '';
      case 'code':
        return '`' + (node.textContent || '') + '`';
      case 'a':
        var href = node.getAttribute && node.getAttribute('href');
        if (!isSafeUrl(href)) return kids;
        return '[' + kids + '](' + href + ')';
      case 'img':
        var src = node.getAttribute && node.getAttribute('src');
        if (!isSafeUrl(src)) return '';
        var alt = (node.getAttribute && node.getAttribute('alt')) || '';
        return '![' + alt + '](' + src + ')';
      case 'br':
        return '\n';
      case 'span':
      case 'font':
      case 'u':
      default:
        // Unknown / stripped inline wrappers — emit children only.
        return kids;
    }
  }

  function serializeInlineChildren(node) {
    return toArray(node.childNodes).map(serializeInline).join('')
      .replace(/[ \t]+/g, ' ')
      .replace(/^ +| +$/g, '');
  }

  function serializeBlock(node) {
    if (!node || node.nodeType !== 1) return '';
    // Block-chrome wrappers are visual only. Serialize the inner
    // body (and any sibling enrichments like a chip row), never the
    // grip / AI buttons.
    if (node.getAttribute && node.getAttribute('data-sh-skill-block') != null) {
      var inner = toArray(node.childNodes)
        .filter(function (c) {
          if (c.nodeType !== 1) return false;
          if (c.getAttribute('data-sh-skill-block-grip') != null) return false;
          if (c.getAttribute('data-sh-skill-block-plus') != null) return false;
          if (c.getAttribute('data-sh-skill-block-ai') != null) return false;
          return true;
        })
        .map(serializeBlock)
        .filter(Boolean);
      return inner.join('\n\n');
    }
    if (node.getAttribute && node.getAttribute('data-sh-skill-block-content') != null) {
      return toArray(node.childNodes)
        .map(function (c) {
          if (c.nodeType === 1) return serializeBlock(c);
          if (c.nodeType === 3) return String(c.nodeValue || '').trim();
          return '';
        })
        .filter(Boolean)
        .join('\n\n');
    }
    var tag = node.tagName.toLowerCase();
    switch (tag) {
      case 'h1': return '# '   + serializeInlineChildren(node);
      case 'h2': return '## '  + serializeInlineChildren(node);
      case 'h3': return '### ' + serializeInlineChildren(node);
      case 'h4': return '#### ' + serializeInlineChildren(node);
      case 'h5': return '##### ' + serializeInlineChildren(node);
      case 'h6': return '###### ' + serializeInlineChildren(node);
      case 'p':
        var text = serializeInlineChildren(node);
        return text;
      case 'ul': {
        var lis = toArray(node.children).filter(function (c) { return c.tagName === 'LI'; });
        var isCheck = (node.getAttribute && node.getAttribute('data-sh-check-list') != null) ||
          (node.className && /seller-home__skill-check-list/.test(node.className));
        return lis.map(function (li) {
          var liIsCheck = isCheck ||
            (li.className && /seller-home__skill-check-item/.test(li.className));
          if (liIsCheck) {
            var checked = li.getAttribute && li.getAttribute('data-checked') === 'true';
            var labelEl = li.querySelector ? li.querySelector('.seller-home__skill-check-label') : null;
            var label = labelEl ? serializeInlineChildren(labelEl) : serializeInlineChildren(li);
            return '- [' + (checked ? 'x' : ' ') + '] ' + label;
          }
          return '- ' + serializeInlineChildren(li);
        }).join('\n');
      }
      case 'ol': {
        var olis = toArray(node.children).filter(function (c) { return c.tagName === 'LI'; });
        return olis.map(function (li, idx) {
          return (idx + 1) + '. ' + serializeInlineChildren(li);
        }).join('\n');
      }
      case 'blockquote': {
        // Concatenate inner block text, then prefix each line.
        var inner = toArray(node.childNodes)
          .map(function (c) {
            if (c.nodeType === 1) return serializeBlock(c);
            if (c.nodeType === 3) return String(c.nodeValue || '').trim();
            return '';
          })
          .filter(Boolean)
          .join('\n\n');
        return inner.split('\n').map(function (l) { return '> ' + l; }).join('\n');
      }
      case 'hr': return '---';
      case 'pre': {
        // Fenced code block. Language captured on the inner <code>.
        var codeEl = node.querySelector ? node.querySelector('code') : null;
        var lang   = codeEl && codeEl.getAttribute ? (codeEl.getAttribute('data-lang') || '') : '';
        var body   = codeEl ? (codeEl.textContent || '') : (node.textContent || '');
        return '```' + (lang ? lang : '') + '\n' + body.replace(/\n+$/, '') + '\n```';
      }
      case 'div':
      case 'section':
      case 'article':
      case 'figure':
      case 'aside': {
        // Post-render enrichments (e.g. the supporting-skill chip
        // row) wrap inline content in a <div> for visual grouping
        // only — the underlying Markdown had those chips on ONE
        // line. If every child of this wrapper is inline
        // (anchor / text / span / img / code / em / strong / br),
        // serialize it as a single paragraph so the source
        // round-trips without gaining spurious blank lines. When
        // the wrapper mixes block + inline children, fall back to
        // the block-level join.
        var kids = toArray(node.childNodes);
        var allInline = kids.every(function (c) {
          if (c.nodeType === 3) return true;
          if (c.nodeType !== 1) return true;
          var t = c.tagName ? c.tagName.toLowerCase() : '';
          return t === 'a' || t === 'span' || t === 'img' || t === 'code'
              || t === 'strong' || t === 'b' || t === 'em' || t === 'i'
              || t === 'br';
        });
        if (allInline) return serializeInlineChildren(node);
        return kids
          .map(function (c) {
            if (c.nodeType === 1) return serializeBlock(c);
            if (c.nodeType === 3) return String(c.nodeValue || '').trim();
            return '';
          })
          .filter(Boolean)
          .join('\n\n');
      }
      default:
        // Anything else (e.g. table, dl) falls through as plain text
        // for now. Extend here as the editor grows.
        return serializeInlineChildren(node);
    }
  }

  function serializeDocument(root) {
    if (!root) return '';
    var blocks = toArray(root.childNodes)
      .map(function (n) {
        if (n.nodeType === 1) {
          // The inline "Draft with AI" composer lives in the flow but is
          // chrome, not content — never serialize it into the Markdown.
          if (n.getAttribute && n.getAttribute('data-sh-skill-ai-composer') != null) return '';
          return serializeBlock(n);
        }
        if (n.nodeType === 3) {
          var t = String(n.nodeValue || '').trim();
          return t;
        }
        return '';
      })
      .filter(function (b) { return b !== ''; });
    return normalizeMarkdown(blocks.join('\n\n'));
  }

  // ── Paste sanitization ─────────────────────────────────────────────
  // We render the browser's paste into an HTML fragment, walk it, and
  // strip any element/attribute the editor's own DOM doesn't already
  // emit. Anything else falls back to text content.
  var ALLOWED_TAGS = {
    P: 1, BR: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
    STRONG: 1, B: 1, EM: 1, I: 1, U: 1,
    UL: 1, OL: 1, LI: 1,
    BLOCKQUOTE: 1,
    HR: 1,
    A: 1, IMG: 1,
    CODE: 1, PRE: 1,
    SPAN: 1
  };
  var ALLOWED_ATTRS = {
    A:   { href: 1, title: 1 },
    IMG: { src: 1, alt: 1, title: 1 }
  };

  function sanitizeElement(el) {
    var tag = el.tagName;
    if (!ALLOWED_TAGS[tag]) {
      // Replace with a text node carrying the element's text content
      var text = document.createTextNode(el.textContent || '');
      if (el.parentNode) el.parentNode.replaceChild(text, el);
      return;
    }
    var attrs = toArray(el.attributes);
    var allowed = ALLOWED_ATTRS[tag] || {};
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name;
      var value = attrs[i].value;
      var keep  = allowed[name] === 1;
      // Extra defense: block javascript: / data: (non-image) URLs.
      if (keep && (name === 'href' || name === 'src') && !isSafeUrl(value)) {
        keep = false;
      }
      if (!keep) el.removeAttribute(name);
    }
    toArray(el.children).forEach(sanitizeElement);
  }

  function sanitizeFragment(html) {
    var wrap = document.createElement('div');
    wrap.innerHTML = String(html == null ? '' : html);
    // Remove <script> / <style> outright.
    toArray(wrap.querySelectorAll('script, style, iframe, object, embed, link, meta')).forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    toArray(wrap.children).forEach(sanitizeElement);
    return wrap;
  }

  // ── Selection helpers ─────────────────────────────────────────────
  function getSelection() {
    var sel = global.getSelection ? global.getSelection() : null;
    return sel && sel.rangeCount > 0 ? sel : null;
  }
  function currentBlock(articleEl) {
    var sel = getSelection();
    if (!sel) return null;
    var node = sel.getRangeAt(0).startContainer;
    while (node && node !== articleEl) {
      if (node.nodeType === 1 && /^(P|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE|PRE)$/.test(node.tagName)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }
  function selectionInside(articleEl) {
    var sel = getSelection();
    if (!sel) return false;
    var range = sel.getRangeAt(0);
    return articleEl.contains(range.commonAncestorContainer);
  }
  function placeCaretAtEnd(el) {
    if (!el) return;
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = getSelection() || global.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function ensureFocus(articleEl) {
    if (!selectionInside(articleEl)) {
      placeCaretAtEnd(articleEl);
    }
  }

  // Wrap current block in a new tag, preserving inline children.
  // If already the target tag, unwrap back to <p>.
  function transformBlockTag(articleEl, targetTag) {
    var block = currentBlock(articleEl);
    if (!block) {
      ensureFocus(articleEl);
      block = currentBlock(articleEl) || articleEl.lastElementChild;
    }
    if (!block) return;
    var currentTag = block.tagName.toLowerCase();
    var newTag = (currentTag === targetTag) ? 'p' : targetTag;
    var replacement = document.createElement(newTag);
    while (block.firstChild) replacement.appendChild(block.firstChild);
    if (block.parentNode) block.parentNode.replaceChild(replacement, block);
    placeCaretAtEnd(replacement);
  }

  function wrapCurrentInline(articleEl, tagName) {
    ensureFocus(articleEl);
    // execCommand for bold/italic still works reliably in Chromium /
    // WebKit / Gecko as of 2026, even though it's officially deprecated.
    // We use it here because reproducing the range-splitting behavior
    // by hand is a large amount of code for a prototype.
    try {
      if (tagName === 'strong' || tagName === 'b') document.execCommand('bold');
      else if (tagName === 'em' || tagName === 'i') document.execCommand('italic');
      else if (tagName === 'code') {
        // No native execCommand — do it manually.
        var sel = getSelection();
        if (!sel) return;
        var range = sel.getRangeAt(0);
        if (range.collapsed) return;
        var codeEl = document.createElement('code');
        codeEl.textContent = String(range.toString() || '');
        range.deleteContents();
        range.insertNode(codeEl);
        // Reselect the code element's content.
        var next = document.createRange();
        next.selectNodeContents(codeEl);
        sel.removeAllRanges();
        sel.addRange(next);
      }
    } catch (_) { /* ignore in non-browser envs */ }
  }

  // Convert current block (or blocks in selection) into a list.
  function toggleList(articleEl, kind) {
    ensureFocus(articleEl);
    try {
      document.execCommand(kind === 'ol' ? 'insertOrderedList' : 'insertUnorderedList');
    } catch (_) { /* fall through */ }
  }

  function insertHorizontalRule(articleEl) {
    ensureFocus(articleEl);
    var hr = document.createElement('hr');
    var block = currentBlock(articleEl);
    if (block && block.parentNode) {
      block.parentNode.insertBefore(hr, block.nextSibling);
      var next = document.createElement('p');
      next.appendChild(document.createElement('br'));
      hr.parentNode.insertBefore(next, hr.nextSibling);
      placeCaretAtEnd(next);
    } else {
      articleEl.appendChild(hr);
    }
  }

  function insertLink(articleEl, url) {
    ensureFocus(articleEl);
    if (!isSafeUrl(url)) return;
    var sel = getSelection();
    if (!sel) return;
    var range = sel.getRangeAt(0);
    var linkText = range.toString();
    var a = document.createElement('a');
    a.setAttribute('href', url);
    a.textContent = linkText || url;
    range.deleteContents();
    range.insertNode(a);
    var next = document.createRange();
    next.setStartAfter(a);
    next.collapse(true);
    sel.removeAllRanges();
    sel.addRange(next);
  }

  function insertImage(articleEl, url, alt) {
    ensureFocus(articleEl);
    if (!isSafeUrl(url)) return;
    var img = document.createElement('img');
    img.setAttribute('src', url);
    if (alt) img.setAttribute('alt', alt);
    var sel = getSelection();
    if (!sel) { articleEl.appendChild(img); return; }
    var range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(img);
  }

  function insertCodeBlock(articleEl) {
    ensureFocus(articleEl);
    var pre = document.createElement('pre');
    var code = document.createElement('code');
    code.textContent = '\n';
    pre.appendChild(code);
    var block = currentBlock(articleEl);
    if (block && block.parentNode) {
      block.parentNode.insertBefore(pre, block.nextSibling);
    } else {
      articleEl.appendChild(pre);
    }
    placeCaretAtEnd(code);
  }

  function insertTable(articleEl) {
    // A minimal 2×2 GFM-shaped table. Serializer currently returns
    // this as inline text (tables round-trip through `serializeBlock`
    // default → text). Kept as an insert affordance so the toolbar
    // button doesn't dead-end; a follow-up can add a real GFM
    // serializer if the design starts leaning on tables heavily.
    ensureFocus(articleEl);
    var pre = document.createElement('pre');
    var code = document.createElement('code');
    code.textContent = '| Header 1 | Header 2 |\n|---|---|\n| Cell A | Cell B |\n';
    pre.appendChild(code);
    var block = currentBlock(articleEl);
    if (block && block.parentNode) {
      block.parentNode.insertBefore(pre, block.nextSibling);
    } else {
      articleEl.appendChild(pre);
    }
    placeCaretAtEnd(code);
  }

  // Update the heading dropdown label + toolbar aria-pressed state
  // from the currently focused block.
  function updateToolbarState(articleEl, toolbarEl, headingLabelEl) {
    if (!toolbarEl) return;
    var block = currentBlock(articleEl);
    var tag = block ? block.tagName.toLowerCase() : 'p';
    if (headingLabelEl) {
      var label = 'Paragraph';
      if (tag === 'h1') label = 'Heading 1';
      else if (tag === 'h2') label = 'Heading 2';
      else if (tag === 'h3') label = 'Heading 3';
      headingLabelEl.textContent = label;
    }
    var buttons = toArray(toolbarEl.querySelectorAll('[aria-pressed]'));
    buttons.forEach(function (btn) {
      var op = btn.getAttribute('data-sh-editor-cmd');
      var pressed = false;
      if (op === 'bold')       pressed = document.queryCommandState && document.queryCommandState('bold');
      else if (op === 'italic') pressed = document.queryCommandState && document.queryCommandState('italic');
      else if (op === 'ul')     pressed = !!closestTag(block, 'UL');
      else if (op === 'ol')     pressed = !!closestTag(block, 'OL');
      else if (op === 'quote')  pressed = !!closestTag(block, 'BLOCKQUOTE');
      else if (op === 'code')   pressed = tag === 'pre';
      btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    });
  }

  function closestTag(node, tagName) {
    while (node) {
      if (node.tagName === tagName) return node;
      node = node.parentNode;
    }
    return null;
  }

  function isBodyEmpty(el) {
    if (!el) return true;
    if (el.tagName === 'HR') return false;
    return !String(el.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  function closestSkillBlock(node, articleEl) {
    var n = node;
    while (n && n !== articleEl) {
      if (n.nodeType === 1 && n.getAttribute && n.getAttribute('data-sh-skill-block') != null) {
        return n;
      }
      n = n.parentNode;
    }
    return null;
  }

  function blockBodyEl(block, from) {
    if (!block) return null;
    var start = from;
    if (start && start.nodeType === 3) start = start.parentNode;
    if (start && start.closest) {
      var inner = start.closest('[data-sh-skill-block-body]');
      if (inner && block.contains(inner)) return inner;
    }
    return block.querySelector('[data-sh-skill-block-body]');
  }

  function placeCaretAtStart(el) {
    if (!el) return;
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    var sel = getSelection() || global.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function placeCaretAfter(node) {
    if (!node || !node.parentNode) return;
    var host = node.parentNode;
    if (host.focus) {
      try { host.focus(); } catch (_) { /* ignore */ }
    }
    var range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    var sel = getSelection() || global.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function isAtomicChip(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.getAttribute('contenteditable') === 'false') return true;
    return false;
  }

  function skipEmptyText(node, dir) {
    var n = node;
    while (n && n.nodeType === 3 && !String(n.nodeValue || '').replace(/\u00a0/g, ' ').trim()) {
      n = dir === 'prev' ? n.previousSibling : n.nextSibling;
    }
    return n;
  }

  function atomicBeforeCaret() {
    var sel = getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var container = range.startContainer;
    var offset = range.startOffset;
    if (container.nodeType === 3) {
      var before = String(container.nodeValue || '').slice(0, offset).replace(/\u00a0/g, ' ');
      if (before.trim()) return null;
      return isAtomicChip(skipEmptyText(container.previousSibling, 'prev'))
        ? skipEmptyText(container.previousSibling, 'prev')
        : (container.parentNode && isAtomicChip(container.parentNode.previousSibling)
          ? skipEmptyText(container.parentNode.previousSibling, 'prev')
          : null);
    }
    if (container.nodeType === 1) {
      if (offset > 0) {
        var prev = skipEmptyText(container.childNodes[offset - 1], 'prev');
        return isAtomicChip(prev) ? prev : null;
      }
      var sib = skipEmptyText(container.previousSibling, 'prev');
      return isAtomicChip(sib) ? sib : null;
    }
    return null;
  }

  function atomicAfterCaret() {
    var sel = getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    var container = range.startContainer;
    var offset = range.startOffset;
    if (container.nodeType === 3) {
      var after = String(container.nodeValue || '').slice(offset).replace(/\u00a0/g, ' ');
      if (after.trim()) return null;
      var next = skipEmptyText(container.nextSibling, 'next');
      return isAtomicChip(next) ? next : null;
    }
    if (container.nodeType === 1) {
      var child = skipEmptyText(container.childNodes[offset], 'next');
      return isAtomicChip(child) ? child : null;
    }
    return null;
  }

  function deleteAtomicNode(node) {
    if (!node || !node.parentNode) return false;
    var sel = getSelection() || global.getSelection();
    if (!sel) return false;
    var range = document.createRange();
    range.selectNode(node);
    sel.removeAllRanges();
    sel.addRange(range);
    var ok = false;
    try { ok = document.execCommand('delete', false, null); } catch (_) { ok = false; }
    if (!ok && node.parentNode) node.parentNode.removeChild(node);
    return true;
  }

  function isCaretAtStart(el) {
    var sel = getSelection();
    if (!sel || !sel.rangeCount || !el) return false;
    var range = sel.getRangeAt(0);
    if (!range.collapsed || !el.contains(range.startContainer)) return false;
    var pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return !String(pre.toString() || '').replace(/\u00a0/g, ' ').trim();
  }

  function utilIcon(name) {
    return '<svg class="seller-home__skill-block-menu-icon" aria-hidden="true" focusable="false">' +
      '<use xlink:href="/aiq-sales-agent/assets/icons/utility-sprite/svg/symbols.svg#' + name + '"></use></svg>';
  }

  // Standard-sprite glyph (viewBox 0 0 1000 1000) rendered monochrome inside a
  // menu glyph box — used for the conditional (If / Else If / Else) blocks so
  // they read as flow-control just like the prompt-builder toolbox.
  function stdIcon(name) {
    return '<svg class="seller-home__skill-block-menu-std" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">' +
      '<use xlink:href="/aiq-sales-agent/assets/icons/standard-sprite/svg/symbols.svg#' + name + '"></use></svg>';
  }

  // Parse a trusted, constant SVG string into a live SVG element without
  // touching innerHTML (all inputs here are hard-coded glyph markup).
  function makeSvg(str) {
    var s = String(str || '');
    // `image/svg+xml` parsing only yields a renderable node when the root
    // <svg> declares the SVG namespace. Several inline glyphs omit it, so
    // inject it when missing (otherwise the parsed node renders as blank).
    if (s.indexOf('xmlns=') === -1) {
      s = s.replace(/^\s*<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    var doc = new DOMParser().parseFromString(s, 'image/svg+xml');
    var el = doc && doc.documentElement;
    // Guard against a parser-error document (renders as blank text).
    if (!el || el.nodeName === 'parsererror' ||
        (el.getElementsByTagName && el.getElementsByTagName('parsererror').length)) {
      return document.createTextNode('');
    }
    return document.importNode(el, true);
  }

  // Stroke glyphs from the prompt-builder `ce-popover` / `ce-toolbar`.
  function menuGlyph(svg) {
    return '<span class="seller-home__skill-block-menu-glyph" aria-hidden="true">' + svg + '</span>';
  }
  var TUNE_SVG = {
    plus: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 7V12M12 17V12M17 12H12M12 12H7"/></svg>',
    search: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" stroke-width="2"/><line x1="15.4142" x2="19" y1="15" y2="18.5858" stroke="currentColor" stroke-linecap="round" stroke-width="2"/></svg>',
    copy: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    convert: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M11.5 17.5L5 11M5 11V15.5M5 11H9.5"/><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12.5 6.5L19 13M19 13V8.5M19 13H14.5"/></svg>',
    chevron: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M9.58284 17.5L14.4414 12.6414C14.5195 12.5633 14.5195 12.4367 14.4414 12.3586L9.58284 7.5"/></svg>',
    sparkle: '<svg aria-hidden="true" viewBox="0 0 520 520"><path fill="currentColor" d="M349 272l-69 34a105 105 0 00-47 47l-33 67c-5 10-19 10-24 0l-34-68a105 105 0 00-47-47l-68-34a13 13 0 010-24l68-34a105 105 0 0047-47l34-68a13 13 0 0124 0l34 68a105 105 0 0047 47l68 34c10 5 10 19 0 24zm148 150l-30-14a45 45 0 01-20-20l-14-30a6 6 0 00-10 0l-15 30a45 45 0 01-20 20l-30 15c-3 2-3 8 0 10l30 15a45 45 0 0120 20l15 29c2 4 8 4 10 0l14-30a45 45 0 0120-20l30-14c4-2 4-8 0-10zm0-335l-30-15a45 45 0 01-20-20l-14-29a6 6 0 00-10 0l-15 30a45 45 0 01-20 20l-30 14c-3 2-3 8 0 10l30 15a45 45 0 0120 20l15 29c2 4 8 4 10 0l15-30a45 45 0 0120-20l29-14c4-2 4-8 0-10z"/></svg>',
    up: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M7 15L11.8586 10.1414C11.9367 10.0633 12.0633 10.0633 12.1414 10.1414L17 15"/></svg>',
    down: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M7 10L11.8586 14.8586C11.9367 14.9367 12.0633 14.9367 12.1414 14.8586L17 10"/></svg>',
    del: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M8 8L12 12M12 12L16 16M12 12L16 8M12 12L8 16"/></svg>',
    paragraph: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><text x="2" y="11" font-size="11" font-weight="600" font-family="sans-serif" fill="currentColor">P</text></svg>',
    hBig: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><text x="0" y="11" font-size="12" font-weight="700" font-family="sans-serif" fill="currentColor">H</text></svg>',
    hMed: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><text x="1" y="11" font-size="10" font-weight="600" font-family="sans-serif" fill="currentColor">H</text></svg>',
    hSm: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><text x="2" y="11" font-size="8" font-weight="500" font-family="sans-serif" fill="currentColor">H</text></svg>',
    divider: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="6" width="12" height="2" rx="1" fill="currentColor"/></svg>',
    bullets: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 520 520" aria-hidden="true"><path fill="currentColor" d="M80 135c0 8-7 15-15 15H35c-8 0-15-7-15-15v-30c0-8 7-15 15-15h30c8 0 15 7 15 15zm420-30c0-8-7-15-15-15H135c-8 0-15 7-15 15v30c0 8 7 15 15 15h350c8 0 15-7 15-15zM80 245c0-8-7-15-15-15H35c-8 0-15 7-15 15v30c0 8 7 15 15 15h30c8 0 15-7 15-15zm380 0c0-8-7-15-15-15H135c-8 0-15 7-15 15v30c0 8 7 15 15 15h310c8 0 15-7 15-15zM80 385c0-8-7-15-15-15H35c-8 0-15 7-15 15v30c0 8 7 15 15 15h30c8 0 15-7 15-15zm420 0c0-8-7-15-15-15H135c-8 0-15 7-15 15v30c0 8 7 15 15 15h350c8 0 15-7 15-15z"/></svg>',
    // Inline-toolbar glyphs, styled after the prompt-builder `ce-inline-tool`.
    bold: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5a1 1 0 011-1h4.5a3.75 3.75 0 012.62 6.43A4 4 0 0114 18H9a1 1 0 01-1-1V5zm2 6h3.5a1.75 1.75 0 100-3.5H10V11zm0 2v3h4a2 2 0 100-4h-4v1z"/></svg>',
    italic: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M11 5h6M7 19h6M14 5l-4 14"/></svg>',
    link: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 13a5 5 0 007.07 0l2-2a5 5 0 00-7.07-7.07l-1 1M14 11a5 5 0 00-7.07 0l-2 2a5 5 0 007.07 7.07l1-1"/></svg>'
  };

  function emptyParagraph() {
    var p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    return p;
  }

  // ── Factory ────────────────────────────────────────────────────────
  function create(options) {
    if (!options) return null;
    var rootEl         = options.root;
    var articleEl      = options.article;
    var toolbarEl      = options.toolbar || null;
    var canEdit        = options.canEdit !== false;
    var initial        = String(options.initialMarkdown || '');
    var blockCopy      = options.blockCopy || {};
    var mentionGroups  = Array.isArray(options.resources) ? options.resources : [];
    var onPlaceholder  = typeof options.onPlaceholder === 'function' ? options.onPlaceholder : null;
    var onDirtyChange  = typeof options.onDirtyChange === 'function' ? options.onDirtyChange : null;
    var onRender       = typeof options.onRender      === 'function' ? options.onRender      : null;
    var onSave         = typeof options.onSave        === 'function' ? options.onSave        : null;
    var onCancel       = typeof options.onCancel      === 'function' ? options.onCancel      : null;
    if (!articleEl) return null;

    var savedMarkdown = initial;
    var draftMarkdown = initial;
    var wasDirty = false;
    var selectedBlock = null;
    var menuHost = null;
    var convertHost = null;
    var inlineHost = null;
    var inlineLinkOpen = false;
    var mentionHost = null;
    var mentionCtx = null;  // { node, atOffset, endOffset, query } while active
    var placeholderAttr = articleEl.getAttribute('data-placeholder') || '';

    function t(key, fallback) {
      var v = blockCopy[key];
      return v == null || v === '' ? fallback : v;
    }

    // ── Floating menus (ported to body so canvas overflow can't clip)
    function ensureMenus() {
      if (menuHost) return;
      menuHost = document.createElement('div');
      menuHost.className = 'seller-home__skill-block-menu';
      menuHost.setAttribute('data-sh-skill-block-menu', '');
      menuHost.setAttribute('role', 'menu');
      menuHost.hidden = true;
      menuHost.innerHTML =
        '<div class="seller-home__skill-block-menu-filter">' +
          '<span class="seller-home__skill-block-menu-filter-icon" aria-hidden="true">' + TUNE_SVG.search + '</span>' +
          '<input type="search" data-sh-skill-block-filter placeholder="' + escapeAttr(t('filterPlaceholder', 'Filter')) + '" aria-label="' + escapeAttr(t('filterPlaceholder', 'Filter')) + '" tabindex="-1">' +
        '</div>' +
        '<div class="seller-home__skill-block-menu-empty" data-sh-skill-block-empty hidden>' + escapeHtml(t('nothingFound', 'Nothing found')) + '</div>' +
        '<div class="seller-home__skill-block-menu-items">' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-block-action="copy">' +
            menuGlyph(TUNE_SVG.copy) +
            '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('copy', 'Copy block')) + '</span>' +
          '</button>' +
          '<div class="seller-home__skill-block-menu-sep"><div class="seller-home__skill-block-menu-sep-line"></div></div>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-block-action="convert">' +
            menuGlyph(TUNE_SVG.convert) +
            '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('convert', 'Convert to')) + '</span>' +
            '<span class="seller-home__skill-block-menu-glyph seller-home__skill-block-menu-glyph_chevron" aria-hidden="true">' + TUNE_SVG.chevron + '</span>' +
          '</button>' +
          '<div class="seller-home__skill-block-menu-sep"><div class="seller-home__skill-block-menu-sep-line"></div></div>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-block-action="refine">' +
            menuGlyph(TUNE_SVG.sparkle) +
            '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('draftWithAi', 'Draft with AI')) + '</span>' +
          '</button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-block-action="up">' +
            menuGlyph(TUNE_SVG.up) +
            '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('moveUp', 'Move up')) + '</span>' +
          '</button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-block-action="delete">' +
            menuGlyph(TUNE_SVG.del) +
            '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('delete', 'Delete')) + '</span>' +
          '</button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-block-action="down">' +
            menuGlyph(TUNE_SVG.down) +
            '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('moveDown', 'Move down')) + '</span>' +
          '</button>' +
        '</div>';

      convertHost = document.createElement('div');
      convertHost.className = 'seller-home__skill-block-menu seller-home__skill-block-menu_convert';
      convertHost.setAttribute('data-sh-skill-block-convert', '');
      convertHost.setAttribute('role', 'menu');
      convertHost.hidden = true;
      convertHost.innerHTML =
        '<div class="seller-home__skill-block-menu-filter">' +
          '<span class="seller-home__skill-block-menu-filter-icon" aria-hidden="true">' + TUNE_SVG.search + '</span>' +
          '<input type="search" data-sh-skill-convert-filter placeholder="' + escapeAttr(t('filterPlaceholder', 'Filter')) + '" aria-label="' + escapeAttr(t('filterPlaceholder', 'Filter')) + '" tabindex="-1">' +
        '</div>' +
        '<div class="seller-home__skill-block-menu-empty" data-sh-skill-block-empty hidden>' + escapeHtml(t('nothingFound', 'Nothing found')) + '</div>' +
        '<div class="seller-home__skill-block-menu-items">' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-convert="p">' + menuGlyph(TUNE_SVG.paragraph) + '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('paragraph', 'Paragraph')) + '</span></button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-convert="h2">' + menuGlyph(TUNE_SVG.hBig) + '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('bigHeading', 'Big heading')) + '</span></button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-convert="h3" data-heading-size="medium">' + menuGlyph(TUNE_SVG.hMed) + '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('mediumHeading', 'Medium heading')) + '</span></button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-convert="h3" data-heading-size="small">' + menuGlyph(TUNE_SVG.hSm) + '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('smallHeading', 'Small heading')) + '</span></button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-convert="hr">' + menuGlyph(TUNE_SVG.divider) + '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('divider', 'Divider')) + '</span></button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-convert="ul">' + menuGlyph(TUNE_SVG.bullets) + '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('bulletedList', 'Bulleted list')) + '</span></button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-convert="if" hidden>' + menuGlyph(stdIcon('decision')) + '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('if', 'If')) + '</span></button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-convert="elseif" hidden>' + menuGlyph(stdIcon('maintenance_work_rule')) + '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('elseIf', 'Else If')) + '</span></button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-convert="else" hidden>' + menuGlyph(stdIcon('decision')) + '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('else', 'Else')) + '</span></button>' +
          '<button type="button" class="seller-home__skill-block-menu-item" role="menuitem" data-convert="draft-ai" hidden>' + menuGlyph(TUNE_SVG.sparkle) + '<span class="seller-home__skill-block-menu-title">' + escapeHtml(t('draftWithAi', 'Draft with AI')) + '</span></button>' +
        '</div>';

      document.body.appendChild(menuHost);
      document.body.appendChild(convertHost);

      menuHost.addEventListener('click', onHandleMenuClick);
      convertHost.addEventListener('click', onConvertMenuClick);
      var filterEl = menuHost.querySelector('[data-sh-skill-block-filter]');
      var convertFilterEl = convertHost.querySelector('[data-sh-skill-convert-filter]');
      if (filterEl) filterEl.addEventListener('input', function () { filterMenu(menuHost, filterEl.value); });
      if (convertFilterEl) convertFilterEl.addEventListener('input', function () { filterMenu(convertHost, convertFilterEl.value); });
    }

    // ── Inline selection toolbar (Bold / Italic / Link) ──────────────
    // Ports the prompt-builder `.ce-inline-toolbar`: a small floating bar
    // that appears above a non-empty text selection inside the canvas.
    var inlineSavedRange = null;

    function inlineToolBtn(kind, label, svg, pressable) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'seller-home__skill-inline-tool';
      b.setAttribute('data-inline', kind);
      if (pressable) b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', label);
      b.title = label;
      b.appendChild(makeSvg(svg));
      return b;
    }

    function ensureInlineToolbar() {
      if (inlineHost) return;
      inlineHost = document.createElement('div');
      inlineHost.className = 'seller-home__skill-inline-toolbar';
      inlineHost.setAttribute('data-sh-skill-inline-toolbar', '');
      inlineHost.setAttribute('role', 'toolbar');
      inlineHost.hidden = true;

      var tools = document.createElement('div');
      tools.className = 'seller-home__skill-inline-toolbar-tools';
      tools.setAttribute('data-sh-inline-tools', '');
      tools.appendChild(inlineToolBtn('bold', t('bold', 'Bold'), TUNE_SVG.bold, true));
      tools.appendChild(inlineToolBtn('italic', t('italic', 'Italic'), TUNE_SVG.italic, true));
      tools.appendChild(inlineToolBtn('link', t('link', 'Link'), TUNE_SVG.link, false));

      var linkWrap = document.createElement('div');
      linkWrap.className = 'seller-home__skill-inline-toolbar-link';
      linkWrap.setAttribute('data-sh-inline-link', '');
      linkWrap.hidden = true;
      var input = document.createElement('input');
      input.type = 'url';
      input.className = 'seller-home__skill-inline-link-input';
      input.setAttribute('data-sh-inline-link-input', '');
      input.placeholder = t('linkPlaceholder', 'Paste or type a link…');
      input.setAttribute('aria-label', t('link', 'Link'));
      linkWrap.appendChild(input);

      inlineHost.appendChild(tools);
      inlineHost.appendChild(linkWrap);
      document.body.appendChild(inlineHost);

      // Pressing a tool must not steal the editor selection — swallow the
      // mousedown everywhere except the link input, which needs focus.
      inlineHost.addEventListener('mousedown', function (e) {
        var inInput = e.target && e.target.closest && e.target.closest('[data-sh-inline-link-input]');
        if (!inInput) e.preventDefault();
      });
      inlineHost.addEventListener('click', onInlineClick);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); applyLink(input.value); }
        else if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeLinkInput(); hideInline(); }
      });
    }

    function positionInline(rect) {
      inlineHost.hidden = false;
      var w = inlineHost.offsetWidth || 120;
      var h = inlineHost.offsetHeight || 36;
      var top = rect.top - h - 8;
      var left = rect.left + (rect.width / 2) - (w / 2);
      if (top < 8) top = rect.bottom + 8;
      if (left < 8) left = 8;
      if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
      inlineHost.style.top = Math.round(top) + 'px';
      inlineHost.style.left = Math.round(left) + 'px';
    }

    function hideInline() {
      if (!inlineHost) return;
      inlineHost.hidden = true;
      closeLinkInput();
    }

    function closeLinkInput() {
      inlineLinkOpen = false;
      if (!inlineHost) return;
      var linkWrap = inlineHost.querySelector('[data-sh-inline-link]');
      var tools = inlineHost.querySelector('[data-sh-inline-tools]');
      if (linkWrap) linkWrap.hidden = true;
      if (tools) tools.hidden = false;
      var input = inlineHost.querySelector('[data-sh-inline-link-input]');
      if (input) input.value = '';
      inlineHost.classList.remove('is-link-open');
    }

    function openLinkInput() {
      var sel = getSelection();
      if (sel && sel.rangeCount) inlineSavedRange = sel.getRangeAt(0).cloneRange();
      inlineLinkOpen = true;
      var linkWrap = inlineHost.querySelector('[data-sh-inline-link]');
      var tools = inlineHost.querySelector('[data-sh-inline-tools]');
      if (tools) tools.hidden = true;
      if (linkWrap) linkWrap.hidden = false;
      inlineHost.classList.add('is-link-open');
      var input = inlineHost.querySelector('[data-sh-inline-link-input]');
      if (input) { input.value = ''; input.focus(); }
    }

    function applyLink(value) {
      var url = String(value || '').trim();
      // Restore the pre-input selection so the link wraps the right text.
      if (inlineSavedRange) {
        var sel = getSelection() || (global.getSelection && global.getSelection());
        if (sel) { sel.removeAllRanges(); sel.addRange(inlineSavedRange); }
      }
      if (url && isSafeUrl(url)) {
        insertLink(articleEl, url);
        refreshDraft();
      }
      inlineSavedRange = null;
      closeLinkInput();
      hideInline();
    }

    function syncInlineState() {
      if (!inlineHost) return;
      var boldBtn = inlineHost.querySelector('[data-inline="bold"]');
      var italicBtn = inlineHost.querySelector('[data-inline="italic"]');
      try {
        if (boldBtn) boldBtn.setAttribute('aria-pressed', document.queryCommandState('bold') ? 'true' : 'false');
        if (italicBtn) italicBtn.setAttribute('aria-pressed', document.queryCommandState('italic') ? 'true' : 'false');
      } catch (_) { /* queryCommandState unsupported — leave unpressed */ }
    }

    function onInlineClick(e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-inline]') : null;
      if (!btn) return;
      e.preventDefault();
      var kind = btn.getAttribute('data-inline');
      if (kind === 'link') { openLinkInput(); return; }
      if (kind === 'bold') wrapCurrentInline(articleEl, 'strong');
      else if (kind === 'italic') wrapCurrentInline(articleEl, 'em');
      refreshDraft();
      syncInlineState();
      updateInlineToolbar();
    }

    function updateInlineToolbar() {
      ensureInlineToolbar();
      if (!canEdit) { hideInline(); return; }
      if (inlineLinkOpen) return; // keep the bar up while a URL is being typed
      var sel = getSelection();
      if (!sel || sel.isCollapsed) { hideInline(); return; }
      var range = sel.getRangeAt(0);
      if (!articleEl.contains(range.commonAncestorContainer)) { hideInline(); return; }
      if (!String(sel.toString() || '').trim()) { hideInline(); return; }
      var rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) { hideInline(); return; }
      positionInline(rect);
      syncInlineState();
    }

    // ── @-mention resource menu ──────────────────────────────────────
    // Typing "@" (at line start or after whitespace) opens a grouped,
    // filter-as-you-type popover of insertable resources. Choosing one
    // replaces the "@query" text with a chip anchor. Ported to body so
    // the canvas overflow can't clip it, like the block menus.
    var MENTION_GLYPH = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z"/></svg>';

    function ensureMentionMenu() {
      if (mentionHost) return;
      mentionHost = document.createElement('div');
      mentionHost.className = 'seller-home__skill-block-menu seller-home__skill-mention-menu';
      mentionHost.setAttribute('data-sh-skill-mention-menu', '');
      mentionHost.setAttribute('role', 'listbox');
      mentionHost.hidden = true;

      var empty = document.createElement('div');
      empty.className = 'seller-home__skill-block-menu-empty';
      empty.setAttribute('data-sh-skill-mention-empty', '');
      empty.hidden = true;
      empty.textContent = t('mentionEmpty', 'No resources found');

      var list = document.createElement('div');
      list.className = 'seller-home__skill-block-menu-items';
      list.setAttribute('data-sh-skill-mention-items', '');

      mentionGroups.forEach(function (group) {
        if (!group || !Array.isArray(group.items) || !group.items.length) return;
        var header = document.createElement('div');
        header.className = 'seller-home__skill-mention-group';
        header.setAttribute('data-sh-skill-mention-group', '');
        header.textContent = String(group.label || '');
        list.appendChild(header);
        group.items.forEach(function (item) {
          list.appendChild(mentionItemBtn(item, group.label));
        });
      });

      mentionHost.appendChild(empty);
      mentionHost.appendChild(list);
      document.body.appendChild(mentionHost);

      mentionHost.addEventListener('mousedown', function (e) { e.preventDefault(); });
      mentionHost.addEventListener('click', onMentionClick);
    }

    function mentionItemBtn(item, groupLabel) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'seller-home__skill-block-menu-item seller-home__skill-mention-item';
      b.setAttribute('role', 'option');
      b.setAttribute('data-sh-skill-mention-item', '');
      b.setAttribute('data-mention-href', String(item.href || ''));
      b.setAttribute('data-mention-label', String(item.label || ''));
      if (groupLabel) b.setAttribute('data-mention-group', String(groupLabel));

      var glyph = document.createElement('span');
      glyph.className = 'seller-home__skill-block-menu-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      if (item.iconSvg) {
        // Inline glyph on a filled badge (e.g. the skill icon).
        if (item.iconBadge) {
          glyph.classList.add('seller-home__skill-mention-glyph_badge');
          glyph.classList.add('seller-home__skill-mention-glyph_' + String(item.iconBadge));
        }
        glyph.appendChild(makeSvg(item.iconSvg));
      } else if (item.iconRef) {
        var img = document.createElement('img');
        img.className = 'seller-home__skill-mention-icon';
        img.src = String(item.iconRef);
        img.alt = '';
        glyph.appendChild(img);
      } else {
        glyph.appendChild(makeSvg(MENTION_GLYPH));
      }
      var title = document.createElement('span');
      title.className = 'seller-home__skill-block-menu-title';
      title.textContent = String(item.label || '');
      b.appendChild(glyph);
      b.appendChild(title);
      return b;
    }

    function filterMentionMenu(query) {
      var q = String(query || '').trim().toLowerCase();
      var visible = 0;
      toArray(mentionHost.querySelectorAll('[data-sh-skill-mention-item]')).forEach(function (btn) {
        var label = String(btn.getAttribute('data-mention-label') || '').toLowerCase();
        btn.hidden = !!(q && label.indexOf(q) === -1);
        btn.classList.remove('is-active');
        if (!btn.hidden) visible += 1;
      });
      // Hide a group header when all its items are filtered out.
      toArray(mentionHost.querySelectorAll('[data-sh-skill-mention-group]')).forEach(function (header) {
        var sib = header.nextElementSibling;
        var any = false;
        while (sib && sib.hasAttribute('data-sh-skill-mention-item')) {
          if (!sib.hidden) { any = true; break; }
          sib = sib.nextElementSibling;
        }
        header.hidden = !any;
      });
      var empty = mentionHost.querySelector('[data-sh-skill-mention-empty]');
      if (empty) empty.hidden = visible > 0;
      setMentionActive(firstVisibleMention());
    }

    function firstVisibleMention() {
      return mentionHost
        ? mentionHost.querySelector('[data-sh-skill-mention-item]:not([hidden])')
        : null;
    }

    function setMentionActive(btn) {
      if (!mentionHost) return;
      toArray(mentionHost.querySelectorAll('.is-active')).forEach(function (el) {
        el.classList.remove('is-active');
      });
      if (btn) {
        btn.classList.add('is-active');
        if (btn.scrollIntoView) { try { btn.scrollIntoView({ block: 'nearest' }); } catch (_) {} }
      }
    }

    function moveMentionActive(dir) {
      if (!mentionHost) return;
      var items = toArray(mentionHost.querySelectorAll('[data-sh-skill-mention-item]:not([hidden])'));
      if (!items.length) return;
      var idx = items.indexOf(mentionHost.querySelector('.is-active'));
      idx = (idx + dir + items.length) % items.length;
      setMentionActive(items[idx]);
    }

    function mentionOpen() {
      return !!(mentionHost && !mentionHost.hidden);
    }

    // Read the "@query" the caret currently sits in, or null. The "@"
    // must start the block or follow whitespace, and the run between it
    // and the caret must be single-token (no spaces).
    function getMentionContext(body) {
      if (!body || body.tagName === 'HR') return null;
      var sel = getSelection();
      if (!sel || !sel.isCollapsed) return null;
      var range = sel.getRangeAt(0);
      var node = range.startContainer;
      if (!node || node.nodeType !== 3 || !body.contains(node)) return null;
      var before = String(node.nodeValue || '').slice(0, range.startOffset);
      var m = before.match(/(?:^|\s)@([^\s@]*)$/);
      if (!m) return null;
      var query = m[1];
      return {
        node: node,
        atOffset: range.startOffset - query.length - 1,
        endOffset: range.startOffset,
        query: query
      };
    }

    function openMentionMenu(ctx) {
      if (!mentionGroups.length) return;
      ensureMentionMenu();
      mentionCtx = ctx;
      // Anchor to the "@…" run so the menu tracks the caret.
      var rect;
      try {
        var r = document.createRange();
        r.setStart(ctx.node, ctx.atOffset);
        r.setEnd(ctx.node, ctx.endOffset);
        rect = r.getBoundingClientRect();
      } catch (_) { rect = null; }
      if (!rect || (!rect.width && !rect.height && !rect.top)) {
        var sel = getSelection();
        if (sel && sel.rangeCount) rect = sel.getRangeAt(0).getBoundingClientRect();
      }
      if (!rect) return;
      closeMenus();
      mentionHost.hidden = false;
      filterMentionMenu(ctx.query);
      positionPanel(mentionHost, rect);
    }

    function closeMentionMenu() {
      mentionCtx = null;
      if (mentionHost) mentionHost.hidden = true;
    }

    function onMentionClick(e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-sh-skill-mention-item]') : null;
      if (!btn) return;
      e.preventDefault();
      insertMention(btn);
    }

    function insertMention(btn) {
      if (!btn || !mentionCtx || !mentionCtx.node) { closeMentionMenu(); return; }
      var href = btn.getAttribute('data-mention-href') || '';
      var label = btn.getAttribute('data-mention-label') || '';
      if (!isSafeUrl(href) || !label) { closeMentionMenu(); return; }

      var textNode = mentionCtx.node;
      if (!textNode.parentNode) { closeMentionMenu(); return; }
      // Split off the "@query" run and replace it with an anchor.
      var full = String(textNode.nodeValue || '');
      var head = full.slice(0, mentionCtx.atOffset);
      var tail = full.slice(mentionCtx.endOffset);
      textNode.nodeValue = head;

      var anchor = document.createElement('a');
      anchor.setAttribute('href', href);
      anchor.textContent = label;

      var space = document.createTextNode(' ');
      var tailNode = document.createTextNode(tail);
      var parent = textNode.parentNode;
      var after = textNode.nextSibling;
      parent.insertBefore(anchor, after);
      parent.insertBefore(space, after);
      parent.insertBefore(tailNode, after);

      // Caret just after the trailing space.
      var sel = getSelection() || global.getSelection();
      if (sel) {
        var caret = document.createRange();
        caret.setStart(space, space.length);
        caret.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caret);
      }

      closeMentionMenu();
      refreshDraft();
      // Let the host turn the fresh anchor into a styled chip (skill or
      // tool). enrichPreview is idempotent, so this is safe mid-edit.
      if (onRender) { try { onRender(articleEl); } catch (_) { /* ignore */ } }
    }

    function filterMenu(host, query) {
      var q = String(query || '').trim().toLowerCase();
      var showExtras = host.hasAttribute('data-slash') || host.hasAttribute('data-toolbox');
      var visible = 0;
      toArray(host.querySelectorAll('[data-block-action], [data-convert]')).forEach(function (btn) {
        var convert = btn.getAttribute('data-convert');
        var extra = convert === 'if' || convert === 'elseif' || convert === 'else' || convert === 'draft-ai';
        if (extra && !showExtras) {
          btn.hidden = true;
          return;
        }
        var label = String(btn.textContent || '').trim().toLowerCase();
        btn.hidden = !!(q && label.indexOf(q) === -1);
        if (!btn.hidden) visible += 1;
      });
      toArray(host.querySelectorAll('.seller-home__skill-block-menu-sep')).forEach(function (sep) {
        sep.hidden = !!q;
      });
      var empty = host.querySelector('[data-sh-skill-block-empty]');
      if (empty) empty.hidden = visible > 0;
    }

    function positionPanel(panel, rect, side) {
      panel.hidden = false;
      var w = panel.offsetWidth || 220;
      var h = panel.offsetHeight || 240;
      var top = rect.bottom + 4;
      var left = rect.left;
      if (side === 'right') {
        top = rect.top;
        left = rect.right + 4;
      }
      if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 4);
      if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
      if (left < 8) left = 8;
      panel.style.top = Math.round(top) + 'px';
      panel.style.left = Math.round(left) + 'px';
    }

    function closeMenus() {
      if (menuHost) {
        menuHost.hidden = true;
        var f = menuHost.querySelector('[data-sh-skill-block-filter]');
        if (f) f.value = '';
        filterMenu(menuHost, '');
      }
      if (convertHost) {
        convertHost.hidden = true;
        convertHost.removeAttribute('data-slash');
        convertHost.removeAttribute('data-toolbox');
        var cf = convertHost.querySelector('[data-sh-skill-convert-filter]');
        if (cf) cf.value = '';
        filterMenu(convertHost, '');
      }
      toArray(articleEl.querySelectorAll('[data-sh-skill-block-grip]')).forEach(function (g) {
        g.setAttribute('aria-expanded', 'false');
      });
    }

    function openHandleMenu(block, grip) {
      ensureMenus();
      // The block menu and AI composer must never be open together.
      closeAiComposer(false);
      selectBlock(block);
      closeMenus();
      if (grip) grip.setAttribute('aria-expanded', 'true');
      menuHost.setAttribute('data-block-id', String(block.getAttribute('data-block-uid') || ''));
      positionPanel(menuHost, grip.getBoundingClientRect(), 'right');
      var f = menuHost.querySelector('[data-sh-skill-block-filter]');
      if (f) {
        try { f.focus(); } catch (_) { /* ignore */ }
      }
    }

    function openConvertMenu(anchorRect, slashQuery, asToolbox) {
      ensureMenus();
      closeAiComposer(false);
      convertHost.setAttribute('data-block-id', selectedBlock ? String(selectedBlock.getAttribute('data-block-uid') || '') : '');
      if (slashQuery != null) {
        convertHost.setAttribute('data-slash', '');
        convertHost.removeAttribute('data-toolbox');
        var cf = convertHost.querySelector('[data-sh-skill-convert-filter]');
        if (cf) cf.value = slashQuery;
        filterMenu(convertHost, slashQuery);
      } else if (asToolbox) {
        convertHost.setAttribute('data-toolbox', '');
        convertHost.removeAttribute('data-slash');
        filterMenu(convertHost, '');
      } else {
        convertHost.removeAttribute('data-slash');
        convertHost.removeAttribute('data-toolbox');
        filterMenu(convertHost, '');
      }
      positionPanel(convertHost, anchorRect, slashQuery != null ? 'below' : 'right');
    }

    function menuBlock() {
      if (!selectedBlock || !selectedBlock.parentNode) return null;
      return selectedBlock;
    }

    function onHandleMenuClick(e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-block-action]') : null;
      if (!btn) return;
      e.preventDefault();
      var action = btn.getAttribute('data-block-action');
      var block = menuBlock();
      if (!block) return;
      if (action === 'convert') {
        openConvertMenu(btn.getBoundingClientRect(), null);
        return;
      }
      closeMenus();
      if (action === 'copy') copyBlock(block);
      else if (action === 'refine') openAiComposer(block);
      else if (action === 'up') moveBlock(block, -1);
      else if (action === 'down') moveBlock(block, 1);
      else if (action === 'delete') deleteBlock(block);
    }

    function onConvertMenuClick(e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-convert]') : null;
      if (!btn) return;
      e.preventDefault();
      var kind = btn.getAttribute('data-convert');
      var block = menuBlock();
      var fromSlash = convertHost.hasAttribute('data-slash');
      closeMenus();
      if (kind === 'if' || kind === 'elseif' || kind === 'else' || kind === 'conditional') {
        // A slash-triggered conditional leaves the typed "/if" behind in
        // the current block — strip it so the new block reads cleanly.
        if (fromSlash && block) {
          var body = blockBodyEl(block);
          if (body && body.tagName !== 'HR') {
            body.textContent = String(body.textContent || '').replace(/^\s*\/[^\n]*/, '').trim();
            if (!body.firstChild) body.appendChild(document.createElement('br'));
            syncBlockEmpty(block);
          }
        }
        firePlaceholder('conditional', btn);
        return;
      }
      if (kind === 'draft-ai') {
        firePlaceholder('draft', btn);
        return;
      }
      if (block) convertBlock(block, kind, fromSlash);
    }

    function firePlaceholder(kind, trigger) {
      if (!onPlaceholder) return;
      try { onPlaceholder(kind, trigger || null); } catch (_) { /* ignore */ }
    }

    // ── Draft with AI — inline composer ──────────────────────────────
    // A single reusable composer node is moved between blocks so only one
    // is ever open. It sits in the normal document flow directly below the
    // selected block; serializeDocument() skips it, so it never leaks into
    // the Markdown or the dirty check. Opening it does not touch content;
    // only a successful generate rewrites the block (and marks dirty).
    var aiComposerEl = null;
    var aiComposerBlock = null;
    var aiComposerBusy = false;
    var aiGenToken = 0;

    var AI_SEND_SVG = '<svg class="seller-home__skill-ai-composer-icon" viewBox="0 0 520 520" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21 445l44-163h186c5 0 10-5 10-10v-20c0-5-5-10-10-10H65L22 82l-2-8c0-7 7-14 15-13l5 1 450 185c6 2 10 8 10 14s-4 11-9 13L40 464l-6 1c-8-1-14-7-14-15z"/></svg>';
    var AI_CLOSE_SVG = '<svg class="seller-home__skill-ai-composer-icon" viewBox="0 0 520 520" aria-hidden="true" focusable="false"><path fill="currentColor" d="M310 254l130-131c6-6 6-15 0-21l-20-21c-6-6-15-6-21 0L268 212a10 10 0 01-14 0L123 80c-6-6-15-6-21 0l-21 21c-6 6-6 15 0 21l131 131c4 4 4 10 0 14L80 399c-6 6-6 15 0 21l21 21c6 6 15 6 21 0l131-131a10 10 0 0114 0l131 131c6 6 15 6 21 0l21-21c6-6 6-15 0-21L310 268a10 10 0 010-14"/></svg>';

    function aiComposerIsOpen() { return !!(aiComposerEl && aiComposerEl.parentNode); }

    function aiSendReady() {
      if (!aiComposerEl || aiComposerBusy) return false;
      var field = aiComposerEl.querySelector('[data-sh-ai-field]');
      return !!field && String(field.value || '').trim().length > 0;
    }

    function updateAiComposerState() {
      if (!aiComposerEl) return;
      var send = aiComposerEl.querySelector('[data-sh-ai-send]');
      var ready = aiSendReady();
      if (send) send.disabled = !ready;
      aiComposerEl.classList.toggle('is-ready', ready);
    }

    function autoGrowAiField(field) {
      if (!field) return;
      field.style.height = 'auto';
      field.style.height = Math.min(field.scrollHeight, 220) + 'px';
    }

    function buildAiComposer() {
      var wrap = document.createElement('div');
      wrap.className = 'seller-home__skill-ai-composer';
      wrap.setAttribute('data-sh-skill-ai-composer', '');
      wrap.setAttribute('contenteditable', 'false');
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', t('draftWithAi', 'Draft with AI'));

      var main = document.createElement('div');
      main.className = 'seller-home__skill-ai-composer-main';

      var field = document.createElement('textarea');
      field.className = 'seller-home__skill-ai-composer-field';
      field.setAttribute('data-sh-ai-field', '');
      field.setAttribute('rows', '1');
      var ph = t('draftWithAiPlaceholder', 'Describe what you want your template to do…');
      field.setAttribute('placeholder', ph);
      field.setAttribute('aria-label', ph);

      var actions = document.createElement('div');
      actions.className = 'seller-home__skill-ai-composer-actions';

      var send = document.createElement('button');
      send.type = 'button';
      send.className = 'seller-home__skill-ai-composer-send';
      send.setAttribute('data-sh-ai-send', '');
      send.disabled = true;
      var sendLabel = t('draftWithAiSend', 'Generate template');
      send.setAttribute('aria-label', sendLabel);
      send.setAttribute('title', sendLabel);
      send.innerHTML = AI_SEND_SVG + '<span class="seller-home__skill-ai-composer-spinner" aria-hidden="true"></span>';

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'seller-home__skill-ai-composer-close';
      closeBtn.setAttribute('data-sh-ai-close', '');
      var closeLabel = t('close', 'Close');
      closeBtn.setAttribute('aria-label', closeLabel);
      closeBtn.setAttribute('title', closeLabel);
      closeBtn.innerHTML = AI_CLOSE_SVG;

      actions.appendChild(send);
      actions.appendChild(closeBtn);
      main.appendChild(field);
      main.appendChild(actions);
      wrap.appendChild(main);

      field.addEventListener('input', function () {
        autoGrowAiField(field);
        updateAiComposerState();
      });
      field.addEventListener('keydown', function (e) {
        // Cmd/Ctrl+Enter submits; plain Enter keeps a newline.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.stopPropagation();
          submitAiComposer();
          return;
        }
        if (e.key === 'Escape' || e.key === 'Esc') {
          e.preventDefault();
          e.stopPropagation();
          closeAiComposer(true);
        }
      });
      send.addEventListener('click', function (e) {
        e.preventDefault();
        submitAiComposer();
      });
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        closeAiComposer(true);
      });
      // Clicks inside the composer must not bubble to the document-level
      // dismiss handler, which would clear the block selection.
      wrap.addEventListener('mousedown', function (e) { e.stopPropagation(); });

      return wrap;
    }

    function openAiComposer(block) {
      if (!canEdit || !block || !block.parentNode) return;
      closeMenus();
      if (!aiComposerEl) aiComposerEl = buildAiComposer();

      // Reset any prior draft / busy state (covers moving to another block)
      // and invalidate any in-flight simulated generation.
      aiGenToken += 1;
      aiComposerBusy = false;
      aiComposerEl.classList.remove('is-busy');
      aiComposerEl.classList.remove('is-ready');
      var field = aiComposerEl.querySelector('[data-sh-ai-field]');
      var send = aiComposerEl.querySelector('[data-sh-ai-send]');
      var closeBtn = aiComposerEl.querySelector('[data-sh-ai-close]');
      if (field) { field.value = ''; field.disabled = false; field.style.height = 'auto'; }
      if (send) send.disabled = true;
      if (closeBtn) closeBtn.disabled = false;

      aiComposerBlock = block;
      selectBlock(block);
      block.parentNode.insertBefore(aiComposerEl, block.nextSibling);

      updateAiComposerState();
      if (field) {
        autoGrowAiField(field);
        try { field.focus(); } catch (_) { /* ignore */ }
      }
    }

    function closeAiComposer(returnFocus) {
      if (!aiComposerEl) return;
      // Invalidate any in-flight simulated generation.
      aiGenToken += 1;
      var block = aiComposerBlock;
      var field = aiComposerEl.querySelector('[data-sh-ai-field]');
      if (aiComposerEl.parentNode) aiComposerEl.parentNode.removeChild(aiComposerEl);
      if (field) { field.value = ''; field.disabled = false; field.style.height = 'auto'; }
      aiComposerEl.classList.remove('is-busy');
      aiComposerEl.classList.remove('is-ready');
      aiComposerBusy = false;
      aiComposerBlock = null;
      // No refreshDraft() here: closing without submitting must leave the
      // block content — and the document's dirty state — untouched.
      if (returnFocus && block && block.parentNode) {
        var body = blockBodyEl(block);
        if (body && body.getAttribute('contenteditable') === 'true') {
          try { placeCaretAtEnd(body); } catch (_) { /* ignore */ }
        } else {
          var grip = block.querySelector('[data-sh-skill-block-grip]');
          if (grip) { try { grip.focus(); } catch (_) { /* ignore */ } }
        }
      }
    }

    function submitAiComposer() {
      if (!aiComposerEl || aiComposerBusy || !aiSendReady()) return;
      var field = aiComposerEl.querySelector('[data-sh-ai-field]');
      var send = aiComposerEl.querySelector('[data-sh-ai-send]');
      var closeBtn = aiComposerEl.querySelector('[data-sh-ai-close]');
      var instruction = field ? String(field.value || '').trim() : '';
      var block = aiComposerBlock;
      if (!instruction) return;
      if (!block || !block.parentNode) { closeAiComposer(false); return; }

      aiComposerBusy = true;
      aiComposerEl.classList.add('is-busy');
      aiComposerEl.classList.remove('is-ready');
      if (field) field.disabled = true;
      if (send) send.disabled = true;
      if (closeBtn) closeBtn.disabled = true;

      // Simulated generation. Swap this timeout for a real async request
      // that resolves to draft HTML to wire a live service later.
      var token = ++aiGenToken;
      global.setTimeout(function () {
        // Bail if the composer was closed or moved to another block.
        if (token !== aiGenToken) return;
        if (block && block.parentNode) applyAiDraft(block, instruction);
        closeAiComposer(false);
        // Keep the freshly drafted block highlighted so it's easy to find.
        if (block && block.parentNode) selectBlock(block);
      }, 1100);
    }

    function applyAiDraft(block, instruction) {
      var body = blockBodyEl(block);
      if (!body) return;
      var kind = block.getAttribute('data-block-kind') || 'p';
      if (kind === 'hr') return;
      body.innerHTML = generateDraftHtml(instruction, kind, String(body.textContent || ''));
      if (!body.firstChild) body.appendChild(document.createElement('br'));
      syncBlockEmpty(block);
      if (onRender) { try { onRender(articleEl); } catch (_) { /* ignore */ } }
      refreshDraft();
    }

    // Deterministic mock generator — produces block-appropriate draft
    // content themed on the user's instruction. Structured so a real AI
    // response can drop in behind the same signature.
    function generateDraftHtml(instruction, kind, prevText) {
      var focus = String(instruction || '')
        .replace(/\s+/g, ' ')
        .replace(/^(please\s+|can you\s+|could you\s+|i want (?:you )?to\s+|help me\s+)/i, '')
        .replace(/[.?!]+$/, '')
        .trim();
      var lead = focus ? (focus.charAt(0).toLowerCase() + focus.slice(1)) : 'communicate this section clearly';

      if (kind === 'ul' || kind === 'ol') {
        var items = [
          'Open by making the goal obvious so the reader instantly gets the point.',
          'Lead with the strongest value and back it with one concrete proof point.',
          'End with a clear, low-friction next step.'
        ];
        return items.map(function (it) { return '<li>' + escapeHtml(it) + '</li>'; }).join('');
      }

      if (kind === 'h1' || kind === 'h2' || kind === 'h3') {
        var heading = focus.split(' ').filter(Boolean).slice(0, 7).map(function (w) {
          return w.charAt(0).toUpperCase() + w.slice(1);
        }).join(' ');
        return escapeHtml(heading || 'Drafted Section');
      }

      var sentence = 'Here’s a draft written to ' + lead + '. '
        + 'It keeps your intent front and center, leads with the most relevant point, '
        + 'and stays clear and specific so it’s ready to refine.';
      return escapeHtml(sentence);
    }

    // ── Block chrome ───────────────────────────────────────────────
    var uidSeq = 0;
    function nextUid() {
      uidSeq += 1;
      return 'b' + uidSeq;
    }

    function decorateBody(el) {
      el.setAttribute('data-sh-skill-block-body', '');
      var tag = (el.tagName || 'P').toLowerCase();
      if (tag !== 'hr' && canEdit) {
        el.setAttribute('contenteditable', 'true');
      } else {
        el.removeAttribute('contenteditable');
      }
      if (tag === 'p' && placeholderAttr) {
        el.setAttribute('data-placeholder', placeholderAttr);
      }
    }

    function wrapOne(el) {
      var wrap = document.createElement('div');
      wrap.className = 'seller-home__skill-block';
      wrap.setAttribute('data-sh-skill-block', '');
      wrap.setAttribute('data-block-uid', nextUid());
      wrap.setAttribute('data-block-kind', (el.tagName || 'P').toLowerCase());

      var plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'seller-home__skill-block-plus';
      plus.setAttribute('data-sh-skill-block-plus', '');
      plus.setAttribute('aria-label', t('addBlock', 'Add block'));
      plus.innerHTML = TUNE_SVG.plus;

      var grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'seller-home__skill-block-grip';
      grip.setAttribute('data-sh-skill-block-grip', '');
      grip.setAttribute('aria-label', t('tuneHint', 'Click to tune'));
      grip.setAttribute('aria-haspopup', 'menu');
      grip.setAttribute('aria-expanded', 'false');
      grip.innerHTML =
        '<svg class="seller-home__skill-block-grip-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<path stroke="currentColor" stroke-linecap="round" stroke-width="2.6" d="M9.40999 7.29999H9.4"/>' +
          '<path stroke="currentColor" stroke-linecap="round" stroke-width="2.6" d="M14.6 7.29999H14.59"/>' +
          '<path stroke="currentColor" stroke-linecap="round" stroke-width="2.6" d="M9.30999 12H9.3"/>' +
          '<path stroke="currentColor" stroke-linecap="round" stroke-width="2.6" d="M14.6 12H14.59"/>' +
          '<path stroke="currentColor" stroke-linecap="round" stroke-width="2.6" d="M9.40999 16.7H9.4"/>' +
          '<path stroke="currentColor" stroke-linecap="round" stroke-width="2.6" d="M14.6 16.7H14.59"/>' +
        '</svg>' +
        '<span class="seller-home__skill-block-grip-hint" aria-hidden="true">' +
          '<span class="seller-home__skill-block-grip-hint-title">' + escapeHtml(t('tuneHint', 'Click to tune')) + '</span>' +
          '<span class="seller-home__skill-block-grip-hint-keys">' +
            '<span class="seller-home__skill-block-slash">⌘</span>' +
            '<span class="seller-home__skill-block-slash-plus">+</span>' +
            '<span class="seller-home__skill-block-slash">/</span>' +
          '</span>' +
        '</span>';

      decorateBody(el);

      var ai = document.createElement('button');
      ai.type = 'button';
      ai.className = 'seller-home__skill-block-ai';
      ai.setAttribute('data-sh-skill-block-ai', '');
      ai.setAttribute('aria-label', t('refine', 'Refine with AI'));
      ai.innerHTML = utilIcon('einstein');

      wrap.appendChild(plus);
      wrap.appendChild(grip);
      var content = document.createElement('div');
      content.className = 'seller-home__skill-block-content';
      content.setAttribute('data-sh-skill-block-content', '');
      content.appendChild(el);
      wrap.appendChild(content);
      wrap.appendChild(ai);
      syncBlockEmpty(wrap);
      return wrap;
    }

    function wrapBlocks() {
      if (!canEdit) return;
      var kids = toArray(articleEl.childNodes);
      if (!kids.length) {
        articleEl.appendChild(wrapOne(emptyParagraph()));
        return;
      }
      kids.forEach(function (n) {
        if (n.nodeType === 3) {
          if (!String(n.nodeValue || '').trim()) {
            if (n.parentNode) n.parentNode.removeChild(n);
            return;
          }
          var p = document.createElement('p');
          p.textContent = n.nodeValue;
          var wrappedText = wrapOne(p);
          articleEl.replaceChild(wrappedText, n);
          return;
        }
        if (n.nodeType !== 1) return;
        if (n.getAttribute('data-sh-skill-block') != null) {
          syncBlockEmpty(n);
          return;
        }
        var next = n.nextSibling;
        var wrapped = wrapOne(n);
        articleEl.insertBefore(wrapped, next);
      });
      if (!articleEl.querySelector('[data-sh-skill-block]')) {
        articleEl.appendChild(wrapOne(emptyParagraph()));
      }
    }

    function syncBlockEmpty(block) {
      if (!block) return;
      var body = blockBodyEl(block);
      var empty = isBodyEmpty(body);
      if (empty) block.classList.add('is-empty');
      else block.classList.remove('is-empty');
      // Mirror prompt-builder `nce-editor[data-empty]` so empty
      // new-line paragraphs can be styled independently of the
      // long first-block placeholder.
      if (body && body.tagName !== 'HR') {
        body.setAttribute('data-empty', empty ? 'true' : 'false');
      }
    }

    function syncAllEmpty() {
      toArray(articleEl.querySelectorAll('[data-sh-skill-block]')).forEach(syncBlockEmpty);
    }

    function selectBlock(block) {
      if (selectedBlock && selectedBlock !== block) {
        selectedBlock.classList.remove('is-selected');
      }
      selectedBlock = block || null;
      toArray(articleEl.querySelectorAll('[data-sh-skill-block]')).forEach(function (b) {
        if (b === selectedBlock) b.classList.add('is-selected');
        else b.classList.remove('is-selected');
      });
    }

    function clearSelection() {
      selectedBlock = null;
      toArray(articleEl.querySelectorAll('[data-sh-skill-block].is-selected, [data-sh-skill-block].is-focused')).forEach(function (b) {
        b.classList.remove('is-selected');
        b.classList.remove('is-focused');
      });
    }

    // Caret in a block is not a handle-selection. Prompt-builder
    // empty paragraphs (`data-empty="true"`) keep a caret only —
    // the blue wash and grip stay off until the handle is clicked.
    function focusBlock(block) {
      toArray(articleEl.querySelectorAll('[data-sh-skill-block].is-focused')).forEach(function (b) {
        if (b !== block) b.classList.remove('is-focused');
      });
      if (block) block.classList.add('is-focused');
    }

    function transferInline(fromEl, toEl) {
      if (!fromEl || fromEl.tagName === 'HR') return;
      if (fromEl.tagName === 'UL' || fromEl.tagName === 'OL') {
        var parts = toArray(fromEl.querySelectorAll('li')).map(function (li) {
          return String(li.textContent || '').trim();
        }).filter(Boolean);
        toEl.textContent = parts.join(' ');
        return;
      }
      while (fromEl.firstChild) toEl.appendChild(fromEl.firstChild);
    }

    function makeBody(kind, fromEl) {
      var tag = kind || 'p';
      var el;
      if (tag === 'ul') {
        el = document.createElement('ul');
        if (fromEl && (fromEl.tagName === 'UL' || fromEl.tagName === 'OL')) {
          toArray(fromEl.children).forEach(function (li) {
            if (li.tagName === 'LI') el.appendChild(li.cloneNode(true));
          });
        } else {
          var li = document.createElement('li');
          transferInline(fromEl, li);
          if (!li.firstChild) li.appendChild(document.createElement('br'));
          el.appendChild(li);
        }
        if (!el.querySelector('li')) {
          var emptyLi = document.createElement('li');
          emptyLi.appendChild(document.createElement('br'));
          el.appendChild(emptyLi);
        }
        return el;
      }
      if (tag === 'hr') return document.createElement('hr');
      el = document.createElement(tag);
      transferInline(fromEl, el);
      if (!el.firstChild) el.appendChild(document.createElement('br'));
      return el;
    }

    function convertBlock(block, kind, fromSlash) {
      if (!block || !kind) return;
      var prev = blockBodyEl(block);
      if (fromSlash && prev && kind !== 'hr') {
        var raw = String(prev.textContent || '').replace(/^\s*\/[^\n]*/, '').trim();
        prev.textContent = raw;
        if (!prev.firstChild) prev.appendChild(document.createElement('br'));
      }
      var next = makeBody(kind, prev);
      decorateBody(next);
      if (prev && prev.parentNode) prev.parentNode.replaceChild(next, prev);
      else {
        var host = block.querySelector('[data-sh-skill-block-content]') || block;
        host.appendChild(next);
      }
      block.setAttribute('data-block-kind', kind);
      syncBlockEmpty(block);
      if (kind !== 'hr') placeCaretAtEnd(next);
      refreshDraft();
    }

    function insertBlockAfter(block, kind, frag) {
      var body = makeBody(kind || 'p', null);
      if (frag) {
        body.innerHTML = '';
        body.appendChild(frag);
        if (!body.firstChild) body.appendChild(document.createElement('br'));
      }
      var wrap = wrapOne(body);
      if (block && block.parentNode) {
        block.parentNode.insertBefore(wrap, block.nextSibling);
      } else {
        articleEl.appendChild(wrap);
      }
      focusBlock(wrap);
      var nb = blockBodyEl(wrap);
      if (nb && nb.getAttribute('contenteditable') === 'true') placeCaretAtStart(nb);
      refreshDraft();
      return wrap;
    }

    function deleteBlock(block) {
      if (!block) return;
      var prev = block.previousElementSibling;
      var next = block.nextElementSibling;
      var parent = block.parentNode;
      if (parent) parent.removeChild(block);
      if (!articleEl.querySelector('[data-sh-skill-block]')) {
        articleEl.appendChild(wrapOne(emptyParagraph()));
      }
      var focus = prev || next || articleEl.querySelector('[data-sh-skill-block]');
      focusBlock(focus);
      var body = blockBodyEl(focus);
      if (body && body.getAttribute('contenteditable') === 'true') placeCaretAtEnd(body);
      refreshDraft();
    }

    function moveBlock(block, dir) {
      if (!block || !block.parentNode) return;
      if (dir < 0) {
        var prev = block.previousElementSibling;
        if (prev) block.parentNode.insertBefore(block, prev);
      } else {
        var next = block.nextElementSibling;
        if (next) block.parentNode.insertBefore(next, block);
      }
      selectBlock(block);
      refreshDraft();
    }

    function copyBlock(block) {
      var md = serializeBlock(block);
      try {
        if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(md);
        }
      } catch (_) { /* ignore */ }
    }

    function splitAtCaret(block) {
      var body = blockBodyEl(block);
      if (!body || body.tagName === 'HR') {
        insertBlockAfter(block, 'p', null);
        return;
      }
      var sel = getSelection();
      var frag = document.createDocumentFragment();
      if (sel && sel.rangeCount && body.contains(sel.getRangeAt(0).startContainer)) {
        var range = sel.getRangeAt(0);
        var after = document.createRange();
        after.selectNodeContents(body);
        after.setStart(range.endContainer, range.endOffset);
        frag = after.extractContents();
      }
      var tag = body.tagName.toLowerCase();
      var newKind = (tag === 'h1' || tag === 'h2' || tag === 'h3') ? 'p' : 'p';
      if (!body.firstChild) body.appendChild(document.createElement('br'));
      insertBlockAfter(block, newKind, frag);
      syncBlockEmpty(block);
    }

    function exitEmptyListItem(block, li) {
      var body = blockBodyEl(block);
      if (!body || !li || !li.parentNode) return false;
      if (!isBodyEmpty(li)) return false;
      var remaining = toArray(body.querySelectorAll('li')).filter(function (item) { return item !== li; });
      li.parentNode.removeChild(li);
      if (!remaining.length) {
        convertBlock(block, 'p', false);
        return true;
      }
      insertBlockAfter(block, 'p', null);
      return true;
    }

    function mergeWithPrev(block) {
      var prev = block.previousElementSibling;
      if (!prev || prev.getAttribute('data-sh-skill-block') == null) return;
      var prevBody = blockBodyEl(prev);
      var body = blockBodyEl(block);
      if (!prevBody || prevBody.tagName === 'HR') {
        deleteBlock(block);
        return;
      }
      if (isBodyEmpty(body)) {
        deleteBlock(block);
        return;
      }
      if (body && prevBody.getAttribute('contenteditable') === 'true') {
        placeCaretAtEnd(prevBody);
        while (body.firstChild) prevBody.appendChild(body.firstChild);
      }
      deleteBlock(block);
      selectBlock(prev);
    }

    // ── Paint ──────────────────────────────────────────────────────
    function paint(md) {
      closeMenus();
      closeAiComposer(false);
      clearSelection();
      articleEl.innerHTML = renderMarkdown(md);
      if (!articleEl.firstElementChild) {
        articleEl.appendChild(emptyParagraph());
      }
      if (onRender) {
        try { onRender(articleEl); } catch (_) { /* ignore */ }
      }
      wrapBlocks();
      syncAllEmpty();
    }

    // ── Serialize + dirty detection ──────────────────────────────────
    function refreshDraft() {
      syncAllEmpty();
      draftMarkdown = serializeDocument(articleEl);
      var normalizedSaved = normalizeMarkdown(savedMarkdown);
      var normalizedDraft = normalizeMarkdown(draftMarkdown);
      var isDirtyNow = normalizedSaved !== normalizedDraft;
      if (isDirtyNow !== wasDirty) {
        wasDirty = isDirtyNow;
        if (onDirtyChange) {
          try { onDirtyChange(isDirtyNow); } catch (_) { /* ignore */ }
        }
      }
    }

    function updateToolbar() {
      if (!toolbarEl) return;
      var headingLabelEl = toolbarEl.querySelector('[data-sh-editor-heading-label]');
      updateToolbarState(articleEl, toolbarEl, headingLabelEl);
    }

    function runCommand(op, arg) {
      if (!canEdit) return;
      var body = blockBodyEl(selectedBlock) || articleEl.querySelector('[data-sh-skill-block-body]');
      if (body) body.focus();
      switch (op) {
        case 'bold':   wrapCurrentInline(articleEl, 'strong'); break;
        case 'italic': wrapCurrentInline(articleEl, 'em'); break;
        case 'code':   insertCodeBlock(articleEl); break;
        case 'heading':
          if (arg === 'p' || arg === 'h1' || arg === 'h2' || arg === 'h3') {
            if (selectedBlock) convertBlock(selectedBlock, arg, false);
          }
          break;
        case 'ul':
          if (selectedBlock) convertBlock(selectedBlock, 'ul', false);
          break;
        case 'ol':     toggleList(articleEl, 'ol'); break;
        case 'quote':  transformBlockTag(articleEl, 'blockquote'); break;
        case 'hr':
          if (selectedBlock) convertBlock(selectedBlock, 'hr', false);
          break;
        case 'link':
          var url = global.prompt ? global.prompt('Link URL', 'https://') : '';
          if (url) insertLink(articleEl, url);
          break;
        case 'image':
          var src = global.prompt ? global.prompt('Image URL', 'https://') : '';
          if (src) {
            var alt = global.prompt ? global.prompt('Alt text', '') : '';
            insertImage(articleEl, src, alt);
          }
          break;
        case 'table':  insertTable(articleEl); break;
      }
      refreshDraft();
      updateToolbar();
    }

    function runHistory(op) {
      if (!canEdit) return;
      try {
        if (op === 'undo') document.execCommand('undo');
        else if (op === 'redo') document.execCommand('redo');
      } catch (_) { /* ignore */ }
      refreshDraft();
      updateToolbar();
    }

    if (toolbarEl) {
      toolbarEl.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-sh-editor-cmd], [data-sh-editor-history]') : null;
        if (!btn) return;
        e.preventDefault();
        var cmd = btn.getAttribute('data-sh-editor-cmd');
        var hist = btn.getAttribute('data-sh-editor-history');
        if (cmd) {
          var arg = btn.getAttribute('data-sh-editor-arg');
          runCommand(cmd, arg);
          var wrap = btn.closest ? btn.closest('.slds-dropdown-trigger') : null;
          if (wrap && wrap.classList.contains('slds-is-open')) {
            wrap.classList.remove('slds-is-open');
            var trigger = wrap.querySelector('[aria-haspopup="menu"]');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
          }
        } else if (hist) {
          runHistory(hist);
        }
      });
    }

    // ── Block interaction ──────────────────────────────────────────
    articleEl.addEventListener('click', function (e) {
      if (!canEdit) return;
      var checkBox = e.target && e.target.closest ? e.target.closest('.seller-home__skill-check-box') : null;
      if (checkBox && articleEl.contains(checkBox)) {
        var checkItem = checkBox.closest('.seller-home__skill-check-item');
        if (checkItem) {
          e.preventDefault();
          var on = checkItem.getAttribute('data-checked') === 'true';
          checkItem.setAttribute('data-checked', on ? 'false' : 'true');
          refreshDraft();
        }
        return;
      }
      var chip = e.target && e.target.closest ? e.target.closest('a.seller-home__skill-chip, li.seller-home__skill-tool-bullet') : null;
      if (chip && articleEl.contains(chip) && chip.getAttribute('contenteditable') === 'false') {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        placeCaretAfter(chip);
        return;
      }
      var chipRow = e.target && e.target.closest ? e.target.closest('.seller-home__skill-chip-row, ul.seller-home__skill-tool-row') : null;
      if (chipRow && articleEl.contains(chipRow) && e.target === chipRow) {
        e.preventDefault();
        placeCaretAtEnd(chipRow);
        return;
      }
      var plusBtn = e.target && e.target.closest ? e.target.closest('[data-sh-skill-block-plus]') : null;
      if (plusBtn && articleEl.contains(plusBtn)) {
        e.preventDefault();
        e.stopPropagation();
        var plusBlock = closestSkillBlock(plusBtn, articleEl);
        if (plusBlock) {
          selectBlock(plusBlock);
          closeMenus();
          openConvertMenu(plusBtn.getBoundingClientRect(), null, true);
        }
        return;
      }
      var grip = e.target && e.target.closest ? e.target.closest('[data-sh-skill-block-grip]') : null;
      if (grip && articleEl.contains(grip)) {
        e.preventDefault();
        e.stopPropagation();
        var block = closestSkillBlock(grip, articleEl);
        if (block) openHandleMenu(block, grip);
        return;
      }
      var ai = e.target && e.target.closest ? e.target.closest('[data-sh-skill-block-ai]') : null;
      if (ai && articleEl.contains(ai)) {
        e.preventDefault();
        var aiBlock = closestSkillBlock(ai, articleEl);
        if (aiBlock) openAiComposer(aiBlock);
        return;
      }
    });

    // In-copy fragment links (e.g. "GTM Profile -> …") are display-only: they
    // carry the text-link styling but must never route or change the URL hash.
    // Capture-phase + always-on so it holds in read-only render too.
    articleEl.addEventListener('click', function (e) {
      var link = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (link && articleEl.contains(link)) e.preventDefault();
    }, true);

    articleEl.addEventListener('focusin', function (e) {
      if (!canEdit) return;
      var block = closestSkillBlock(e.target, articleEl);
      focusBlock(block);
    });

    articleEl.addEventListener('focusout', function (e) {
      var block = closestSkillBlock(e.target, articleEl);
      if (!block) return;
      if (e.relatedTarget && block.contains(e.relatedTarget)) return;
      block.classList.remove('is-focused');
    });

    articleEl.addEventListener('keydown', function (e) {
      if (!canEdit) return;
      var block = closestSkillBlock(e.target, articleEl);
      if (!block) return;
      var body = blockBodyEl(block, e.target);

      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        setTimeout(function () {
          refreshDraft();
          updateToolbar();
          syncAllEmpty();
        }, 0);
      }

      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        var atomic = e.key === 'Backspace' ? atomicBeforeCaret() : atomicAfterCaret();
        if (atomic && articleEl.contains(atomic)) {
          e.preventDefault();
          deleteAtomicNode(atomic);
          refreshDraft();
          updateToolbar();
          if (block) syncBlockEmpty(block);
          return;
        }
      }

      if (e.key === 'Escape' || e.key === 'Esc') {
        if (mentionOpen()) { closeMentionMenu(); return; }
        closeMenus();
        return;
      }

      // While the @-mention menu is open, arrows move the highlight and
      // Enter/Tab inserts the highlighted resource.
      if (mentionOpen()) {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveMentionActive(1); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); moveMentionActive(-1); return; }
        if (e.key === 'Enter' || e.key === 'Tab') {
          var active = mentionHost.querySelector('.is-active');
          if (active) { e.preventDefault(); insertMention(active); return; }
        }
      }

      if (e.key === '/' && body && isBodyEmpty(body) && body.tagName !== 'HR') {
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        if (body && (body.tagName === 'UL' || body.tagName === 'OL')) {
          var li = e.target;
          while (li && li !== body && li.tagName !== 'LI') li = li.parentNode;
          if (li && li.tagName === 'LI' && isBodyEmpty(li)) {
            e.preventDefault();
            exitEmptyListItem(block, li);
          }
          return;
        }
        e.preventDefault();
        splitAtCaret(block);
        return;
      }

      if (e.key === 'Backspace' && body && isCaretAtStart(body)) {
        e.preventDefault();
        mergeWithPrev(block);
      }
    }, true);

    articleEl.addEventListener('input', function (e) {
      refreshDraft();
      updateToolbar();
      updateInlineToolbar();
      if (!canEdit) return;
      var block = closestSkillBlock(e.target, articleEl);
      if (!block) return;
      var body = blockBodyEl(block);
      if (!body) return;

      // @-mention: typing "@…" anywhere in a block body opens the resource
      // picker. This is checked before the slash menu since the two are
      // mutually exclusive (slash requires the block to start with "/").
      if (mentionGroups.length) {
        var mctx = getMentionContext(body);
        if (mctx) {
          openMentionMenu(mctx);
          return;
        }
        if (mentionOpen()) closeMentionMenu();
      }

      var text = String(body.textContent || '');
      if (text.charAt(0) === '/' && body.tagName !== 'UL' && body.tagName !== 'OL' && body.tagName !== 'HR') {
        var query = text.charAt(1) === ' ' ? '' : text.slice(1).split(/\s/)[0];
        if (!/\s/.test(text.slice(1)) || text === '/') {
          openConvertMenu(block.getBoundingClientRect(), query.replace(/^\//, ''));
          convertHost.setAttribute('data-slash', '');
        } else {
          if (convertHost) convertHost.hidden = true;
        }
      } else if (convertHost && convertHost.hasAttribute('data-slash')) {
        convertHost.hidden = true;
        convertHost.removeAttribute('data-slash');
      }
    });

    function updateToolbars() { updateToolbar(); updateInlineToolbar(); }
    articleEl.addEventListener('keyup', updateToolbars);
    articleEl.addEventListener('mouseup', updateToolbars);
    articleEl.addEventListener('focus', updateToolbar);

    document.addEventListener('mousedown', function (e) {
      var t = e.target;
      // Dismiss the inline toolbar when the click lands outside both the bar
      // and the editor (a fresh in-editor selection recomputes on mouseup).
      if (inlineHost && !inlineHost.hidden && !inlineHost.contains(t) && !articleEl.contains(t)) {
        hideInline();
      }
      // Dismiss the @-mention menu on any click outside it (in-editor clicks
      // reposition the caret, which the next input event re-evaluates).
      if (mentionOpen() && !mentionHost.contains(t)) {
        closeMentionMenu();
      }
      var inSelected = selectedBlock && t && selectedBlock.contains(t);
      var inMenu = (menuHost && menuHost.contains(t)) || (convertHost && convertHost.contains(t));
      var inInline = inlineHost && inlineHost.contains(t);
      var inMention = mentionHost && mentionHost.contains(t);
      var inComposer = aiComposerEl && aiComposerEl.contains(t);
      // Keep the block highlighted while its composer is open so the
      // draft target stays obvious.
      if (selectedBlock && !inSelected && !inMenu && !inInline && !inMention && !inComposer && !aiComposerIsOpen()) {
        clearSelection();
      }
      if (!menuHost && !convertHost) return;
      if (menuHost && menuHost.contains(t)) return;
      if (convertHost && convertHost.contains(t)) return;
      if (t && t.closest && t.closest('[data-sh-skill-block-grip]')) return;
      if (t && t.closest && t.closest('[data-sh-skill-block-plus]')) return;
      closeMenus();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (mentionOpen()) closeMentionMenu();
      if ((menuHost && !menuHost.hidden) || (convertHost && !convertHost.hidden)) {
        closeMenus();
      }
      if (inlineHost && !inlineHost.hidden) hideInline();
    });

    // ── Paste sanitizer ──────────────────────────────────────────────
    articleEl.addEventListener('paste', function (e) {
      if (!canEdit) return;
      if (!e.clipboardData) return;
      e.preventDefault();
      var html = e.clipboardData.getData('text/html');
      var text = e.clipboardData.getData('text/plain');
      var frag;
      if (html) {
        var wrap = sanitizeFragment(html);
        frag = document.createDocumentFragment();
        while (wrap.firstChild) frag.appendChild(wrap.firstChild);
      } else {
        frag = document.createDocumentFragment();
        var lines = String(text || '').split(/\r?\n/);
        lines.forEach(function (line, idx) {
          if (idx > 0) frag.appendChild(document.createElement('br'));
          frag.appendChild(document.createTextNode(line));
        });
      }
      var sel = getSelection();
      if (!sel) return;
      var range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(frag);
      range.collapse(false);
      refreshDraft();
      updateToolbar();
    });

    // ── Apply canEdit at boot ────────────────────────────────────────
    articleEl.setAttribute('contenteditable', 'false');
    if (canEdit) {
      articleEl.classList.add('seller-home__skill-canvas-doc_blocks');
    } else {
      if (toolbarEl) {
        toolbarEl.setAttribute('hidden', '');
        toArray(toolbarEl.querySelectorAll('button')).forEach(function (b) {
          b.setAttribute('disabled', 'true');
        });
      }
      if (rootEl) rootEl.classList.add('is-readonly');
    }

    paint(initial);
    draftMarkdown = serializeDocument(articleEl);
    wasDirty = false;
    updateToolbar();

    function focusDoc() {
      if (!canEdit) return;
      var first = articleEl.querySelector('[data-sh-skill-block-body][contenteditable="true"]');
      if (first) {
        if (isBodyEmpty(first)) placeCaretAtStart(first);
        else placeCaretAtEnd(first);
        var block = closestSkillBlock(first, articleEl);
        if (block) focusBlock(block);
      }
    }

    // ── Public API ───────────────────────────────────────────────────
    return {
      getMarkdown:      function () { return draftMarkdown; },
      getSavedMarkdown: function () { return savedMarkdown; },
      isDirty:          function () { return wasDirty; },
      focus:            focusDoc,
      setMarkdown: function (md) {
        savedMarkdown = String(md || '');
        paint(savedMarkdown);
        draftMarkdown = serializeDocument(articleEl);
        wasDirty = false;
        if (onDirtyChange) { try { onDirtyChange(false); } catch (_) {} }
        updateToolbar();
      },
      setDraft: function (md) {
        paint(String(md || ''));
        refreshDraft();
        updateToolbar();
      },
      // Insert a lightly-styled conditional block (If / Else If / Else)
      // after the current block. Modeled as a blockquote whose first
      // word is a bold branch label, so it round-trips to Markdown as
      // `> **If** <condition>` with no special syntax.
      insertConditional: function (kind, condition) {
        if (!canEdit) return null;
        var label = kind === 'elseif'
          ? t('elseIf', 'Else If')
          : (kind === 'else' ? t('else', 'Else') : t('if', 'If'));
        var p = document.createElement('p');
        var strong = document.createElement('strong');
        strong.textContent = label;
        p.appendChild(strong);
        var cond = String(condition || '').trim();
        if (cond) p.appendChild(document.createTextNode(' ' + cond));
        if (!p.firstChild) p.appendChild(document.createElement('br'));
        var frag = document.createDocumentFragment();
        frag.appendChild(p);
        var target = selectedBlock;
        if (!target) {
          var blocks = articleEl.querySelectorAll('[data-sh-skill-block]');
          target = blocks.length ? blocks[blocks.length - 1] : null;
        }
        var wrap = insertBlockAfter(target, 'blockquote', frag);
        selectBlock(wrap);
        return wrap;
      },
      snapshot: function () {
        savedMarkdown = draftMarkdown;
        if (wasDirty) {
          wasDirty = false;
          if (onDirtyChange) { try { onDirtyChange(false); } catch (_) {} }
        }
      },
      save: function () {
        savedMarkdown = draftMarkdown;
        if (wasDirty) {
          wasDirty = false;
          if (onDirtyChange) { try { onDirtyChange(false); } catch (_) {} }
        }
        if (onSave) { try { onSave(savedMarkdown); } catch (_) {} }
      },
      cancel: function () {
        paint(savedMarkdown);
        draftMarkdown = serializeDocument(articleEl);
        if (wasDirty) {
          wasDirty = false;
          if (onDirtyChange) { try { onDirtyChange(false); } catch (_) {} }
        }
        if (onCancel) { try { onCancel(); } catch (_) {} }
      },
      render: function () {
        paint(draftMarkdown);
      },
      serialize: function () { return serializeDocument(articleEl); }
    };
  }

  // ── Exports ────────────────────────────────────────────────────────
  global.SkillMarkdownEditor = {
    create:             create,
    renderMarkdown:     renderMarkdown,
    serializeDocument:  serializeDocument,
    normalizeMarkdown:  normalizeMarkdown,
    sanitizeFragment:   sanitizeFragment
  };
}(window));
