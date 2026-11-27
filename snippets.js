// 定型文(isolated world)。
// - 登録・編集は設定画面の「Muse Helper」→「定型文」(settings.js)
// - Alt+T で入力欄の上に一覧を出し、選ぶとカーソル位置に挿入する
// - 文中の {日付} {時刻} {曜日} {選択中の文字} {クリップボード} は挿入時に中身に置き換え、{カーソル} の位置にカーソルを置く
(() => {
  'use strict';
  const M = MuseHelper;
  const KEY = M.SNIPPETS_KEY;
  const PICK = 'muse-helper-snippets';
  let snippets = []; // [{ id, title, text }]
  let sel = 0;
  let target = null; // 挿入先の入力欄と、開いたときのカーソル位置

  const style = document.createElement('style');
  style.textContent = `
    #${PICK} { position: fixed; z-index: 2147483000; box-sizing: border-box; width: min(420px, calc(100vw - 32px));
      max-height: min(50vh, 420px); display: flex; flex-direction: column; font: 13px/1.45 ${M.FONT};
      color: #1a1a19; background: #fff; border: 1px solid rgba(0,0,0,.1); border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.18); }
    html.dark #${PICK} { color: #f0efec; background: #262624; border-color: rgba(255,255,255,.1); }
    #${PICK} input { all: unset; box-sizing: border-box; width: 100%; padding: 10px 12px; border-bottom: 1px solid rgba(128,128,128,.2); }
    #${PICK} .sn-list { overflow-y: auto; padding: 4px; }
    #${PICK} .sn-item { padding: 6px 8px; border-radius: 8px; cursor: pointer; }
    #${PICK} .sn-item[aria-selected="true"] { background: rgba(42,120,214,.14); }
    html.dark #${PICK} .sn-item[aria-selected="true"] { background: rgba(57,135,229,.24); }
    #${PICK} .sn-title { font-weight: 600; }
    #${PICK} .sn-text { font-size: 12px; opacity: .65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #${PICK} .sn-empty { padding: 8px 10px; font-size: 12px; opacity: .65; }
    #${PICK} .sn-foot { padding: 6px 12px; font-size: 11px; opacity: .55; border-top: 1px solid rgba(128,128,128,.2); }
  `;
  document.documentElement.appendChild(style);

  const picker = () => document.getElementById(PICK);

  function filtered() {
    const q = ((picker() && picker().querySelector('input').value) || '').trim().toLowerCase();
    return q ? snippets.filter((s) => `${s.title}\n${s.text}`.toLowerCase().includes(q)) : snippets;
  }

  function open() {
    const t = M.composerInput();
    if (!t) return;
    if (picker()) return close();
    target = { t, start: t.selectionStart, end: t.selectionEnd };
    const p = document.createElement('div');
    p.id = PICK;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '定型文を検索';
    input.setAttribute('aria-label', '定型文を検索');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-controls', PICK + '-list');
    const list = document.createElement('div');
    list.className = 'sn-list';
    list.id = PICK + '-list';
    list.setAttribute('role', 'listbox');
    const foot = document.createElement('div');
    foot.className = 'sn-foot';
    foot.textContent = '↑↓ で選択 ・ Enter で挿入 ・ Esc で閉じる ・ 登録は設定画面の「Muse Helper」→「定型文」';
    p.append(input, list, foot);
    // 入力欄のすぐ上に出す(入れる場所がなければ下に)
    const r = t.getBoundingClientRect();
    p.style.left = `${Math.max(16, Math.min(r.left, innerWidth - 16 - Math.min(420, innerWidth - 32)))}px`;
    if (r.top > 240) p.style.bottom = `${innerHeight - r.top + 8}px`;
    else p.style.top = `${r.bottom + 8}px`;
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const items = filtered();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (items[sel]) insert(items[sel]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    });
    document.body.appendChild(p);
    sel = 0;
    render();
    input.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }

  function outside(e) {
    if (picker() && !picker().contains(e.target)) close();
  }

  // back: 入力欄にフォーカスを戻す
  function close(back) {
    const p = picker();
    if (p) p.remove();
    document.removeEventListener('pointerdown', outside, true);
    if (back && target && target.t.isConnected) {
      target.t.focus();
      target.t.setSelectionRange(target.start, target.end);
    }
  }

  function render() {
    const p = picker();
    if (!p) return;
    const list = p.querySelector('.sn-list');
    list.textContent = '';
    const items = filtered();
    if (!snippets.length) {
      list.appendChild(Object.assign(document.createElement('div'), { className: 'sn-empty',
        textContent: 'まだ定型文がありません。設定画面の「Muse Helper」→「定型文」で登録できます。' }));
      return;
    }
    if (!items.length) {
      list.appendChild(Object.assign(document.createElement('div'), { className: 'sn-empty', textContent: '一致する定型文はありません' }));
      return;
    }
    sel = Math.min(sel, items.length - 1);
    items.forEach((s, i) => {
      const it = document.createElement('div');
      it.className = 'sn-item';
      it.id = `${PICK}-${i}`;
      it.setAttribute('role', 'option');
      it.setAttribute('aria-selected', String(i === sel));
      const title = document.createElement('div');
      title.className = 'sn-title';
      title.textContent = s.title || s.text.split('\n')[0].slice(0, 40);
      const text = document.createElement('div');
      text.className = 'sn-text';
      text.textContent = s.text.replace(/\s+/g, ' ');
      it.append(title, text);
      it.addEventListener('mousedown', (e) => e.preventDefault()); // 検索欄のフォーカスを保つ
      it.addEventListener('click', () => insert(s));
      list.appendChild(it);
    });
    p.querySelector('input').setAttribute('aria-activedescendant', `${PICK}-${sel}`);
    const cur = list.children[sel];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  // 差し込み項目を置き換える。戻り値 { text, cursor(なければ -1), note }
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const pad = (n) => String(n).padStart(2, '0');
  async function expand(src, selected) {
    const d = new Date();
    const h = d.getHours();
    const clock = M.fmt12() ? `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}` : `${pad(h)}:${pad(d.getMinutes())}`;
    const vars = { 日付: `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, 時刻: clock, 曜日: WD[d.getDay()], 選択中の文字: selected, クリップボード: '' };
    let note = '';
    if (src.includes('{クリップボード}')) {
      try { vars.クリップボード = await navigator.clipboard.readText(); } catch (e) { note = 'クリップボードを読めませんでした(ブラウザの許可が必要です)'; }
    }
    let text = src.replace(/\{(日付|時刻|曜日|選択中の文字|クリップボード)\}/g, (_, k) => vars[k]);
    const cursor = text.indexOf('{カーソル}');
    text = text.split('{カーソル}').join('');
    return { text, cursor, note };
  }

  async function insert(s) {
    const tg = target;
    close();
    if (!tg || !tg.t.isConnected) return;
    const selected = tg.t.value.slice(tg.start, tg.end);
    const { text, cursor, note } = await expand(s.text, selected);
    tg.t.focus();
    tg.t.setSelectionRange(tg.start, tg.end);
    M.insertText(tg.t, text);
    if (cursor >= 0) tg.t.setSelectionRange(tg.start + cursor, tg.start + cursor);
    if (note) toast(note);
  }

  function toast(text) {
    const t = M.composerInput();
    if (!t) return;
    const r = t.getBoundingClientRect();
    const n = document.createElement('div');
    n.textContent = text;
    n.style.cssText = `position:fixed;left:${Math.max(16, r.left)}px;bottom:${innerHeight - r.top + 8}px;z-index:2147483000;padding:6px 10px;` +
      'border-radius:8px;font:12px/1.4 ' + M.FONT + ';color:#fff;background:rgba(30,30,30,.92);pointer-events:none;';
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 4000);
  }

  M.snippets = { open, close };

  try {
    chrome.storage.local.get(KEY, (v) => { snippets = (v && Array.isArray(v[KEY]) && v[KEY]) || []; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) { snippets = changes[KEY].newValue || []; render(); }
    });
  } catch (e) {}
})();
