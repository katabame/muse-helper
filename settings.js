// muse.ai の設定ダイアログに「Muse Helper」の項目を追加する(isolated world)。
// サイドバーに項目を足し、選ばれている間だけ右側の本来のページを隠して独自ページを表示する。
// Muse 側(React)が管理する要素の属性は書き換えず、CSS とダイアログに付けたクラスだけで切り替える。
(() => {
  'use strict';
  const TS_FMT_KEY = 'museTsFormat'; // '12' | '24'(content.js / timestamps.js が参照)
  const NAV = 'muse-helper-nav';
  const PANE = 'muse-helper-pane';
  const OPEN = 'muse-helper-open'; // 独自ページ表示中にダイアログへ付けるクラス
  const RIGHT = 'data-muse-helper-right'; // 右ペインの目印
  const TITLES = ['設定', 'Settings'];

  let tsFormat = '24';
  let update = null; // background.js が保存する GitHub Releases の確認結果
  let checking = false;

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
    body.appendChild(el('h2', 'text-subheadline-emphasized text-text-secondary mb-1.5', 'メッセージの時刻'));

    const group = el('div', 'flex flex-col gap-2');
    const card = el('div', 'bg-fill-secondary-elevated rounded-16 p-1.5');
    card.setAttribute('role', 'radiogroup');
    card.setAttribute('aria-label', '時刻の表示形式');

    const options = [
      { value: '24', title: '24時間表記', example: '例: 15:05' },
      { value: '12', title: '12時間表記', example: '例: 3:05 pm' },
    ];
    options.forEach((o, i) => {
      if (i > 0) card.appendChild(el('div', 'h-px bg-black/[0.04] dark:bg-white/[0.06] mx-3'));
      const row = el('div', 'box-border flex min-w-0 items-center self-stretch min-h-[44px] rounded-12 px-3 hover:bg-fill-secondary-elevated');
      row.setAttribute('role', 'radio');
      row.setAttribute('tabindex', '0');
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
      const choose = () => setFormat(o.value);
      row.addEventListener('click', choose);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
      });
      card.appendChild(row);
    });
    group.appendChild(card);
    body.appendChild(group);
    body.appendChild(buildUpdateSection());

    pane.append(header, body);
    syncPane(pane);
    return pane;
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
    pane.querySelectorAll('[role="radio"]').forEach((r) => {
      r.setAttribute('aria-checked', String(r.dataset.value === tsFormat));
    });
  }

  function setFormat(v) {
    tsFormat = v === '12' ? '12' : '24';
    document.querySelectorAll('.' + PANE).forEach(syncPane);
    try { chrome.storage.local.set({ [TS_FMT_KEY]: tsFormat }); } catch (e) {}
  }

  // ---------- 開閉 ----------
  function setOpen(s, open) {
    s.dialog.classList.toggle(OPEN, open);
    const nav = s.navList.querySelector('.' + NAV);
    if (nav) nav.setAttribute('data-active', String(open));
  }

  function inject() {
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
    chrome.storage.local.get([TS_FMT_KEY, MuseHelper.UPDATE_KEY], (v) => {
      tsFormat = v && v[TS_FMT_KEY] === '12' ? '12' : '24';
      update = (v && v[MuseHelper.UPDATE_KEY]) || null;
      document.querySelectorAll('.' + PANE).forEach(syncPane);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[TS_FMT_KEY]) {
        tsFormat = changes[TS_FMT_KEY].newValue === '12' ? '12' : '24';
        document.querySelectorAll('.' + PANE).forEach(syncPane);
      }
      if (area === 'local' && changes[MuseHelper.UPDATE_KEY]) {
        update = changes[MuseHelper.UPDATE_KEY].newValue || null;
        document.querySelectorAll('.' + PANE).forEach(syncUpdate);
      }
    });
  } catch (e) {}
  inject();
})();
