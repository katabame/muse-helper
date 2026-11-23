// キーボードショートカット(isolated world)。Alt(Mac は Option)と組み合わせて使う。
// 一覧は common.js の SHORTCUTS。設定でオフにできる(museShortcuts = false)。
(() => {
  'use strict';
  const M = MuseHelper;
  const KEY = M.SHORTCUTS_KEY;
  const HELP = 'muse-helper-keys-help';
  let enabled = true;

  // メッセージの列をスクロールしている要素
  function scroller(from) {
    for (let e = from && from.parentElement; e && e !== document.body; e = e.parentElement) {
      const o = getComputedStyle(e).overflowY;
      if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e;
    }
    return document.scrollingElement;
  }

  function focusComposer() {
    const t = M.composerInput();
    if (!t) return;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }

  function latest() {
    const list = M.messages();
    if (!list.length) return;
    const sc = scroller(list[0].el);
    sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
  }

  // 前後のメッセージへ。続けて押したとき(スクロールの途中)は、前回の移動先から数える
  let last = { id: null, t: 0 };
  function step(dir) {
    const list = M.messages();
    if (!list.length) return;
    let i = Date.now() - last.t < 800 ? list.findIndex((m) => m.id === last.id) : -1;
    if (i >= 0) {
      i += dir;
    } else {
      const sc = scroller(list[0].el);
      const top = sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top;
      const edge = top + 72; // CSS の scroll-margin-top と同じ
      const tops = list.map((m) => m.el.getBoundingClientRect().top);
      if (dir < 0) { i = tops.length - 1; while (i >= 0 && tops[i] >= edge - 8) i--; } else i = tops.findIndex((y) => y > edge + 8);
    }
    const target = list[i];
    if (!target) return;
    last = { id: target.id, t: Date.now() };
    M.scrollToMessage(target.el, 'start');
  }

  // ---------- 一覧の表示 ----------
  function help() {
    const old = document.getElementById(HELP);
    if (old) return old.remove();
    const box = document.createElement('div');
    box.id = HELP;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'キーボードショートカット');
    const dark = document.documentElement.classList.contains('dark');
    box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483001;box-sizing:border-box;' +
      'width:min(380px,calc(100vw - 32px));padding:14px 16px;border-radius:14px;font:13px/1.5 system-ui,sans-serif;pointer-events:auto;' +
      `box-shadow:0 8px 32px rgba(0,0,0,.25);background:${dark ? '#262624' : '#fff'};color:${dark ? '#f0efec' : '#1a1a19'};` +
      `border:1px solid ${dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.1)'};`;
    const h = document.createElement('div');
    h.textContent = 'キーボードショートカット';
    h.style.cssText = 'font-weight:600;margin-bottom:8px;';
    box.appendChild(h);
    for (const s of M.SHORTCUTS) {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;gap:12px;padding:3px 0;';
      const k = document.createElement('kbd');
      k.textContent = M.ALT + s.key;
      k.style.cssText = 'flex:none;min-width:56px;font:12px/1.5 ui-monospace,monospace;opacity:.8;';
      const t = document.createElement('span');
      t.textContent = s.title;
      r.append(k, t);
      box.appendChild(r);
    }
    const foot = document.createElement('div');
    foot.textContent = 'Esc かどこかを押すと閉じます。設定画面の「Muse Helper」でオフにできます。';
    foot.style.cssText = 'margin-top:8px;font-size:11px;opacity:.6;';
    box.appendChild(foot);
    document.body.appendChild(box);
    const close = (e) => {
      if (e.type === 'keydown' && e.altKey && e.code === 'Slash') return; // もう一度 Alt+/ は下の処理で閉じる
      box.remove();
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('pointerdown', close, true);
      if (e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
    };
    setTimeout(() => {
      window.addEventListener('keydown', close, true);
      window.addEventListener('pointerdown', close, true);
    });
  }

  const ACTIONS = {
    KeyI: focusComposer,
    KeyJ: latest,
    ArrowUp: () => step(-1),
    ArrowDown: () => step(1),
    KeyB: () => M.bookmarks && M.bookmarks.toggle(),
    Slash: help,
  };

  window.addEventListener('keydown', (e) => {
    if (!enabled || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    const act = ACTIONS[e.code];
    if (!act) return;
    // Muse のダイアログ(設定画面など)を開いている間は使わない
    if ([...document.querySelectorAll('[role="dialog"]')].some((d) => d.id !== HELP)) return;
    const t = e.target;
    const composer = M.composerInput();
    const editable = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (editable && t !== composer) return;
    // 入力欄に文章があるときの Alt+↑↓ は、入力欄の中の移動(Mac の段落移動など)を優先する
    if (t === composer && t.value && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    act();
  }, true);

  try {
    chrome.storage.local.get(KEY, (v) => { enabled = !(v && v[KEY] === false); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) enabled = changes[KEY].newValue !== false;
    });
  } catch (e) {}
})();
