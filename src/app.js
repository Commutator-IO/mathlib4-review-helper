// Shared by every page: the light/dark toggle, and safe localStorage access.
(function () {
  'use strict';
  var store = (window.MRH = {
    get: function (k) {
      try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: marks last for this visit only */ }
    },
    key: function (repo, n) { return 'mrh:' + repo + '#' + n; },
  });
  var root = document.documentElement;
  var theme = store.get('mrh:theme');
  if (theme) root.dataset.theme = theme;
  var btn = document.querySelector('.theme');
  if (btn) btn.addEventListener('click', function () {
    var dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('mrh:theme', root.dataset.theme);
  });
})();
