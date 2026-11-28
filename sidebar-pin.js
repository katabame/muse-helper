// チャットのサイドバー(「チャット」ボタンで開く、メインチャットとサイドチャットの一覧)を固定する(isolated world)。
// - 一覧の上(検索欄の横)にピンのボタンを足し、押すと固定する。固定中は本文を右にずらして、一覧が本文に重ならないようにする
// - Muse は一覧の外を押す(pointerdown)と閉じる。閉じる処理は、押した要素が特定のセレクター
//   ([data-radix-menu-content] など、メニューやダイアログの中)の中なら閉じないので、固定中は
//   一覧の外で押された要素に一瞬だけその属性を付けて閉じないようにする(Muse の処理より先に動く capture のリスナーで)
// - 会話を選ぶと Muse が一覧を閉じるので、固定中は開き直す(開き直したときに検索欄へ移るフォーカスは元に戻す)
// - 「チャット」ボタンで閉じたときは固定をやめる
// - 一覧は幅 768px 以上(md)のときだけ表示されるので、それより狭いときは何もしない
(() => {
  'use strict';
  const M = MuseHelper;
  const KEY = M.SIDEBAR_PIN_KEY;
  const TRIGGER = '[data-testid="hatch-chat-switcher-trigger"]';
  const PANEL = '[data-hatch-side-chats-panel-visibility-animation]';
  const DOCK = '[data-hatch-dock]';
  const IGNORE = 'data-radix-menu-content'; // Muse の閉じる処理が無視する目印(メニューの中身)
  const PINNED = 'data-muse-sidebar-pinned'; // <html> に付けて、CSS で本文をずらす
  const BTN = 'muse-sidebar-pin';
  // lucide の pin
  const ICON_PIN = 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';

  let pinned = false;
  let loaded = false;
  let dockWidth = 312; // 一覧を開いたときのドックの幅(左のアイコンの列を含む)
  let reopening = 0; // 開き直しを頼んだ時刻(何度も押さないため)

  const style = document.createElement('style');
  style.textContent = `
    @media (min-width: 768px) {
      html[${PINNED}] [data-hatch-full-page-shell] { margin-inline-start: var(--muse-dock-width, 312px) !important; }
      html[${PINNED}] [data-hatch-shell-composer-layer] { left: var(--muse-dock-width, 312px) !important; }
      html[${PINNED}] [data-hatch-dock-surface] { box-shadow: none !important; }
      /* サイドチャットの見出しの「←」(メインチャットに戻る)。固定中は一覧の「メインチャット」で戻れるので隠す
         (見出しの左側のボタンのうち、「チャット」ボタン以外) */
      html[${PINNED}] [data-testid="hatch-chat-leading-controls"] > :not(:has(${TRIGGER})):not(${TRIGGER}) { display: none !important; }
    }
    .${BTN} { all: unset; box-sizing: border-box; flex: none; display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 9999px; cursor: pointer; color: inherit; opacity: .6; }
    .${BTN}:hover { background: rgba(128,128,128,.16); opacity: 1; }
    .${BTN}:focus-visible { outline: 2px solid #2a78d6; }
    .${BTN}[aria-pressed="true"] { opacity: 1; color: #2a78d6; }
    .${BTN}[aria-pressed="true"] svg path { fill: currentColor; }`;
  document.documentElement.appendChild(style);

  const panel = () => document.querySelector(PANEL);
  const dock = () => document.querySelector(DOCK);
  const trigger = () => document.querySelector(TRIGGER);
  // 一覧を出せる画面か(ドックが表示されていて、「チャット」ボタンがある)
  const available = () => {
    const d = dock();
    return !!(d && trigger() && getComputedStyle(d).display !== 'none');
  };
  // Muse のダイアログ(設定など)が開いているときは、開き直さない
  const dialogOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');

  function setPinned(v) {
    pinned = v;
    try { chrome.storage.local.set({ [KEY]: v }); } catch (e) {}
    apply();
  }

  // 本文のずれと、ピンのボタンの状態を合わせる
  function apply() {
    const p = panel();
    if (p) {
      const w = dock() && dock().getBoundingClientRect().width;
      if (w > 100) dockWidth = Math.round(w);
    }
    const root = document.documentElement;
    root.style.setProperty('--muse-dock-width', `${dockWidth}px`);
    // 開き直すまでの一瞬も本文を動かさないよう、一覧を出せる画面なら閉じていてもずらしたままにする
    if (pinned && available()) root.setAttribute(PINNED, '');
    else root.removeAttribute(PINNED);
    if (p) addButton(p);
    document.querySelectorAll('.' + BTN).forEach((b) => {
      const label = pinned ? 'サイドバーの固定をやめる' : 'サイドバーを固定する';
      if (b.getAttribute('aria-label') === label) return;
      b.setAttribute('aria-pressed', String(pinned));
      b.setAttribute('aria-label', label);
      b.title = label; // tooltip.js が自前のツールチップにする
    });
  }

  // 検索欄の行(検索欄と「…」ボタン)の、「…」の前にピンのボタンを足す
  function addButton(p) {
    if (p.querySelector('.' + BTN)) return;
    const input = p.querySelector('input');
    const row = input && input.parentElement && input.parentElement.parentElement;
    if (!row || !p.contains(row)) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = BTN;
    b.appendChild(M.icon(ICON_PIN, { size: 16 }));
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setPinned(!pinned);
    });
    const more = row.lastElementChild;
    if (more && more !== input.parentElement) row.insertBefore(b, more);
    else row.appendChild(b);
  }

  // 固定中に閉じていたら開き直す(会話を選んだときなど)
  function keepOpen() {
    if (!pinned || !loaded || panel() || !available() || dialogOpen()) return;
    if (Date.now() - reopening < 1500) return;
    reopening = Date.now();
    const prev = document.activeElement;
    trigger().click();
    // 開くと少し遅れて検索欄にフォーカスが移るので、しばらくの間(押したり打ったりするまで)元の場所に戻す。
    // 元の場所がなければ(ページを開いた直後など)メッセージの入力欄へ
    const until = Date.now() + 1200;
    let touched = false;
    const touch = () => { touched = true; };
    document.addEventListener('pointerdown', touch, { capture: true, once: true });
    document.addEventListener('keydown', touch, { capture: true, once: true });
    const restore = () => {
      const p = panel();
      if (p) { reopening = 0; apply(); }
      const a = document.activeElement;
      if (!touched && p && a && p.contains(a)) {
        const back = prev && prev !== document.body && prev.isConnected && !p.contains(prev)
          ? prev : document.querySelector('[data-hatch-shell-composer-layer] textarea');
        if (back) back.focus({ preventScroll: true }); else a.blur();
      }
      if (!touched && Date.now() < until) requestAnimationFrame(restore);
      else {
        document.removeEventListener('pointerdown', touch, true);
        document.removeEventListener('keydown', touch, true);
      }
    };
    requestAnimationFrame(restore);
  }

  // 一覧の外で押されたとき、Muse の閉じる処理(document の pointerdown)より先に目印を付ける。
  // 次のタスクで外すので、ほかの処理には影響しない
  document.addEventListener('pointerdown', (e) => {
    if (!pinned || !panel()) return;
    const t = e.target instanceof Element ? e.target : e.target && e.target.parentElement;
    if (!t || t.closest(DOCK) || t.closest(`[${IGNORE}]`)) return;
    t.setAttribute(IGNORE, '');
    setTimeout(() => t.removeAttribute(IGNORE), 0);
  }, true);

  // 「チャット」ボタンで閉じたら固定をやめる(開くときは何もしない)
  document.addEventListener('click', (e) => {
    if (!pinned || !e.isTrusted || !panel()) return;
    const t = e.target instanceof Element && e.target.closest(TRIGGER);
    if (t) setPinned(false);
  }, true);

  // 一覧が閉じたらすぐ開き直せるよう、ドックの中の変化を見る(400ms ごとの確認は予備)
  let observed = null;
  const obs = new MutationObserver(() => { apply(); keepOpen(); });
  M.everyTick(() => {
    if (!M.alive()) return;
    const d = dock();
    if (d !== observed) {
      obs.disconnect();
      observed = d;
      if (d) obs.observe(d, { childList: true, subtree: true });
    }
    apply();
    keepOpen();
  });

  try {
    chrome.storage.local.get(KEY, (v) => {
      pinned = !!(v && v[KEY]);
      loaded = true;
      apply();
      keepOpen();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) {
        pinned = !!changes[KEY].newValue;
        apply();
        keepOpen();
      }
    });
  } catch (e) {}
})();
