// Muse Helper の表示のツールチップ(isolated world)。
// Chrome 標準のツールチップ(title 属性)は OS のフォントで描かれ、環境によって漢字が中国語の字形になるので、
// Muse Helper が足した要素の title は、マウスを乗せたときに data-muse-tip へ移し、自前の表示で出す。
// - Muse Helper の要素: id が「muse-」で始まるもの、クラスに「muse-」で始まるものがある要素とその中身
// - title は各スクリプトがそのまま設定してよい(マウスを乗せたとき・title が変わったときに移し替える)
// - 読み書きの両方で title を使いたい要素(バッジ)は MuseHelper.tooltip.bind(el) で、title を data-muse-tip のプロパティにする
(() => {
  'use strict';
  const M = MuseHelper;
  const OURS = '[id^="muse-"], [class^="muse-"], [class*=" muse-"]';
  const DELAY = 500;
  const FONT = 'system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif';

  let tip = null; // 表示中のツールチップ
  let target = null; // ツールチップを出す(出している)要素
  let timer = 0;

  const isOurs = (e) => !!(e && e.closest && e.closest(OURS));

  // title を data-muse-tip に移す(Chrome 標準のツールチップを出さないため)
  function adopt(e) {
    if (!e.hasAttribute('title')) return;
    const v = e.getAttribute('title');
    e.removeAttribute('title');
    if (v) e.dataset.museTip = v; else delete e.dataset.museTip;
    if (target === e && tip) tip.textContent = v;
  }

  function hide() {
    clearTimeout(timer);
    if (tip) tip.remove();
    tip = null;
    target = null;
  }

  function show(e) {
    const text = e.dataset.museTip;
    if (!text || !e.isConnected) return;
    if (!tip) {
      tip = document.createElement('div');
      tip.lang = 'ja';
      tip.setAttribute('role', 'tooltip');
      tip.style.cssText = 'position:fixed;z-index:2147483647;max-width:min(360px,calc(100vw - 16px));box-sizing:border-box;' +
        `padding:6px 9px;border-radius:8px;white-space:pre-line;word-break:break-word;pointer-events:none;font:12px/1.5 ${FONT};` +
        'color:#f0efec;background:rgba(20,20,22,.96);border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 20px rgba(0,0,0,.35);';
      document.documentElement.appendChild(tip);
    }
    tip.textContent = text;
    // 要素の下に出す(入らなければ上)。左右は画面内に収める
    const r = e.getBoundingClientRect(), t = tip.getBoundingClientRect();
    const top = r.bottom + 6 + t.height <= window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - 6 - t.height);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - t.width - 8);
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  }

  document.addEventListener('mouseover', (ev) => {
    if (!M.alive()) return;
    const start = ev.target && ev.target.closest ? ev.target : null;
    // マウスの下の要素から上にたどり、説明のある Muse Helper の要素を探す
    let e = start && start.closest('[title], [data-muse-tip]');
    while (e && !isOurs(e)) e = e.parentElement && e.parentElement.closest('[title], [data-muse-tip]');
    if (e) adopt(e);
    if (e === target) return;
    hide();
    if (!e || !e.dataset.museTip) return;
    target = e;
    timer = setTimeout(() => { if (target === e) show(e); }, DELAY);
  }, true);
  document.addEventListener('mouseout', (ev) => {
    if (target && !(ev.relatedTarget && target.contains(ev.relatedTarget))) hide();
  }, true);
  ['pointerdown', 'keydown', 'scroll', 'blur'].forEach((t) => window.addEventListener(t, hide, true));

  // 表示中や、マウスを乗せたままの要素の title が書き換わったら、すぐ移し替える
  new MutationObserver((list) => {
    for (const m of list) if (m.target.nodeType === 1 && m.target.hasAttribute('title') && isOurs(m.target)) adopt(m.target);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['title'], subtree: true });

  // title を読み書きの両方で使う要素用: el.title が data-muse-tip を読み書きするようにする
  function bind(el) {
    Object.defineProperty(el, 'title', {
      configurable: true,
      get: () => el.dataset.museTip || '',
      set: (v) => {
        const s = String(v || '');
        if (s) el.dataset.museTip = s; else delete el.dataset.museTip;
        if (target === el && tip) tip.textContent = s;
      },
    });
  }

  M.tooltip = { bind, hide };
})();
