// 送信キーの切り替え(isolated world)。
// 「Ctrl/⌘+Enter で送信」モードのとき、入力欄での Enter を改行にし、Ctrl/⌘+Enter で送信する。
// 「Enter で送信」モード(既定)では何もしない(Muse の標準の動き)。
(() => {
  'use strict';
  const M = MuseHelper;
  const KEY = M.SEND_KEY_KEY;
  let mode = 'enter'; // 'enter' | 'mod-enter'

  const isComposer = (t) => t && t.tagName === 'TEXTAREA' && t === M.composerInput();

  // 送信ボタン: 入力欄のカード内で、aria-label に「送信」「Send」を含むボタン
  function sendButton(t) {
    const { card } = M.composerLayout(t);
    return [...card.querySelectorAll('button')].find(
      (b) => /送信|send/i.test(b.getAttribute('aria-label') || '') && !b.disabled && b.getAttribute('aria-disabled') !== 'true',
    ) || null;
  }

  function send(t) {
    const btn = sendButton(t);
    if (btn) return btn.click();
    // ボタンが見つからなければ、修飾キーなしの Enter を入力欄に送って Muse 側の送信処理に任せる
    const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    ev.__museHelperSynthetic = true;
    t.dispatchEvent(ev);
  }

  // 改行を入れる(execCommand なら元に戻す(⌘Z)が効き、input イベントで Muse 側にも伝わる)
  function newline(t) {
    let ok = false;
    try { ok = document.execCommand('insertText', false, '\n'); } catch (e) {}
    if (!ok) {
      const { selectionStart: s, selectionEnd: e, value } = t;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(t, value.slice(0, s) + '\n' + value.slice(e));
      t.setSelectionRange(s + 1, s + 1);
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // window のキャプチャで受けて、Muse(React のルート)や他のスクリプトより先に処理する
  window.addEventListener('keydown', (e) => {
    if (mode !== 'mod-enter' || e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (e.__museHelperSynthetic || !isComposer(e.target)) return;
    if (e.shiftKey || e.altKey) return; // Shift+Enter などは Muse の標準のまま
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.ctrlKey || e.metaKey) {
      if (e.target.value.trim()) send(e.target);
    } else {
      newline(e.target);
    }
  }, true);

  try {
    chrome.storage.local.get(KEY, (v) => { mode = v && v[KEY] === 'mod-enter' ? 'mod-enter' : 'enter'; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) mode = changes[KEY].newValue === 'mod-enter' ? 'mod-enter' : 'enter';
    });
  } catch (e) {}
})();
