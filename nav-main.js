// ページ側(MAIN world)で動作: 再読み込みせずに別の会話へ移動する。
// Muse は Next.js(App Router)なので、window.next.router.push で画面を切り替えられる。
// isolated world(bookmarks.js)から window.postMessage({ source: 'muse-helper', type: 'navigate', id, path }) で呼ばれ、
// 結果を { type: 'navigate-result', id, ok } で返す(ok が false なら呼び出し側で通常の読み込みに切り替える)。
(() => {
  'use strict';
  if (window.__museNavInstalled) return;
  window.__museNavInstalled = true;
  const MSG = 'muse-helper';

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== MSG || m.type !== 'navigate' || typeof m.path !== 'string' || !m.path.startsWith('/')) return;
    let ok = false;
    try {
      const r = window.next && window.next.router;
      if (r && typeof r.push === 'function') {
        r.push(m.path);
        ok = true;
      }
    } catch (err) {}
    window.postMessage({ source: MSG, type: 'navigate-result', id: m.id, ok }, location.origin);
  });
})();
