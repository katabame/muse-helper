// チャットの入力欄(textarea)に文字数カウンターを付ける(isolated world)。
// カウンターは入力欄のカード(Muse 側の要素)の中には入れず、その外側の右上に重ねて表示する。
(() => {
  'use strict';
  const ID = 'muse-helper-counter';

  const count = MuseHelper.charCount; // 絵文字や結合文字も1文字として数える

  let input = null, counter = null, lastValue = null, lastLayout = '';

  function build() {
    counter = document.createElement('div');
    counter.id = ID;
    // 下のメッセージと重なっても読めるよう、入力欄と同じすりガラスの背景を付ける(Muse のクラスを流用)
    counter.className = 'text-text-secondary bg-fill-blur-thick backdrop-blur-elevation-01 rounded-full px-2 py-0.5';
    counter.style.cssText =
      'position:absolute;bottom:100%;margin-bottom:6px;z-index:1;pointer-events:none;' +
      'font:12px/1.2 system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;display:none;';
  }

  function update() {
    const t = MuseHelper.composerInput();
    if (!t) {
      if (counter) counter.style.display = 'none';
      input = null;
      return;
    }
    if (!counter) build();
    const { card, anchor } = MuseHelper.composerLayout(t);
    if (!anchor) return;
    if (counter.parentElement !== anchor) anchor.appendChild(counter);

    // カードの右端に合わせる
    const ar = anchor.getBoundingClientRect(), cr = card.getBoundingClientRect();
    const layout = `${Math.round(ar.right - cr.right)}`;
    if (layout !== lastLayout) {
      counter.style.right = `${Math.max(0, ar.right - cr.right) + 16}px`;
      lastLayout = layout;
    }

    const v = t.value;
    if (t === input && v === lastValue) return;
    input = t;
    lastValue = v;
    const n = count(v);
    counter.textContent = `${n.toLocaleString()}文字`;
    counter.title = `空白・改行を除くと ${count(v.replace(/\s/g, '')).toLocaleString()}文字`;
    counter.style.display = n ? 'block' : 'none';
  }

  // 入力時はすぐ、送信後のクリアなど入力イベントの出ない変化は定期的に反映する
  document.addEventListener('input', (e) => {
    if (e.target && e.target.tagName === 'TEXTAREA') update();
  }, true);
  setInterval(() => {
    try { update(); } catch (e) {}
  }, 400);
  update();
})();
