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

  const pad = (n) => String(n).padStart(2, '0');
  function clock(t, withSec) {
    const sec = withSec ? `:${pad(t.getSeconds())}` : '';
    if (!is12h()) return `${pad(t.getHours())}:${pad(t.getMinutes())}${sec}`;
    const h = t.getHours();
    return `${h % 12 || 12}:${pad(t.getMinutes())}${sec} ${h < 12 ? 'am' : 'pm'}`;
  }
  function format(t) {
    const now = new Date();
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
    const fmt = is12h() ? '12' : '24';
    if (label && label.dataset.iso === iso && label.dataset.fmt === fmt && label.style.textAlign === align) return;
    if (!label) {
      label = document.createElement('div');
      label.className = CLS;
      label.style.cssText =
        'display:block;width:100%;flex:0 0 100%;box-sizing:border-box;padding:2px 8px 0;' +
        'font:11px/1.2 system-ui,sans-serif;opacity:.5;pointer-events:none;';
      el.appendChild(label);
    }
    label.style.textAlign = align;
    label.dataset.iso = iso;
    label.dataset.fmt = fmt;
    label.textContent = format(t);
    label.title = full(t);
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
  new MutationObserver(scan).observe(document.documentElement, { attributes: true, attributeFilter: [FMT_ATTR] });
  scan();
})();
