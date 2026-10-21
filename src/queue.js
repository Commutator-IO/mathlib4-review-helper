// The queue: filters, and each PR's review progress read from this browser.
(function () {
  'use strict';
  var repo = document.querySelector('main').dataset.repo;
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var q = document.getElementById('q');
  var topic = document.getElementById('topic');
  var hideDone = document.getElementById('hide-done');
  var prefs = MRH.get('mrh:queue') || {};

  cards.forEach(function (c) {
    var st = MRH.get(MRH.key(repo, c.dataset.pr));
    var total = +c.dataset.decls;
    if (!st || !st.marks) return;
    var marked = Object.keys(st.marks).filter(function (k) { return st.marks[k].v; }).length;
    if (!marked && !(st.comments || []).length) return;
    var p = c.querySelector('.progress');
    p.hidden = false;
    p.textContent = 'you: ' + Math.min(marked, total) + '/' + total + ' checked' + (st.head && st.head !== c.dataset.head ? ' (PR updated since)' : '');
    if (total && marked >= total) c.classList.add('done');
  });

  function apply() {
    var text = q.value.trim().toLowerCase();
    var t = topic.value;
    cards.forEach(function (c) {
      var show = (!text || c.textContent.toLowerCase().indexOf(text) >= 0) &&
        (!t || c.dataset.topic.split(' ').indexOf(t) >= 0) &&
        !(hideDone.checked && c.classList.contains('done'));
      c.hidden = !show;
    });
    document.querySelectorAll('.bucket').forEach(function (b) {
      var n = b.querySelectorAll('.card:not([hidden])').length;
      b.hidden = !n;
      b.querySelector('.count').textContent = n;
    });
    MRH.set('mrh:queue', { topic: t, hideDone: hideDone.checked });
  }
  topic.value = prefs.topic || '';
  hideDone.checked = !!prefs.hideDone;
  [q, topic, hideDone].forEach(function (el) { el.addEventListener('input', apply); });
  apply();
})();
