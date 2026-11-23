(() => {
  'use strict';
  const STORE_KEY = MuseHelper.USAGE_KEY;
  const HISTORY_KEY = MuseHelper.HISTORY_KEY;
  const SAMPLE_GAP = 15 * 60 * 1000; // 値が同じなら15分に1回だけ記録する
  const HISTORY_KEEP = 14 * MuseHelper.DAY;
  const POS_KEY = 'museUsageBadgePos';
  const TS_FMT_KEY = 'museTsFormat'; // '12' | '24'(settings.js で設定)
  const TS_MODE_KEY = 'museTsMode'; // 'abs' | 'rel' | 'both'(settings.js で設定)
  const STALE_MS = 60 * 60 * 1000; // 1時間以上更新がなければ「古い」表示

  let state = null; // { label, used, reset, extra, at }
  let update = null; // GitHub Releases の確認結果(background.js が保存)
  let history = []; // [{ used, at }] 使用率の記録
  const PACE_BADGE_KEY = MuseHelper.PACE_BADGE_KEY;
  let showPace = true; // オーバーレイに使用ペースの行を出すか(設定画面で切り替え)

  // ---------- 読み取り ----------
  function scan() {
    const bars = [...document.querySelectorAll('[role="progressbar"][aria-valuenow]')];
    if (!bars.length) return false;

    // 「◯◯プラン」のバーを優先、なければ最初のバー
    const bar = bars.find((b) => /プラン|plan/i.test(b.getAttribute('aria-label') || '')) || bars[0];
    const used = Number(bar.getAttribute('aria-valuenow'));
    if (!Number.isFinite(used)) return false;

    const scope = bar.closest('[role="dialog"]') || document.body;
    const text = scope.textContent || '';
    const reset = (text.match(/(\d{1,2}月\d{1,2}日)に?リセット/) || [])[1] || '';
    const extra = (text.match(/残り([\d.,]+[億万千]?)トークン/) || [])[1] || '';

    const next = {
      label: bar.getAttribute('aria-label') || '',
      used,
      reset: reset || (state && state.reset) || '',
      extra: extra || (state && state.extra) || '',
      at: Date.now(),
    };
    if (state && state.used === next.used && state.reset === next.reset && state.extra === next.extra) {
      state.at = next.at; // 値が同じでも「確認した時刻」は更新
    } else {
      state = next;
    }
    save();
    record(state.used, state.at);
    render();
    return true;
  }

  // 使用率の記録(直近ペースの計算用)。値が変わったときと、同じ値でも15分ごとに追加する。
  function record(used, at) {
    const last = history[history.length - 1];
    if (last && last.used === used && at - last.at < SAMPLE_GAP) return;
    history = history.filter((s) => at - s.at < HISTORY_KEEP).concat({ used, at }).slice(-500);
    try { chrome.storage.local.set({ [HISTORY_KEY]: history }); } catch (e) {}
  }

  // ---------- 保存 ----------
  function save() {
    try { chrome.storage.local.set({ [STORE_KEY]: state }); } catch (e) {}
  }

  // ---------- 表示 ----------
  let el, big, small, pace, warn, upd, dragging = null;

  function build() {
    el = document.createElement('div');
    el.id = 'muse-usage-badge';
    el.style.cssText = [
      'position:fixed', 'top:10px', 'right:110px', 'z-index:2147483647',
      'font:12px/1.3 system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif',
      'color:#fff', 'background:rgba(30,30,34,.92)', 'border:1px solid rgba(255,255,255,.18)',
      'border-radius:10px', 'padding:6px 10px', 'cursor:grab', 'user-select:none',
      'box-shadow:0 2px 10px rgba(0,0,0,.35)', 'min-width:120px',
    ].join(';');
    big = document.createElement('div');
    big.style.cssText = 'font-size:15px;font-weight:700;white-space:nowrap';
    small = document.createElement('div');
    small.style.cssText = 'opacity:.75;font-size:11px;white-space:nowrap';
    warn = document.createElement('div');
    warn.style.cssText = 'margin-top:3px;font-size:11px;font-weight:600;color:#fbbf24;white-space:nowrap;display:none';
    upd = document.createElement('a');
    upd.target = '_blank';
    upd.rel = 'noopener';
    upd.style.cssText =
      'display:none;margin-top:3px;font-size:11px;font-weight:600;color:#93c5fd;' +
      'text-decoration:none;white-space:nowrap;cursor:pointer';
    pace = document.createElement('div');
    pace.style.cssText = 'margin-top:2px;font-size:11px;white-space:nowrap;display:none';
    el.append(big, small, pace, warn, upd);
    document.documentElement.appendChild(el);

    // ドラッグで移動(位置は保存)
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('a')) return; // リンクはドラッグ対象にしない
      const r = el.getBoundingClientRect();
      dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      el.style.left = Math.max(0, e.clientX - dragging.dx) + 'px';
      el.style.top = Math.max(0, e.clientY - dragging.dy) + 'px';
      el.style.right = 'auto';
    });
    el.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = null;
      el.style.cursor = 'grab';
      try { chrome.storage.local.set({ [POS_KEY]: { left: el.style.left, top: el.style.top } }); } catch (e) {}
    });
  }

  const ago = MuseHelper.ago;

  function renderUpdate() {
    const cur = MuseHelper.version();
    if (update && update.latest && MuseHelper.isNewer(update.latest, cur)) {
      upd.textContent = `⬆ ${update.latest} があります(現在 v${cur})`;
      upd.href = update.url || MuseHelper.RELEASES_URL;
      upd.title = 'クリックでリリースページを開きます';
      upd.style.display = 'block';
    } else {
      upd.style.display = 'none';
    }
  }

  // 「11月24日」→ 今日から何日後か(過ぎていれば負)
  function daysUntil(md) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = MuseHelper.resetDate(md, today);
    return d ? Math.round((d - today) / MuseHelper.DAY) : null;
  }

  // 使用ペースの行: 「目安 +8% ・ 平均 約85% ・ 直近 11/22 14:40ごろ上限」
  const PACE_COLOR = ['#6ee7a0', '#fbbf24', '#f87171'];
  function renderPace() {
    const f = MuseHelper.forecast(state, history);
    if (!f || f.resetPassed) {
      pace.style.display = 'none';
      return '';
    }
    const fmt12 = MuseHelper.fmt12();
    if (!showPace) {
      pace.style.display = 'none';
      return '';
    }
    pace.textContent =
      `目安 ${MuseHelper.signed(f.diff)}% ・ 平均 ${MuseHelper.projText(f.avg, fmt12)}` +
      ` ・ 直近 ${MuseHelper.projText(f.recent, fmt12)}`;
    const sev = Math.max(MuseHelper.severity(f.avg), MuseHelper.severity(f.recent), f.diff > 10 ? 1 : 0);
    pace.style.color = PACE_COLOR[sev];
    pace.style.display = 'block';
    const line = (name, p) =>
      p.insufficient ? `${name}: ${p.insufficient}` :
      `${name}: 1日あたり ${p.perDay.toFixed(1)}% → ${MuseHelper.projText(p, fmt12)}`;
    return (
      '\n[使用ペース]\n' +
      `目安: ${Math.round(f.target)}%(週の経過割合)に対して ${f.used}%\n` +
      line('平均', f.avg) + '\n' + line('直近', f.recent) + '\n' +
      '※ リセット時刻は 0:00 と仮定しています\n'
    );
  }

  function render() {
    if (!el) build();
    if (!MuseHelper.alive()) {
      // 拡張機能が再読み込み・更新された後の古いスクリプト。表示はそのまま残し、再読み込みを促す。
      upd.style.display = 'none';
      warn.textContent = '⚠ 拡張機能が更新されました — ページを再読み込みしてください';
      warn.style.display = 'block';
      el.style.borderColor = '#fbbf24';
      return;
    }
    renderUpdate();
    if (!state) {
      big.textContent = 'Muse: 未取得';
      small.textContent = '設定画面を開くと取得します';
      warn.style.display = 'none';
      pace.style.display = 'none';
      el.style.borderColor = 'rgba(255,255,255,.18)';
      return;
    }
    const remain = Math.max(0, 100 - state.used);
    const age = Date.now() - state.at;
    const color = remain > 50 ? '#6ee7a0' : remain > 20 ? '#fbbf24' : '#f87171';
    big.innerHTML = '';
    const a = document.createElement('span');
    a.textContent = `残り ${remain}%`;
    a.style.color = color;
    const b = document.createElement('span');
    b.textContent = `  (${state.used}% 使用済)`;
    b.style.cssText = 'font-weight:400;font-size:11px;opacity:.8';
    big.append(a, b);

    const days = state.reset ? daysUntil(state.reset) : null;
    const resetPassed = days != null && days < 0;
    const stale = age > STALE_MS;

    const parts = [];
    if (state.reset) {
      const rest = days == null ? '' : days > 0 ? `(あと${days}日)` : days === 0 ? '(今日)' : '(済)';
      parts.push(`${state.reset}リセット${rest}`);
    }
    if (!stale) parts.push(ago(age) + '更新');
    small.textContent = parts.join(' ・ ');

    // 古い値は別の行で目立たせる
    if (resetPassed || stale) {
      warn.textContent = resetPassed
        ? '⚠ リセット後の値は未取得 — 設定画面で更新'
        : `⚠ ${ago(age)}の値 — 設定画面で更新`;
      warn.style.display = 'block';
    } else {
      warn.style.display = 'none';
    }
    el.style.borderColor = stale || resetPassed ? '#fbbf24' : color;
    el.style.opacity = stale || resetPassed ? '.85' : '1';
    const paceDetail = renderPace();
    el.title =
      `${state.label || '週間使用量'}\n` +
      (state.extra ? `追加トークン: 残り${state.extra}\n` : '') +
      paceDetail +
      '値は設定画面(利用状況)を開いたときに更新されます。\nドラッグで移動できます。';
  }

  // ---------- タイムスタンプ表示形式(MAIN world の timestamps.js へ属性で伝える) ----------
  function applyTsFormat(v) {
    document.documentElement.setAttribute('data-muse-ts-format', v === '12' ? '12' : '24');
  }
  function applyTsMode(v) {
    document.documentElement.setAttribute('data-muse-ts-mode', v === 'rel' || v === 'both' ? v : 'abs');
  }
  try {
    chrome.storage.local.get([TS_FMT_KEY, TS_MODE_KEY], (v) => {
      applyTsFormat(v && v[TS_FMT_KEY]);
      applyTsMode(v && v[TS_MODE_KEY]);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[TS_FMT_KEY]) applyTsFormat(changes[TS_FMT_KEY].newValue);
      if (area === 'local' && changes[TS_MODE_KEY]) applyTsMode(changes[TS_MODE_KEY].newValue);
    });
  } catch (e) {}

  // ---------- 起動 ----------
  let timer;
  const obs = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 300);
  });

  function start() {
    obs.observe(document.body, { childList: true, subtree: true });
    render();
    scan();
    setInterval(render, 30000); // 「◯分前」の表示更新
  }

  try {
    chrome.storage.local.get([STORE_KEY, POS_KEY, HISTORY_KEY, PACE_BADGE_KEY, MuseHelper.UPDATE_KEY], (v) => {
      showPace = !(v && v[PACE_BADGE_KEY] === false);
      if (v && v[STORE_KEY]) state = v[STORE_KEY];
      if (v && Array.isArray(v[HISTORY_KEY])) history = v[HISTORY_KEY];
      update = (v && v[MuseHelper.UPDATE_KEY]) || null;
      start();
      const p = v && v[POS_KEY];
      if (p && el) {
        el.style.left = p.left;
        el.style.top = p.top;
        el.style.right = 'auto';
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[MuseHelper.UPDATE_KEY]) update = changes[MuseHelper.UPDATE_KEY].newValue || null;
      // 他のタブで読み取った値も反映する
      if (changes[STORE_KEY] && changes[STORE_KEY].newValue) state = changes[STORE_KEY].newValue;
      if (changes[HISTORY_KEY] && Array.isArray(changes[HISTORY_KEY].newValue)) history = changes[HISTORY_KEY].newValue;
      if (changes[PACE_BADGE_KEY]) showPace = changes[PACE_BADGE_KEY].newValue !== false;
      if (el && (changes[MuseHelper.UPDATE_KEY] || changes[STORE_KEY] || changes[HISTORY_KEY] || changes[TS_FMT_KEY] || changes[PACE_BADGE_KEY])) render();
    });
  } catch (e) {
    start();
  }
})();
