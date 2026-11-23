// 入力欄の下書きをチャットごとに自動保存し、ボタンで復元できるようにする(isolated world)。
// - 入力が 0.5 秒止まったら chrome.storage.local に保存(キーはチャットの URL のパス)
// - 送信や手動での全消去で入力欄が空になったら、そのチャットの下書きを削除
// - 入力欄が空で下書きがあるときは、入力欄の左上に「下書きを復元」ボタンを出す
// - 30日より古い下書きは自動で削除
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

  function deleteDraft(key) {
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
  }

  // ---------- 入力の監視 ----------
  const isComposer = (t) => t && t === M.composerInput();

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!isComposer(t)) return;
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
      if (Date.now() - sendIntentAt < SEND_WINDOW || (sameInput && chatKey() === lastKey)) {
        clearTimeout(saveTimer);
        deleteDraft(lastKey);
      }
    }
    lastInput = t;
    lastValue = v;
  }

  // ---------- 復元ボタン ----------
  let chip = null, restoreBtn = null, lastLayout = '';

  function buildChip() {
    chip = document.createElement('div');
    chip.id = 'muse-helper-draft-chip';
    chip.className = 'text-text-primary bg-fill-blur-thick backdrop-blur-elevation-01 shadow-blur-elevation-01 rounded-full';
    chip.style.cssText =
      'position:absolute;bottom:100%;margin-bottom:6px;z-index:1;pointer-events:auto;display:none;' +
      'align-items:center;font:12px/1.2 system-ui,sans-serif;white-space:nowrap;overflow:hidden;';
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
      deleteDraft(chatKey());
      tick();
    });
    chip.append(restoreBtn, sep, discard);
  }

  function restore() {
    const t = M.composerInput();
    const d = drafts[chatKey()];
    if (!t || !d) return;
    // React の制御下にある textarea なので、ネイティブの setter で値を入れてから input イベントで知らせる
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(t, d.text);
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.focus();
    try { t.setSelectionRange(d.text.length, d.text.length); } catch (e) {}
    tick();
  }

  function renderChip() {
    const t = M.composerInput();
    const d = drafts[chatKey()];
    const show = enabled && loaded && t && !t.value && d && d.text;
    if (!show) {
      if (chip) chip.style.display = 'none';
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
    restoreBtn.textContent = `↩ 下書きを復元(${M.charCount(d.text).toLocaleString()}文字・${M.ago(Date.now() - d.at)})`;
    const preview = d.text.length > 200 ? d.text.slice(0, 200) + '…' : d.text;
    restoreBtn.title = preview;
    chip.style.display = 'flex';
  }

  function tick() {
    if (!M.alive()) {
      if (chip) chip.style.display = 'none';
      return;
    }
    watch();
    renderChip();
  }

  // ---------- 起動 ----------
  try {
    chrome.storage.local.get([KEY, ENABLED_KEY], (v) => {
      drafts = (v && v[KEY] && typeof v[KEY] === 'object' && v[KEY]) || {};
      enabled = !(v && v[ENABLED_KEY] === false);
      loaded = true;
      purgeOld();
      tick();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[KEY]) drafts = changes[KEY].newValue || {}; // 他のタブや設定画面での変更
      if (changes[ENABLED_KEY]) enabled = changes[ENABLED_KEY].newValue !== false;
      if (changes[KEY] || changes[ENABLED_KEY]) tick();
    });
  } catch (e) {}

  setInterval(() => {
    try { tick(); } catch (e) {}
  }, 400);
  setInterval(() => {
    try { if (loaded && M.alive()) purgeOld(); } catch (e) {}
  }, 60 * 60 * 1000);
})();
