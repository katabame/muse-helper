// Muse Helper の表示のツールチップ(isolated world)。
// Chrome 標準のツールチップ(title 属性)は OS のフォントで描かれ、環境によって漢字が中国語の字形になるので、
// Muse Helper が足した要素の title は、マウスを乗せたときに data-muse-tip へ移し、自前の表示で出す。
// - Muse Helper の要素: id が「muse-」で始まるもの、クラスに「muse-」で始まるものがある要素とその中身
// - title は各スクリプトがそのまま設定してよい(マウスを乗せたとき・title が変わったときに移し替える)
// - 読み書きの両方で title を使いたい要素(バッジ)は MuseHelper.tooltip.bind(el) で、title を data-muse-tip のプロパティにする
(() => {
  'use strict';
  const M = MuseHelper;
  const OURS = M.OWN;
  const DELAY = 500;
  const FONT = M.FONT;

  let tip = null; // 表示中のツールチップ
  let target = null; // ツールチップを出す(出している)要素
  let timer = 0;
  let pressed = false; // マウスのボタンを押している間(ドラッグ中など)は出さない

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

  // Muse の要素に説明を足す仕組み: provide(セレクター, 要素 → 説明) で登録する。
  // 説明は文字列、または { big: 大きく出す文字, text: その下の文字 }、またはそれを返す関数(表示する時点で呼ぶ)
  const providers = [];
  // opts.delay: 表示までの時間(ms。既定 500)
  function provide(selector, fn, opts) {
    providers.push({ selector, fn, delay: (opts && opts.delay) || DELAY });
  }

  // content: 文字列、または { big, text }(省略時は data-muse-tip)
  function show(e, content) {
    const c = typeof content === 'function' ? content() : content || e.dataset.museTip;
    if (!c || !e.isConnected) return;
    if (!tip) {
      tip = document.createElement('div');
      tip.lang = 'ja';
      tip.setAttribute('role', 'tooltip');
      tip.style.cssText = 'position:fixed;z-index:2147483647;max-width:min(360px,calc(100vw - 16px));box-sizing:border-box;' +
        `padding:6px 9px;border-radius:8px;white-space:pre-line;word-break:break-word;pointer-events:none;font:12px/1.5 ${FONT};` +
        'color:#f0efec;background:rgba(20,20,22,.96);border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 20px rgba(0,0,0,.35);';
      document.documentElement.appendChild(tip);
    }
    if (typeof c === 'string') {
      tip.textContent = c;
    } else {
      tip.textContent = '';
      if (c.big) {
        const big = document.createElement('div');
        big.textContent = c.big;
        big.style.cssText = 'font-size:40px;line-height:1.15;text-align:center;margin:2px 0 4px;';
        tip.appendChild(big);
      }
      if (c.text) tip.appendChild(document.createTextNode(c.text));
    }
    // 要素の下に出す(入らなければ上)。左右は画面内に収める
    const r = e.getBoundingClientRect(), t = tip.getBoundingClientRect();
    const top = r.bottom + 6 + t.height <= window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - 6 - t.height);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - t.width - 8);
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  }

  document.addEventListener('mouseover', (ev) => {
    if (!M.alive()) return;
    // ドラッグ中(バッジを動かしている間など)は、要素がマウスについて動くので mouseover が起き続ける。出さない
    if (pressed || ev.buttons) { hide(); return; }
    const start = ev.target && ev.target.closest ? ev.target : null;
    // マウスの下の要素から上にたどり、説明のある Muse Helper の要素を探す
    let e = start && start.closest('[title], [data-muse-tip]');
    while (e && !isOurs(e)) e = e.parentElement && e.parentElement.closest('[title], [data-muse-tip]');
    if (e) adopt(e);
    // Muse Helper の説明がなければ、登録された Muse の要素の説明を探す
    let content = null, delay = DELAY;
    if (!e && start) {
      for (const p of providers) {
        const hit = start.closest(p.selector);
        if (!hit) continue;
        try { content = p.fn(hit); } catch (err) { content = null; }
        if (content) { e = hit; delay = p.delay; break; }
      }
    }
    if (e === target) return;
    hide();
    if (!e || !(content || e.dataset.museTip)) return;
    target = e;
    timer = setTimeout(() => { if (target === e && !pressed) show(e, content); }, delay);
  }, true);
  document.addEventListener('mouseout', (ev) => {
    if (target && !(ev.relatedTarget && target.contains(ev.relatedTarget))) hide();
  }, true);
  window.addEventListener('pointerdown', () => { pressed = true; hide(); }, true);
  ['pointerup', 'pointercancel'].forEach((t) => window.addEventListener(t, () => { pressed = false; }, true));
  // ボタンを離したのがウィンドウの外でも、戻ってきたら押していない状態に戻す
  window.addEventListener('blur', () => { pressed = false; hide(); }, true);
  ['keydown', 'scroll'].forEach((t) => window.addEventListener(t, hide, true));

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

  M.tooltip = { bind, hide, provide };
})();
