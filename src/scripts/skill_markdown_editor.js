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
//     article,            // contenteditable target
//     toolbar,            // toolbar element containing data-sh-editor-*
//     initialMarkdown,    // saved baseline (string)
//     canEdit,            // boolean
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
      out.push('<' + list + '>' + items.map(function (it) {
        return '<li>' + renderInline(it) + '</li>';
      }).join('') + '</' + list + '>');
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
        return lis.map(function (li) {
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
        if (n.nodeType === 1) return serializeBlock(n);
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

  // ── Factory ────────────────────────────────────────────────────────
  function create(options) {
    if (!options) return null;
    var rootEl        = options.root;
    var articleEl     = options.article;
    var toolbarEl     = options.toolbar || null;
    var canEdit       = options.canEdit !== false;
    var initial       = String(options.initialMarkdown || '');
    var onDirtyChange = typeof options.onDirtyChange === 'function' ? options.onDirtyChange : null;
    var onRender      = typeof options.onRender      === 'function' ? options.onRender      : null;
    var onSave        = typeof options.onSave        === 'function' ? options.onSave        : null;
    var onCancel      = typeof options.onCancel      === 'function' ? options.onCancel      : null;
    if (!articleEl) return null;

    var savedMarkdown = initial;
    var draftMarkdown = initial;
    var wasDirty = false;

    // ── Initial paint ────────────────────────────────────────────────
    function paint(md) {
      articleEl.innerHTML = renderMarkdown(md);
      if (onRender) {
        try { onRender(articleEl); } catch (_) { /* ignore */ }
      }
    }

    // ── Serialize + dirty detection ──────────────────────────────────
    function refreshDraft() {
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

    // ── Toolbar handlers ─────────────────────────────────────────────
    function runCommand(op, arg) {
      if (!canEdit) return;
      articleEl.focus();
      switch (op) {
        case 'bold':   wrapCurrentInline(articleEl, 'strong'); break;
        case 'italic': wrapCurrentInline(articleEl, 'em'); break;
        case 'code':   insertCodeBlock(articleEl); break;
        case 'heading':
          if (arg === 'p')  transformBlockToTag(articleEl, 'p');
          if (arg === 'h1') transformBlockToTag(articleEl, 'h1');
          if (arg === 'h2') transformBlockToTag(articleEl, 'h2');
          if (arg === 'h3') transformBlockToTag(articleEl, 'h3');
          break;
        case 'ul':     toggleList(articleEl, 'ul'); break;
        case 'ol':     toggleList(articleEl, 'ol'); break;
        case 'quote':  transformBlockToTag(articleEl, 'blockquote'); break;
        case 'hr':     insertHorizontalRule(articleEl); break;
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

    // Alias so both call sites read cleanly.
    function transformBlockToTag(articleEl, tag) { transformBlockTag(articleEl, tag); }

    function runHistory(op) {
      if (!canEdit) return;
      articleEl.focus();
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
          // Close the heading dropdown if it was open.
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

    // ── Content edit listener ────────────────────────────────────────
    articleEl.addEventListener('input', function () {
      refreshDraft();
      updateToolbar();
    });
    articleEl.addEventListener('keyup', updateToolbar);
    articleEl.addEventListener('mouseup', updateToolbar);
    articleEl.addEventListener('focus', updateToolbar);

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
    if (canEdit) {
      articleEl.setAttribute('contenteditable', 'true');
    } else {
      articleEl.setAttribute('contenteditable', 'false');
      if (toolbarEl) {
        toolbarEl.setAttribute('hidden', '');
        toArray(toolbarEl.querySelectorAll('button')).forEach(function (b) {
          b.setAttribute('disabled', 'true');
        });
      }
      // Hide any toolbar-adjacent affordances the host injected.
      if (rootEl) rootEl.classList.add('is-readonly');
    }

    paint(initial);
    // Compute an initial draft = normalized version of the saved MD
    // so a load without user changes never fires `onDirtyChange(true)`.
    draftMarkdown = serializeDocument(articleEl);
    wasDirty = false;
    updateToolbar();

    // ── Public API ───────────────────────────────────────────────────
    return {
      getMarkdown:      function () { return draftMarkdown; },
      getSavedMarkdown: function () { return savedMarkdown; },
      isDirty:          function () { return wasDirty; },
      focus: function () {
        if (canEdit) placeCaretAtEnd(articleEl);
      },
      setMarkdown: function (md) {
        savedMarkdown = String(md || '');
        paint(savedMarkdown);
        draftMarkdown = serializeDocument(articleEl);
        wasDirty = false;
        if (onDirtyChange) { try { onDirtyChange(false); } catch (_) {} }
        updateToolbar();
      },
      setDraft: function (md) {
        // Rehydrate content from a persisted draft WITHOUT touching
        // the saved baseline (draft-restore path).
        paint(String(md || ''));
        refreshDraft();
        updateToolbar();
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
        // No dirty flip here — we just re-paint the current draft.
      },
      // Expose the serializer for tests / advanced hosts that want to
      // inspect the serialized form without waiting for an input event.
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
