// 送信キーの切り替え(isolated world)。
// 「Ctrl/⌘+Enter で送信」モードのとき、入力欄での Enter を改行にし、Ctrl/⌘+Enter で送信する。
// 「Enter で送信」モード(既定)では何もしない(Muse の標準の動き)。
(() => {
  'use strict';
  const M = MuseHelper;
  const KEY = M.SEND_KEY_KEY;
  let mode = 'enter'; // 'enter' | 'mod-enter'

  const isComposer = (t) => t && t.tagName === 'TEXTAREA' && t === M.composerInput();


  // window のキャプチャで受けて、Muse(React のルート)や他のスクリプトより先に処理する
  window.addEventListener('keydown', (e) => {
    if (mode !== 'mod-enter' || e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    if (e.__museHelperSynthetic || !isComposer(e.target)) return;
    if (e.shiftKey || e.altKey) return; // Shift+Enter などは Muse の標準のまま
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.ctrlKey || e.metaKey) {
      if (e.target.value.trim()) M.send(e.target); // 送信ボタン(なければ Enter)で送る
    } else {
      M.insertText(e.target, '\n'); // 改行(元に戻す(⌘Z)も効く)
    }
  }, true);

  try {
    chrome.storage.local.get(KEY, (v) => { mode = v && v[KEY] === 'mod-enter' ? 'mod-enter' : 'enter'; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) mode = changes[KEY].newValue === 'mod-enter' ? 'mod-enter' : 'enter';
    });
  } catch (e) {}
})();
