// 表示の調整(isolated world)。
// - 本文の幅: メッセージの列(data-hatch-chat-column、標準は max-w-3xl = 48rem)の最大幅を変える
// - 文字の大きさ: メッセージ要素を zoom で拡大・縮小する
// - 長いメッセージの折りたたみ: 本文の高さが一定を超えるメッセージを途中まで表示し、
//   時刻ラベルの横のボタンで開閉する。Muse の要素には属性(data-muse-collapse)だけを付け、見た目は CSS で変える
// - 右上の「招待」ボタンと、左下の「Museアプリをダウンロード」ボタンを隠す(既定は表示)
(() => {
  'use strict';
  const M = MuseHelper;
  const LIMIT = 360; // 折りたたんだときの高さ(px)
  const MIN = LIMIT + 160; // これより高いメッセージだけ折りたたむ
  const BTN = 'muse-collapse-btn';
  const WIDTH = { narrow: '38rem', default: '', wide: '64rem', full: 'none' };

  let width = 'default';
  let scale = 100;
  let collapse = false;
  let hideInvite = false;
  let hideAppDownload = false;
  const expanded = new Set(); // 開いたメッセージの ID

  const style = document.createElement('style');
  const fixed = document.createElement('style');
  fixed.textContent = `
    /* メッセージ要素は縦並びの flex。overflow: hidden を付けると本文が縮められて高さ 0 になり、
       時刻ラベル(flex: 0 0 100%)がその分を埋めてしまうので、本文は縮めず、ラベルは中身の高さにする */
    [data-muse-collapse="1"] > .muse-ts-label { flex-basis: auto !important; }
    [data-muse-collapse="1"] > :not(.muse-ts-label) { max-height: ${LIMIT}px; overflow: hidden; flex-shrink: 0;
      -webkit-mask-image: linear-gradient(#000 calc(100% - 64px), transparent); mask-image: linear-gradient(#000 calc(100% - 64px), transparent); }
    .${BTN} { all: unset; box-sizing: border-box; pointer-events: auto; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;
      vertical-align: -2px; margin: 0 2px 0 6px; padding: 1px 4px; border-radius: 4px; color: inherit; }
    .${BTN}::after { content: attr(data-label); font-size: 11px; }
    .${BTN} svg { width: 12px; height: 12px; }
    .${BTN}:hover { background: rgba(128,128,128,.16); }
    .${BTN}:focus-visible { outline: 2px solid #2a78d6; }`;
  document.documentElement.append(fixed, style);

  function applyStyle() {
    const rules = [];
    if (WIDTH[width]) rules.push(`[data-hatch-chat-column="true"] { max-width: ${WIDTH[width]} !important; }`);
    if (scale !== 100) rules.push(`[data-message-id] { zoom: ${scale / 100}; }`);
    if (hideInvite) rules.push('[data-testid="hatch-invite-friends-button"] { display: none !important; }');
    // 左のアイコンの列の項目(.hatch-dock-reveal-item)ごと隠す。列の下部(ダウンロードと「≡」の入れ物)には
    // Muse がボタン2つ分の min-height を直接指定しているので、それも外して、空いた分を上のスペースの一覧に回す
    if (hideAppDownload) {
      rules.push('.hatch-dock-reveal-item:has([data-testid="app-download-dock-mark"]) { display: none !important; }');
      rules.push('[data-testid="hatch-dock-rail"] > :has(> * > [data-testid="hatch-dock-more"]) { min-height: 0 !important; }');
    }
    style.textContent = rules.join('\n');
  }

  // 大きさは CSS(.muse-collapse-btn svg)で決める
  const chevron = (up) => M.icon(up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6', { size: null });

  // 本文の高さ(時刻ラベルを除く子要素のうち一番高いもの)
  function contentHeight(el) {
    let h = 0;
    for (const c of el.children) if (!c.classList.contains('muse-ts-label')) h = Math.max(h, c.scrollHeight);
    return h;
  }

  function setCollapsed(el, on) {
    if (on) el.setAttribute('data-muse-collapse', '1');
    else el.removeAttribute('data-muse-collapse');
  }

  function scan() {
    if (!M.alive()) return;
    for (const m of M.messages()) {
      const label = m.el.querySelector(':scope > .muse-ts-label');
      let b = label && label.querySelector(':scope > .' + BTN);
      if (!collapse) {
        setCollapsed(m.el, false);
        if (b) b.remove();
        continue;
      }
      const isOpen = expanded.has(m.id);
      // 折りたたみ中は本文の scrollHeight(はみ出しを含む高さ)で判断できる
      const long = contentHeight(m.el) > MIN;
      if (!long) {
        setCollapsed(m.el, false);
        if (b) b.remove();
        continue;
      }
      setCollapsed(m.el, !isOpen);
      if (!label) continue;
      if (!b) {
        // 文字は CSS(data-label)で出す(timestamps.js はラベルの textContent で描き直しの要否を判断するため)
        b = document.createElement('button');
        b.type = 'button';
        b.className = BTN;
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const msg = b.closest('[data-message-id]');
          if (msg) toggle(msg);
        });
        label.appendChild(b);
      }
      const want = isOpen ? 'open' : 'closed';
      if (b.dataset.state !== want) {
        b.dataset.state = want;
        b.replaceChildren(chevron(isOpen));
        b.dataset.label = isOpen ? '折りたたむ' : '全文を表示';
        b.setAttribute('aria-expanded', String(isOpen));
        b.setAttribute('aria-label', isOpen ? 'メッセージを折りたたむ' : 'メッセージの全文を表示');
      }
    }
  }

  function toggle(el) {
    const id = el.getAttribute('data-message-id');
    if (expanded.has(id)) {
      expanded.delete(id);
      scan();
      M.scrollToMessage(el, 'start'); // 折りたたむと位置がずれるので、メッセージの先頭に戻す
    } else {
      expanded.add(id);
      scan();
    }
  }

  // 検索などから: 折りたたまれていれば開く
  function expand(el) {
    const id = el && el.getAttribute('data-message-id');
    if (!id || !el.hasAttribute('data-muse-collapse')) return;
    expanded.add(id);
    scan();
  }
  M.collapse = { expand };

  let timer;
  new MutationObserver((list) => {
    if (!collapse) return;
    if (list.every((m) => m.target.closest && m.target.closest('.' + BTN))) return;
    clearTimeout(timer);
    timer = setTimeout(scan, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });

  try {
    const K = [M.CHAT_WIDTH_KEY, M.FONT_SCALE_KEY, M.COLLAPSE_KEY, M.HIDE_INVITE_KEY, M.HIDE_APP_DOWNLOAD_KEY];
    const apply = (k, v) => {
      if (k === M.CHAT_WIDTH_KEY) width = WIDTH[v] !== undefined ? v : 'default';
      if (k === M.FONT_SCALE_KEY) scale = [80, 90, 100, 110, 125].includes(v) ? v : 100;
      if (k === M.COLLAPSE_KEY) collapse = v === true;
      if (k === M.HIDE_INVITE_KEY) hideInvite = v === true;
      if (k === M.HIDE_APP_DOWNLOAD_KEY) hideAppDownload = v === true;
    };
    chrome.storage.local.get(K, (v) => {
      K.forEach((k) => apply(k, v && v[k]));
      applyStyle();
      scan();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !K.some((k) => changes[k])) return;
      K.forEach((k) => { if (changes[k]) apply(k, changes[k].newValue); });
      applyStyle();
      scan();
    });
  } catch (e) {}
})();
