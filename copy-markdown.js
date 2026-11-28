// メッセージの「…」メニュー(と右クリックのメニュー)の「コピー」の下に「Markdownとしてコピー」を足す(isolated world)。
// - Muse の「コピー」は書式を外した文字をコピーするので、こちらは元の文章(**太字** や - 箇条書き などの Markdown)をコピーする
// - 元の文章は React の内部データにあり、isolated world からは読めないので、markdown-main.js(MAIN world)に頼む
// - どのメッセージのメニューかは、メニューを開く直前に押したボタン(または右クリックした場所)から決める
(() => {
  'use strict';
  const M = MuseHelper;
  const ITEM = 'muse-copy-md';
  const MSG = 'muse-helper';

  let lastId = null; // 直前にメニューを開いたメッセージの ID
  let lastAt = 0;

  // 要素から、それが属するメッセージの ID を探す(祖先のうち、メッセージを1件だけ含むもの)
  function messageIdOf(node) {
    const own = node.closest && node.closest('[data-message-id]');
    if (own) return own.getAttribute('data-message-id');
    let n = node;
    for (let i = 0; n && n !== document.body && i < 8; i++, n = n.parentElement) {
      const ms = n.querySelectorAll('[data-message-id]');
      if (ms.length === 1) return ms[0].getAttribute('data-message-id');
      if (ms.length > 1) return null;
    }
    return null;
  }
  const remember = (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || M.isOwn(t)) return;
    if (e.type === 'pointerdown' && !t.closest('button')) return;
    const id = messageIdOf(t);
    if (id) { lastId = id; lastAt = Date.now(); }
  };
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('contextmenu', remember, true);

  // 元の文章を markdown-main.js から受け取る
  function requestMarkdown(id) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, 2000);
      function onMsg(e) {
        const m = e.data;
        if (e.source !== window || !m || m.source !== MSG || m.type !== 'md-response' || m.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(typeof m.text === 'string' ? m.text : null);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: MSG, type: 'md-request', id }, location.origin);
    });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.className = 'muse-copy-md-buffer';
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }

  // 結果を短く知らせる(画面の下の中央)
  function toast(text) {
    const n = document.createElement('div');
    n.className = 'muse-copy-md-toast';
    n.textContent = text;
    n.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483000;padding:6px 12px;' +
      'border-radius:8px;font:13px/1.4 ' + M.FONT + ';color:#fff;background:rgba(30,30,30,.92);pointer-events:none;';
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 2000);
  }

  // メニューを閉じる(Radix のメニューは Escape で閉じる)
  function closeMenu(menu) {
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  }

  // 開いたメニューに「コピー」があれば、その下に足す
  function addItem(menu) {
    if (menu.querySelector('.' + ITEM)) return;
    if (!lastId || Date.now() - lastAt > 2000) return;
    const copy = [...menu.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === 'コピー');
    if (!copy) return;
    const id = lastId;
    const item = copy.cloneNode(true);
    item.classList.add(ITEM);
    item.removeAttribute('id');
    item.removeAttribute('data-highlighted');
    item.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    const label = [...item.querySelectorAll('div, span')].find((n) => n.children.length === 0 && n.textContent.trim() === 'コピー');
    if (label) label.textContent = 'Markdownとしてコピー';
    item.title = '**太字** や箇条書きなどの書式を、記号のままコピーします';
    const run = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = await requestMarkdown(id);
      if (text == null) {
        toast('元の文章を読み取れませんでした');
      } else {
        toast((await copyText(text)) ? 'Markdown としてコピーしました' : 'コピーできませんでした');
      }
      closeMenu(menu);
    };
    item.addEventListener('click', run);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') run(e);
    });
    // Radix のメニューは、項目の上にマウスが乗るとそこにフォーカスを移す。複製した項目は Radix の管理外なので自分で
    item.addEventListener('pointermove', () => { if (document.activeElement !== item) item.focus({ preventScroll: true }); });
    // 矢印キーでの移動: Radix は自分の項目の一覧だけで移動先を決めるので、複製した項目へ(から)の移動はこちらで行う。
    // メニューの要素で capture するので、Radix の処理(document で動く React の bubble)より先に動き、止められる
    menu.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...menu.querySelectorAll('[role="menuitem"]:not([data-disabled])')];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      const to = items[e.key === 'ArrowDown' ? i + 1 : i - 1];
      if (items[i] !== item && to !== item) return; // 複製した項目に関係しない移動は Radix に任せる
      e.preventDefault();
      e.stopPropagation();
      if (to) to.focus({ preventScroll: true });
    }, true);
    copy.after(item);
  }

  // メニューは body の直下(portal)に出る
  new MutationObserver((list) => {
    if (!M.alive()) return;
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue;
        const menus = n.matches('[role="menu"]') ? [n] : [...n.querySelectorAll('[role="menu"]')];
        // 項目があとから足されるときのため、メニューの中に足された要素からもメニューを探す
        const inside = n.parentElement && n.parentElement.closest('[role="menu"]');
        if (inside) menus.push(inside);
        menus.forEach(addItem);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
