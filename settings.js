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
  let showPace = true; // オーバーレイに使用ペースを表示するか
  let draftsEnabled = true; // 下書きの自動保存
  let drafts = {}; // 保存中の下書き { [path]: { text, at } }
  let confirmClearUntil = 0; // 「すべて削除」の確認待ちの期限

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
  const ICON_CLOCK = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2';
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
      icon.replaceChildren(svg(size, ICON_CLOCK, 1.8));
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
    body.appendChild(group);
    body.appendChild(buildDraftsSection());
    body.appendChild(buildUpdateSection());

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
    PACE_ROWS.forEach(([key, title], i) => {
      if (i > 0) card.appendChild(divider());
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
      set('week', '—', msg + '(「一般」の利用状況を開くと更新されます)', -1);
      ['target', 'avg', 'recent'].forEach((k) => set(k, '—', '', -1));
      note.textContent = '';
      return;
    }

    const span = `${M.when(f.weekStart, fmt12)} 〜 ${M.when(f.resetAt, fmt12)}`;
    set('week', `${Math.round(f.elapsed * 100)}%`, `${span}(リセットは 0:00 と仮定)`, -1);

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

    note.textContent =
      `最終読み取り: ${M.ago(Date.now() - f.at)}。` +
      '「一般」の利用状況を開くたびに更新・記録されます。';
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
    const countRow = row('muse-helper-drafts-count');
    countRow.appendChild(texts('保存中の下書き', '30日たった下書きは自動で削除されます'));
    countRow.appendChild(el('div', 'muse-helper-drafts-num flex items-center self-center ps-2 text-subheadline text-text-primary'));
    card.appendChild(countRow);
    card.appendChild(divider());
    card.appendChild(actionRow('muse-helper-drafts-clear', 'button', 'すべての下書きを削除', '', () => {
      const n = Object.keys(drafts).length;
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
      try { chrome.storage.local.set({ [MuseHelper.DRAFTS_KEY]: {} }); } catch (e) {}
      document.querySelectorAll('.' + PANE).forEach(syncDrafts);
    }));
    wrap.appendChild(card);
    return wrap;
  }

  function syncDrafts(pane) {
    const sw = pane.querySelector('.muse-helper-drafts-toggle');
    if (!sw) return;
    sw.setAttribute('aria-checked', String(draftsEnabled));
    const n = Object.keys(drafts).length;
    pane.querySelector('.muse-helper-drafts-num').textContent = `${n}件`;
    const clear = pane.querySelector('.muse-helper-drafts-clear');
    const title = clear.querySelector('.text-subheadline');
    const sub = clear.querySelector('.text-caption-1');
    const confirming = Date.now() <= confirmClearUntil;
    title.textContent = confirming ? 'もう一度押すと削除します' : 'すべての下書きを削除';
    title.style.color = n ? MuseHelper.SEVERITY_COLOR[2] : '';
    sub.textContent = n ? (confirming ? '3秒以内に押してください' : `${n}件の下書きを削除します`) : '削除する下書きはありません';
    clear.style.opacity = n ? '' : '.5';
    clear.style.cursor = n ? 'pointer' : 'default';
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
    btn.appendChild(texts('今すぐ確認', '1時間ごとに自動で確認しています'));
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

    card.append(status, linkDivider, link, divider(), btn);
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

    link.href = (u && u.url) || MuseHelper.RELEASES_URL;
    link.style.display = has ? '' : 'none';
    linkDivider.style.display = has ? '' : 'none';
    btnTitle.textContent = checking ? '確認中…' : '今すぐ確認';
  }

  function syncPane(pane) {
    syncUpdate(pane);
    syncPace(pane);
    syncDrafts(pane);
    pane.querySelectorAll('[role="radio"]').forEach((r) => {
      const cur = r.dataset.group === 'mode' ? tsMode : tsFormat;
      r.setAttribute('aria-checked', String(r.dataset.value === cur));
    });
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
      MuseHelper.DRAFTS_KEY, MuseHelper.DRAFTS_ENABLED_KEY], (v) => {
      showPace = !(v && v[MuseHelper.PACE_BADGE_KEY] === false);
      draftsEnabled = !(v && v[MuseHelper.DRAFTS_ENABLED_KEY] === false);
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
      if (area === 'local' && changes[MuseHelper.UPDATE_KEY]) {
        update = changes[MuseHelper.UPDATE_KEY].newValue || null;
        document.querySelectorAll('.' + PANE).forEach(syncUpdate);
      }
      if (area === 'local' && (changes[MuseHelper.DRAFTS_KEY] || changes[MuseHelper.DRAFTS_ENABLED_KEY])) {
        if (changes[MuseHelper.DRAFTS_KEY]) drafts = changes[MuseHelper.DRAFTS_KEY].newValue || {};
        if (changes[MuseHelper.DRAFTS_ENABLED_KEY]) draftsEnabled = changes[MuseHelper.DRAFTS_ENABLED_KEY].newValue !== false;
        document.querySelectorAll('.' + PANE).forEach(syncDrafts);
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
