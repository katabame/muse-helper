// 入力欄の下書きをチャットごとに自動保存し、ボタンで復元できるようにする(isolated world)。
// - 入力が 0.5 秒止まったら chrome.storage.local に保存(キーはチャットの URL のパス)
// - 送信や手動での全消去で入力欄が空になったら、そのチャットの下書きを削除
// - 入力欄が空で下書きがあるときは、入力欄の左上に「下書きを復元」ボタンを出す
// - 30日より古い下書きは自動で削除
// - 送信以外で消えた下書き(全部消した・✕で破棄した・ほかの下書きで置き換えた)は「以前の下書き」として
//   チャットごとに最大5件残し、復元ボタンの横の「以前の下書き」から戻せる
(() => {
  'use strict';
  const M = MuseHelper;
  const KEY = M.DRAFTS_KEY;
  const ENABLED_KEY = M.DRAFTS_ENABLED_KEY;
  const SAVE_DELAY = 500;
  const SEND_WINDOW = 5000; // 送信操作からこの時間内に入力欄が空になったら「送信された」とみなす
  const NON_SEND_BUTTONS = ['ファイルを添付', 'メッセージを音声入力', 'Attach file', 'Voice input'];

  let enabled = true;
  let drafts = {}; // { [path]: { text, at } }
  let history = {}; // { [path]: [{ text, at }] } 以前の下書き(新しい順)
  const HISTORY_KEY = M.DRAFT_HISTORY_KEY;
  const HISTORY_MAX = 5;
  let loaded = false;

  let lastKey = null; // 最後に入力があったチャット
  let lastValue = null; // 最後に見た入力欄の値
  let lastInput = null; // 最後に見た入力欄(要素が差し替わったら別物とみなす)
  let sendIntentAt = 0;
  let saveTimer = null;

  const chatKey = () => location.pathname;

  // ---------- 保存 ----------
  function persist() {
    try { chrome.storage.local.set({ [KEY]: drafts }); } catch (e) {}
  }

  function saveDraft(key, text) {
    if (!enabled || !key) return;
    if (!text || !text.trim()) return deleteDraft(key);
    const cur = drafts[key];
    if (cur && cur.text === text) return;
    drafts = { ...drafts, [key]: { text, at: Date.now() } };
    persist();
  }

  // 以前の下書きに残す(同じ文章は先頭に移すだけ)
  function keep(key, text) {
    if (!key || !text || !text.trim()) return;
    const list = (history[key] || []).filter((h) => h.text !== text);
    history = { ...history, [key]: [{ text, at: Date.now() }, ...list].slice(0, HISTORY_MAX) };
    try { chrome.storage.local.set({ [HISTORY_KEY]: history }); } catch (e) {}
  }

  // 以前の下書きから消す(text を省くと、そのチャットの分をすべて)
  function forget(key, text) {
    const list = history[key];
    if (!list) return;
    const next = text == null ? [] : list.filter((h) => h.text !== text);
    if (next.length === list.length) return;
    history = { ...history };
    if (next.length) history[key] = next; else delete history[key];
    try { chrome.storage.local.set({ [HISTORY_KEY]: history }); } catch (e) {}
  }

  // keepIt: 消す前に以前の下書きに残す
  function deleteDraft(key, keepIt) {
    if (keepIt && drafts[key]) keep(key, drafts[key].text);
    if (!key || !(key in drafts)) return;
    const next = { ...drafts };
    delete next[key];
    drafts = next;
    persist();
  }

  function scheduleSave(key, text) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDraft(key, text), SAVE_DELAY);
  }

  function purgeOld() {
    const limit = Date.now() - M.DRAFT_KEEP;
    const next = {};
    let changed = false;
    for (const [k, d] of Object.entries(drafts)) {
      if (d && d.text && d.at >= limit) next[k] = d;
      else changed = true;
    }
    if (changed) {
      drafts = next;
      persist();
    }
    const nextH = {};
    let changedH = false;
    for (const [k, list] of Object.entries(history)) {
      const l = (Array.isArray(list) ? list : []).filter((h) => h && h.text && h.at >= limit);
      if (l.length) nextH[k] = l;
      if (!Array.isArray(list) || l.length !== list.length) changedH = true;
    }
    if (changedH) {
      history = nextH;
      try { chrome.storage.local.set({ [HISTORY_KEY]: history }); } catch (e) {}
    }
  }

  // ---------- 入力の監視 ----------
  const isComposer = (t) => t && t === M.composerInput();

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!isComposer(t)) return;
    // 送信以外で空になった(全部消した): 消える前の文章を以前の下書きに残す
    if (!t.value && lastValue && lastInput === t && chatKey() === lastKey && Date.now() - sendIntentAt >= SEND_WINDOW) keep(lastKey, lastValue);
    lastKey = chatKey();
    lastValue = t.value;
    lastInput = t;
    scheduleSave(lastKey, t.value);
    tick();
  }, true);

  function markSendIntent() {
    sendIntentAt = Date.now();
    // 送信直前の未保存分が、送信後に保存されて下書きが復活しないようにする。
    // 送信されなかった(入力欄が空にならなかった)場合は、少し後に改めて保存する。
    clearTimeout(saveTimer);
    const key = chatKey();
    setTimeout(() => {
      const t = M.composerInput();
      if (t && t.value && chatKey() === key && Date.now() - sendIntentAt >= 900) saveDraft(key, t.value);
    }, 1000);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && isComposer(e.target)) markSendIntent();
  }, true);

  document.addEventListener('click', (e) => {
    const t = M.composerInput();
    if (!t || !e.target.closest) return;
    const btn = e.target.closest('button, [role="button"]');
    const { card } = M.composerLayout(t);
    if (!btn || btn === card || !card.contains(btn)) return;
    if (NON_SEND_BUTTONS.includes(btn.getAttribute('aria-label'))) return;
    markSendIntent();
  }, true);

  // 入力イベントを伴わない変化(送信後のクリア、チャットの切り替え)を定期的に確認する
  function watch() {
    const t = M.composerInput();
    if (!t) return;
    const v = t.value;
    if (t === lastInput && v === lastValue) return;
    const sameInput = t === lastInput;
    if (v === '' && lastValue && lastKey) {
      // 空になった: 送信操作の直後か、同じチャットのままなら送信(または消去)とみなして下書きを消す。
      // 別のチャットに移ったことで空になった場合は残す。
      if (Date.now() - sendIntentAt < SEND_WINDOW) {
        clearTimeout(saveTimer);
        deleteDraft(lastKey);
        forget(lastKey, lastValue); // 送った文章は以前の下書きからも消す
      } else if (sameInput && chatKey() === lastKey) {
        clearTimeout(saveTimer);
        keep(lastKey, lastValue);
        deleteDraft(lastKey);
      }
    }
    lastInput = t;
    lastValue = v;
  }

  // ---------- 復元ボタン ----------
  let chip = null, restoreBtn = null, histBtn = null, histSep = null, menu = null, lastLayout = '';

  // 以前の下書きの一覧(復元ボタンの上に出す)
  function toggleMenu() {
    if (menu) return closeMenu();
    const list = history[chatKey()] || [];
    if (!list.length || !chip) return;
    menu = document.createElement('div');
    menu.id = 'muse-helper-draft-menu';
    menu.setAttribute('role', 'menu');
    menu.className = 'text-text-primary bg-fill-blur-thick backdrop-blur-elevation-01 shadow-blur-elevation-01';
    menu.style.cssText = 'position:absolute;bottom:100%;margin-bottom:6px;z-index:2;pointer-events:auto;border-radius:12px;padding:4px;' +
      'width:min(380px,calc(100vw - 48px));font:12px/1.4 system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif;';
    list.forEach((h) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:2px;';
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.style.cssText = 'display:block;width:100%;text-align:left;background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:6px 8px;border-radius:8px;';
      b.addEventListener('mouseenter', () => { b.style.background = 'rgba(128,128,128,.14)'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
      const meta = document.createElement('div');
      meta.style.cssText = 'opacity:.6;font-size:11px;';
      meta.textContent = `${M.ago(Date.now() - h.at)} ・ ${M.charCount(h.text).toLocaleString()}文字`;
      const text = document.createElement('div');
      text.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      text.textContent = h.text.replace(/\s+/g, ' ');
      b.append(text, meta);
      b.style.minWidth = '0';
      b.addEventListener('click', () => {
        closeMenu();
        const key = chatKey();
        const cur = drafts[key];
        if (cur && cur.text !== h.text) keep(key, cur.text); // 今の下書きも残しておく
        forget(key, h.text); // 戻した文章は今の下書きになるので、一覧からは消す
        put(h.text);
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '✕';
      del.title = 'この下書きを削除';
      del.setAttribute('aria-label', 'この下書きを削除');
      del.style.cssText = 'flex:none;background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:6px 8px;border-radius:8px;opacity:.6;';
      del.addEventListener('click', () => {
        forget(chatKey(), h.text);
        closeMenu();
        if ((history[chatKey()] || []).length) toggleMenu();
        tick();
      });
      item.append(b, del);
      menu.appendChild(item);
    });
    const all = document.createElement('button');
    all.type = 'button';
    all.textContent = 'このチャットの以前の下書きをすべて削除';
    all.style.cssText = 'display:block;width:100%;text-align:left;background:none;border:0;border-top:1px solid rgba(128,128,128,.2);' +
      'color:#dc2626;font:inherit;cursor:pointer;padding:8px 8px 6px;margin-top:2px;';
    all.addEventListener('click', () => {
      forget(chatKey());
      closeMenu();
      tick();
    });
    menu.appendChild(all);
    chip.parentElement.appendChild(menu);
    menu.style.left = chip.style.left;
    setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true));
  }
  function outsideMenu(e) {
    if (menu && !menu.contains(e.target) && !(histBtn && histBtn.contains(e.target))) closeMenu();
  }
  function closeMenu() {
    if (menu) menu.remove();
    menu = null;
    document.removeEventListener('pointerdown', outsideMenu, true);
  }

  function buildChip() {
    chip = document.createElement('div');
    chip.id = 'muse-helper-draft-chip';
    chip.className = 'text-text-primary bg-fill-blur-thick backdrop-blur-elevation-01 shadow-blur-elevation-01 rounded-full';
    chip.style.cssText =
      'position:absolute;bottom:100%;margin-bottom:6px;z-index:1;pointer-events:auto;display:none;' +
      'align-items:center;font:12px/1.2 system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif;white-space:nowrap;overflow:hidden;';
    const btnCss = 'background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:5px 10px;';
    restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.style.cssText = btnCss + 'padding-right:6px;';
    restoreBtn.addEventListener('click', restore);
    const sep = document.createElement('span');
    sep.style.cssText = 'width:1px;align-self:stretch;margin:5px 0;background:currentColor;opacity:.2;';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.textContent = '✕';
    discard.title = '下書きを破棄';
    discard.setAttribute('aria-label', '下書きを破棄');
    discard.style.cssText = btnCss + 'padding-left:8px;opacity:.6;';
    discard.addEventListener('click', () => {
      deleteDraft(chatKey(), true);
      tick();
    });
    histSep = sep.cloneNode();
    histBtn = document.createElement('button');
    histBtn.type = 'button';
    histBtn.style.cssText = btnCss;
    histBtn.setAttribute('aria-haspopup', 'menu');
    histBtn.addEventListener('click', toggleMenu);
    chip.append(restoreBtn, sep, discard, histSep, histBtn);
  }

  function restore() {
    const d = drafts[chatKey()];
    if (d) put(d.text);
  }

  // 入力欄に文章を入れる
  function put(text) {
    const t = M.composerInput();
    if (!t) return;
    // React の制御下にある textarea なので、ネイティブの setter で値を入れてから input イベントで知らせる
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(t, text);
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.focus();
    try { t.setSelectionRange(text.length, text.length); } catch (e) {}
    tick();
  }

  function renderChip() {
    const t = M.composerInput();
    const d = drafts[chatKey()];
    const hist = history[chatKey()] || [];
    const show = enabled && loaded && t && !t.value && ((d && d.text) || hist.length);
    if (!show) {
      if (chip) chip.style.display = 'none';
      closeMenu();
      return;
    }
    if (!chip) buildChip();
    const { card, anchor } = M.composerLayout(t);
    if (!anchor) return;
    if (chip.parentElement !== anchor) anchor.appendChild(chip);
    const ar = anchor.getBoundingClientRect(), cr = card.getBoundingClientRect();
    const layout = `${Math.round(cr.left - ar.left)}`;
    if (layout !== lastLayout) {
      chip.style.left = `${Math.max(0, cr.left - ar.left) + 16}px`;
      lastLayout = layout;
    }
    // 今の下書きがなければ、以前の下書きのボタンだけ出す
    const hasDraft = !!(d && d.text);
    restoreBtn.style.display = hasDraft ? '' : 'none';
    restoreBtn.nextElementSibling.style.display = hasDraft ? '' : 'none';
    restoreBtn.nextElementSibling.nextElementSibling.style.display = hasDraft ? '' : 'none';
    if (hasDraft) {
      restoreBtn.textContent = `↩ 下書きを復元(${M.charCount(d.text).toLocaleString()}文字・${M.ago(Date.now() - d.at)})`;
      restoreBtn.title = d.text.length > 200 ? d.text.slice(0, 200) + '…' : d.text;
    }
    histSep.style.display = hasDraft && hist.length ? '' : 'none';
    histBtn.style.display = hist.length ? '' : 'none';
    histBtn.textContent = `以前の下書き(${hist.length})${menu ? ' ▴' : ' ▾'}`;
    chip.style.display = 'flex';
  }

  // 拡張機能の更新で読み込み直す前に入力していた文章(content.js が sessionStorage に預けたもの)を、
  // 下書きに保存して入力欄に戻す。入力欄が出るまで待つ(最大30秒)
  let pending = null;
  try {
    const raw = sessionStorage.getItem(M.PENDING_DRAFT);
    sessionStorage.removeItem(M.PENDING_DRAFT);
    const p = raw && JSON.parse(raw);
    if (p && typeof p.text === 'string' && p.text.trim() && p.path === chatKey() && Date.now() - p.at < 5 * 60 * 1000) pending = p;
  } catch (e) {}
  const pendingUntil = Date.now() + 30000;
  function restorePending() {
    if (!pending || !loaded) return;
    if (Date.now() > pendingUntil) { pending = null; return; }
    const t = M.composerInput();
    if (!t) return;
    const text = pending.text;
    pending = null;
    if (!t.value) {
      if (enabled) saveDraft(chatKey(), text);
      put(text);
    } else if (t.value !== text) {
      keep(chatKey(), text); // 何か入っていたら上書きせず「以前の下書き」に残す
    }
  }

  function tick() {
    if (!M.alive()) {
      if (chip) chip.style.display = 'none';
      return;
    }
    restorePending();
    watch();
    renderChip();
  }

  // ---------- 起動 ----------
  try {
    chrome.storage.local.get([KEY, ENABLED_KEY, HISTORY_KEY], (v) => {
      drafts = (v && v[KEY] && typeof v[KEY] === 'object' && v[KEY]) || {};
      history = (v && v[HISTORY_KEY] && typeof v[HISTORY_KEY] === 'object' && v[HISTORY_KEY]) || {};
      enabled = !(v && v[ENABLED_KEY] === false);
      loaded = true;
      purgeOld();
      tick();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[KEY]) drafts = changes[KEY].newValue || {}; // 他のタブや設定画面での変更
      if (changes[HISTORY_KEY]) history = changes[HISTORY_KEY].newValue || {};
      if (changes[ENABLED_KEY]) enabled = changes[ENABLED_KEY].newValue !== false;
      if (changes[KEY] || changes[ENABLED_KEY] || changes[HISTORY_KEY]) tick();
    });
  } catch (e) {}

  setInterval(() => {
    try { tick(); } catch (e) {}
  }, 400);
  setInterval(() => {
    try { if (loaded && M.alive()) purgeOld(); } catch (e) {}
  }, 60 * 60 * 1000);
})();
