// 下書きの一覧(isolated world)。すべての会話の下書きを、会話ごとにまとめて新しい順に並べる。
// - 開き方: Alt+R(設定で変更可)/ 設定画面の「下書き」→「一覧を開く」
// - 項目を押すと、その会話を開いて(再読み込みせずに)入力欄に戻す(drafts.js の MuseHelper.drafts.open)
// - 送信以外で消えた「以前の下書き」は、会話ごとに折りたたんで表示する
(() => {
  'use strict';
  const M = MuseHelper;
  const PANEL = 'muse-helper-draftlist';
  const FONT = M.FONT;

  let names = {}; // { [会話のパス]: サイドバーでの名前 }(bookmarks.js が覚えたもの)
  let titles = {}; // { [会話のパス]: ブックマークを保存したときのタブの名前 }
  let query = '';
  const openHistory = new Set(); // 「以前の下書き」を開いている会話

  const style = document.createElement('style');
  style.textContent = `
    #${PANEL} { position: fixed; top: 64px; right: 16px; z-index: 2147483000; width: min(380px, calc(100vw - 32px));
      max-height: min(70vh, 640px); display: flex; flex-direction: column; box-sizing: border-box;
      font: 13px/1.45 ${FONT}; color: #1a1a19; background: #fff; border: 1px solid rgba(0,0,0,.1);
      border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,.18); pointer-events: auto; }
    html.dark #${PANEL} { color: #f0efec; background: #262624; border-color: rgba(255,255,255,.1); }
    #${PANEL} button { all: unset; box-sizing: border-box; cursor: pointer; }
    #${PANEL} button:focus-visible { outline: 2px solid #2a78d6; outline-offset: -2px; }
    #${PANEL} .dl-head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 14px; font-weight: 600; }
    #${PANEL} .dl-head span { flex: 1; }
    #${PANEL} .dl-close { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; opacity: .6; }
    #${PANEL} .dl-close:hover { opacity: 1; background: rgba(128,128,128,.15); }
    #${PANEL} .dl-tools { padding: 0 10px 8px 14px; }
    #${PANEL} .dl-q { all: unset; box-sizing: border-box; width: 100%; padding: 4px 8px; font-size: 12px;
      border: 1px solid rgba(128,128,128,.4); border-radius: 6px; }
    #${PANEL} .dl-q:focus { border-color: #2a78d6; }
    #${PANEL} .dl-body { overflow-y: auto; padding: 0 6px 8px; }
    #${PANEL} .dl-empty { padding: 4px 8px 8px; font-size: 12px; opacity: .65; }
    #${PANEL} .dl-group { margin: 8px 8px 2px; font-size: 11px; opacity: .6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #${PANEL} .dl-item { display: flex; align-items: flex-start; gap: 4px; border-radius: 8px; }
    #${PANEL} .dl-item:hover { background: rgba(128,128,128,.12); }
    #${PANEL} .dl-go { flex: 1; min-width: 0; padding: 6px 8px; border-radius: 8px; }
    #${PANEL} .dl-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; white-space: pre-wrap; }
    #${PANEL} .dl-meta { font-size: 11px; opacity: .6; }
    #${PANEL} .dl-del { width: 24px; height: 24px; margin: 6px 4px 0 0; display: grid; place-items: center; border-radius: 6px; opacity: 0; }
    #${PANEL} .dl-item:hover .dl-del, #${PANEL} .dl-del:focus-visible { opacity: .6; }
    #${PANEL} .dl-del:hover { opacity: 1 !important; background: rgba(128,128,128,.18); }
    #${PANEL} .dl-hist-toggle { display: block; margin: 0 8px 2px; padding: 2px 0; font-size: 11px; opacity: .7; }
    #${PANEL} .dl-hist-toggle:hover { opacity: 1; text-decoration: underline; }
    #${PANEL} .dl-hist { margin-left: 10px; border-left: 2px solid rgba(128,128,128,.3); padding-left: 2px; }
  `;
  document.documentElement.appendChild(style);

  const el = M.el;
  const cross = () => M.icon(M.ICON_CROSS);

  function chatName(path) {
    if (path === location.pathname) return 'この会話';
    if (names[path]) return names[path];
    if (titles[path]) return titles[path];
    if (path === '/' || path === '') return 'チャット(トップ)';
    return `会話 ${path.split('/').pop().slice(0, 8)}…`;
  }

  const panel = () => document.getElementById(PANEL);

  function open() {
    if (panel()) return render();
    if (M.bookmarks) M.bookmarks.hide(); // 同じ場所に出るので、ブックマークの一覧は閉じる
    const p = el('div');
    p.id = PANEL;
    p.lang = 'ja';
    p.setAttribute('role', 'region');
    p.setAttribute('aria-label', '下書きの一覧');
    const head = el('div', 'dl-head');
    const title = el('span', 'dl-title', '下書き');
    const close = el('button', 'dl-close');
    close.type = 'button';
    close.setAttribute('aria-label', '閉じる');
    close.title = '閉じる(Esc)';
    close.appendChild(cross());
    close.addEventListener('click', hide);
    head.append(title, close);
    const tools = el('div', 'dl-tools');
    const q = el('input', 'dl-q');
    q.type = 'search';
    q.placeholder = '本文・会話名で絞り込み';
    q.setAttribute('aria-label', '下書きを絞り込む');
    q.value = query;
    q.addEventListener('input', () => { query = q.value; render(); });
    tools.appendChild(q);
    p.append(head, tools, el('div', 'dl-body'));
    document.body.appendChild(p);
    render();
    q.focus();
  }
  function hide() {
    const p = panel();
    if (p) p.remove();
  }
  const toggle = () => (panel() ? hide() : open());

  function item(path, text, at, fromHistory) {
    const row = el('div', 'dl-item');
    const go = el('button', 'dl-go');
    go.type = 'button';
    go.title = fromHistory ? 'この会話を開いて、入力欄に戻します(以前の下書きからは消えます)' : 'この会話を開いて、入力欄に戻します';
    go.append(el('div', 'dl-text', text.length > 400 ? text.slice(0, 400) + '…' : text),
      el('div', 'dl-meta', `${M.charCount(text).toLocaleString()}文字 ・ ${M.ago(Date.now() - at)}`));
    go.addEventListener('click', () => {
      hide();
      M.drafts.open(path, text, fromHistory);
    });
    const del = el('button', 'dl-del');
    del.type = 'button';
    del.setAttribute('aria-label', '下書きを削除');
    del.title = '削除';
    del.appendChild(cross());
    del.addEventListener('click', () => {
      if (fromHistory) M.drafts.forget(path, text); else M.drafts.remove(path);
    });
    row.append(go, del);
    return row;
  }

  function render() {
    const p = panel();
    if (!p || !M.drafts) return;
    const { drafts, history } = M.drafts.all();
    const paths = [...new Set([...Object.keys(drafts), ...Object.keys(history).filter((k) => (history[k] || []).length)])];
    const total = Object.keys(drafts).length + paths.reduce((n, k) => n + ((history[k] || []).length), 0);
    p.querySelector('.dl-title').textContent = `下書き(${total}件)`;
    const body = p.querySelector('.dl-body');
    body.textContent = '';
    if (!paths.length) {
      body.appendChild(el('div', 'dl-empty', '保存中の下書きはありません。入力欄に書いた文章は会話ごとに自動で保存されます。'));
      return;
    }
    const q = query.trim().toLowerCase();
    const match = (path, text) => !q || `${text}\n${chatName(path)}`.toLowerCase().includes(q);
    // 会話の並び: 今の会話を先頭に、ほかは一番新しい下書きの順
    const latest = (k) => Math.max((drafts[k] && drafts[k].at) || 0, ...((history[k] || []).map((h) => h.at)));
    paths.sort((a, b) => (a === location.pathname ? -1 : b === location.pathname ? 1 : latest(b) - latest(a)));
    let shown = 0;
    for (const path of paths) {
      const d = drafts[path];
      const hist = (history[path] || []).filter((h) => match(path, h.text));
      const showDraft = d && d.text && match(path, d.text);
      if (!showDraft && !hist.length) continue;
      body.appendChild(el('div', 'dl-group', chatName(path)));
      if (showDraft) { body.appendChild(item(path, d.text, d.at, false)); shown++; }
      if (hist.length) {
        const opened = openHistory.has(path) || !!q;
        const t = el('button', 'dl-hist-toggle', `以前の下書き(${hist.length})${opened ? ' ▴' : ' ▾'}`);
        t.type = 'button';
        t.setAttribute('aria-expanded', String(opened));
        t.addEventListener('click', () => {
          if (openHistory.has(path)) openHistory.delete(path); else openHistory.add(path);
          render();
        });
        body.appendChild(t);
        if (opened) {
          const box = el('div', 'dl-hist');
          for (const h of hist) { box.appendChild(item(path, h.text, h.at, true)); shown++; }
          body.appendChild(box);
        } else shown += hist.length;
      }
    }
    if (!shown) body.appendChild(el('div', 'dl-empty', '一致する下書きはありません。'));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel()) {
      e.stopPropagation();
      hide();
    }
  }, true);

  M.draftList = { open, hide, toggle };

  try {
    chrome.storage.local.get([M.THREAD_NAMES_KEY, M.BOOKMARKS_KEY], (v) => {
      names = (v && v[M.THREAD_NAMES_KEY]) || {};
      for (const b of Object.values((v && v[M.BOOKMARKS_KEY]) || {})) if (b && b.path && b.title) titles[b.path] = b.title;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[M.THREAD_NAMES_KEY]) names = changes[M.THREAD_NAMES_KEY].newValue || {};
      // 下書きの変更は drafts.js が受け取ってから描き直す
      if (changes[M.DRAFTS_KEY] || changes[M.DRAFT_HISTORY_KEY] || changes[M.THREAD_NAMES_KEY]) setTimeout(render, 0);
    });
  } catch (e) {}
})();
