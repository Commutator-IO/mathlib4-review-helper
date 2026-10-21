/**
 * The review page: a verdict and a note per declaration, comments on a
 * selection of code, keyboard navigation, and the export to one Markdown
 * comment. Nothing leaves the browser until the reader copies the export or
 * opens the prefilled issue; the state is kept in localStorage per PR.
 */
(function () {
  'use strict';
  var main = document.querySelector('main.pr');
  var pr = main.dataset;
  var KEY = MRH.key(pr.repo, pr.pr);
  var state = MRH.get(KEY) || {};
  state.marks = state.marks || {};
  state.comments = state.comments || [];
  var decls = Array.prototype.slice.call(document.querySelectorAll('.decl'));
  var current = -1;

  if (state.head && state.head !== pr.head) {
    var b = document.createElement('p');
    b.className = 'banner';
    b.textContent = 'Your marks were made on revision ' + state.head.slice(0, 7) + '; the PR has moved to ' +
      pr.head.slice(0, 7) + ' since. Line numbers in your comments refer to the older revision.';
    document.querySelector('.pr-head').after(b);
  }

  function save() {
    state.head = state.head || pr.head;
    MRH.set(KEY, state);
  }

  var permalink = function (file, a, b) {
    return 'https://github.com/' + pr.repo + '/blob/' + (state.head || pr.head) + '/' + file + '#L' + a + (b && b !== a ? '-L' + b : '');
  };
  function esc(s) {
    return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  // -------------------------------------------------------------------------
  // Verdicts and notes

  function render(d) {
    var m = state.marks[d.dataset.key] || {};
    if (m.v) d.dataset.v = m.v; else delete d.dataset.v;
    d.querySelectorAll('.review button').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.v === m.v));
    });
    var ta = d.querySelector('.decl-note');
    if (document.activeElement !== ta) ta.value = m.note || '';
    var li = document.querySelector('.toc li[data-key="' + CSS.escape(d.dataset.key) + '"]');
    if (li) { if (m.v) li.dataset.v = m.v; else delete li.dataset.v; }
    var ul = d.querySelector('.line-comments');
    ul.innerHTML = '';
    d.querySelectorAll('.ln.commented').forEach(function (l) { l.classList.remove('commented'); });
    state.comments.forEach(function (c, i) {
      if (c.decl !== d.dataset.key) return;
      var item = document.createElement('li');
      item.innerHTML = '<a href="' + permalink(c.file, c.from, c.to) + '">L' + c.from + (c.to !== c.from ? '–' + c.to : '') +
        '</a> <button type="button" title="Delete this comment">✕</button><pre>' + esc(c.quote) + '</pre>' + esc(c.text);
      item.querySelector('button').onclick = function () { state.comments.splice(i, 1); save(); render(d); progress(); };
      ul.appendChild(item);
      d.querySelectorAll('.ln[data-line]').forEach(function (l) {
        var n = +l.dataset.line;
        if (n >= c.from && n <= c.to) l.classList.add('commented');
      });
    });
  }

  function mark(d, v) {
    var m = state.marks[d.dataset.key] || (state.marks[d.dataset.key] = {});
    m.v = m.v === v ? null : v;
    save();
    render(d);
    progress();
  }

  function progress() {
    var n = decls.filter(function (d) { return (state.marks[d.dataset.key] || {}).v; }).length;
    document.querySelector('.bar-progress').textContent = n + '/' + decls.length + ' declarations checked' +
      (state.comments.length ? ' · ' + state.comments.length + ' line comment' + (state.comments.length > 1 ? 's' : '') : '');
  }

  decls.forEach(function (d) {
    d.querySelectorAll('.review button').forEach(function (btn) {
      btn.addEventListener('click', function () { mark(d, btn.dataset.v); });
    });
    d.querySelector('.decl-note').addEventListener('input', function (e) {
      var m = state.marks[d.dataset.key] || (state.marks[d.dataset.key] = {});
      m.note = e.target.value;
      save();
    });
    d.addEventListener('click', function () { current = decls.indexOf(d); focusDecl(false); });
    render(d);
  });
  progress();

  // -------------------------------------------------------------------------
  // Comment on a selection of code

  var pop = null;
  function closePop() { if (pop) pop.remove(); pop = null; }

  function selectionInfo() {
    var sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    var r = sel.getRangeAt(0);
    var el = function (n) { return (n.nodeType === 1 ? n : n.parentElement); };
    var a = el(r.startContainer).closest('.ln');
    var z = el(r.endContainer).closest('.ln');
    var d = el(r.commonAncestorContainer).closest('.decl, .seg');
    if (!a || !z || !d) return null;
    var lines = [];
    for (var l = a; l; l = l.nextElementSibling) {
      if (l.classList.contains('ln')) lines.push(l);
      if (l === z) break;
    }
    var nums = lines.map(function (l) { return +l.dataset.line; }).filter(Boolean);
    if (!nums.length) return null;
    var decl = d.closest('.decl');
    var file = d.closest('.file').querySelector('h2 a').textContent;
    return {
      rect: r.getBoundingClientRect(),
      file: file,
      from: Math.min.apply(null, nums),
      to: Math.max.apply(null, nums),
      quote: sel.toString().replace(/\n{2,}/g, '\n').trim(),
      declEl: decl,
    };
  }

  document.addEventListener('mouseup', function (e) {
    if (pop && pop.contains(e.target)) return;
    setTimeout(function () {
      var info = selectionInfo();
      closePop();
      if (!info) return;
      pop = document.createElement('div');
      pop.className = 'pop btn-only';
      pop.innerHTML = '<button type="button">💬 Comment on L' + info.from + (info.to !== info.from ? '–' + info.to : '') + '</button>';
      place(pop, info.rect);
      pop.querySelector('button').onclick = function () { openForm(info); };
    }, 0);
  });

  function place(el, rect) {
    document.body.appendChild(el);
    el.style.top = window.scrollY + rect.bottom + 6 + 'px';
    el.style.left = Math.max(8, Math.min(window.scrollX + rect.left, window.scrollX + innerWidth - el.offsetWidth - 16)) + 'px';
  }

  function openForm(info) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'pop';
    pop.innerHTML = '<div class="quote"></div><textarea rows="4" placeholder="Your comment"></textarea>' +
      '<div class="row"><button type="button" class="save">Save</button><button type="button" class="issue">Open as issue…</button>' +
      '<button type="button" class="cancel">Cancel</button></div>';
    pop.querySelector('.quote').textContent = info.quote;
    place(pop, info.rect);
    var ta = pop.querySelector('textarea');
    ta.focus();
    var record = function () {
      var c = {
        decl: info.declEl ? info.declEl.dataset.key : null,
        name: info.declEl ? info.declEl.dataset.name : null,
        file: info.file, from: info.from, to: info.to, quote: info.quote, text: ta.value.trim(),
      };
      state.comments.push(c);
      save();
      if (info.declEl) render(info.declEl);
      progress();
      return c;
    };
    pop.querySelector('.save').onclick = function () { if (ta.value.trim()) record(); closePop(); getSelection().removeAllRanges(); };
    pop.querySelector('.issue').onclick = function () {
      var c = ta.value.trim() ? record() : { file: info.file, from: info.from, to: info.to, quote: info.quote, text: '' };
      var title = '#' + pr.pr + ' ' + c.file.split('/').pop() + ' L' + c.from + ': ' + (c.text.split('\n')[0] || 'comment').slice(0, 60);
      var body = 'On ' + pr.url + ' (' + pr.title + ')\n\n' + permalink(c.file, c.from, c.to) + '\n\n' + c.text + '\n';
      window.open('https://github.com/' + pr.issues + '/issues/new?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body), '_blank', 'noopener');
      closePop();
    };
    pop.querySelector('.cancel').onclick = closePop;
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePop();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) pop.querySelector('.save').click();
    });
  }

  // -------------------------------------------------------------------------
  // Export

  function exportText() {
    var groups = { change: [], question: [], ok: [] };
    decls.forEach(function (d) {
      var m = state.marks[d.dataset.key];
      if (!m || (!m.v && !m.note)) return;
      var link = '[L' + d.dataset.from + '](' + permalink(d.dataset.file, +d.dataset.from, +d.dataset.to) + ')';
      var item = '- `' + d.dataset.name + '` (' + link + ')' + (m.note ? ': ' + m.note.trim().replace(/\n/g, '\n  ') : '');
      (groups[m.v || 'question']).push(m.v === 'ok' && !m.note ? '`' + d.dataset.name + '`' : item);
    });
    var out = ['Review notes on ' + pr.head.slice(0, 7) + ':', ''];
    if (groups.change.length) out.push('**Needs change**', '', groups.change.join('\n'), '');
    if (groups.question.length) out.push('**Questions**', '', groups.question.join('\n'), '');
    if (state.comments.length) {
      out.push('**On specific lines**', '');
      state.comments.forEach(function (c) {
        out.push(permalink(c.file, c.from, c.to), '', c.text || '(no comment)', '');
      });
    }
    var ok = groups.ok.filter(function (x) { return x[0] === '`'; });
    var okNotes = groups.ok.filter(function (x) { return x[0] === '-'; });
    if (ok.length || okNotes.length) out.push('**Looks right**' + (ok.length ? ': ' + ok.join(', ') : ''), '');
    if (okNotes.length) out.push(okNotes.join('\n'), '');
    if (out.length === 2) out.push('(Nothing marked yet.)');
    return out.join('\n').trim() + '\n';
  }

  var dlg = document.querySelector('dialog.export');
  function openExport() {
    var text = exportText();
    dlg.querySelector('textarea').value = text;
    dlg.querySelector('.open-pr').href = pr.url + '#issue-comment-box';
    var issue = 'https://github.com/' + pr.issues + '/issues/new?title=' + encodeURIComponent('Review of #' + pr.pr + ': ' + pr.title) +
      '&body=' + encodeURIComponent('On ' + pr.url + '\n\n' + text);
    var a = dlg.querySelector('.open-issue');
    a.hidden = issue.length > 7500; // GitHub refuses longer URLs
    a.href = issue;
    dlg.showModal();
  }
  document.querySelector('.export-btn').addEventListener('click', openExport);
  dlg.querySelector('.copy').addEventListener('click', function (e) {
    var ta = dlg.querySelector('textarea');
    var done = function () { e.target.textContent = 'Copied'; setTimeout(function () { e.target.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(done, function () { ta.select(); document.execCommand('copy'); done(); });
    else { ta.select(); document.execCommand('copy'); done(); }
  });

  // -------------------------------------------------------------------------
  // Keyboard

  function focusDecl(scroll) {
    decls.forEach(function (d, i) { d.classList.toggle('current', i === current); });
    if (scroll && decls[current]) decls[current].scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t.closest && t.closest('textarea, input, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (current < 0 && '1230n'.indexOf(e.key) >= 0) {
      // Nothing picked yet: take the first declaration whose top is on screen.
      current = Math.max(0, decls.findIndex(function (x) { return x.getBoundingClientRect().bottom > 90; }));
      focusDecl(false);
    }
    var d = decls[current];
    switch (e.key) {
      case 'j': current = Math.min(decls.length - 1, current + 1); focusDecl(true); break;
      case 'k': current = Math.max(0, current - 1); focusDecl(true); break;
      case '1': if (d) mark(d, 'ok'); break;
      case '2': if (d) mark(d, 'question'); break;
      case '3': if (d) mark(d, 'change'); break;
      case '0': if (d) { (state.marks[d.dataset.key] || {}).v = null; save(); render(d); progress(); } break;
      case 'n': if (d) { e.preventDefault(); d.querySelector('.decl-note').focus(); } break;
      case 'e': openExport(); break;
      case '?': help(); break;
      case 'Escape': closePop(); break;
      default: return;
    }
  });

  function help() {
    var h = document.createElement('div');
    h.className = 'help';
    h.innerHTML = '<div><h2>Keys</h2><p><kbd>j</kbd> / <kbd>k</kbd> next / previous declaration<br><kbd>1</kbd> looks right · <kbd>2</kbd> question · <kbd>3</kbd> needs change · <kbd>0</kbd> clear<br><kbd>n</kbd> write a note · <kbd>e</kbd> export the review<br>Select code to comment on it.</p><p class="small muted">Click anywhere to close.</p></div>';
    h.onclick = function () { h.remove(); };
    document.body.appendChild(h);
  }

  // Follow the reader: the declaration under the top of the screen is the current one.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { current = decls.indexOf(en.target); focusDecl(false); }
      });
    }, { rootMargin: '-90px 0px -70% 0px' });
    decls.forEach(function (d) { io.observe(d); });
  }
})();
