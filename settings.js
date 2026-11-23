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
  };

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
    const extras = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    extras.appendChild(prefSwitch(MuseHelper.DATE_SEP_KEY, '日付の区切り線', '日付が変わるところに「── 11月23日(月) ──」の線を入れます'));
    extras.appendChild(divider());
    extras.appendChild(prefSwitch(MuseHelper.RESP_TIME_KEY, '応答時間', '相手の返信の時刻に「・12秒で応答」のように添えます'));
    group.appendChild(extras);
    body.appendChild(group);

    body.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', '入力'));
    body.appendChild(radioCard('sendkey', '送信キー', [
      { value: 'enter', title: 'Enter で送信', example: 'Muse の標準の動き(Shift+Enter で改行)' },
      { value: 'mod-enter', title: 'Ctrl/⌘+Enter で送信', example: 'Enter で改行します。長い文章を書くときの誤送信を防げます' },
    ], setSendKey));

    body.appendChild(buildNotifySection());
    body.appendChild(buildDraftsSection());
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
      (!auto ? '自動更新は停止中です(このタブで設定画面の「一般」を一度開くと始まります)。'
        : autoStatus.lastError ? `自動更新(${Math.round(autoStatus.intervalMs / 60000)}分ごと)の前回の取得に失敗しました: ${autoStatus.lastError}`
        : `自動更新: 有効(${Math.round(autoStatus.intervalMs / 60000)}分ごと、タブを表示している間)。`);
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
    pane.querySelectorAll('[data-pref]').forEach((r) => r.setAttribute('aria-checked', String(prefs[r.dataset.pref] !== false)));
  }

  function setSendKey(v) {
    sendKey = v === 'mod-enter' ? 'mod-enter' : 'enter';
    document.querySelectorAll('.' + PANE).forEach(syncPane);
    try { chrome.storage.local.set({ [MuseHelper.SEND_KEY_KEY]: sendKey }); } catch (e) {}
  }

  // ---------- 通知 ----------
  function buildNotifySection() {
    const wrap = el('div', 'space-y-1.5');
    wrap.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', '通知'));
    const card = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    card.appendChild(prefSwitch(MuseHelper.NOTIFY_KEY, '使用率の通知',
      `残りが${MuseHelper.NOTIFY_LOW}%以下になったときと、リセット前に上限に達しそうなときに通知します(週に1回ずつ)`));
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
    svg.style.cssText = 'display:block;overflow:visible;font:10px system-ui,sans-serif;';
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
      '調査用のツールを表示し、DevTools の Console で museHelper を使えるようにします', () => {
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
    syncDev(pane);
    syncUpdate(pane);
    syncPace(pane);
    syncDrafts(pane);
    syncPrefs(pane);
    pane.querySelectorAll('[role="radio"]').forEach((r) => {
      const cur = { mode: tsMode, format: tsFormat, sendkey: sendKey }[r.dataset.group];
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

  // 自動更新の状態(usage-main.js から window.postMessage で届く)
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'muse-helper' || e.data.type !== 'usage-status') return;
    autoStatus = e.data;
    document.querySelectorAll('.' + PANE).forEach(syncPace);
  });
  try { window.postMessage({ source: 'muse-helper', type: 'usage-status-request' }, location.origin); } catch (e) {}

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
      MuseHelper.DRAFTS_KEY, MuseHelper.DRAFTS_ENABLED_KEY, MuseHelper.DEV_MODE_KEY, MuseHelper.SEND_KEY_KEY, ...Object.keys(prefs)], (v) => {
      for (const k of Object.keys(prefs)) prefs[k] = !(v && v[k] === false);
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
        for (const k of Object.keys(prefs)) if (changes[k]) prefs[k] = changes[k].newValue !== false;
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
