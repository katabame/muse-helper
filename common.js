// content script と service worker で共有する定数・関数(グローバル MuseHelper として公開)。
globalThis.MuseHelper = (() => {
  'use strict';
  const REPO = 'katabame/muse-helper';

  // "v0.4.0" / "0.4.0" を [0, 4, 0] に。数字以外の部分(-beta など)は無視する。
  function parse(v) {
    return String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 4).map((x) => parseInt(x, 10) || 0);
  }

  const HOUR = 3600000, DAY = 24 * HOUR, WEEK = 7 * DAY;
  const pad = (n) => String(n).padStart(2, '0');

  // 「11月24日」→ その日の 0:00(リセット時刻は画面に出ないため 0:00 と仮定)。年は base に近い方を採用。
  function resetDate(md, base) {
    const m = String(md || '').match(/(\d{1,2})月(\d{1,2})日/);
    if (!m) return null;
    const b = new Date(base);
    let d = new Date(b.getFullYear(), Number(m[1]) - 1, Number(m[2]));
    if (d - b < -180 * DAY) d = new Date(b.getFullYear() + 1, d.getMonth(), d.getDate());
    else if (d - b > 180 * DAY) d = new Date(b.getFullYear() - 1, d.getMonth(), d.getDate());
    return d;
  }

  // 使用率 used(%) の時点 at から、毎ミリ秒 rate(%) のペースが続いた場合の見込み
  function project(used, at, rate, resetAt) {
    rate = Math.max(0, rate);
    let hitAt = null;
    if (used >= 100) hitAt = at;
    else if (rate > 0 && at + (100 - used) / rate < resetAt) hitAt = at + (100 - used) / rate;
    return { perDay: rate * DAY, atReset: used + rate * (resetAt - at), hitAt };
  }

  const AVG_MIN = 6 * HOUR; // 平均ペースは週の始まりから6時間以上経ってから
  const RECENT_WINDOW = DAY; // 直近ペースは過去24時間の記録から
  const RECENT_MIN = 2 * HOUR; // 直近ペースには2時間以上離れた記録が必要

  /**
   * 使用ペースの予測。state = { used, reset, at }, history = [{ used, at }, ...]
   * 戻り値:
   *   null(リセット日不明) / { resetPassed: true, ... } /
   *   { weekStart, resetAt, at, used, elapsed, target, diff, avg, recent }
   *   avg / recent は project() の結果に情報を足したもの、または { insufficient: '理由' }
   */
  function forecast(state, history, now) {
    if (!state || !(state.resetAt || state.reset) || !Number.isFinite(state.used)) return null;
    now = now || Date.now();
    const at = state.at || now, used = state.used;
    // 正確なリセット日時(Muse の内部データの resetsAt)があればそれを、なければ日付の 0:00 を使う
    let resetAt = state.resetAt;
    if (!resetAt) {
      const d = resetDate(state.reset, at);
      if (!d) return null;
      resetAt = d.getTime();
    }
    const weekStart = resetAt - WEEK;
    if (now >= resetAt || at >= resetAt) return { resetPassed: true, resetAt, weekStart };

    const elapsed = Math.min(1, Math.max(0, (at - weekStart) / WEEK));
    const r = { weekStart, resetAt, at, used, elapsed, exactReset: !!state.resetAt };

    // 1. 目安(週の経過割合ぶん使っている状態)との比較
    r.target = elapsed * 100;
    r.diff = used - r.target;

    // 2. 週の始まりからの平均ペース
    const sinceStart = at - weekStart;
    r.avg = sinceStart >= AVG_MIN
      ? project(used, at, used / sinceStart, resetAt)
      : { insufficient: '週の始まりから6時間経つと計算できます' };

    // 3. 直近24時間の記録からのペース(今週分・最後に値が下がった後の記録だけを使う)
    let samples = (history || [])
      .filter((s) => s && s.at >= weekStart && s.at <= at && Number.isFinite(s.used))
      .sort((a, b) => a.at - b.at);
    for (let i = samples.length - 1; i > 0; i--) {
      if (samples[i].used < samples[i - 1].used) { samples = samples.slice(i); break; }
    }
    const base = samples.find((s) => s.at >= at - RECENT_WINDOW);
    if (base && at - base.at >= RECENT_MIN) {
      r.recent = project(used, at, (used - base.used) / (at - base.at), resetAt);
      r.recent.span = at - base.at;
      r.recent.delta = used - base.used;
    } else {
      r.recent = { insufficient: '2時間以上離れた記録がたまると計算できます' };
    }
    return r;
  }

  // 予測の深刻度: 0 = 余裕, 1 = 注意(リセット時 90% 超), 2 = 上限到達の見込み
  function severity(p) {
    if (!p || p.insufficient) return -1;
    if (p.hitAt != null) return 2;
    return p.atReset > 90 ? 1 : 0;
  }

  // 日時を「11/22 14:40」または「11/22 2:40 pm」に(exact でなければ、予測なので分は10分単位に切り捨て)
  function when(t, fmt12, exact) {
    const d = new Date(t);
    const h = d.getHours(), m = pad(exact ? d.getMinutes() : Math.floor(d.getMinutes() / 10) * 10);
    const clock = fmt12 ? `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}` : `${pad(h)}:${m}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${clock}`;
  }

  // 予測を短い文に: 「約85%」/「11/22 14:40ごろ上限」/「上限到達」
  function projText(p, fmt12) {
    if (!p || p.insufficient) return '—';
    if (p.hitAt != null) return p.hitAt <= p.at ? '上限到達' : `${when(p.hitAt, fmt12)}ごろ上限`;
    return `約${Math.round(Math.min(p.atReset, 999))}%`;
  }

  // 拡張機能を再読み込み・更新すると、開いていたタブの content script は切り離され、
  // chrome.runtime の呼び出しが "Extension context invalidated" で失敗する。
  // バージョンは読み込み時に一度だけ取得しておく。
  // ---------- チャットの入力欄(counter.js / drafts.js で共有) ----------
  // aria-label が「メッセージ」の textarea(なければダイアログ外の表示中の textarea)
  function composerInput() {
    const list = [...document.querySelectorAll('textarea')].filter(
      (t) => !t.closest('[role="dialog"]') && t.getClientRects().length,
    );
    return list.find((t) => ['メッセージ', 'Message'].includes(t.getAttribute('aria-label'))) || list[0] || null;
  }
  // 入力欄のカード(role="button" の角丸の枠)と、独自の表示を重ねる基準(position が static でない祖先)。
  // Muse 側のカードの中には要素を入れず、基準要素の末尾に足して absolute で配置する。
  function composerLayout(t) {
    const card = t.closest('[role="button"]') || t.parentElement;
    let anchor = card.parentElement;
    const positioned = (e) => ['relative', 'absolute', 'fixed', 'sticky'].includes(getComputedStyle(e).position);
    while (anchor && anchor !== document.body && !positioned(anchor)) anchor = anchor.parentElement;
    return { card, anchor: anchor && anchor !== document.body ? anchor : null };
  }

  // 文字数(絵文字や結合文字も1文字として数える)
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;
  function charCount(s) {
    if (!s) return 0;
    if (!seg) return [...s].length;
    let n = 0;
    for (const _ of seg.segment(s)) n++;
    return n;
  }

  // ---------- チャットのメッセージ(会話の統計・ショートカット・ブックマークで共有) ----------
  // 時刻は timestamps.js(MAIN world)がメッセージに付けたラベルの data-iso から読む
  const OWN_IN_MESSAGE = '.muse-ts-label, .muse-date-sep, .muse-bm-btn';
  const RELOAD_SIGNAL = 'museHelperReloadAt'; // 「再読み込みして更新」の合図(muse.ai の localStorage)
  function isUserMessage(el) {
    const role = (el.getAttribute('data-message-role') || '').toLowerCase();
    const side = (el.getAttribute('data-message-side') || '').toLowerCase();
    return role === 'user' || side === 'right' || side === 'end';
  }
  // 表示中のメッセージ [{ el, id, user, at }](at は読めなければ null)
  function messages() {
    return [...document.querySelectorAll('[data-message-id]')].map((el) => {
      const label = el.querySelector(':scope > .muse-ts-label');
      const t = label ? Date.parse(label.dataset.iso) : NaN;
      return { el, id: el.getAttribute('data-message-id'), user: isUserMessage(el), at: Number.isFinite(t) ? t : null };
    });
  }
  // メッセージの本文(Muse のボタンの文字や Muse Helper の表示は除く。段落の間は空白1つ)
  const BLOCK = 'p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, td, th, div';
  function messageText(el) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest(`${OWN_IN_MESSAGE}, button, [aria-hidden="true"]`)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let out = '', block = null;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const b = n.parentElement.closest(BLOCK);
      if (block && b !== block) out += ' ';
      block = b;
      out += n.textContent;
    }
    return out.replace(/\s+/g, ' ').trim();
  }
  // メッセージまでスクロールして、少しの間枠で示す
  function scrollToMessage(el, block = 'start') {
    el.scrollIntoView({ block, behavior: 'smooth' });
    el.classList.add('muse-helper-flash');
    clearTimeout(el.__museFlash);
    el.__museFlash = setTimeout(() => el.classList.remove('muse-helper-flash'), 1600);
  }
  // 時間の長さ: 「12秒」「3分20秒」「1時間5分」「2日と3時間」
  function duration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}秒`;
    const m = Math.floor(s / 60);
    if (m < 60) return s % 60 ? `${m}分${s % 60}秒` : `${m}分`;
    const h = Math.floor(m / 60);
    if (h < 24) return m % 60 ? `${h}時間${m % 60}分` : `${h}時間`;
    return h % 24 ? `${Math.floor(h / 24)}日と${h % 24}時間` : `${Math.floor(h / 24)}日`;
  }
  try {
    const st = document.createElement('style');
    st.textContent = `
      [data-message-id] { scroll-margin-top: 72px; scroll-margin-bottom: 24px; }
      .muse-helper-flash { outline: 2px solid #2a78d6 !important; outline-offset: 4px; border-radius: 12px; }
      html.dark .muse-helper-flash { outline-color: #3987e5 !important; }`;
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}

  // キーボードショートカット(keys.js と設定画面で共有)。Mac では Option キー
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const ALT = IS_MAC ? '⌥' : 'Alt+';
  // id: 設定に保存するときの名前、code: 既定のキー(KeyboardEvent.code)。キーは設定画面で変えられる(museShortcutKeys)
  const SHORTCUTS = [
    { id: 'focus', code: 'KeyI', title: '入力欄にフォーカス' },
    { id: 'latest', code: 'KeyJ', title: '最新のメッセージへ' },
    { id: 'prev', code: 'ArrowUp', title: '前のメッセージへ', sub: '入力欄に文章があるときは、入力欄の中の移動になります' },
    { id: 'next', code: 'ArrowDown', title: '次のメッセージへ', sub: '入力欄に文章があるときは、入力欄の中の移動になります' },
    { id: 'search', code: 'KeyS', title: '会話内を検索' },
    { id: 'snippet', code: 'KeyT', title: '定型文を挿入' },
    { id: 'bookmarks', code: 'KeyB', title: 'ブックマークの一覧を開く/閉じる' },
    { id: 'help', code: 'Slash', title: 'ショートカットの一覧を表示' },
  ];
  // KeyboardEvent.code を表示用の文字に(KeyS → S、Digit1 → 1、ArrowUp → ↑)
  function keyLabel(code) {
    const named = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Slash: '/', Period: '.', Comma: ',',
      Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
      Enter: 'Enter', Space: 'Space', IntlRo: 'ろ', IntlYen: '¥' };
    if (named[code]) return named[code];
    let m = /^Key([A-Z])$/.exec(code) || /^Digit(\d)$/.exec(code) || /^(F\d{1,2})$/.exec(code);
    return m ? m[1] : code;
  }
  // 今のキー割り当て { id: code }(保存された割り当てで上書き)
  const shortcutCodes = (saved) => Object.fromEntries(SHORTCUTS.map((s) => [s.id, (saved && saved[s.id]) || s.code]));

  // 入力欄のカーソル位置に文字を入れる(execCommand なら元に戻す(⌘Z)が効き、input イベントで Muse 側にも伝わる)
  function insertText(t, text) {
    t.focus();
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) {}
    if (!ok) {
      const { selectionStart: s, selectionEnd: e, value } = t;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(t, value.slice(0, s) + text + value.slice(e));
      t.setSelectionRange(s + text.length, s + text.length);
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // 日付のキー「2026-11-24」(端末の時刻で)
  const dayKey = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  let VERSION = '';
  try { VERSION = chrome.runtime.getManifest().version; } catch (e) {}

  return {
    REPO,
    UPDATE_KEY: 'museUpdate', // { latest, url, etag, checkedAt, error, disk, unpacked }(disk: フォルダのファイルのバージョン)
    USAGE_KEY: 'museUsageBadge', // { label, used, reset, extra, at }
    PACE_BADGE_KEY: 'museShowPaceInBadge', // false ならオーバーレイに使用ペースの行を出さない(既定は表示)
    DRAFTS_KEY: 'museDrafts', // { [チャットのパス]: { text, at } }
    DRAFTS_ENABLED_KEY: 'museDraftsEnabled', // false なら下書きを自動保存しない(既定は保存)
    DRAFT_KEEP: 30 * DAY,
    SEND_KEY_KEY: 'museSendKey', // 'enter'(Enter で送信・既定)| 'mod-enter'(Ctrl/⌘+Enter で送信)
    DATE_SEP_KEY: 'museDateSep', // false なら日付の区切り線を出さない(既定は表示)
    RESP_TIME_KEY: 'museRespTime', // false なら応答時間を出さない(既定は表示)
    BADGE_COMPACT_KEY: 'museBadgeCompact', // true ならバッジを縮小表示
    NOTIFY_KEY: 'museNotify', // false なら使用率の通知を出さない(既定は通知)
    NOTIFIED_KEY: 'museNotified', // 通知済みの ID(同じ週に同じ通知を繰り返さない)
    NOTIFY_LOW: 20, // 残りがこの % 以下になったら通知
    DEV_MODE_KEY: 'museDevMode', // true なら設定画面に開発者向けツールを出し、Console に museHelper を公開
    HISTORY_KEY: 'museUsageHistory', // [{ used, at }, ...] 使用率の記録(直近ペースの計算用)
    BOOKMARKS_KEY: 'museBookmarks', // { [メッセージID]: { path, title, text, at, user, savedAt } }
    SHORTCUTS_KEY: 'museShortcuts', // false ならキーボードショートカットを使わない(既定は使う)
    RESET_NOTIFY_KEY: 'museNotifyReset', // false ならリセットの通知を出さない(既定は通知)
    REPLY_NOTIFY_KEY: 'museNotifyReply', // false なら返信の通知を出さない(既定は通知)
    REPLY_PREVIEW_KEY: 'museNotifyReplyPreview', // true なら返信の通知に本文の冒頭を出す(既定は出さない)
    SNIPPETS_KEY: 'museSnippets', // [{ id, title, text }] 定型文
    SHORTCUT_KEYS_KEY: 'museShortcutKeys', // { [ショートカットの id]: KeyboardEvent.code } 変更したキー
    DRAFT_HISTORY_KEY: 'museDraftHistory', // { [チャットのパス]: [{ text, at }] } 以前の下書き(新しい順、最大5件)
    LOW_CONFIRM_KEY: 'museLowConfirm', // 残りがこの % 以下なら送信前に確認する(0 でオフ。既定 10)
    CHAT_WIDTH_KEY: 'museChatWidth', // 'narrow' | 'default' | 'wide' | 'full' 本文の幅
    FONT_SCALE_KEY: 'museFontScale', // 80 | 90 | 100 | 110 | 125 本文の文字の大きさ(%)
    COLLAPSE_KEY: 'museCollapse', // true なら長いメッセージを折りたたむ(既定はオフ)
    BOOKMARK_SORT_KEY: 'museBookmarkSort', // 'chat'(会話ごと)| 'added'(追加した順)
    SIDEBAR_BADGE_KEY: 'museSidebarBadge', // false ならサイドバーの会話にブックマーク数を出さない(既定は出す)
    BOOKMARK_AUTOLOAD_KEY: 'museBookmarkAutoLoad', // false なら読み込まれていないブックマークへ移動するとき過去のメッセージを自動で読み込まない(既定は読み込む)
    THREAD_NAMES_KEY: 'museThreadNames', // { [会話のパス]: サイドバーでの名前 } 開いたときに覚える(★の表示用)
    ACTIVITY_KEY: 'museActivity', // { days: { 'YYYY-MM-DD': { sent, recv, sentChars, recvChars } }, ids: [...] } 利用の記録
    API_LATEST: `https://api.github.com/repos/${REPO}/releases/latest`,
    RELEASES_URL: `https://github.com/${REPO}/releases/latest`,

    version: () => VERSION,

    // 拡張機能との接続が生きているか(false なら chrome.* API は使えない)
    alive() {
      try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
    },

    // tag が current より新しいか
    // フォルダのファイルが今動いている版より新しいか(再読み込みすれば反映できる)
    diskNewer(u) {
      return !!(u && u.unpacked && u.disk && this.isNewer(u.disk, this.version()));
    },
    // 再読み込みして更新し、このタブも読み込み直す。
    // ほかの muse.ai のタブには localStorage で合図する(storage イベントはほかのタブにだけ届く。
    // 再読み込みで chrome.* が使えなくなった古いスクリプトでも受け取れる。タブの URL を見る権限も要らない)
    reloadToUpdate() {
      try { localStorage.setItem(RELOAD_SIGNAL, String(Date.now())); } catch (e) {}
      try { chrome.runtime.sendMessage({ type: 'museReloadSelf' }); } catch (e) {}
      setTimeout(() => location.reload(), 1500);
    },

    isNewer(tag, current) {
      const a = parse(tag), b = parse(current);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] || 0) - (b[i] || 0);
        if (d) return d > 0;
      }
      return false;
    },

    HOUR, DAY, WEEK,
    resetDate, forecast, severity, when, projText,
    composerInput, composerLayout, charCount,
    RELOAD_SIGNAL, messages, messageText, scrollToMessage, duration, ALT, SHORTCUTS, keyLabel, shortcutCodes, insertText, dayKey, OWN_IN_MESSAGE,
    SEVERITY_COLOR: ['#16a34a', '#d97706', '#dc2626'], // 設定画面(明暗どちらでも読める濃さ)
    fmt12: () => document.documentElement.getAttribute('data-muse-ts-format') === '12',
    signed(n, digits = 0) {
      const v = Number(n.toFixed(digits));
      return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(digits);
    },

    // リセットまでの残り時間: 「あと3日」「あと14時間」「あと25分」
    until(ms) {
      if (ms <= 0) return '済';
      const m = Math.floor(ms / 60000);
      if (m < 60) return `あと${m}分`;
      const h = Math.floor(m / 60);
      return h < 24 ? `あと${h}時間` : `あと${Math.floor(h / 24)}日`;
    },

    // 大きな数を「1.2億」「3,500万」のように
    bigNum(n) {
      if (!Number.isFinite(n)) return '';
      if (n >= 1e8) return `${+(n / 1e8).toFixed(1)}億`;
      if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString()}万`;
      return n.toLocaleString();
    },

    ago(ms) {
      const m = Math.floor(ms / 60000);
      if (m < 1) return 'たった今';
      if (m < 60) return `${m}分前`;
      const h = Math.floor(m / 60);
      return h < 24 ? `${h}時間前` : `${Math.floor(h / 24)}日前`;
    },
  };
})();
