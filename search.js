// 会話内の検索(isolated world)。Alt+S で画面上部に検索バーを出す。
// 読み込まれているメッセージの本文から探し、CSS Custom Highlight API で色を付ける
// (Muse(React)が管理する DOM には要素を足さない)。自分/相手のメッセージだけに絞り込める。
(() => {
  'use strict';
  const M = MuseHelper;
  const BAR = 'muse-helper-search';
  const HL = 'muse-search', HL_CUR = 'muse-search-current';
  const canHighlight = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';

  let hits = []; // [{ range, el }]
  let cur = -1;
  let scope = 'all'; // 'all' | 'user' | 'other'

  const style = document.createElement('style');
  style.textContent = `
    ::highlight(${HL}) { background-color: rgba(237, 161, 0, .35); }
    ::highlight(${HL_CUR}) { background-color: #eda100; color: #000; }
    #${BAR} { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483000; box-sizing: border-box;
      width: min(520px, calc(100vw - 32px)); display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 12px;
      font: 13px/1.4 ${M.FONT}; color: #1a1a19; background: #fff; border: 1px solid rgba(0,0,0,.1);
      border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.18); }
    html.dark #${BAR} { color: #f0efec; background: #262624; border-color: rgba(255,255,255,.1); }
    #${BAR} input { all: unset; flex: 1; min-width: 0; padding: 4px 0; }
    #${BAR} select { font: inherit; color: inherit; background: transparent; border: 1px solid rgba(128,128,128,.35); border-radius: 6px; padding: 2px 4px; }
    html.dark #${BAR} select option { background: #262624; }
    #${BAR} .s-count { min-width: 52px; text-align: right; font-size: 12px; opacity: .65; font-variant-numeric: tabular-nums; }
    #${BAR} button { all: unset; box-sizing: border-box; cursor: pointer; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px; opacity: .7; }
    #${BAR} button:hover { opacity: 1; background: rgba(128,128,128,.15); }
    #${BAR} button:focus-visible, #${BAR} select:focus-visible { outline: 2px solid #2a78d6; }
  `;
  document.documentElement.appendChild(style);

  const bar = () => document.getElementById(BAR);

  const icon = (d) => M.icon(d, { size: 16 });
  function button(label, d, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.appendChild(icon(d));
    b.addEventListener('click', onClick);
    return b;
  }

  function open() {
    let b = bar();
    if (!b) {
      b = document.createElement('div');
      b.id = BAR;
      b.setAttribute('role', 'search');
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '会話内を検索';
      input.setAttribute('aria-label', '会話内を検索');
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', '検索する範囲');
      for (const [v, t] of [['all', 'すべて'], ['user', '自分'], ['other', M.otherName()]]) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        sel.appendChild(o);
      }
      sel.value = scope;
      const count = document.createElement('span');
      count.className = 's-count';
      count.setAttribute('aria-live', 'polite');
      b.append(input, sel, count,
        button('前へ(Shift+Enter)', 'M6 15l6-6 6 6', () => move(-1)),
        button('次へ(Enter)', 'M6 9l6 6 6-6', () => move(1)),
        button('閉じる(Esc)', M.ICON_CROSS, close));
      input.addEventListener('input', () => run(true));
      sel.addEventListener('change', () => { scope = sel.value; run(true); input.focus(); });
      b.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); e.stopPropagation(); move(e.shiftKey ? -1 : 1); }
      });
      document.body.appendChild(b);
    }
    const input = b.querySelector('input');
    // 選択中の文字があれば、それで検索する
    const sel = String(window.getSelection() || '').trim();
    if (sel && sel.length <= 100 && !sel.includes('\n')) input.value = sel;
    input.focus();
    input.select();
    run(true);
  }

  function close() {
    const b = bar();
    if (b) b.remove();
    hits = [];
    cur = -1;
    if (canHighlight) { CSS.highlights.delete(HL); CSS.highlights.delete(HL_CUR); }
  }
  const toggle = () => (bar() && bar().contains(document.activeElement) ? close() : open());

  // 本文の文字(Muse のボタンや Muse Helper の表示は除く)の中から探す
  function find(q) {
    const out = [];
    const needle = q.toLowerCase();
    for (const m of M.messages()) {
      if ((scope === 'user' && !m.user) || (scope === 'other' && m.user)) continue;
      const w = document.createTreeWalker(m.el, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement && n.parentElement.closest(`${M.OWN_IN_MESSAGE}, button, [aria-hidden="true"]`)
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const hay = n.textContent.toLowerCase();
        if (hay.length !== n.textContent.length) continue; // 大文字小文字の変換で長さが変わる特殊な文字は対象外
        for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + needle.length);
          out.push({ range: r, el: m.el });
        }
      }
    }
    return out;
  }

  // reset: 検索語や範囲が変わった(最初の一致へ)。false なら画面の変化に合わせて数え直すだけ
  function run(reset) {
    const b = bar();
    if (!b) return;
    const q = b.querySelector('input').value.trim();
    const prev = hits[cur];
    hits = q ? find(q) : [];
    if (reset) cur = hits.length ? 0 : -1;
    else if (prev) {
      // 同じ場所の一致を選んだままにする
      const i = hits.findIndex((h) => h.range.startContainer === prev.range.startContainer && h.range.startOffset === prev.range.startOffset);
      cur = i >= 0 ? i : Math.min(cur, hits.length - 1);
    }
    paint();
    if (reset && cur >= 0) reveal();
  }

  function move(d) {
    if (!hits.length) return;
    cur = (cur + d + hits.length) % hits.length;
    paint();
    reveal();
  }

  function paint() {
    const b = bar();
    if (b) {
      const q = b.querySelector('input').value.trim();
      b.querySelector('.s-count').textContent = !q ? '' : hits.length ? `${cur + 1} / ${hits.length}` : '0件';
    }
    if (!canHighlight) return;
    CSS.highlights.set(HL, new Highlight(...hits.map((h) => h.range)));
    if (hits[cur]) CSS.highlights.set(HL_CUR, new Highlight(hits[cur].range));
    else CSS.highlights.delete(HL_CUR);
  }

  function reveal() {
    const h = hits[cur];
    if (!h) return;
    if (M.collapse) M.collapse.expand(h.el); // 折りたたまれたメッセージなら開く
    const host = h.range.startContainer.parentElement;
    if (host) host.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!canHighlight) M.scrollToMessage(h.el, 'center');
  }

  // 開いている間に会話が変わったら(返信が届いた・過去のメッセージを読み込んだなど)数え直す
  let timer;
  new MutationObserver((list) => {
    if (!bar() || list.every((m) => m.target.closest && m.target.closest('#' + BAR))) return;
    clearTimeout(timer);
    timer = setTimeout(() => run(false), 400);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  M.search = { open, close, toggle };
})();
