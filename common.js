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
    if (!state || !state.reset || !Number.isFinite(state.used)) return null;
    now = now || Date.now();
    const at = state.at || now, used = state.used;
    const resetAtDate = resetDate(state.reset, at);
    if (!resetAtDate) return null;
    const resetAt = resetAtDate.getTime();
    const weekStart = resetAt - WEEK;
    if (now >= resetAt || at >= resetAt) return { resetPassed: true, resetAt, weekStart };

    const elapsed = Math.min(1, Math.max(0, (at - weekStart) / WEEK));
    const r = { weekStart, resetAt, at, used, elapsed };

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
      r.recent = { insufficient: '設定画面を2時間以上あけて再度開くと計算できます' };
    }
    return r;
  }

  // 予測の深刻度: 0 = 余裕, 1 = 注意(リセット時 90% 超), 2 = 上限到達の見込み
  function severity(p) {
    if (!p || p.insufficient) return -1;
    if (p.hitAt != null) return 2;
    return p.atReset > 90 ? 1 : 0;
  }

  // 日時を「11/22 14:40」または「11/22 2:40 pm」に(予測なので分は10分単位に切り捨て)
  function when(t, fmt12) {
    const d = new Date(t);
    const h = d.getHours(), m = pad(Math.floor(d.getMinutes() / 10) * 10);
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

  let VERSION = '';
  try { VERSION = chrome.runtime.getManifest().version; } catch (e) {}

  return {
    REPO,
    UPDATE_KEY: 'museUpdate', // { latest, url, etag, checkedAt, error }
    USAGE_KEY: 'museUsageBadge', // { label, used, reset, extra, at }
    PACE_BADGE_KEY: 'museShowPaceInBadge', // false ならオーバーレイに使用ペースの行を出さない(既定は表示)
    DRAFTS_KEY: 'museDrafts', // { [チャットのパス]: { text, at } }
    DRAFTS_ENABLED_KEY: 'museDraftsEnabled', // false なら下書きを自動保存しない(既定は保存)
    DRAFT_KEEP: 30 * DAY,
    HISTORY_KEY: 'museUsageHistory', // [{ used, at }, ...] 使用率の記録(直近ペースの計算用)
    API_LATEST: `https://api.github.com/repos/${REPO}/releases/latest`,
    RELEASES_URL: `https://github.com/${REPO}/releases/latest`,

    version: () => VERSION,

    // 拡張機能との接続が生きているか(false なら chrome.* API は使えない)
    alive() {
      try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
    },

    // tag が current より新しいか
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
    SEVERITY_COLOR: ['#16a34a', '#d97706', '#dc2626'], // 設定画面(明暗どちらでも読める濃さ)
    fmt12: () => document.documentElement.getAttribute('data-muse-ts-format') === '12',
    signed(n, digits = 0) {
      const v = Number(n.toFixed(digits));
      return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(digits);
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
