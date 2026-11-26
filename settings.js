// muse.ai の設定ダイアログに「Muse Helper」の項目を追加する(isolated world)。
// サイドバーに項目を足し、選ばれている間だけ右側の本来のページを隠して独自ページを表示する。
// Muse 側(React)が管理する要素の属性は書き換えず、CSS とダイアログに付けたクラスだけで切り替える。
(() => {
  'use strict';
  const TS_FMT_KEY = 'museTsFormat'; // '12' | '24'(content.js / timestamps.js が参照)
  const TS_MODE_KEY = 'museTsMode'; // 'abs' | 'rel' | 'both'(時刻のみ / 相対時刻のみ / 両方)
  const NAV = 'muse-helper-nav';
  const PANE = 'muse-helper-pane';
  const OPEN = 'muse-helper-open'; // 独自ページ表示中にダイアログへ付けるクラス
  const RIGHT = 'data-muse-helper-right'; // 右ペインの目印
  const TITLES = ['設定', 'Settings'];

  let tsFormat = '24';
  let tsMode = 'abs';
  const normMode = (v) => (v === 'rel' || v === 'both' ? v : 'abs');
  let update = null; // background.js が保存する GitHub Releases の確認結果
  let checking = false;
  let usage = null; // content.js が保存する使用率 { used, reset, at, ... }
  let history = []; // 使用率の記録 [{ used, at }]
  let autoStatus = null; // usage-main.js からの自動更新の状態 { auto, lastFetchAt, lastError, intervalMs }
  let showPace = true; // オーバーレイに使用ペースを表示するか
  let draftsEnabled = true; // 下書きの自動保存
  let drafts = {}; // 保存中の下書き { [path]: { text, at } }
  let confirmClearUntil = 0; // 「すべて削除」の確認待ちの期限
  let devMode = false; // デベロッパーモード
  let sendKey = 'enter'; // 'enter' | 'mod-enter'
  // オン/オフだけの設定(既定値)。スイッチは data-pref で対応付ける
  const prefs = {
    [MuseHelper.DATE_SEP_KEY]: true,
    [MuseHelper.RESP_TIME_KEY]: true,
    [MuseHelper.NOTIFY_KEY]: true,
    [MuseHelper.SHORTCUTS_KEY]: true,
    [MuseHelper.RESET_NOTIFY_KEY]: true,
    [MuseHelper.REPLY_NOTIFY_KEY]: true,
    [MuseHelper.REPLY_PREVIEW_KEY]: false,
    [MuseHelper.COLLAPSE_KEY]: false,
    [MuseHelper.SIDEBAR_BADGE_KEY]: true,
    [MuseHelper.BOOKMARK_AUTOLOAD_KEY]: true,
  };
  let chatWidth = 'default'; // 本文の幅
  let fontScale = 100; // 文字の大きさ(%)
  let lowConfirm = 10; // 残りがこの % 以下なら送信前に確認(0 でオフ)
  let shortcutKeys = {}; // 変更したショートカットのキー { id: code }
  let capturing = null; // キーの変更を待っているショートカットの id
  let shortcutMsg = '';
  let draftHistory = {}; // 以前の下書き { [path]: [{ text, at }] }
  const PREF_DEFAULTS = { ...prefs };
  const prefValue = (k, v) => (typeof v === 'boolean' ? v : PREF_DEFAULTS[k]);
  let snippets = []; // 定型文 [{ id, title, text }]
  let snippetEditing = null; // 編集中の定型文の ID('new' は追加)
  let snippetConfirm = { id: null, until: 0 }; // 削除の確認待ち
  let activity = null; // 利用の記録 { days: { 'YYYY-MM-DD': { sent, recv, sentChars, recvChars } } }
  let pendingImport = null; // 読み込み待ちのバックアップ { name, data, exportedAt }
  let backupStatus = '';
  let bookmarkCount = 0;

  // ---------- スタイル ----------
  const style = document.createElement('style');
  style.textContent = `
    .${OPEN} [${RIGHT}] > :not(.${PANE}):not(span.contents):not(.pointer-events-none) { display: none !important; }
    [${RIGHT}] > .${PANE} { display: none; }
    .${OPEN} [${RIGHT}] > .${PANE} { display: flex; }
    /* 独自ページ表示中は、本来の選択中項目のハイライトを消す */
    .${OPEN} button[data-active="true"]:not(.${NAV}):not(:hover) { background-color: transparent !important; }
    .${PANE} [role="radio"] { cursor: pointer; }
    .${PANE} [role="radio"] .muse-helper-check { visibility: hidden; }
    .${PANE} [role="radio"][aria-checked="true"] .muse-helper-check { visibility: visible; }
    /* 使用率グラフの系列色(既定パレットの1番目。Muse のダークモードは <html class="dark">) */
    /* 先週の線は2番目(オレンジ)。どちらのモードも検証スクリプトで確認済み */
    .${PANE} .muse-helper-chart { --muse-helper-series: #2a78d6; --muse-helper-prev: #eb6834; --muse-helper-surface: #fcfcfb; }
    html.dark .${PANE} .muse-helper-chart { --muse-helper-series: #3987e5; --muse-helper-prev: #d95926; --muse-helper-surface: #1a1a19; }
    .${PANE} .muse-helper-act-chart { --muse-helper-series: #2a78d6; --muse-helper-surface: #fcfcfb;
      --seq-0: rgba(128,128,128,.12); --seq-1: #d4e4f7; --seq-2: #a3c6ee; --seq-3: #6aa0e2; --seq-4: #2a78d6; --seq-5: #1b4f90; }
    html.dark .${PANE} .muse-helper-act-chart { --muse-helper-series: #3987e5; --muse-helper-surface: #1a1a19;
      --seq-0: rgba(128,128,128,.14); --seq-1: #1e3048; --seq-2: #23497a; --seq-3: #2b66ad; --seq-4: #3987e5; --seq-5: #86b6f0; }
    /* 入力欄とボタン(定型文・バックアップ) */
    .${PANE} .muse-helper-field { box-sizing: border-box; width: 100%; padding: 6px 10px; font: inherit; color: inherit; background: transparent;
      border: 1px solid rgba(128,128,128,.4); border-radius: 8px; outline: none; }
    .${PANE} .muse-helper-field:focus { border-color: #2a78d6; }
    .${PANE} textarea.muse-helper-field { resize: vertical; min-height: 84px; line-height: 1.5; }
    .${PANE} .muse-helper-btn { box-sizing: border-box; padding: 4px 12px; border-radius: 8px; font: inherit; cursor: pointer;
      color: inherit; background: rgba(128,128,128,.14); border: none; }
    .${PANE} .muse-helper-btn:hover { background: rgba(128,128,128,.24); }
    .${PANE} .muse-helper-btn.primary { color: #fff; background: #2a78d6; }
    .${PANE} .muse-helper-btn.primary:hover { background: #2368bd; }
    .${PANE} .muse-helper-btn.danger { color: #dc2626; }
    .${PANE} .muse-helper-btn:focus-visible, .${PANE} .muse-helper-field:focus-visible { outline: 2px solid #2a78d6; outline-offset: 1px; }
    /* オン/オフのスイッチ */
    .${PANE} [role="switch"] { cursor: pointer; }
    .muse-helper-switch { position: relative; width: 40px; height: 24px; border-radius: 12px; flex: none;
      background: rgba(120,120,128,.32); transition: background-color .15s; }
    .muse-helper-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px;
      border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .15s; }
    [role="switch"][aria-checked="true"] .muse-helper-switch { background: #34c759; }
    [role="switch"][aria-checked="true"] .muse-helper-switch::after { transform: translateX(16px); }
  `;
  (document.head || document.documentElement).appendChild(style);

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(size, d, strokeWidth) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', strokeWidth);
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
    return s;
  }
  // 設定画面のサイドバーの Muse Helper のアイコン。拡張機能のアイコン(icons/icon.svg)の「手書きの m」と ✦ を、
  // Muse のほかの項目のアイコンに合わせて単色(currentColor)の線で描く
  function logoIcon(size) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('viewBox', '8 16 108 108');
    s.setAttribute('aria-hidden', 'true');
    const m = document.createElementNS(SVG_NS, 'path');
    m.setAttribute('d', 'M16 50 L31 28 L25 90 L55 32 L50 90 L79 44 L77 78');
    m.setAttribute('fill', 'none');
    m.setAttribute('stroke', 'currentColor');
    m.setAttribute('stroke-width', '9');
    m.setAttribute('stroke-linecap', 'round');
    m.setAttribute('stroke-linejoin', 'round');
    const star = document.createElementNS(SVG_NS, 'path');
    star.setAttribute('d', 'M101 86 Q102.8 98.2 115 100 Q102.8 101.8 101 114 Q99.2 101.8 87 100 Q99.2 98.2 101 86 Z');
    star.setAttribute('fill', 'currentColor');
    s.append(m, star);
    return s;
  }
  const ICON_CHECK = 'M5 12.5l4.5 4.5L19 7.5';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- 設定ダイアログの検出 ----------
  function findSettings() {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const h2 = [...dialog.querySelectorAll('h2')].find((h) => TITLES.includes(h.textContent.trim()));
      if (!h2) continue;
      // h2 から親をたどり、「次の兄弟(右ペイン)の中にページ見出し h2 がある」要素を左カラムとみなす
      let left = h2;
      while (left && left !== dialog && !(left.nextElementSibling && left.nextElementSibling.querySelector('h2'))) {
        left = left.parentElement;
      }
      if (!left || left === dialog) continue;
      const first = left.querySelector('button');
      if (!first) continue;
      return { dialog, left, right: left.nextElementSibling, navList: first.parentElement, sample: first };
    }
    return null;
  }

  // ---------- サイドバー項目 ----------
  function buildNav(sample) {
    const b = sample.cloneNode(true); // 見た目だけ複製(React のハンドラは付かない)
    b.classList.add(NAV);
    b.removeAttribute('id');
    b.setAttribute('data-active', 'false');
    b.removeAttribute('aria-current');
    const label = b.querySelector('span.block') || b.querySelector('div span') || b;
    label.textContent = 'Muse Helper';
    const icon = b.querySelector(':scope > span');
    if (icon) {
      const ref = sample.querySelector(':scope > span svg');
      const size = (ref && ref.getAttribute('width')) || '20';
      icon.replaceChildren(logoIcon(size));
    }
    return b;
  }

  // ---------- 右側のページ ----------
  function buildPane() {
    const pane = el('div', `${PANE} flex flex-col min-h-0 flex-1 overflow-y-auto`);

    const header = el('div', 'z-10 hidden md:block');
    const headerRow = el('div', 'relative z-10 flex shrink-0 items-center h-15 pe-6 ps-6');
    headerRow.appendChild(el('h2', 'text-title-3-emphasized text-text-primary', 'Muse Helper'));
    header.appendChild(headerRow);

    const body = el('div', 'space-y-6 pb-4 px-6');
    body.appendChild(buildPaceSection());
    body.appendChild(buildActivitySection());
    body.appendChild(buildStatsSection());
    body.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', 'メッセージの時刻'));

    const group = el('div', 'flex flex-col gap-2');
    group.appendChild(radioCard('mode', '時刻の表示内容', [
      { value: 'abs', title: '時刻のみ', example: '例: 15:05' },
      { value: 'rel', title: '相対時刻のみ', example: '例: 5分前(7日以上前は日付と時刻)' },
      { value: 'both', title: '時刻と相対時刻', example: '例: 15:05・5分前' },
    ], setMode));
    group.appendChild(radioCard('format', '時刻の表記', [
      { value: '24', title: '24時間表記', example: '例: 15:05' },
      { value: '12', title: '12時間表記', example: '例: 3:05 pm' },
    ], setFormat));
    const extras = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    extras.appendChild(prefSwitch(MuseHelper.DATE_SEP_KEY, '日付の区切り線', '日付が変わるところに「── 11月23日(月) ──」の線を入れます'));
    extras.appendChild(divider());
    extras.appendChild(prefSwitch(MuseHelper.RESP_TIME_KEY, '応答時間', `${MuseHelper.otherName()}の返信の時刻に「・12秒で応答」のように添えます`));
    group.appendChild(extras);
    body.appendChild(group);

    body.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', '表示'));
    const view = el('div', 'flex flex-col gap-2');
    view.appendChild(radioCard('width', '本文の幅', [
      { value: 'narrow', title: '狭い', example: '標準の約0.8倍' },
      { value: 'default', title: '標準', example: 'Muse の標準の幅' },
      { value: 'wide', title: '広い', example: '標準の約1.3倍' },
      { value: 'full', title: '画面いっぱい', example: 'ウィンドウの幅に合わせます' },
    ], (v) => setLayout(MuseHelper.CHAT_WIDTH_KEY, v)));
    view.appendChild(radioCard('scale', '文字の大きさ', [
      { value: '80', title: '特小(80%)', example: 'メッセージを小さく表示します' },
      { value: '90', title: '小さめ(90%)', example: 'メッセージを少し小さく表示します' },
      { value: '100', title: '標準', example: 'Muse の標準の大きさ' },
      { value: '110', title: '大きめ(110%)', example: 'メッセージを少し大きく表示します' },
      { value: '125', title: '特大(125%)', example: 'メッセージを大きく表示します' },
    ], (v) => setLayout(MuseHelper.FONT_SCALE_KEY, Number(v))));
    const viewExtras = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    viewExtras.appendChild(prefSwitch(MuseHelper.COLLAPSE_KEY, '長いメッセージを折りたたむ',
      'とても長いメッセージを途中まで表示し、時刻の横の「全文を表示」で開きます。表示が崩れる場合はオフにしてください'));
    view.appendChild(viewExtras);
    body.appendChild(view);

    body.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', '入力'));
    const input = el('div', 'flex flex-col gap-2');
    body.appendChild(input);
    input.appendChild(radioCard('sendkey', '送信キー', [
      { value: 'enter', title: 'Enter で送信', example: 'Muse の標準の動き(Shift+Enter で改行)' },
      { value: 'mod-enter', title: 'Ctrl/⌘+Enter で送信', example: 'Enter で改行します。長い文章を書くときの誤送信を防げます' },
    ], setSendKey));
    input.appendChild(radioCard('lowconfirm', '残りが少ないときの送信前の確認', [
      { value: '0', title: '確認しない', example: '' },
      { value: '5', title: '残り 5% 以下で確認', example: '' },
      { value: '10', title: '残り 10% 以下で確認', example: '送信の前に「残り 8% です。送信しますか？」と確認します(送ったあと30分は聞きません)' },
      { value: '20', title: '残り 20% 以下で確認', example: '' },
    ], (v) => setLayout(MuseHelper.LOW_CONFIRM_KEY, Number(v))));
    body.appendChild(buildSnippetsSection());
    body.appendChild(buildShortcutsSection());
    body.appendChild(buildBookmarksSection());

    body.appendChild(buildNotifySection());
    body.appendChild(buildDraftsSection());
    body.appendChild(buildBackupSection());
    body.appendChild(buildUpdateSection());
    body.appendChild(buildDevSection());

    pane.append(header, body);
    syncPane(pane);
    return pane;
  }

  // 選択肢のカード(行をクリックで選択、選ばれた行にチェック)
  function radioCard(groupName, label, options, onChoose) {
    const card = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    card.setAttribute('role', 'radiogroup');
    card.setAttribute('aria-label', label);
    options.forEach((o, i) => {
      if (i > 0) card.appendChild(el('div', 'h-px bg-black/[0.04] dark:bg-white/[0.06] mx-3'));
      const row = el('div', 'box-border flex min-w-0 items-center self-stretch min-h-[44px] rounded-12 px-3 hover:bg-fill-secondary-elevated');
      row.setAttribute('role', 'radio');
      row.setAttribute('tabindex', '0');
      row.dataset.group = groupName;
      row.dataset.value = o.value;
      const texts = el('div', 'min-w-0 flex-1 self-center');
      const col = el('div', 'min-h-0 min-w-0 flex flex-col gap-x-0.5 gap-y-0.5');
      col.append(
        el('span', 'mx-0 break-words text-subheadline text-text-primary', o.title),
        el('span', 'mx-0 break-words text-caption-1 text-text-secondary', o.example),
      );
      texts.appendChild(col);
      const check = el('div', 'muse-helper-check flex items-center self-center ps-2 text-text-primary');
      check.appendChild(svg('20', ICON_CHECK, 2.2));
      row.append(texts, check);
      const choose = () => onChoose(o.value);
      row.addEventListener('click', choose);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
      });
      card.appendChild(row);
    });
    return card;
  }

  // ---------- 使用ペース ----------
  const PACE_ROWS = [
    ['week', '週の経過'],
    ['target', '目安との比較'],
    ['avg', '平均ペースでの予測'],
    ['recent', '直近ペースでの予測'],
  ];

  function buildPaceSection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', '使用ペース'));
    const card = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    card.appendChild(el('div', 'muse-helper-chart px-3 pt-2 pb-1'));
    PACE_ROWS.forEach(([key, title]) => {
      card.appendChild(divider());
      const r = row('muse-helper-pace-' + key);
      r.appendChild(texts(title, ''));
      const value = el('div', 'muse-helper-pace-value flex items-center self-center ps-2 text-subheadline text-text-primary text-end');
      r.appendChild(value);
      card.appendChild(r);
    });
    wrap.appendChild(card);
    wrap.appendChild(el('div', 'muse-helper-pace-note px-3 pt-1.5 text-caption-1 text-text-secondary'));

    // オーバーレイに表示する/しない
    const optCard = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5 mt-3');
    optCard.appendChild(switchRow('muse-helper-pace-toggle', 'オーバーレイに表示', '使用率のオーバーレイに予測の行を表示します', () => {
      showPace = !showPace;
      document.querySelectorAll('.' + PANE).forEach(syncPace);
      try { chrome.storage.local.set({ [MuseHelper.PACE_BADGE_KEY]: showPace }); } catch (e) {}
    }));
    wrap.appendChild(optCard);
    return wrap;
  }

  function syncPace(pane) {
    const chart = pane.querySelector('.muse-helper-chart');
    if (chart) {
      try { renderChart(chart); } catch (e) { chart.textContent = ''; }
    }
    const get = (key) => {
      const r = pane.querySelector('.muse-helper-pace-' + key);
      return r && { value: r.querySelector('.muse-helper-pace-value'), sub: r.querySelector('.text-caption-1') };
    };
    const note = pane.querySelector('.muse-helper-pace-note');
    if (!note) return;
    const sw = pane.querySelector('.muse-helper-pace-toggle');
    if (sw) sw.setAttribute('aria-checked', String(showPace));
    const set = (key, value, sub, sev) => {
      const r = get(key);
      r.value.textContent = value;
      r.value.style.color = sev >= 0 ? MuseHelper.SEVERITY_COLOR[sev] : '';
      r.sub.textContent = sub;
    };
    const M = MuseHelper, fmt12 = tsFormat === '12';
    const f = M.forecast(usage, history);

    if (!f || f.resetPassed) {
      const msg = !usage ? '使用率がまだ取得されていません' :
        !f ? 'リセット日が取得できていません' : 'リセット日を過ぎています';
      set('week', '—', msg + '(「一般」の利用状況を開くと取得されます)', -1);
      ['target', 'avg', 'recent'].forEach((k) => set(k, '—', '', -1));
      note.textContent = '';
      return;
    }

    const span = `${M.when(f.weekStart, fmt12, f.exactReset)} 〜 ${M.when(f.resetAt, fmt12, f.exactReset)}`;
    set('week', `${Math.round(f.elapsed * 100)}%`, f.exactReset ? span : `${span}(リセットは 0:00 と仮定)`, -1);

    const diffSev = f.diff > 10 ? 2 : f.diff > 0 ? 1 : 0;
    set('target', `${M.signed(f.diff)}%`,
      `目安 ${Math.round(f.target)}% に対して ${f.used}% 使用` +
      (f.diff > 0 ? '(使いすぎ)' : '(余裕あり)'), diffSev);

    const proj = (key, p, desc) => {
      if (p.insufficient) return set(key, '—', p.insufficient, -1);
      set(key, M.projText(p, fmt12), `${desc}1日あたり ${p.perDay.toFixed(1)}%`, M.severity(p));
    };
    proj('avg', f.avg, '週の始まりから ');
    proj('recent', f.recent, f.recent.insufficient ? '' :
      `直近 ${Math.round(f.recent.span / M.HOUR)}時間で ${M.signed(f.recent.delta)}% ・ `);

    const auto = autoStatus && autoStatus.auto;
    note.textContent =
      `最終取得: ${M.ago(Date.now() - f.at)}。` +
      (!auto ? '自動更新は停止中です(設定画面の「一般」を一度開くと始まり、次からはページを開くだけで自動更新します)。'
        : autoStatus.lastError ? `自動更新(${Math.round(autoStatus.intervalMs / 60000)}分ごと)の前回の取得に失敗しました: ${autoStatus.lastError}`
        : `自動更新: 有効(${Math.round(autoStatus.intervalMs / 60000)}分ごと。タブが裏にあっても更新し、複数のタブで開いているときは1つのタブだけが取得します)。`);
  }

  // オン/オフのスイッチ行(状態は aria-checked で表す)
  function switchRow(cls, title, sub, onToggle) {
    return actionRow(cls, 'switch', title, sub, onToggle, el('div', 'muse-helper-switch'));
  }
  // クリック・Enter・スペースで動く行
  function actionRow(cls, role, title, sub, onClick, trailing) {
    const r = row(cls + ' hover:bg-fill-secondary-elevated');
    r.setAttribute('role', role);
    r.setAttribute('tabindex', '0');
    r.style.cursor = 'pointer';
    r.appendChild(texts(title, sub));
    if (trailing) {
      const w = el('div', 'flex items-center self-center ps-2');
      w.appendChild(trailing);
      r.appendChild(w);
    }
    r.addEventListener('click', onClick);
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    });
    return r;
  }

  // オン/オフの設定のスイッチ
  function prefSwitch(key, title, sub) {
    const r = switchRow('muse-helper-pref', title, sub, () => {
      prefs[key] = !prefs[key];
      document.querySelectorAll('.' + PANE).forEach(syncPrefs);
      try { chrome.storage.local.set({ [key]: prefs[key] }); } catch (e) {}
    });
    r.dataset.pref = key;
    return r;
  }
  function syncPrefs(pane) {
    pane.querySelectorAll('[data-pref]').forEach((r) => r.setAttribute('aria-checked', String(!!prefs[r.dataset.pref])));
  }

  function setSendKey(v) {
    sendKey = v === 'mod-enter' ? 'mod-enter' : 'enter';
    document.querySelectorAll('.' + PANE).forEach(syncPane);
    try { chrome.storage.local.set({ [MuseHelper.SEND_KEY_KEY]: sendKey }); } catch (e) {}
  }

  // ---------- この会話(統計) ----------
  // 表示中のメッセージから数える(Muse が読み込んでいない古いメッセージは含まれない)
  function conversationStats() {
    const list = MuseHelper.messages();
    if (!list.length) return null;
    const side = { user: { n: 0, chars: 0 }, other: { n: 0, chars: 0 } };
    const resp = [];
    let prev = null;
    for (const m of list) {
      const s = m.user ? side.user : side.other;
      s.n++;
      s.chars += MuseHelper.charCount(MuseHelper.messageText(m.el).replace(/\s+/g, ''));
      // 応答時間: 自分のメッセージの直後の相手のメッセージまで(1日以上は除く。timestamps.js と同じ)
      if (!m.user && prev && prev.user && m.at != null && prev.at != null) {
        const d = m.at - prev.at;
        if (d >= 0 && d < MuseHelper.DAY) resp.push(d);
      }
      prev = m;
    }
    const times = list.map((m) => m.at).filter((t) => t != null);
    resp.sort((a, b) => a - b);
    return {
      total: list.length, user: side.user, other: side.other, resp,
      first: times.length ? Math.min(...times) : null, last: times.length ? Math.max(...times) : null,
    };
  }

  function buildStatsSection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', 'この会話'));
    const card = el('div', 'muse-helper-stats bg-fill-secondary-elevated rounded-16 p-1.5');
    wrap.appendChild(card);
    return wrap;
  }

  function syncStats(pane) {
    const card = pane.querySelector('.muse-helper-stats');
    if (!card) return;
    const M = MuseHelper, fmt12 = tsFormat === '12';
    const st = conversationStats();
    const rows = [];
    if (!st) {
      rows.push(['会話を開いているときに表示されます', '会話の画面で設定を開くと、メッセージ数や文字数などを確認できます']);
    } else {
      const n = (v) => v.toLocaleString();
      const avg = (s) => (s.n ? `平均 ${n(Math.round(s.chars / s.n))}字` : '');
      const other = M.otherName();
      rows.push([`メッセージ ${n(st.total)}件`, `自分 ${n(st.user.n)}件 ・ ${other} ${n(st.other.n)}件`]);
      rows.push([`文字数 ${n(st.user.chars + st.other.chars)}字(空白を除く)`,
        `自分 ${n(st.user.chars)}字(${avg(st.user)}) ・ ${other} ${n(st.other.chars)}字(${avg(st.other)})`]);
      if (st.resp.length) {
        const r = st.resp, mid = r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2;
        const mean = r.reduce((a, b) => a + b, 0) / r.length;
        rows.push([`応答時間 中央値 ${M.duration(mid)}`,
          `平均 ${M.duration(mean)} ・ 最短 ${M.duration(r[0])} ・ 最長 ${M.duration(r[r.length - 1])}(${r.length}回)`]);
      }
      if (st.first != null) {
        const [da, ...ta] = M.when(st.first, fmt12, true).split(' '), [db, ...tb] = M.when(st.last, fmt12, true).split(' ');
        rows.push([da === db ? `${da} ${ta.join(' ')} 〜 ${tb.join(' ')}` : `${da} ${ta.join(' ')} 〜 ${db} ${tb.join(' ')}`,
          st.last > st.first ? `期間 ${M.duration(st.last - st.first)}` : '']);
      }
      rows.push(['', '表示中のメッセージから数えています。読み込まれていない古いメッセージは含まれません']);
    }
    // 中身が同じなら作り直さない
    const sig = JSON.stringify(rows);
    if (card.dataset.sig === sig) return;
    card.dataset.sig = sig;
    card.textContent = '';
    rows.forEach(([title, sub], i) => {
      if (i) card.appendChild(divider());
      const r = row();
      r.appendChild(title ? texts(title, sub || null) : texts('', sub));
      if (!title) r.querySelector('.text-subheadline').remove();
      card.appendChild(r);
    });
  }

  // ---------- ショートカット ----------
  const codes = () => MuseHelper.shortcutCodes(shortcutKeys);
  const altName = () => (MuseHelper.ALT === '⌥' ? 'Option' : 'Alt');
  const keyText = (id) => MuseHelper.ALT + MuseHelper.keyLabel(codes()[id]);

  function buildShortcutsSection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', 'キーボードショートカット'));
    const card = el('div', 'muse-helper-shortcuts bg-fill-secondary-elevated rounded-16 p-1.5');
    card.appendChild(prefSwitch(MuseHelper.SHORTCUTS_KEY, 'ショートカットを使う', ''));
    card.firstChild.querySelector('.text-caption-1').classList.add('muse-helper-sc-sub');
    for (const sc of MuseHelper.SHORTCUTS) {
      card.appendChild(divider());
      const r = row();
      r.dataset.shortcut = sc.id;
      r.appendChild(texts(sc.title, sc.sub || null));
      const k = el('kbd', 'muse-helper-sc-key text-subheadline text-text-secondary ps-2 self-center');
      k.style.fontFamily = 'ui-monospace, monospace';
      const change = el('button', 'muse-helper-btn ms-2 self-center', '変更');
      change.type = 'button';
      change.addEventListener('click', () => {
        capturing = capturing === sc.id ? null : sc.id;
        shortcutMsg = capturing ? `${altName()} キーを押しながら、割り当てたいキーを押してください(Esc でやめる)` : '';
        document.querySelectorAll('.' + PANE).forEach(syncShortcuts);
      });
      r.append(k, change);
      card.appendChild(r);
    }
    card.appendChild(divider());
    const foot = row('muse-helper-sc-foot');
    foot.appendChild(texts('', ''));
    foot.querySelector('.text-subheadline').remove();
    const reset = el('button', 'muse-helper-btn ms-2 self-center', '既定に戻す');
    reset.type = 'button';
    reset.addEventListener('click', () => saveShortcutKeys({}, '既定のキーに戻しました'));
    foot.appendChild(reset);
    card.appendChild(foot);
    wrap.appendChild(card);
    return wrap;
  }

  function saveShortcutKeys(next, msg) {
    shortcutKeys = next;
    capturing = null;
    shortcutMsg = msg || '';
    try { chrome.storage.local.set({ [MuseHelper.SHORTCUT_KEYS_KEY]: shortcutKeys }); } catch (e) {}
    document.querySelectorAll('.' + PANE).forEach(syncPane);
  }

  function syncShortcuts(pane) {
    const card = pane.querySelector('.muse-helper-shortcuts');
    if (!card) return;
    card.querySelector('.muse-helper-sc-sub').textContent =
      `${altName()} キーと組み合わせて使います。会話の画面で ${keyText('help')} を押すと一覧が出ます`;
    card.querySelectorAll('[data-shortcut]').forEach((r) => {
      const id = r.dataset.shortcut;
      r.querySelector('.muse-helper-sc-key').textContent = capturing === id ? 'キーを押してください…' : keyText(id);
      r.querySelector('.muse-helper-btn').textContent = capturing === id ? 'やめる' : '変更';
    });
    const changed = Object.keys(shortcutKeys).length > 0;
    card.querySelector('.muse-helper-sc-foot .text-caption-1').textContent =
      shortcutMsg || (changed ? '一部のキーを変更しています' : '「変更」を押すと、キーを割り当て直せます');
  }

  // キーの割り当ての受け付け(変更を押したあとの次のキー)
  document.addEventListener('keydown', (e) => {
    if (!capturing) return;
    if (['Alt', 'Shift', 'Control', 'Meta'].includes(e.key) || e.isComposing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
      capturing = null;
      shortcutMsg = '';
      document.querySelectorAll('.' + PANE).forEach(syncShortcuts);
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) {
      shortcutMsg = `${altName()} キーを押しながら押してください(Ctrl・⌘ は使えません)`;
      document.querySelectorAll('.' + PANE).forEach(syncShortcuts);
      return;
    }
    const cur = codes();
    const other = MuseHelper.SHORTCUTS.find((sc) => sc.id !== capturing && cur[sc.id] === e.code);
    if (other) {
      shortcutMsg = `${MuseHelper.ALT}${MuseHelper.keyLabel(e.code)} は「${other.title}」で使っています`;
      document.querySelectorAll('.' + PANE).forEach(syncShortcuts);
      return;
    }
    const def = MuseHelper.SHORTCUTS.find((sc) => sc.id === capturing);
    const next = { ...shortcutKeys };
    if (def && def.code === e.code) delete next[capturing]; else next[capturing] = e.code;
    saveShortcutKeys(next, `「${def ? def.title : ''}」を ${MuseHelper.ALT}${MuseHelper.keyLabel(e.code)} にしました`);
  }, true);

  // ---------- ブックマーク ----------
  // 設定ダイアログを閉じる(Muse の「閉じる」ボタン。なければ Esc)
  function closeSettings() {
    const s = findSettings();
    const btn = s && s.dialog.querySelector('button[aria-label="閉じる"], button[aria-label="Close"]');
    if (btn) btn.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }

  function buildBookmarksSection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', 'ブックマーク'));
    const card = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    const countRow = row();
    countRow.appendChild(texts('保存中のブックマーク', 'メッセージにマウスを乗せ、時刻の横の ☆ を押すと追加できます'));
    countRow.appendChild(el('div', 'muse-helper-bm-num flex items-center self-center ps-2 text-subheadline text-text-primary'));
    card.appendChild(countRow);
    card.appendChild(divider());
    card.appendChild(actionRow('muse-helper-bm-open', 'button', '一覧を開く', `設定を閉じて一覧を表示します(${keyText('bookmarks')} でも開けます)`, () => {
      closeSettings();
      setTimeout(() => MuseHelper.bookmarks && MuseHelper.bookmarks.open(), 150);
    }));
    card.appendChild(divider());
    card.appendChild(prefSwitch(MuseHelper.SIDEBAR_BADGE_KEY, 'サイドバーにブックマーク数を表示',
      'ブックマークがある会話の名前の横に「★2」のように件数を出します'));
    card.appendChild(divider());
    card.appendChild(prefSwitch(MuseHelper.BOOKMARK_AUTOLOAD_KEY, '過去のメッセージを自動で読み込んで移動',
      'まだ読み込まれていないメッセージへ移動するとき、見つかるまで会話を上へ読み込みます。オフのときや見つからなかったときは、保存した全文を表示します'));
    wrap.appendChild(card);
    return wrap;
  }

  function syncBookmarks(pane) {
    const num = pane.querySelector('.muse-helper-bm-num');
    if (num) num.textContent = `${bookmarkCount}件`;
  }

  // ---------- 利用の記録(日ごとのメッセージ数) ----------
  function buildActivitySection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', '利用の記録'));
    const card = el('div', 'muse-helper-activity bg-fill-secondary-elevated rounded-16 p-1.5');
    wrap.appendChild(card);
    return wrap;
  }

  function syncActivity(pane) {
    const card = pane.querySelector('.muse-helper-activity');
    if (!card) return;
    const M = MuseHelper, fmt12 = tsFormat === '12';
    const days = (activity && activity.days) || {};
    const sig = JSON.stringify([days, fmt12, M.dayKey(Date.now())]);
    if (card.dataset.sig === sig) return;
    card.dataset.sig = sig;
    const wasOpen = !!card.querySelector('details[open]');
    card.textContent = '';
    const keys = Object.keys(days).sort();
    if (!keys.length) {
      const r = row();
      r.appendChild(texts('まだ記録がありません', 'muse.ai を開いている間に送ったメッセージと届いた返信を、日ごとに数えます'));
      card.appendChild(r);
      return;
    }
    // 直近28日(今日を含む)
    const today = new Date();
    const list = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const k = M.dayKey(d.getTime());
      list.push({ d, k, ...(days[k] || { sent: 0, recv: 0, sentChars: 0, recvChars: 0 }) });
    }
    const sum = (arr, f) => arr.reduce((a, b) => a + b[f], 0);
    const n = (v) => v.toLocaleString();
    const last7 = list.slice(-7), prev7 = list.slice(-14, -7);
    const t = list[list.length - 1];
    const rows = [
      [`今日 送信 ${n(t.sent)}件 ・ 返信 ${n(t.recv)}件`, `送信した文字数 ${n(t.sentChars)}字`],
      [`直近7日 送信 ${n(sum(last7, 'sent'))}件`, `その前の7日 ${n(sum(prev7, 'sent'))}件(${M.signed(sum(last7, 'sent') - sum(prev7, 'sent'))}件) ・ 返信 ${n(sum(last7, 'recv'))}件`],
      [`直近28日 送信 ${n(sum(list, 'sent'))}件`, `1日平均 ${(sum(list, 'sent') / 28).toFixed(1)}件 ・ 送信した文字数 ${n(sum(list, 'sentChars'))}字`],
    ];
    rows.forEach(([a, b], i) => {
      if (i) card.appendChild(divider());
      const r = row();
      r.appendChild(texts(a, b));
      card.appendChild(r);
    });
    card.appendChild(divider());
    const box = el('div', 'muse-helper-act-chart px-3 pt-2 pb-1');
    card.appendChild(box);
    renderActivityChart(box, list, fmt12, wasOpen);
    if (list.some((p) => p.hours)) {
      card.appendChild(divider());
      const hb = el('div', 'muse-helper-act-chart px-3 pt-2 pb-1');
      card.appendChild(hb);
      renderHeatmap(hb, list, !!card.dataset.heatOpen);
      hb.querySelector('details').addEventListener('toggle', (e) => { card.dataset.heatOpen = e.target.open ? '1' : ''; });
    }
    const first = keys[0].split('-');
    const foot = row();
    foot.appendChild(texts('', `${Number(first[1])}/${Number(first[2])} から記録しています。muse.ai を開いているタブで、新しく送った・届いたメッセージを数えます`));
    foot.querySelector('.text-subheadline').remove();
    card.appendChild(foot);
  }

  // 日ごとの送信数の棒グラフ(1系列なので凡例なし。マウスを乗せると値、表で見るで一覧)
  function renderActivityChart(box, list, fmt12, wasOpen) {
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    const W = 560, H = 140, L = 30, R = 8, T = 10, B = 22;
    const max = Math.max(...list.map((x) => x.sent));
    const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
    const top = Math.max(step * Math.ceil(max / step), step * 2);
    const slot = (W - L - R) / list.length;
    const bw = Math.max(4, slot - 2); // 2px の間隔
    const x = (i) => L + i * slot + (slot - bw) / 2;
    const y = (v) => T + (1 - v / top) * (H - T - B);
    const label = (d) => `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;

    const wrap = el('div', '');
    wrap.style.cssText = 'position:relative;';
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
      'aria-label': `直近28日の送信数。合計 ${list.reduce((a, b) => a + b.sent, 0)}件、最多 ${max}件` });
    svg.style.cssText = 'display:block;overflow:visible;font:10px system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif;';
    wrap.appendChild(svg);
    box.appendChild(wrap);

    const grid = s('g', { stroke: 'currentColor', 'stroke-opacity': '0.12', 'stroke-width': '1' }, svg);
    for (const v of [0, top / 2, top]) {
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v) }, grid);
      const t = s('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = String(v);
    }
    list.forEach((p, i) => {
      if ((list.length - 1 - i) % 7) return; // 今日から7日おきに日付
      const t = s('text', { x: x(i) + bw / 2, y: H - B + 14, 'text-anchor': 'middle', fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = i === list.length - 1 ? '今日' : `${p.d.getMonth() + 1}/${p.d.getDate()}`;
    });
    // 棒(上の角だけ 4px の丸み。0件は描かない)
    const series = 'var(--muse-helper-series)';
    const bars = list.map((p, i) => {
      if (!p.sent) return null;
      const x0 = x(i), y0 = y(p.sent), y1 = y(0), r = Math.min(4, bw / 2, y1 - y0);
      return s('path', { d: `M${x0},${y1} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${y1} Z`, fill: series }, svg);
    });

    const tip = el('div', 'text-caption-1 text-text-primary');
    tip.style.cssText = 'position:absolute;top:0;pointer-events:none;display:none;white-space:nowrap;padding:4px 8px;border-radius:8px;' +
      'background:var(--muse-helper-surface);box-shadow:0 1px 6px rgba(0,0,0,.25);';
    wrap.appendChild(tip);
    const hit = s('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(list.length - 1, Math.floor((px - L) / slot)));
      const p = list[i];
      bars.forEach((b, j) => b && b.setAttribute('fill-opacity', j === i ? '1' : '0.55'));
      tip.textContent = '';
      tip.append(`${label(p.d)} `, el('b', '', `送信 ${p.sent}件`), ` ・ 返信 ${p.recv}件 ・ ${p.sentChars.toLocaleString()}字`);
      tip.style.display = 'block';
      const left = ((x(i) + bw / 2) / W) * r.width;
      tip.style.left = `${Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth)}px`;
    });
    hit.addEventListener('pointerleave', () => {
      bars.forEach((b) => b && b.removeAttribute('fill-opacity'));
      tip.style.display = 'none';
    });

    const details = el('details', 'text-caption-1 text-text-secondary');
    details.style.cssText = 'margin-top:4px;';
    const summary = el('summary', '', '表で見る(直近28日)');
    summary.style.cursor = 'pointer';
    details.appendChild(summary);
    const table = el('table', '');
    table.style.cssText = 'margin-top:4px;border-collapse:collapse;font-variant-numeric:tabular-nums;';
    const head = el('tr', '');
    ['日付', '送信', '返信', '送信した文字数'].forEach((h, i) => {
      const th = el('th', '', h);
      th.style.cssText = `padding:1px ${i ? '0 1px 16px' : '16px 1px 0'};font-weight:normal;text-align:${i ? 'right' : 'left'};`;
      head.appendChild(th);
    });
    table.appendChild(head);
    [...list].reverse().forEach((p) => {
      const tr = el('tr', '');
      [label(p.d), `${p.sent}件`, `${p.recv}件`, `${p.sentChars.toLocaleString()}字`].forEach((v, i) => {
        const td = el('td', i === 1 ? 'text-text-primary' : '', v);
        td.style.cssText = `padding:1px ${i ? '0 1px 16px' : '16px 1px 0'};text-align:${i ? 'right' : 'left'};`;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    details.appendChild(table);
    details.open = wasOpen;
    box.appendChild(details);
  }

  // 曜日と時間帯ごとの送信数(直近28日の合計)。1つの色の濃さで表す(数が多いほど濃い)
  function renderHeatmap(box, list, wasOpen) {
    const WD = ['月', '火', '水', '木', '金', '土', '日'];
    const grid = WD.map(() => new Array(24).fill(0));
    for (const p of list) {
      if (!p.hours) continue;
      const wd = (p.d.getDay() + 6) % 7; // 月曜始まり
      for (const [h, n] of Object.entries(p.hours)) grid[wd][Number(h)] += n;
    }
    const max = Math.max(...grid.flat());
    const level = (n) => (!n ? 0 : Math.min(5, Math.ceil((n / max) * 5)));
    box.appendChild(el('div', 'text-caption-1 text-text-secondary', 'よく送る曜日と時間帯(直近28日の送信数)'));

    const W = 560, L = 22, T = 4, B = 18, cw = (W - L) / 24, ch = 14, H = T + ch * 7 + B;
    const wrap = el('div', '');
    wrap.style.cssText = 'position:relative;margin-top:4px;';
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': '曜日と時間帯ごとの送信数' });
    svg.style.cssText = 'display:block;overflow:visible;font:10px system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif;';
    wrap.appendChild(svg);
    box.appendChild(wrap);
    WD.forEach((w, r) => {
      const t = s('text', { x: L - 6, y: T + r * ch + ch / 2 + 3.5, 'text-anchor': 'end', fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = w;
    });
    for (const h of [0, 6, 12, 18]) {
      const t = s('text', { x: L + h * cw, y: H - 4, fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = `${h}時`;
    }
    const cells = [];
    grid.forEach((rowv, r) => rowv.forEach((n, h) => {
      // 2px の間隔をあけたマス
      cells.push(s('rect', { x: L + h * cw + 1, y: T + r * ch + 1, width: cw - 2, height: ch - 2, rx: 2, fill: `var(--seq-${level(n)})` }, svg));
    }));
    const tip = el('div', 'text-caption-1 text-text-primary');
    tip.style.cssText = 'position:absolute;top:0;pointer-events:none;display:none;white-space:nowrap;padding:4px 8px;border-radius:8px;' +
      'background:var(--muse-helper-surface);box-shadow:0 1px 6px rgba(0,0,0,.25);transform:translateY(-100%);';
    wrap.appendChild(tip);
    const outline = s('rect', { width: cw, height: ch, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', rx: 3, visibility: 'hidden' }, svg);
    const hit = s('rect', { x: L, y: T, width: W - L, height: ch * 7, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
      const h = Math.max(0, Math.min(23, Math.floor((px - L) / cw))), row = Math.max(0, Math.min(6, Math.floor((py - T) / ch)));
      outline.setAttribute('x', L + h * cw);
      outline.setAttribute('y', T + row * ch);
      outline.setAttribute('visibility', 'visible');
      tip.textContent = '';
      tip.append(`${WD[row]}曜 ${h}時台 `, el('b', '', `${grid[row][h]}件`));
      tip.style.display = 'block';
      const left = ((L + h * cw + cw / 2) / W) * r.width;
      tip.style.left = `${Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth)}px`;
      tip.style.top = `${((T + row * ch) / H) * r.height - 4}px`;
    });
    hit.addEventListener('pointerleave', () => { outline.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });

    // 凡例(少ない → 多い)
    const legend = el('div', 'text-caption-1 text-text-secondary');
    legend.style.cssText = 'display:flex;align-items:center;gap:3px;justify-content:flex-end;margin-top:2px;';
    legend.append('少ない ');
    for (let i = 0; i <= 5; i++) {
      const sw = el('span', '');
      sw.style.cssText = `display:inline-block;width:12px;height:10px;border-radius:2px;background:var(--seq-${i});`;
      legend.appendChild(sw);
    }
    legend.append(' 多い');
    box.appendChild(legend);

    // 表で見る: 送信の多い時間帯の上位
    const details = el('details', 'text-caption-1 text-text-secondary');
    details.style.cssText = 'margin-top:4px;';
    const summary = el('summary', '', '表で見る(送信の多い時間帯)');
    summary.style.cursor = 'pointer';
    details.appendChild(summary);
    const top = [];
    grid.forEach((rowv, r) => rowv.forEach((n, h) => { if (n) top.push({ r, h, n }); }));
    top.sort((a, b) => b.n - a.n);
    const table = el('table', '');
    table.style.cssText = 'margin-top:4px;border-collapse:collapse;font-variant-numeric:tabular-nums;';
    top.slice(0, 15).forEach((c) => {
      const tr = el('tr', '');
      const a = el('td', '', `${WD[c.r]}曜 ${c.h}時台`);
      const b = el('td', 'text-text-primary', `${c.n}件`);
      a.style.cssText = 'padding:1px 16px 1px 0;';
      b.style.textAlign = 'right';
      tr.append(a, b);
      table.appendChild(tr);
    });
    details.appendChild(table);
    details.open = wasOpen;
    box.appendChild(details);
  }

  // ---------- 定型文 ----------
  function buildSnippetsSection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', '定型文'));
    wrap.appendChild(el('div', 'muse-helper-snippets bg-fill-secondary-elevated rounded-16 p-1.5'));
    return wrap;
  }

  function saveSnippets(next) {
    snippets = next;
    try { chrome.storage.local.set({ [MuseHelper.SNIPPETS_KEY]: snippets }); } catch (e) {}
    document.querySelectorAll('.' + PANE).forEach(syncSnippets);
  }

  function snippetForm(sn) {
    const f = el('div', 'flex flex-col gap-2 px-3 py-2');
    const title = el('input', 'muse-helper-field');
    title.type = 'text';
    title.maxLength = 60;
    title.placeholder = '名前(例: 要約のお願い)';
    title.setAttribute('aria-label', '定型文の名前');
    title.value = sn ? sn.title : '';
    const text = el('textarea', 'muse-helper-field');
    text.placeholder = '挿入する文章(例: 次の文章を要約してください。\n\n{選択中の文字}{カーソル})';
    text.setAttribute('aria-label', '挿入する文章');
    text.value = sn ? sn.text : '';
    const btns = el('div', 'flex gap-2 justify-end');
    const cancel = el('button', 'muse-helper-btn', 'キャンセル');
    const ok = el('button', 'muse-helper-btn primary', '保存');
    cancel.type = ok.type = 'button';
    cancel.addEventListener('click', () => { snippetEditing = null; document.querySelectorAll('.' + PANE).forEach(syncSnippets); });
    ok.addEventListener('click', () => {
      const v = { title: title.value.trim(), text: text.value };
      if (!v.text.trim()) return text.focus();
      snippetEditing = null;
      if (sn) saveSnippets(snippets.map((x) => (x.id === sn.id ? { ...x, ...v } : x)));
      else saveSnippets([...snippets, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...v }]);
    });
    btns.append(cancel, ok);
    const hint = el('div', 'text-caption-1 text-text-secondary',
      '{日付} {時刻} {曜日} {選択中の文字} {クリップボード} は挿入するときに中身に置き換わります。{カーソル} の位置にカーソルを置きます');
    f.append(title, text, hint, btns);
    setTimeout(() => (sn ? text : title).focus());
    return f;
  }

  function syncSnippets(pane) {
    const card = pane.querySelector('.muse-helper-snippets');
    if (!card) return;
    const confirming = snippetConfirm.until > Date.now() ? snippetConfirm.id : null;
    const sig = JSON.stringify([snippets, snippetEditing, confirming]);
    if (card.dataset.sig === sig) return; // 入力中に作り直さない
    card.dataset.sig = sig;
    card.textContent = '';
    snippets.forEach((sn, i) => {
      if (i) card.appendChild(divider());
      if (snippetEditing === sn.id) return card.appendChild(snippetForm(sn));
      const r = row();
      r.appendChild(texts(sn.title || '(名前なし)', sn.text.replace(/\s+/g, ' ').slice(0, 80)));
      const btns = el('div', 'flex gap-1 self-center ps-2');
      const edit = el('button', 'muse-helper-btn', '編集');
      const del = el('button', 'muse-helper-btn danger', confirming === sn.id ? 'もう一度押すと削除' : '削除');
      edit.type = del.type = 'button';
      edit.addEventListener('click', () => { snippetEditing = sn.id; document.querySelectorAll('.' + PANE).forEach(syncSnippets); });
      del.addEventListener('click', () => {
        if (confirming !== sn.id) {
          snippetConfirm = { id: sn.id, until: Date.now() + 3000 };
          document.querySelectorAll('.' + PANE).forEach(syncSnippets);
          setTimeout(() => document.querySelectorAll('.' + PANE).forEach(syncSnippets), 3100);
          return;
        }
        snippetConfirm = { id: null, until: 0 };
        saveSnippets(snippets.filter((x) => x.id !== sn.id));
      });
      btns.append(edit, del);
      r.appendChild(btns);
      card.appendChild(r);
    });
    if (snippets.length) card.appendChild(divider());
    if (snippetEditing === 'new') card.appendChild(snippetForm(null));
    else {
      card.appendChild(actionRow('muse-helper-snippet-add', 'button', '定型文を追加',
        `会話の画面で ${keyText('snippet')} を押すと一覧が出て、選ぶと入力欄に挿入します`, () => {
          snippetEditing = 'new';
          document.querySelectorAll('.' + PANE).forEach(syncSnippets);
        }));
    }
  }

  // ---------- バックアップ ----------
  // muse で始まるキーをまとめて JSON に。アップデート確認の結果と通知済みの記録は含めない
  const BACKUP_SKIP = [MuseHelper.UPDATE_KEY, MuseHelper.NOTIFIED_KEY];
  const backupKey = (k) => /^muse/.test(k) && !BACKUP_SKIP.includes(k);

  function buildBackupSection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', 'バックアップ'));
    const card = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    card.appendChild(actionRow('muse-helper-backup-export', 'button', 'ファイルに書き出す',
      '設定・使用率の記録・下書き・ブックマーク・定型文・利用の記録を JSON ファイルに保存します', exportBackup));
    card.appendChild(divider());
    const file = el('input', '');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.style.display = 'none';
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (f) readBackup(f);
    });
    card.appendChild(file);
    card.appendChild(actionRow('muse-helper-backup-import', 'button', 'ファイルから読み込む',
      '書き出したファイルを選ぶと、内容を確認してから読み込みます', () => file.click()));
    // 読み込みの確認
    const confirm = el('div', 'muse-helper-backup-confirm');
    const cr = row();
    cr.appendChild(texts('', '今の設定とデータは、ファイルの内容で上書きされます'));
    cr.firstChild.querySelector('.text-subheadline').classList.add('muse-helper-backup-what');
    const btns = el('div', 'flex gap-1 self-center ps-2');
    const no = el('button', 'muse-helper-btn', 'やめる');
    const yes = el('button', 'muse-helper-btn primary', '読み込む');
    no.type = yes.type = 'button';
    no.addEventListener('click', () => { pendingImport = null; backupStatus = ''; document.querySelectorAll('.' + PANE).forEach(syncBackup); });
    yes.addEventListener('click', applyBackup);
    btns.append(no, yes);
    cr.appendChild(btns);
    confirm.append(divider(), cr);
    card.appendChild(confirm);
    const status = row('muse-helper-backup-status');
    status.appendChild(texts('', ''));
    status.querySelector('.text-subheadline').remove();
    card.appendChild(status);
    wrap.appendChild(card);
    return wrap;
  }

  function syncBackup(pane) {
    const confirm = pane.querySelector('.muse-helper-backup-confirm');
    if (!confirm) return;
    confirm.style.display = pendingImport ? '' : 'none';
    if (pendingImport) {
      const d = pendingImport.exportedAt ? new Date(pendingImport.exportedAt) : null;
      pane.querySelector('.muse-helper-backup-what').textContent = `「${pendingImport.name}」を読み込みますか？(${Object.keys(pendingImport.data).length}項目` +
        (d && !isNaN(d) ? `、${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} に書き出し` : '') + ')';
    }
    const status = pane.querySelector('.muse-helper-backup-status');
    status.style.display = backupStatus ? '' : 'none';
    status.querySelector('.text-caption-1').textContent = backupStatus;
  }

  function exportBackup() {
    try {
      chrome.storage.local.get(null, (all) => {
        const data = {};
        for (const k of Object.keys(all || {})) if (backupKey(k)) data[k] = all[k];
        const json = JSON.stringify({ app: 'muse-helper', version: MuseHelper.version(), exportedAt: new Date().toISOString(), data }, null, 2);
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = el('a', '');
        a.href = url;
        a.download = `muse-helper-backup-${MuseHelper.dayKey(Date.now())}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        backupStatus = `書き出しました(${Object.keys(data).length}項目)`;
        document.querySelectorAll('.' + PANE).forEach(syncBackup);
      });
    } catch (e) {
      backupStatus = `書き出せませんでした: ${(e && e.message) || e}`;
      document.querySelectorAll('.' + PANE).forEach(syncBackup);
    }
  }

  async function readBackup(f) {
    pendingImport = null;
    try {
      const j = JSON.parse(await f.text());
      if (!j || j.app !== 'muse-helper' || !j.data || typeof j.data !== 'object') throw new Error('Muse Helper のバックアップファイルではありません');
      const data = {};
      for (const k of Object.keys(j.data)) if (backupKey(k)) data[k] = j.data[k];
      if (!Object.keys(data).length) throw new Error('読み込める項目がありません');
      pendingImport = { name: f.name, data, exportedAt: j.exportedAt };
      backupStatus = '';
    } catch (e) {
      backupStatus = `読み込めませんでした: ${(e && e.message) || e}`;
    }
    document.querySelectorAll('.' + PANE).forEach(syncBackup);
  }

  function applyBackup() {
    if (!pendingImport) return;
    const n = Object.keys(pendingImport.data).length;
    try {
      chrome.storage.local.set(pendingImport.data, () => {
        backupStatus = chrome.runtime.lastError ? `読み込めませんでした: ${chrome.runtime.lastError.message}`
          : `読み込みました(${n}項目)。ほかの muse.ai のタブは再読み込みすると反映されます`;
        document.querySelectorAll('.' + PANE).forEach(syncBackup);
      });
    } catch (e) {
      backupStatus = `読み込めませんでした: ${(e && e.message) || e}`;
    }
    pendingImport = null;
    document.querySelectorAll('.' + PANE).forEach(syncBackup);
  }

  // ---------- 通知 ----------
  function buildNotifySection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', '通知'));
    const card = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    card.appendChild(prefSwitch(MuseHelper.NOTIFY_KEY, '使用率の通知',
      `残りが${MuseHelper.NOTIFY_LOW}%以下になったときと、リセット前に上限に達しそうなときに通知します(週に1回ずつ)`));
    card.appendChild(divider());
    card.appendChild(prefSwitch(MuseHelper.RESET_NOTIFY_KEY, 'リセットの通知',
      '週の使用率がリセットされたら通知します(muse.ai を閉じていても届きます。正確なリセット日時が分かっているときだけ)'));
    card.appendChild(divider());
    card.appendChild(prefSwitch(MuseHelper.REPLY_NOTIFY_KEY, '返信の通知',
      `別のタブやアプリを見ている間に${MuseHelper.otherName()}の返信が届いたら通知します。通知を押すとそのタブを開きます`));
    card.appendChild(divider());
    card.appendChild(prefSwitch(MuseHelper.REPLY_PREVIEW_KEY, '返信の通知に本文の冒頭を表示',
      'オフのときは「返信が届きました」とだけ表示します(通知は画面の端や通知センターに残ります)'));
    card.appendChild(divider());
    const test = actionRow('muse-helper-notify-test', 'button', 'テスト通知を送る', '通知が表示されるか確かめます', () => {
      const sub = test.querySelector('.text-caption-1');
      try {
        chrome.runtime.sendMessage({ type: 'museNotify', id: 'test', force: true, title: 'Muse Helper のテスト通知',
          message: '使用率の通知はこのように表示されます。' }, (res) => {
          void chrome.runtime.lastError;
          sub.textContent = res && res.shown ? '送りました。表示されない場合は OS の通知設定で Chrome を許可してください'
            : `送れませんでした${res && res.reason ? `: ${res.reason}` : ''}`;
        });
      } catch (e) {
        sub.textContent = `送れませんでした: ${(e && e.message) || e}`;
      }
    });
    card.appendChild(test);
    wrap.appendChild(card);
    return wrap;
  }

  // ---------- 使用率の推移グラフ ----------
  // 今週(週の始まり〜リセット)の使用率の折れ線と、目安(週の経過割合)の線、平均ペースでの予測(破線)。
  // 先週の記録があれば、1週間ずらして同じ位置に重ねる(そのときは凡例を出す)。
  // 目安・予測・上限・先週は線の端に直接ラベルを付ける。マウスを乗せると各記録の値が出る。
  const SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, parent) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  function renderChart(box) {
    const M = MuseHelper, fmt12 = tsFormat === '12';
    const f = M.forecast(usage, history);
    // 中身が変わっていなければ作り直さない(「表で見る」の開閉やマウスを乗せた表示を保つため)
    const last = history[history.length - 1];
    const sig = JSON.stringify([f && f.used, f && f.resetAt, f && f.resetPassed, history.length, last && last.at, fmt12]);
    if (box.dataset.sig === sig && box.firstChild) return;
    box.dataset.sig = sig;
    const wasOpen = !!box.querySelector('details[open]');
    box.textContent = '';
    if (!f || f.resetPassed) {
      box.style.display = 'none';
      return;
    }
    box.style.display = '';
    // 今週の記録(最後に値が下がった後)+ 週の始まり(0%)+ 最新値
    let pts = history.filter((p) => p.at >= f.weekStart && p.at <= f.at && Number.isFinite(p.used)).sort((a, b) => a.at - b.at);
    for (let i = pts.length - 1; i > 0; i--) if (pts[i].used < pts[i - 1].used) { pts = pts.slice(i); break; }
    if (!pts.length || pts[pts.length - 1].at < f.at) pts.push({ at: f.at, used: f.used });
    const anchor = { at: f.weekStart, used: 0, anchor: true };

    // 先週(1週間前の同じ期間)の記録。時刻を1週間ずらして今週の軸に重ねる
    const prevPts = history.filter((p) => p.at >= f.weekStart - M.WEEK && p.at < f.weekStart && Number.isFinite(p.used)).sort((a, b) => a.at - b.at);
    for (let i = prevPts.length - 1; i > 0; i--) if (prevPts[i].used < prevPts[i - 1].used) { prevPts.splice(0, i); break; }
    const prev = prevPts.length >= 2 ? prevPts.map((p) => ({ at: p.at + M.WEEK, used: p.used })) : null;
    // 先週の同じ時刻の値(記録の間は直線で補う。記録の範囲外は null)
    const prevAt = (t) => {
      if (!prev || t < prev[0].at || t > prev[prev.length - 1].at) return null;
      const i = prev.findIndex((p) => p.at >= t);
      if (prev[i].at === t || i === 0) return prev[i].used;
      const a = prev[i - 1], b = prev[i];
      return a.used + ((b.used - a.used) * (t - a.at)) / (b.at - a.at);
    };
    const pct = (v) => `${Math.round(v * 10) / 10}%`;
    const prevNow = prevAt(f.at);

    const W = 560, H = 176, L = 34, R = 62, T = 12, B = 24;
    const x = (t) => L + ((t - f.weekStart) / (f.resetAt - f.weekStart)) * (W - L - R);
    const y = (v) => T + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - T - B);

    // 凡例(2系列のときだけ)
    if (prev) {
      const legend = el('div', 'text-caption-1 text-text-secondary');
      legend.style.cssText = 'display:flex;gap:16px;margin-bottom:4px;';
      const d = new Date(f.weekStart - M.WEEK), e = new Date(f.weekStart - 1);
      for (const [color, text] of [['var(--muse-helper-series)', '今週'],
        ['var(--muse-helper-prev)', `先週(${d.getMonth() + 1}/${d.getDate()}〜${e.getMonth() + 1}/${e.getDate()})`]]) {
        const item = el('span', '');
        item.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
        const sw = el('span', '');
        sw.style.cssText = `display:inline-block;width:14px;height:2px;border-radius:1px;background:${color};`;
        item.append(sw, text);
        legend.appendChild(item);
      }
      box.appendChild(legend);
    }

    const wrap = el('div', '');
    wrap.style.cssText = 'position:relative;';
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
      'aria-label': `今週の使用率の推移。現在 ${f.used}%、目安 ${Math.round(f.target)}%` +
        (prevNow != null ? `、先週の同じ時点 ${Math.round(prevNow)}%` : '') });
    svg.style.cssText = 'display:block;overflow:visible;font:10px system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif;';
    wrap.appendChild(svg);
    box.appendChild(wrap);

    // 目盛り(1px・実線・控えめ)
    const grid = s('g', { stroke: 'currentColor', 'stroke-opacity': '0.12', 'stroke-width': '1' }, svg);
    for (const v of [0, 50, 100]) {
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v) }, grid);
      const t = s('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = `${v}%`;
    }
    const d0 = new Date(f.weekStart);
    for (let d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1); d.getTime() < f.resetAt; d.setDate(d.getDate() + 1)) {
      const xx = x(d.getTime());
      s('line', { x1: xx, x2: xx, y1: T, y2: H - B }, grid);
      if (xx - L < 18 || W - R - xx < 12) continue; // 端に近すぎる日付は文字を省く(軸の文字と重なるため)
      const t = s('text', { x: xx, y: H - B + 14, 'text-anchor': 'middle', fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = `${d.getMonth() + 1}/${d.getDate()}`;
    }

    const label = (xx, yy, text, anchorPos = 'start') => {
      const t = s('text', { x: xx, y: yy, 'text-anchor': anchorPos, fill: 'currentColor', 'fill-opacity': '0.75' }, svg);
      t.textContent = text;
    };
    // 右端のラベル(上限・予測・先週)は、重ならないよう最後にまとめて並べる
    const right = [{ y: y(100) + 3.5, text: '上限', fixed: true }];
    // 上限(100%)と目安の線
    s('line', { x1: x(f.weekStart), y1: y(0), x2: x(f.resetAt), y2: y(100), stroke: 'currentColor', 'stroke-opacity': '0.45', 'stroke-width': '1.5' }, svg);
    // 「目安」は線の途中(週の 15% 地点)、線の左上に
    const tx = f.weekStart + (f.resetAt - f.weekStart) * 0.15;
    label(x(tx) - 4, y(15) - 6, '目安', 'end');

    // 平均ペースでの予測(破線)
    const series = 'var(--muse-helper-series)';
    if (f.avg && !f.avg.insufficient) {
      const endT = f.avg.hitAt != null ? f.avg.hitAt : f.resetAt;
      const endV = f.avg.hitAt != null ? 100 : f.avg.atReset;
      s('line', { x1: x(f.at), y1: y(f.used), x2: x(endT), y2: y(endV), stroke: series, 'stroke-width': '2',
        'stroke-dasharray': '5 4', 'stroke-opacity': '0.8', 'stroke-linecap': 'round' }, svg);
      if (f.avg.hitAt == null) right.push({ y: y(endV) + 3.5, text: `予測 ${Math.round(endV)}%` });
      else label(x(endT), y(100) - 4, `${M.when(endT, fmt12)} 上限`, 'middle');
    }

    // 先週(今週の線の下に描く)
    if (prev) {
      s('path', { d: prev.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.used).toFixed(1)}`).join(' '),
        fill: 'none', stroke: 'var(--muse-helper-prev)', 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      const end = prev[prev.length - 1];
      const text = `先週 ${Math.round(end.used)}%`;
      // 週の終わりまで記録があれば右端の列に、途中で途切れていれば線の端に
      if (f.resetAt - end.at <= 12 * M.HOUR) right.push({ y: y(end.used) + 3.5, text });
      else label(x(end.at) + 6, y(end.used) - 6, text);
    }
    right.sort((a, b) => a.y - b.y);
    for (let i = 1; i < right.length; i++) right[i].y = Math.max(right[i].y, right[i - 1].y + 12);
    right.forEach((r) => label(W - R + 6, r.y, r.text));

    // 実績(折れ線)。週の始まり〜最初の記録は記録がないので薄く
    const all = [anchor, ...pts];
    const path = (list) => list.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.used).toFixed(1)}`).join(' ');
    s('path', { d: path(all.slice(0, 2)), fill: 'none', stroke: series, 'stroke-width': '2', 'stroke-opacity': '0.35', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    if (pts.length > 1) s('path', { d: path(pts), fill: 'none', stroke: series, 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    // 最新値の点(8px、面の色の輪)
    s('circle', { cx: x(f.at), cy: y(f.used), r: '4', fill: series, stroke: 'var(--muse-helper-surface)', 'stroke-width': '2' }, svg);

    // マウスを乗せたとき: 一番近い記録に縦線と値
    const hair = s('line', { y1: T, y2: H - B, stroke: 'currentColor', 'stroke-opacity': '0.35', 'stroke-width': '1', visibility: 'hidden' }, svg);
    const dot = s('circle', { r: '4', fill: series, stroke: 'var(--muse-helper-surface)', 'stroke-width': '2', visibility: 'hidden' }, svg);
    const pdot = s('circle', { r: '4', fill: 'var(--muse-helper-prev)', stroke: 'var(--muse-helper-surface)', 'stroke-width': '2', visibility: 'hidden' }, svg);
    // 乗せられる位置: 今週の記録 + 今より先にある先週の記録
    const spots = [...pts.map((p) => ({ at: p.at, used: p.used })),
      ...(prev || []).filter((p) => p.at > f.at).map((p) => ({ at: p.at, used: null }))];
    const tip = el('div', 'text-caption-1 text-text-primary');
    tip.style.cssText = 'position:absolute;top:0;pointer-events:none;display:none;white-space:nowrap;padding:4px 8px;border-radius:8px;' +
      'background:var(--muse-helper-surface);box-shadow:0 1px 6px rgba(0,0,0,.25);';
    wrap.appendChild(tip);
    const hit = s('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const p = spots.reduce((a, b) => (Math.abs(x(b.at) - px) < Math.abs(x(a.at) - px) ? b : a));
      const target = Math.round(((p.at - f.weekStart) / (f.resetAt - f.weekStart)) * 100);
      const pv = prevAt(p.at);
      hair.setAttribute('x1', x(p.at)); hair.setAttribute('x2', x(p.at)); hair.setAttribute('visibility', 'visible');
      if (p.used != null) { dot.setAttribute('cx', x(p.at)); dot.setAttribute('cy', y(p.used)); }
      dot.setAttribute('visibility', p.used != null ? 'visible' : 'hidden');
      if (pv != null) { pdot.setAttribute('cx', x(p.at)); pdot.setAttribute('cy', y(pv)); }
      pdot.setAttribute('visibility', pv != null ? 'visible' : 'hidden');
      tip.textContent = '';
      if (p.used != null) {
        tip.append(el('b', '', `${p.used}%`), ' 使用');
        if (pv != null) tip.append(` ・ 先週 ${pct(pv)}`);
        tip.append(` ・ 目安 ${target}% ・ ${M.when(p.at, fmt12, true)}`);
      } else {
        tip.append('先週 ', el('b', '', pct(pv)), ` ・ 目安 ${target}% ・ ${M.when(p.at - M.WEEK, fmt12, true)}`);
      }
      tip.style.display = 'block';
      const left = (x(p.at) / W) * r.width;
      tip.style.left = `${Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth)}px`;
    });
    hit.addEventListener('pointerleave', () => {
      hair.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      pdot.setAttribute('visibility', 'hidden');
      tip.style.display = 'none';
    });

    // 表で見る(色や図に頼らず値を確認できるように)
    const details = el('details', 'text-caption-1 text-text-secondary');
    details.style.cssText = 'margin-top:4px;';
    const summary = el('summary', '', `表で見る(記録 ${pts.length} 件)`);
    summary.style.cursor = 'pointer';
    details.appendChild(summary);
    const table = el('table', '');
    table.style.cssText = 'margin-top:4px;border-collapse:collapse;font-variant-numeric:tabular-nums;';
    if (prev) {
      const tr = el('tr', '');
      for (const t of ['日時', '使用率', '先週の同時刻']) {
        const th = el('th', '', t);
        th.style.cssText = 'padding:1px 0 1px 16px;font-weight:normal;text-align:right;';
        tr.appendChild(th);
      }
      tr.firstChild.style.cssText = 'padding:1px 16px 1px 0;font-weight:normal;text-align:left;';
      table.appendChild(tr);
    }
    // 同じ値が続く記録は1行にまとめる(「11/24 3:13 am 〜 5:16 am」)。先週の値は、まとめた最後の時刻で比べる
    const groups = [];
    for (const p of pts) {
      const g = groups[groups.length - 1];
      if (g && g.used === p.used) g.to = p.at;
      else groups.push({ used: p.used, from: p.at, to: p.at });
    }
    const range = (g) => {
      const a = M.when(g.from, fmt12, true), b = M.when(g.to, fmt12, true);
      if (g.from === g.to) return a;
      const [da, ...ta] = a.split(' '), [db, ...tb] = b.split(' ');
      return da === db ? `${da} ${ta.join(' ')} 〜 ${tb.join(' ')}` : `${a} 〜 ${b}`;
    };
    groups.slice(-50).reverse().forEach((g) => {
      const tr = el('tr', '');
      const a = el('td', '', range(g));
      const b = el('td', 'text-text-primary', `${g.used}%`);
      a.style.cssText = 'padding:1px 16px 1px 0;';
      b.style.textAlign = 'right';
      tr.append(a, b);
      if (prev) {
        const pv = prevAt(g.to);
        const c = el('td', '', pv != null ? pct(pv) : '—');
        c.style.cssText = 'padding:1px 0 1px 16px;text-align:right;';
        tr.appendChild(c);
      }
      table.appendChild(tr);
    });
    details.appendChild(table);
    details.open = wasOpen;
    box.appendChild(details);
  }

  // ---------- 下書き ----------
  function buildDraftsSection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', '下書き'));
    const card = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    card.appendChild(switchRow('muse-helper-drafts-toggle', '自動保存',
      '入力中の文章をチャットごとに保存し、入力欄の上のボタンで復元できます', () => {
        draftsEnabled = !draftsEnabled;
        document.querySelectorAll('.' + PANE).forEach(syncDrafts);
        try { chrome.storage.local.set({ [MuseHelper.DRAFTS_ENABLED_KEY]: draftsEnabled }); } catch (e) {}
      }));
    card.appendChild(divider());
    card.appendChild(actionRow('muse-helper-drafts-open', 'button', '一覧を開く', `すべての会話の下書きを表示します(${keyText('drafts')} でも開けます)`, () => {
      closeSettings();
      setTimeout(() => MuseHelper.draftList && MuseHelper.draftList.open(), 150);
    }));
    card.appendChild(divider());
    const countRow = row('muse-helper-drafts-count');
    countRow.appendChild(texts('保存中の下書き', '30日たった下書きは自動で削除されます'));
    countRow.appendChild(el('div', 'muse-helper-drafts-num flex items-center self-center ps-2 text-subheadline text-text-primary'));
    card.appendChild(countRow);
    card.appendChild(divider());
    card.appendChild(actionRow('muse-helper-drafts-clear', 'button', 'すべての下書きを削除', '', () => {
      const n = Object.keys(drafts).length + historyCount();
      if (!n) return;
      if (Date.now() > confirmClearUntil) {
        // 誤操作防止: 1回目は確認表示だけ(3秒以内にもう一度押すと削除)
        confirmClearUntil = Date.now() + 3000;
        document.querySelectorAll('.' + PANE).forEach(syncDrafts);
        setTimeout(() => document.querySelectorAll('.' + PANE).forEach(syncDrafts), 3100);
        return;
      }
      confirmClearUntil = 0;
      drafts = {};
      draftHistory = {};
      try { chrome.storage.local.set({ [MuseHelper.DRAFTS_KEY]: {}, [MuseHelper.DRAFT_HISTORY_KEY]: {} }); } catch (e) {}
      document.querySelectorAll('.' + PANE).forEach(syncDrafts);
    }));
    wrap.appendChild(card);
    return wrap;
  }

  const historyCount = () => Object.values(draftHistory).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);

  function syncDrafts(pane) {
    const sw = pane.querySelector('.muse-helper-drafts-toggle');
    if (!sw) return;
    sw.setAttribute('aria-checked', String(draftsEnabled));
    const d = Object.keys(drafts).length;
    const h = historyCount();
    const n = d + h;
    pane.querySelector('.muse-helper-drafts-num').textContent = h ? `${d}件(以前の下書き ${h}件)` : `${d}件`;
    const clear = pane.querySelector('.muse-helper-drafts-clear');
    const title = clear.querySelector('.text-subheadline');
    const sub = clear.querySelector('.text-caption-1');
    const confirming = Date.now() <= confirmClearUntil;
    title.textContent = confirming ? 'もう一度押すと削除します' : 'すべての下書きを削除';
    title.style.color = n ? MuseHelper.SEVERITY_COLOR[2] : '';
    sub.textContent = n ? (confirming ? '3秒以内に押してください' : `${n}件の下書きを削除します${h ? '(以前の下書きを含む)' : ''}`) : '削除する下書きはありません';
    clear.style.opacity = n ? '' : '.5';
    clear.style.cursor = n ? 'pointer' : 'default';
  }

  // ---------- 開発者向け ----------
  // devtools-main.js(MAIN world)のコマンドを呼ぶ
  let devSeq = 0;
  function devCall(cmd, ...args) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${++devSeq}`;
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('応答がありません(devtools-main.js が読み込まれていない可能性があります)'));
      }, 10000);
      function onMsg(e) {
        const m = e.data;
        if (e.source !== window || !m || m.source !== 'muse-helper' || m.type !== 'dev-response' || m.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (m.ok) resolve(m.result);
        else reject(new Error(m.error));
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'muse-helper', type: 'dev-request', id, cmd, args }, location.origin);
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // フォーカスやユーザー操作の条件を満たさないとき用の予備
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  const maskIds = (s) => String(s)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d{10,}/g, '<id>');

  // chrome.storage.local の中身(下書きの本文は文字数だけ、使用率の記録は件数と範囲だけ)
  function storageSummary() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (all) => {
        const out = {};
        for (const [k, v] of Object.entries(all || {})) {
          if (k === MuseHelper.DRAFTS_KEY && v && typeof v === 'object') {
            out[k] = Object.fromEntries(Object.entries(v).map(([p, d]) => [maskIds(p), { chars: (d && d.text || '').length, at: d && new Date(d.at).toLocaleString() }]));
          } else if (k === MuseHelper.HISTORY_KEY && Array.isArray(v)) {
            out[k] = { count: v.length, first: v[0], last: v[v.length - 1] };
          } else {
            out[k] = v;
          }
        }
        resolve(out);
      });
    });
  }

  const DEV_ACTIONS = [
    ['diagnose', '診断情報をコピー', 'バージョン・保存データの概要・ページ側の状態をまとめてコピーします', async () => {
      const page = await devCall('diagnose');
      const storage = await storageSummary();
      return JSON.stringify({ version: MuseHelper.version(), time: new Date().toString(), page, storage }, null, 2);
    }],
    ['refresh', '使用率を今すぐ取得', '5分ごとの自動更新を待たずに取り直します(コピーはしません)', async () => {
      const r = await devCall('refreshUsage');
      return { message: r.ok ? `取得しました(${r.lastFetchAt})` : `取得できませんでした: ${r.reason || r.lastError}` };
    }],
    ['dom-settings', '設定画面の構造をコピー', 'この設定ダイアログの要素の構造(文字は先頭20文字まで)', () => devCall('dom', 'settings')],
    ['dom-composer', '入力欄まわりの構造をコピー', 'チャットの入力欄と送信ボタンなどの構造', () => devCall('dom', 'composer')],
    ['dom-message', 'メッセージの構造をコピー', '最後のメッセージ1件の構造', () => devCall('dom', 'message')],
    ['queries', 'クエリ一覧をコピー', 'Muse の React Query キャッシュのキーと状態(★は使用率関連。中身は形だけ)', () => devCall('queries')],
    ['storage', '保存データをコピー', '拡張機能が保存しているデータ(下書きの本文は文字数だけ)', async () => JSON.stringify(await storageSummary(), null, 2)],
  ];

  function buildDevSection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', '開発者向け'));
    const card = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    card.appendChild(switchRow('muse-helper-dev-toggle', 'デベロッパーモード',
      '調査用のツールを表示し、DevTools の Console で museHelper を使えるようにします。拡張機能のファイルを書き換えると、自動で再読み込みします', () => {
        devMode = !devMode;
        applyDevAttr();
        document.querySelectorAll('.' + PANE).forEach(syncDev);
        try { chrome.storage.local.set({ [MuseHelper.DEV_MODE_KEY]: devMode }); } catch (e) {}
      }));
    wrap.appendChild(card);

    const tools = el('div', 'muse-helper-dev-tools bg-fill-secondary-elevated rounded-16 p-1.5 mt-3');
    DEV_ACTIONS.forEach(([key, title, sub, run], i) => {
      if (i > 0) tools.appendChild(divider());
      const r = actionRow('muse-helper-dev-' + key, 'button', title, sub, async () => {
        const caption = r.querySelector('.text-caption-1');
        caption.textContent = '実行中…';
        try {
          const result = await run();
          if (result && typeof result === 'object' && result.message) {
            caption.textContent = result.message;
          } else {
            const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            const ok = await copyText(text);
            caption.textContent = ok ? `コピーしました(${text.split('\n').length} 行)` : 'コピーできませんでした';
          }
        } catch (e) {
          caption.textContent = `エラー: ${(e && e.message) || e}`;
        }
        clearTimeout(r._museTimer);
        r._museTimer = setTimeout(() => { caption.textContent = sub; }, 6000);
      });
      tools.appendChild(r);
    });
    wrap.appendChild(tools);
    wrap.appendChild(el('div', 'muse-helper-dev-note px-3 pt-1.5 text-caption-1 text-text-secondary',
      'Console では museHelper.help() で使い方を表示できます。コピーした内容は ID らしき部分を伏せていますが、' +
      '画面の文字が少し含まれるため、共有する前に確認してください。'));
    return wrap;
  }

  function applyDevAttr() {
    if (devMode) document.documentElement.setAttribute('data-muse-helper-dev', '1');
    else document.documentElement.removeAttribute('data-muse-helper-dev');
  }

  function syncDev(pane) {
    const sw = pane.querySelector('.muse-helper-dev-toggle');
    if (!sw) return;
    sw.setAttribute('aria-checked', String(devMode));
    pane.querySelector('.muse-helper-dev-tools').style.display = devMode ? '' : 'none';
    pane.querySelector('.muse-helper-dev-note').style.display = devMode ? '' : 'none';
  }

  // ---------- アップデート ----------
  function row(cls) {
    return el('div', 'box-border flex min-w-0 items-center self-stretch min-h-[44px] rounded-12 px-3 ' + (cls || ''));
  }
  function texts(title, sub, subCls) {
    const t = el('div', 'min-w-0 flex-1 self-center');
    const col = el('div', 'min-h-0 min-w-0 flex flex-col gap-x-0.5 gap-y-0.5');
    col.appendChild(el('span', 'mx-0 break-words text-subheadline text-text-primary', title));
    if (sub != null) col.appendChild(el('span', 'mx-0 break-words text-caption-1 text-text-secondary ' + (subCls || ''), sub));
    t.appendChild(col);
    return t;
  }
  const divider = () => el('div', 'h-px bg-black/[0.04] dark:bg-white/[0.06] mx-3');

  function buildUpdateSection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', 'アップデート'));
    const card = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');

    const status = row();
    status.append(texts('バージョン', '', 'muse-helper-upd-checked'));
    status.firstChild.querySelector('.text-subheadline').classList.add('muse-helper-upd-status');

    const link = el('a', 'muse-helper-upd-link box-border flex min-w-0 items-center self-stretch min-h-[44px] rounded-12 px-3 hover:bg-fill-secondary-elevated');
    link.target = '_blank';
    link.rel = 'noopener';
    link.appendChild(texts('リリースページを開く', 'ダウンロードして読み込み直すと更新できます'));
    const linkDivider = divider();
    linkDivider.classList.add('muse-helper-upd-link-divider');

    const btn = row('muse-helper-upd-btn hover:bg-fill-secondary-elevated');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.style.cursor = 'pointer';
    btn.appendChild(texts('今すぐ確認', '新しい版は1時間ごと、インストールしたフォルダは1分ごとに自動で確認しています'));
    const run = () => {
      if (checking) return;
      checking = true;
      document.querySelectorAll('.' + PANE).forEach(syncUpdate);
      try {
        chrome.runtime.sendMessage({ type: 'museCheckUpdate' }, (res) => {
          void chrome.runtime.lastError;
          checking = false;
          if (res) update = res;
          document.querySelectorAll('.' + PANE).forEach(syncUpdate);
        });
      } catch (e) {
        checking = false;
        document.querySelectorAll('.' + PANE).forEach(syncUpdate);
      }
    };
    btn.addEventListener('click', run);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
    });

    // フォルダのファイルが新しくなっていれば、再読み込みで反映する
    const reload = row('muse-helper-upd-reload hover:bg-fill-secondary-elevated');
    reload.setAttribute('role', 'button');
    reload.setAttribute('tabindex', '0');
    reload.style.cursor = 'pointer';
    reload.appendChild(texts('再読み込みして更新', 'Muse Helper を再読み込みし、muse.ai のタブを読み込み直します'));
    const doReload = () => {
      reload.querySelector('.text-subheadline').textContent = '再読み込みしています…';
      MuseHelper.reloadToUpdate();
    };
    reload.addEventListener('click', doReload);
    reload.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doReload(); }
    });
    const reloadDivider = divider();
    reloadDivider.classList.add('muse-helper-upd-reload-divider');

    card.append(status, reloadDivider, reload, linkDivider, link, divider(), btn);
    wrap.appendChild(card);
    return wrap;
  }

  function syncUpdate(pane) {
    const status = pane.querySelector('.muse-helper-upd-status');
    const checked = pane.querySelector('.muse-helper-upd-checked');
    const link = pane.querySelector('.muse-helper-upd-link');
    const linkDivider = pane.querySelector('.muse-helper-upd-link-divider');
    const btnTitle = pane.querySelector('.muse-helper-upd-btn .text-subheadline');
    if (!status) return;
    const cur = MuseHelper.version();
    const u = update;
    const has = !!(u && u.latest && MuseHelper.isNewer(u.latest, cur));

    if (has) status.textContent = `${u.latest} があります(現在 v${cur})`;
    else if (u && u.error && !u.latest) status.textContent = `v${cur}(確認できませんでした)`;
    else if (u && u.checkedAt && !u.latest) status.textContent = `v${cur}(リリースはまだありません)`;
    else if (u && u.latest) status.textContent = `v${cur}(最新です)`;
    else status.textContent = `v${cur}(未確認)`;

    const parts = [];
    if (u && u.checkedAt) parts.push(`最終確認: ${MuseHelper.ago(Date.now() - u.checkedAt)}`);
    if (u && u.error) parts.push(`エラー: ${u.error}`);
    checked.textContent = parts.join(' ・ ') || 'まだ確認していません';

    const disk = MuseHelper.diskNewer(u);
    if (disk) status.textContent = `v${u.disk} に更新できます(現在 v${cur})`;
    const reload = pane.querySelector('.muse-helper-upd-reload');
    if (reload) {
      reload.style.display = disk ? '' : 'none';
      pane.querySelector('.muse-helper-upd-reload-divider').style.display = disk ? '' : 'none';
      if (disk) reload.querySelector('.text-subheadline').textContent = `再読み込みして v${u.disk} に更新`;
    }
    link.href = (u && u.url) || MuseHelper.RELEASES_URL;
    link.style.display = has && !disk ? '' : 'none';
    linkDivider.style.display = has && !disk ? '' : 'none';
    const linkSub = link.querySelector('.text-caption-1');
    if (linkSub) linkSub.textContent = u && u.unpacked
      ? 'インストールしたフォルダを新しくすると(git pull や zip の上書き)、1分以内にここに「再読み込みして更新」が出ます'
      : 'ダウンロードして読み込み直すと更新できます';
    btnTitle.textContent = checking ? '確認中…' : '今すぐ確認';
  }

  function syncPane(pane) {
    syncDev(pane);
    syncUpdate(pane);
    syncPace(pane);
    syncDrafts(pane);
    syncPrefs(pane);
    syncBookmarks(pane);
    syncStats(pane);
    syncSnippets(pane);
    syncActivity(pane);
    syncShortcuts(pane);
    syncBackup(pane);
    pane.querySelectorAll('[role="radio"]').forEach((r) => {
      const cur = { mode: tsMode, format: tsFormat, sendkey: sendKey, width: chatWidth, scale: String(fontScale), lowconfirm: String(lowConfirm) }[r.dataset.group];
      r.setAttribute('aria-checked', String(r.dataset.value === cur));
    });
  }

  // 表示・入力の値の設定(ラジオボタン)
  function setLayout(key, v) {
    if (key === MuseHelper.CHAT_WIDTH_KEY) chatWidth = v;
    if (key === MuseHelper.FONT_SCALE_KEY) fontScale = v;
    if (key === MuseHelper.LOW_CONFIRM_KEY) lowConfirm = v;
    document.querySelectorAll('.' + PANE).forEach(syncPane);
    try { chrome.storage.local.set({ [key]: v }); } catch (e) {}
  }

  function setFormat(v) {
    tsFormat = v === '12' ? '12' : '24';
    document.querySelectorAll('.' + PANE).forEach(syncPane);
    try { chrome.storage.local.set({ [TS_FMT_KEY]: tsFormat }); } catch (e) {}
  }

  function setMode(v) {
    tsMode = normMode(v);
    document.querySelectorAll('.' + PANE).forEach(syncPane);
    try { chrome.storage.local.set({ [TS_MODE_KEY]: tsMode }); } catch (e) {}
  }

  // ---------- 開閉 ----------
  function setOpen(s, open) {
    s.dialog.classList.toggle(OPEN, open);
    const nav = s.navList.querySelector('.' + NAV);
    if (nav) nav.setAttribute('data-active', String(open));
  }

  function inject() {
    if (!MuseHelper.alive()) return; // 切り離された古いスクリプトでは何もしない
    const s = findSettings();
    if (!s) return;
    if (!s.right.hasAttribute(RIGHT)) s.right.setAttribute(RIGHT, '');
    if (!s.right.querySelector(':scope > .' + PANE)) s.right.appendChild(buildPane());

    if (!s.navList.querySelector(':scope > .' + NAV)) {
      const nav = buildNav(s.sample);
      nav.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cur = findSettings();
        if (cur) setOpen(cur, true);
        document.querySelectorAll('.' + PANE).forEach(syncStats);
      });
      s.navList.appendChild(nav);
    }
    if (!s.navList.dataset.museHelperBound) {
      s.navList.dataset.museHelperBound = '1';
      // Muse 本来の項目が押されたら独自ページを閉じる
      s.navList.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b && !b.classList.contains(NAV)) {
          const cur = findSettings();
          if (cur) setOpen(cur, false);
        }
      }, true);
    }
  }

  // 自動更新の状態(usage-main.js から window.postMessage で届く)
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'muse-helper' || e.data.type !== 'usage-status') return;
    autoStatus = e.data;
    document.querySelectorAll('.' + PANE).forEach(syncPace);
  });
  try { window.postMessage({ source: 'muse-helper', type: 'usage-status-request' }, location.origin); } catch (e) {}

  // 表示・入力・ショートカット・以前の下書きの値を読み込む(partial: 変わったキーだけ)
  function applyLayoutValues(v, partial) {
    const has = (k) => !partial || k in v;
    if (has(MuseHelper.CHAT_WIDTH_KEY)) chatWidth = ['narrow', 'wide', 'full'].includes(v[MuseHelper.CHAT_WIDTH_KEY]) ? v[MuseHelper.CHAT_WIDTH_KEY] : 'default';
    if (has(MuseHelper.FONT_SCALE_KEY)) fontScale = [80, 90, 110, 125].includes(v[MuseHelper.FONT_SCALE_KEY]) ? v[MuseHelper.FONT_SCALE_KEY] : 100;
    if (has(MuseHelper.LOW_CONFIRM_KEY)) lowConfirm = [0, 5, 20].includes(v[MuseHelper.LOW_CONFIRM_KEY]) ? v[MuseHelper.LOW_CONFIRM_KEY] : 10;
    if (has(MuseHelper.SHORTCUT_KEYS_KEY)) shortcutKeys = v[MuseHelper.SHORTCUT_KEYS_KEY] || {};
    if (has(MuseHelper.DRAFT_HISTORY_KEY)) draftHistory = v[MuseHelper.DRAFT_HISTORY_KEY] || {};
  }

  // ---------- 起動 ----------
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      try { inject(); } catch (e) {}
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  try {
    chrome.storage.local.get([TS_FMT_KEY, TS_MODE_KEY, MuseHelper.UPDATE_KEY, MuseHelper.USAGE_KEY, MuseHelper.HISTORY_KEY, MuseHelper.PACE_BADGE_KEY,
      MuseHelper.DRAFTS_KEY, MuseHelper.DRAFTS_ENABLED_KEY, MuseHelper.DEV_MODE_KEY, MuseHelper.SEND_KEY_KEY, MuseHelper.BOOKMARKS_KEY, MuseHelper.SNIPPETS_KEY, MuseHelper.ACTIVITY_KEY, MuseHelper.CHAT_WIDTH_KEY, MuseHelper.FONT_SCALE_KEY,
      MuseHelper.LOW_CONFIRM_KEY, MuseHelper.SHORTCUT_KEYS_KEY, MuseHelper.DRAFT_HISTORY_KEY, ...Object.keys(prefs)], (v) => {
      applyLayoutValues(v || {});
      bookmarkCount = Object.keys((v && v[MuseHelper.BOOKMARKS_KEY]) || {}).length;
      for (const k of Object.keys(prefs)) prefs[k] = prefValue(k, v && v[k]);
      snippets = (v && Array.isArray(v[MuseHelper.SNIPPETS_KEY]) && v[MuseHelper.SNIPPETS_KEY]) || [];
      activity = (v && v[MuseHelper.ACTIVITY_KEY]) || null;
      sendKey = v && v[MuseHelper.SEND_KEY_KEY] === 'mod-enter' ? 'mod-enter' : 'enter';
      showPace = !(v && v[MuseHelper.PACE_BADGE_KEY] === false);
      draftsEnabled = !(v && v[MuseHelper.DRAFTS_ENABLED_KEY] === false);
      devMode = !!(v && v[MuseHelper.DEV_MODE_KEY]);
      applyDevAttr();
      drafts = (v && v[MuseHelper.DRAFTS_KEY]) || {};
      tsFormat = v && v[TS_FMT_KEY] === '12' ? '12' : '24';
      tsMode = normMode(v && v[TS_MODE_KEY]);
      usage = (v && v[MuseHelper.USAGE_KEY]) || null;
      history = (v && Array.isArray(v[MuseHelper.HISTORY_KEY]) && v[MuseHelper.HISTORY_KEY]) || [];
      update = (v && v[MuseHelper.UPDATE_KEY]) || null;
      document.querySelectorAll('.' + PANE).forEach(syncPane);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes[TS_FMT_KEY] || changes[TS_MODE_KEY])) {
        if (changes[TS_FMT_KEY]) tsFormat = changes[TS_FMT_KEY].newValue === '12' ? '12' : '24';
        if (changes[TS_MODE_KEY]) tsMode = normMode(changes[TS_MODE_KEY].newValue);
        document.querySelectorAll('.' + PANE).forEach(syncPane);
      }
      const lk = [MuseHelper.CHAT_WIDTH_KEY, MuseHelper.FONT_SCALE_KEY, MuseHelper.LOW_CONFIRM_KEY, MuseHelper.SHORTCUT_KEYS_KEY, MuseHelper.DRAFT_HISTORY_KEY];
      if (area === 'local' && lk.some((k) => changes[k])) {
        const v = {};
        for (const k of lk) if (changes[k]) v[k] = changes[k].newValue;
        applyLayoutValues(v, true);
        document.querySelectorAll('.' + PANE).forEach(syncPane);
      }
      if (area === 'local' && changes[MuseHelper.SNIPPETS_KEY]) {
        snippets = changes[MuseHelper.SNIPPETS_KEY].newValue || [];
        document.querySelectorAll('.' + PANE).forEach(syncSnippets);
      }
      if (area === 'local' && changes[MuseHelper.ACTIVITY_KEY]) {
        activity = changes[MuseHelper.ACTIVITY_KEY].newValue || null;
        document.querySelectorAll('.' + PANE).forEach(syncActivity);
      }
      if (area === 'local' && changes[MuseHelper.BOOKMARKS_KEY]) {
        bookmarkCount = Object.keys(changes[MuseHelper.BOOKMARKS_KEY].newValue || {}).length;
        document.querySelectorAll('.' + PANE).forEach(syncBookmarks);
      }
      if (area === 'local' && changes[MuseHelper.UPDATE_KEY]) {
        update = changes[MuseHelper.UPDATE_KEY].newValue || null;
        document.querySelectorAll('.' + PANE).forEach(syncUpdate);
      }
      if (area === 'local' && (changes[MuseHelper.DRAFTS_KEY] || changes[MuseHelper.DRAFTS_ENABLED_KEY])) {
        if (changes[MuseHelper.DRAFTS_KEY]) drafts = changes[MuseHelper.DRAFTS_KEY].newValue || {};
        if (changes[MuseHelper.DRAFTS_ENABLED_KEY]) draftsEnabled = changes[MuseHelper.DRAFTS_ENABLED_KEY].newValue !== false;
        document.querySelectorAll('.' + PANE).forEach(syncDrafts);
      }
      if (area === 'local' && Object.keys(prefs).some((k) => changes[k])) {
        for (const k of Object.keys(prefs)) if (changes[k]) prefs[k] = prefValue(k, changes[k].newValue);
        document.querySelectorAll('.' + PANE).forEach(syncPrefs);
      }
      if (area === 'local' && changes[MuseHelper.SEND_KEY_KEY]) {
        sendKey = changes[MuseHelper.SEND_KEY_KEY].newValue === 'mod-enter' ? 'mod-enter' : 'enter';
        document.querySelectorAll('.' + PANE).forEach(syncPane);
      }
      if (area === 'local' && changes[MuseHelper.DEV_MODE_KEY]) {
        devMode = !!changes[MuseHelper.DEV_MODE_KEY].newValue;
        applyDevAttr();
        document.querySelectorAll('.' + PANE).forEach(syncDev);
      }
      if (area === 'local' && changes[MuseHelper.PACE_BADGE_KEY]) {
        showPace = changes[MuseHelper.PACE_BADGE_KEY].newValue !== false;
        document.querySelectorAll('.' + PANE).forEach(syncPace);
      }
      if (area === 'local' && (changes[MuseHelper.USAGE_KEY] || changes[MuseHelper.HISTORY_KEY])) {
        if (changes[MuseHelper.USAGE_KEY]) usage = changes[MuseHelper.USAGE_KEY].newValue || null;
        if (changes[MuseHelper.HISTORY_KEY]) history = changes[MuseHelper.HISTORY_KEY].newValue || [];
        document.querySelectorAll('.' + PANE).forEach(syncPace);
      }
    });
  } catch (e) {}
  inject();
})();
