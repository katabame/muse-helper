// メッセージのブックマーク(isolated world)。
// - メッセージの時刻ラベル(timestamps.js が付ける)の横に ☆ ボタンを足し、押すと保存する
// - 一覧は画面右上のパネル(Alt+B / 設定画面から開く)。項目を押すとそのメッセージへ移動する
//   別の会話のメッセージなら、その会話を開いてから移動する(sessionStorage で移動先を引き継ぐ)
(() => {
  'use strict';
  const M = MuseHelper;
  const KEY = M.BOOKMARKS_KEY;
  const JUMP = 'museHelperJump';
  const BTN = 'muse-bm-btn';
  const PANEL = 'muse-helper-bookmarks';
  const SVG = 'http://www.w3.org/2000/svg';
  const STAR = 'M12 3.6l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.62l-5.1 2.68.97-5.68L3.75 9.6l5.7-.83z';

  let marks = {}; // { [メッセージID]: { path, title, text, at, user, savedAt, memo } }
  let editing = null; // メモを編集中のブックマーク ID
  let loaded = false;
  let note = ''; // パネルに出す一時的なお知らせ

  const style = document.createElement('style');
  style.textContent = `
    .${BTN} { all: unset; box-sizing: border-box; pointer-events: auto; cursor: pointer; display: inline-flex; vertical-align: -2px;
      margin: 0 2px 0 6px; padding: 1px; border-radius: 4px; color: inherit; visibility: hidden; }
    .${BTN} svg { width: 12px; height: 12px; display: block; }
    .${BTN} path { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
    [data-message-id]:hover .${BTN}, .${BTN}:focus-visible, .${BTN}[aria-pressed="true"] { visibility: visible; }
    .${BTN}[aria-pressed="true"] { color: #c98500; }
    .${BTN}[aria-pressed="true"] path { fill: currentColor; }
    .${BTN}:focus-visible { outline: 2px solid #2a78d6; }

    #${PANEL} { position: fixed; top: 64px; right: 16px; z-index: 2147483000; width: min(360px, calc(100vw - 32px));
      max-height: min(70vh, 640px); display: flex; flex-direction: column; box-sizing: border-box;
      font: 13px/1.45 system-ui, sans-serif; color: #1a1a19; background: #fff; border: 1px solid rgba(0,0,0,.1);
      border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,.18); pointer-events: auto; }
    html.dark #${PANEL} { color: #f0efec; background: #262624; border-color: rgba(255,255,255,.1); }
    #${PANEL} button { all: unset; box-sizing: border-box; cursor: pointer; }
    #${PANEL} button:focus-visible { outline: 2px solid #2a78d6; outline-offset: -2px; }
    #${PANEL} .bm-head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 14px; font-weight: 600; }
    #${PANEL} .bm-head span { flex: 1; }
    #${PANEL} .bm-close { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; opacity: .6; }
    #${PANEL} .bm-close:hover { opacity: 1; background: rgba(128,128,128,.15); }
    #${PANEL} .bm-body { overflow-y: auto; padding: 0 6px 8px; }
    #${PANEL} .bm-note { margin: 0 8px 8px; padding: 6px 8px; border-radius: 8px; font-size: 12px; background: rgba(217,119,6,.14); }
    #${PANEL} .bm-empty { padding: 4px 8px 8px; font-size: 12px; opacity: .65; }
    #${PANEL} .bm-group { margin: 8px 8px 2px; font-size: 11px; opacity: .6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #${PANEL} .bm-item { display: flex; align-items: flex-start; gap: 4px; border-radius: 8px; }
    #${PANEL} .bm-item:hover { background: rgba(128,128,128,.12); }
    #${PANEL} .bm-go { flex: 1; min-width: 0; padding: 6px 8px; border-radius: 8px; }
    #${PANEL} .bm-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
    #${PANEL} .bm-meta { font-size: 11px; opacity: .6; }
    #${PANEL} .bm-memo { margin-top: 2px; font-size: 12px; padding-left: 8px; border-left: 2px solid #c98500; word-break: break-word; white-space: pre-wrap; }
    #${PANEL} .bm-memo-input { all: unset; box-sizing: border-box; display: block; width: 100%; margin: 4px 0 2px; padding: 4px 8px;
      font-size: 12px; border: 1px solid rgba(128,128,128,.45); border-radius: 6px; }
    #${PANEL} .bm-memo-input:focus { border-color: #2a78d6; }
    #${PANEL} .bm-memo-hint { font-size: 11px; opacity: .55; }
    #${PANEL} .bm-del { width: 24px; height: 24px; margin: 6px 4px 0 0; display: grid; place-items: center; border-radius: 6px; opacity: 0; }
    #${PANEL} .bm-actions { display: flex; margin: 6px 4px 0 0; }
    #${PANEL} .bm-del { margin: 0; }
    #${PANEL} .bm-item:hover .bm-del, #${PANEL} .bm-del:focus-visible { opacity: .6; }
    #${PANEL} .bm-del:hover { opacity: 1 !important; background: rgba(128,128,128,.18); }
  `;
  document.documentElement.appendChild(style);

  function star() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', STAR);
    svg.appendChild(p);
    return svg;
  }
  function pencil() {
    const svg = cross();
    svg.firstChild.setAttribute('d', 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4');
    svg.firstChild.setAttribute('stroke-width', '1.8');
    svg.firstChild.setAttribute('stroke-linejoin', 'round');
    return svg;
  }
  function cross() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    svg.appendChild(p);
    return svg;
  }
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function save() {
    try { chrome.storage.local.set({ [KEY]: marks }); } catch (e) {}
  }

  // 会話の名前(タブのタイトル。サービス名だけなら空)
  function chatTitle() {
    const t = document.title.replace(/\s*[|\-–—]\s*Muse\s*$/i, '').trim();
    return /^muse$/i.test(t) ? '' : t.slice(0, 80);
  }

  function toggle(msgEl) {
    const id = msgEl.getAttribute('data-message-id');
    if (!id) return;
    if (marks[id]) {
      delete marks[id];
    } else {
      const m = M.messages().find((x) => x.el === msgEl);
      marks[id] = {
        path: location.pathname,
        title: chatTitle(),
        text: M.messageText(msgEl).slice(0, 160),
        at: m && m.at,
        user: !!(m && m.user),
        savedAt: Date.now(),
      };
    }
    save();
    ensure();
    render();
  }

  // ---------- 時刻ラベルの ☆ ボタン ----------
  // ボタンには文字を入れない(timestamps.js はラベルの textContent で描き直しの要否を判断するため)
  function ensure() {
    if (!loaded) return;
    for (const m of M.messages()) {
      const label = m.el.querySelector(':scope > .muse-ts-label');
      if (!label) continue;
      let b = label.querySelector(':scope > .' + BTN);
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = BTN;
        b.appendChild(star());
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const msg = b.closest('[data-message-id]');
          if (msg) toggle(msg);
        });
        label.appendChild(b);
      }
      const on = String(!!marks[m.id]);
      if (b.getAttribute('aria-pressed') !== on) {
        b.setAttribute('aria-pressed', on);
        const t = on === 'true' ? 'ブックマークを外す' : 'ブックマークに追加';
        b.setAttribute('aria-label', t);
        b.title = t;
      }
    }
  }

  // ---------- 一覧のパネル ----------
  const panel = () => document.getElementById(PANEL);

  function open() {
    if (panel()) return render();
    const p = el('div');
    p.id = PANEL;
    p.setAttribute('role', 'region');
    p.setAttribute('aria-label', 'ブックマーク');
    const head = el('div', 'bm-head');
    const title = el('span', 'bm-title', 'ブックマーク');
    const close = el('button', 'bm-close');
    close.type = 'button';
    close.setAttribute('aria-label', '閉じる');
    close.title = `閉じる(Esc / ${M.ALT}B)`;
    close.appendChild(cross());
    close.addEventListener('click', hide);
    head.append(title, close);
    p.append(head, el('div', 'bm-body'));
    document.body.appendChild(p);
    render();
    close.focus();
  }
  function hide() {
    const p = panel();
    editing = null;
    if (p) p.remove();
    note = '';
  }
  const toggleOpen = () => (panel() ? hide() : open());

  function render() {
    const p = panel();
    if (!p) return;
    const list = Object.entries(marks).map(([id, b]) => ({ id, ...b }));
    p.querySelector('.bm-title').textContent = `ブックマーク(${list.length}件)`;
    const body = p.querySelector('.bm-body');
    body.textContent = '';
    if (note) body.appendChild(el('div', 'bm-note', note));
    if (!list.length) {
      body.appendChild(el('div', 'bm-empty', 'メッセージにマウスを乗せ、時刻の横の ☆ を押すと追加できます。'));
      return;
    }
    // 会話ごとにまとめる(今の会話を先頭に、ほかは新しく追加した順)
    const groups = new Map();
    list.sort((a, b) => (a.at || a.savedAt) - (b.at || b.savedAt));
    for (const b of list) {
      if (!groups.has(b.path)) groups.set(b.path, []);
      groups.get(b.path).push(b);
    }
    const order = [...groups.keys()].sort((a, b) => {
      if (a === location.pathname) return -1;
      if (b === location.pathname) return 1;
      return Math.max(...groups.get(b).map((x) => x.savedAt)) - Math.max(...groups.get(a).map((x) => x.savedAt));
    });
    const fmt12 = M.fmt12();
    for (const path of order) {
      const items = groups.get(path);
      const name = path === location.pathname ? 'この会話' : (items.find((x) => x.title) || {}).title || '別の会話';
      body.appendChild(el('div', 'bm-group', name));
      for (const b of items) {
        const row = el('div', 'bm-item');
        const go = el('button', 'bm-go');
        go.type = 'button';
        go.append(el('div', 'bm-text', b.text || '(本文なし)'),
          el('div', 'bm-meta', `${b.at ? M.when(b.at, fmt12, true) : '時刻不明'} ・ ${b.user ? '自分' : '相手'}`));
        if (b.memo && editing !== b.id) go.appendChild(el('div', 'bm-memo', b.memo));
        go.addEventListener('click', () => jump(b.id));
        if (editing === b.id) {
          // メモの編集(Enter で保存、Esc で取り消し、欄の外を押しても保存)
          const box = el('div', 'bm-go');
          box.append(el('div', 'bm-text', b.text || '(本文なし)'));
          const input = el('input', 'bm-memo-input');
          input.type = 'text';
          input.maxLength = 200;
          input.value = b.memo || '';
          input.placeholder = 'メモ(例: あとで聞き直す)';
          input.setAttribute('aria-label', 'メモ');
          const commit = (keep) => {
            if (editing !== b.id) return;
            editing = null;
            if (keep && marks[b.id]) {
              const v = input.value.trim();
              if (v) marks[b.id].memo = v; else delete marks[b.id].memo;
              save();
            }
            render();
          };
          input.addEventListener('keydown', (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') { e.preventDefault(); commit(true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(false); }
          });
          input.addEventListener('blur', () => commit(true));
          box.append(input, el('div', 'bm-memo-hint', 'Enter で保存 ・ Esc で取り消し'));
          row.append(box);
          body.appendChild(row);
          setTimeout(() => input.focus());
          continue;
        }
        const edit = el('button', 'bm-del');
        edit.type = 'button';
        edit.setAttribute('aria-label', b.memo ? 'メモを編集' : 'メモを追加');
        edit.title = b.memo ? 'メモを編集' : 'メモを追加';
        edit.appendChild(pencil());
        edit.addEventListener('click', () => { editing = b.id; render(); });
        const del = el('button', 'bm-del');
        del.type = 'button';
        del.setAttribute('aria-label', 'ブックマークを削除');
        del.title = '削除';
        del.appendChild(cross());
        del.addEventListener('click', () => {
          delete marks[b.id];
          save();
          ensure();
          render();
        });
        const actions = el('div', 'bm-actions');
        actions.append(edit, del);
        row.append(go, actions);
        body.appendChild(row);
      }
    }
  }

  // ---------- 移動 ----------
  const findMessage = (id) => [...document.querySelectorAll('[data-message-id]')].find((x) => x.getAttribute('data-message-id') === id);

  function jump(id) {
    const b = marks[id];
    if (!b) return;
    if (b.path === location.pathname) {
      const target = findMessage(id);
      if (target) {
        hide();
        M.scrollToMessage(target, 'center');
      } else {
        note = 'このメッセージは読み込まれていません。会話を上にスクロールして過去のメッセージを読み込んでから、もう一度押してください。';
        render();
      }
      return;
    }
    try { sessionStorage.setItem(JUMP, id); } catch (e) {}
    location.assign(b.path);
  }

  // 別の会話から移動してきたとき: メッセージが表示されるまで待って移動する(最大15秒)
  function resumeJump() {
    let id = null;
    try { id = sessionStorage.getItem(JUMP); sessionStorage.removeItem(JUMP); } catch (e) {}
    if (!id) return;
    const until = Date.now() + 15000;
    (function wait() {
      const target = findMessage(id);
      if (target) return setTimeout(() => M.scrollToMessage(target, 'center'), 300);
      if (Date.now() < until) return setTimeout(wait, 300);
      note = '移動先のメッセージが見つかりませんでした。会話を上にスクロールして過去のメッセージを読み込んでから、もう一度押してください。';
      open();
    })();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel() && !(e.target && e.target.classList && e.target.classList.contains('bm-memo-input'))) {
      e.stopPropagation();
      hide();
    }
  }, true);

  // ほかのスクリプト(keys.js・settings.js)から使う
  M.bookmarks = { open, hide, toggle: toggleOpen, count: () => Object.keys(marks).length };

  // ---------- 起動 ----------
  let timer;
  new MutationObserver((list) => {
    if (list.every((m) => m.target.closest && m.target.closest(`.${BTN}, #${PANEL}`))) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (M.alive()) ensure(); }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  try {
    chrome.storage.local.get(KEY, (v) => {
      marks = (v && v[KEY] && typeof v[KEY] === 'object' && v[KEY]) || {};
      loaded = true;
      ensure();
      render();
      resumeJump();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[KEY]) return;
      marks = changes[KEY].newValue || {};
      ensure();
      render();
    });
  } catch (e) {}
})();
