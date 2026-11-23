// ページ側(MAIN world)で動作: Reactの内部データから各メッセージの createdAt を読み、時刻ラベルを付ける。
(() => {
  'use strict';
  if (window.__museTsInstalled) return;
  window.__museTsInstalled = true;

  const CLS = 'muse-ts-label';

  function findCreatedAt(el) {
    const id = el.getAttribute('data-message-id');
    const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (!id || !fk) return null;
    let f = el[fk];
    for (let d = 0; f && d < 8; d++, f = f.return) {
      let h = f.memoizedState;
      for (let i = 0; h && typeof h === 'object' && i < 40; i++, h = h.next) {
        const s = h.memoizedState;
        const cands = [s, s && s.current, s && s.current && s.current.value];
        for (const c of cands) {
          if (c && typeof c === 'object' && c.createdAt != null && (c.id === id || c.messageId === id)) {
            const t = new Date(c.createdAt);
            if (!isNaN(t)) return t;
          }
        }
      }
    }
    return null;
  }

  // 表示形式: content.js が <html data-muse-ts-format="12|24"> に設定する(既定は24時間)
  const FMT_ATTR = 'data-muse-ts-format';
  const is12h = () => document.documentElement.getAttribute(FMT_ATTR) === '12';
  // 表示内容: <html data-muse-ts-mode="abs|rel|both">(時刻のみ / 相対時刻のみ / 両方。既定は時刻のみ)
  const MODE_ATTR = 'data-muse-ts-mode';
  const mode = () => {
    const v = document.documentElement.getAttribute(MODE_ATTR);
    return v === 'rel' || v === 'both' ? v : 'abs';
  };
  const REL_LIMIT = 7 * 24 * 60 * 60 * 1000; // 「相対時刻のみ」でも、これより前は日付と時刻で表示

  const pad = (n) => String(n).padStart(2, '0');
  function clock(t, withSec) {
    const sec = withSec ? `:${pad(t.getSeconds())}` : '';
    if (!is12h()) return `${pad(t.getHours())}:${pad(t.getMinutes())}${sec}`;
    const h = t.getHours();
    return `${h % 12 || 12}:${pad(t.getMinutes())}${sec} ${h < 12 ? 'am' : 'pm'}`;
  }
  function relative(t, now) {
    const m = Math.floor((now - t) / 60000);
    if (m < 1) return 'たった今';
    if (m < 60) return `${m}分前`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}時間前` : `${Math.floor(h / 24)}日前`;
  }
  function format(t) {
    const now = new Date();
    const md = mode();
    if (md === 'rel' && now - t < REL_LIMIT) return relative(t, now);
    const abs = absolute(t, now);
    return md === 'both' ? `${abs}・${relative(t, now)}` : abs;
  }
  function absolute(t, now) {
    const hm = clock(t, false);
    if (t.toDateString() === now.toDateString()) return hm;
    const md = `${t.getMonth() + 1}/${t.getDate()}`;
    return t.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${t.getFullYear()}/${md} ${hm}`;
  }
  function full(t) {
    return `${t.getFullYear()}/${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${clock(t, true)}`;
  }

  function decorate(el) {
    const t = findCreatedAt(el);
    if (!t) return;
    const iso = t.toISOString();
    // 自分(user)のメッセージは右寄せ、相手(assistant)は左寄せ
    const role = (el.getAttribute('data-message-role') || '').toLowerCase();
    const side = (el.getAttribute('data-message-side') || '').toLowerCase();
    const right = role === 'user' || side === 'right' || side === 'end';
    const align = right ? 'right' : 'left';

    let label = el.querySelector(':scope > .' + CLS);
    const text = format(t);
    if (label && label.dataset.iso === iso && label.textContent === text && label.style.textAlign === align) return;
    if (!label) {
      // 行全体(幅100%)はマウスに反応させず、Muse 側の操作を邪魔しないようにする。
      // 文字の部分(span)だけ反応させて、マウスを乗せると秒までの日時が出るようにする。
      label = document.createElement('div');
      label.className = CLS;
      label.style.cssText =
        'display:block;width:100%;flex:0 0 100%;box-sizing:border-box;padding:2px 8px 0;' +
        'font:11px/1.2 system-ui,sans-serif;opacity:.5;pointer-events:none;';
      const span = document.createElement('span');
      span.style.cssText = 'pointer-events:auto;cursor:default;';
      label.appendChild(span);
      el.appendChild(label);
    }
    const span = textSpan(label);
    label.style.textAlign = align;
    label.dataset.iso = iso;
    span.textContent = text;
    span.title = full(t);
  }

  // ラベル内の文字の span(古い形式のラベルなら作り直す)
  function textSpan(label) {
    let span = label.firstElementChild;
    if (!span) {
      label.textContent = '';
      span = document.createElement('span');
      span.style.cssText = 'pointer-events:auto;cursor:default;';
      label.appendChild(span);
    }
    return span;
  }

  function scan() {
    document.querySelectorAll('[data-message-id]').forEach((el) => {
      try { decorate(el); } catch (e) {}
    });
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 200);
  }).observe(document.documentElement, { childList: true, subtree: true });
  // 表示形式が切り替わったら即座に描き直す
  new MutationObserver(scan).observe(document.documentElement, { attributes: true, attributeFilter: [FMT_ATTR, MODE_ATTR] });
  // 相対時刻(と日付の切り替わり)を反映するため、1分ごとに既存のラベルを書き直す
  setInterval(() => {
    document.querySelectorAll('.' + CLS).forEach((label) => {
      const t = new Date(label.dataset.iso);
      if (isNaN(t)) return;
      const text = format(t);
      if (label.textContent !== text) textSpan(label).textContent = text;
    });
  }, 60000);
  scan();
})();
