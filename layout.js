// 表示の調整(isolated world)。
// - 本文の幅: メッセージの列(data-hatch-chat-column、標準は max-w-3xl = 48rem)の最大幅を変える
// - 文字の大きさ: メッセージ要素を zoom で拡大・縮小する
// - 長いメッセージの折りたたみ: 本文の高さが一定を超えるメッセージを途中まで表示し、
//   時刻ラベルの横のボタンで開閉する。Muse の要素には属性(data-muse-collapse)だけを付け、見た目は CSS で変える
// - 右上の「招待」ボタンと、左下の「Museアプリをダウンロード」ボタンを隠す(既定は表示)
// - 会話の途中に Muse が出す時刻の区切り(「19:59」「11月25日 16:38」)と、メッセージのメニュー(「…」・右クリック)の上部の日時
//   (「今日20:37」)を、設定の時刻の表記(12時間表記なら「4:38 pm」)に合わせる
// - 会話の一覧(サイドバー)の行にマウスを乗せたときの日時(「1h」「Wed」「Nov 17」)を日本語(「1時間」「水曜日」「11月17日」)にする
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

  // ---------- Muse の時刻の区切りの表記 ----------
  // 会話の途中の中央寄せの時刻(div.text-center > span.text-caption-1)。Muse は常に24時間表記なので、
  // 12時間表記のときは末尾の「16:38」を「4:38 pm」に書き換える。元の文字は data-muse-time24 に残し、24時間表記に戻すときに使う。
  // Muse が中身を変えたら(元の文字とも書き換えた文字とも違えば)、それを新しい元の文字とみなす
  const TIME_RE = /(\d{1,2}):(\d{2})$/;
  // 「今日20:37」のように前に文字が詰まっているときは、読みやすいよう間をあける(「今日 8:37 pm」)
  const to12 = (s) => s.replace(/([^\d\s]?)(\d{1,2}):(\d{2})$/, (_, pre, h, m) =>
    `${pre}${pre ? ' ' : ''}${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`);
  function convertTimes() {
    const fmt12 = M.fmt12();
    for (const span of document.querySelectorAll('div.text-center > span.text-caption-1, [role="menu"] > .text-caption-2:first-child')) {
      const t = span.firstChild;
      if (span.childNodes.length !== 1 || !t || t.nodeType !== 3 || M.isOwn(span)) continue;
      const cur = t.data;
      if (span.dataset.museTime24 == null || (cur !== span.dataset.museTime24 && cur !== span.dataset.museTime12)) {
        if (!TIME_RE.test(cur) || cur.length > 30) continue;
        span.dataset.museTime24 = cur;
        span.dataset.museTime12 = to12(cur);
      }
      const want = fmt12 ? span.dataset.museTime12 : span.dataset.museTime24;
      if (cur !== want) t.data = want;
    }
  }
  // ---------- 会話の一覧の日時を日本語に ----------
  // Muse は「20m」「1h」「Wed」「Nov 17」「Nov 17, 2025」のように英語で出すので書き換える(「Today」「Yesterday」が出ることもあるので、それも。読めない形ならそのまま)。
  // 元の文字は data-muse-orig に残し、Muse が中身を変えたら(元とも書き換え後とも違えば)新しい元の文字とみなす
  const WEEKDAYS = { Sun: '日曜日', Mon: '月曜日', Tue: '火曜日', Wed: '水曜日', Thu: '木曜日', Fri: '金曜日', Sat: '土曜日' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function toJa(t) {
    const s = t.trim();
    let m;
    if (/^(just )?now$/i.test(s)) return 'たった今';
    if (/^today$/i.test(s)) return '今日';
    if (/^yesterday$/i.test(s)) return '昨日';
    if ((m = s.match(/^(\d+)\s*(s|m|h|d|w|mo|y)$/))) {
      return m[1] + { s: '秒', m: '分', h: '時間', d: '日', w: '週間', mo: 'か月', y: '年' }[m[2]];
    }
    if (WEEKDAYS[s.slice(0, 3)] && /^[A-Z][a-z]{2,8}$/.test(s)) return WEEKDAYS[s.slice(0, 3)];
    if ((m = s.match(/^([A-Z][a-z]{2})[a-z]*\.? (\d{1,2})(?:, (\d{4}))?$/)) && MONTHS.includes(m[1])) {
      return `${m[3] ? m[3] + '年' : ''}${MONTHS.indexOf(m[1]) + 1}月${m[2]}日`;
    }
    return null;
  }
  function localizeRows() {
    for (const span of document.querySelectorAll('[data-testid="hatch-thread-row"] > span.text-caption-1')) {
      const t = span.firstChild;
      if (span.childNodes.length !== 1 || !t || t.nodeType !== 3) continue;
      const cur = t.data;
      if (span.dataset.museOrig == null || (cur !== span.dataset.museOrig && cur !== span.dataset.museJa)) {
        const ja = toJa(cur);
        if (!ja) continue;
        span.dataset.museOrig = cur;
        span.dataset.museJa = ja;
      }
      if (cur !== span.dataset.museJa) t.data = span.dataset.museJa;
    }
  }
  // 「20m」→「21m」のような更新は文字だけが変わり、下の MutationObserver(要素の追加・削除)では気づけないので、400ms ごとにも確かめる
  M.everyTick(() => { if (M.alive()) localizeRows(); });

  // 設定で表記を変えたとき(content.js が <html> の data-muse-ts-format を変える)
  new MutationObserver(convertTimes).observe(document.documentElement, { attributes: true, attributeFilter: ['data-muse-ts-format'] });

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
  let timeTimer = 0;
  new MutationObserver((list) => {
    // 時刻の区切りは、変化が続いていても0.1秒以内に書き換える(待ち続けて24時間表記のまま残らないよう、延ばさない)
    if (!timeTimer) timeTimer = setTimeout(() => { timeTimer = 0; if (M.alive()) { convertTimes(); localizeRows(); } }, 100);
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
