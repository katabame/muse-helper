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

  // { label, used, reset, resetAt, extra, quotaStatus, source, at }
  // reset は「11月24日」形式、resetAt は正確なリセット日時(ms、内部データから取れたときだけ)
  let state = null;
  let autoStatus = null; // usage-main.js からの自動更新の状態 { auto, lastFetchAt, lastError, intervalMs }
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
    // 内部データから取れた正確なリセット日時は、同じリセット日である限り引き継ぐ
    if (state && state.resetAt && state.reset === next.reset) next.resetAt = state.resetAt;
    if (state && state.quotaStatus) next.quotaStatus = state.quotaStatus;
    if (state && state.used === next.used && state.reset === next.reset && state.extra === next.extra) {
      state.at = next.at; // 値が同じでも「確認した時刻」は更新
      // ただし保存は1分に1回まで(保存のたびに設定画面が描き直され、それがまた読み取りを呼ぶため)
      if (next.at - lastSavedAt < 60000) {
        render();
        return true;
      }
    } else {
      state = next;
    }
    save();
    record(state.used, state.at);
    render();
    return true;
  }

  // usage-main.js(MAIN world)が Muse の内部データから読んだ使用率
  function applyUsage(d) {
    if (!d || !Number.isFinite(d.percentUsed)) return;
    const r = d.resetsAt ? new Date(d.resetsAt) : null;
    state = {
      label: d.label || (state && state.label) || '',
      used: d.percentUsed,
      reset: r ? `${r.getMonth() + 1}月${r.getDate()}日` : (state && state.reset) || '',
      resetAt: d.resetsAt || null,
      // 残りのトークンは Muse の表示用の文字列から読む(topupBalance は画面のトークン数と単位が違う)
      extra: (String(d.topupLabel || '').match(/残り([\d.,]+[億万千]?)トークン/) || [])[1] || '',
      quotaStatus: d.quotaStatus || '',
      source: 'query',
      at: Math.min(d.at || Date.now(), Date.now()),
    };
    save();
    record(state.used, state.at);
    render();
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'muse-helper') return;
    if (!MuseHelper.alive()) return;
    if (e.data.type === 'usage') {
      // 調査用: ページ側の Console から受け取れているか確認できるよう、最後に受け取った値を属性に残す
      document.documentElement.setAttribute('data-muse-helper-usage',
        `${e.data.data && e.data.data.percentUsed}% reset=${e.data.data && e.data.data.resetsAt} @${new Date().toLocaleTimeString()}`);
      applyUsage(e.data.data);
    }
    if (e.data.type === 'usage-status') {
      autoStatus = e.data;
      if (el) render();
    }
  });

  // 使用率の記録(直近ペースの計算用)。値が変わったときと、同じ値でも15分ごとに追加する。
  function record(used, at) {
    const last = history[history.length - 1];
    if (last && last.used === used && at - last.at < SAMPLE_GAP) return;
    history = history.filter((s) => at - s.at < HISTORY_KEEP).concat({ used, at }).slice(-3000); // 14日分(15分ごと+変化時)が収まる件数
    try { chrome.storage.local.set({ [HISTORY_KEY]: history }); } catch (e) {}
  }

  // ---------- 保存 ----------
  let lastSavedAt = 0;
  function save() {
    lastSavedAt = Date.now();
    try { chrome.storage.local.set({ [STORE_KEY]: state }); } catch (e) {}
  }

  // ---------- 表示 ----------
  let el, big, small, pace, warn, upd, autoRow, dragging = null;
  let compact = false; // 縮小表示(クリックで切り替え)
  const COMPACT_KEY = MuseHelper.BADGE_COMPACT_KEY;

  function build() {
    el = document.createElement('div');
    el.id = 'muse-usage-badge';
    el.style.cssText = [
      'position:fixed', 'top:10px', 'right:110px', 'z-index:2147483647',
      'font:12px/1.3 system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif',
      'color:#fff', 'background:rgba(30,30,34,.92)', 'border:1px solid rgba(255,255,255,.18)',
      'border-radius:10px', 'padding:6px 10px', 'cursor:grab', 'user-select:none',
      'box-shadow:0 2px 10px rgba(0,0,0,.35)', 'min-width:120px',
    ].join(';');
    el.lang = 'ja';
    MuseHelper.tooltip.bind(el); // 説明は tooltip.js の自前の表示で出す(el.title はそのまま読み書きできる)
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
    // 自動更新が止まっている・失敗しているときの行(値が古くなる前から出す)
    autoRow = document.createElement('div');
    autoRow.style.cssText = 'margin-top:3px;font-size:11px;white-space:nowrap;display:none;color:#c4b5fd';
    upd.addEventListener('click', (e) => {
      if (!MuseHelper.diskNewer(update)) return; // リリースページを開く(リンクのまま)
      e.preventDefault();
      upd.textContent = '⬆ 再読み込みしています…';
      MuseHelper.reloadToUpdate();
    });
    el.append(big, small, autoRow, pace, warn, upd);
    document.documentElement.appendChild(el);

    // ドラッグで移動(位置は保存)
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('a')) return; // リンクはドラッグ対象にしない
      const r = el.getBoundingClientRect();
      dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY, moved: false };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      // 4px 未満の動きはクリックとみなす(縮小表示の切り替え)
      if (!dragging.moved && Math.hypot(e.clientX - dragging.x, e.clientY - dragging.y) < 4) return;
      dragging.moved = true;
      el.style.left = Math.max(0, e.clientX - dragging.dx) + 'px';
      el.style.top = Math.max(0, e.clientY - dragging.dy) + 'px';
      el.style.right = 'auto';
    });
    el.addEventListener('pointerup', () => {
      if (!dragging) return;
      const moved = dragging.moved;
      dragging = null;
      el.style.cursor = 'grab';
      if (!moved) {
        compact = !compact;
        try { chrome.storage.local.set({ [COMPACT_KEY]: compact }); } catch (e) {}
        render();
        return;
      }
      try { chrome.storage.local.set({ [POS_KEY]: { left: el.style.left, top: el.style.top } }); } catch (e) {}
    });
  }

  const ago = MuseHelper.ago;

  function renderUpdate() {
    const cur = MuseHelper.version();
    if (MuseHelper.diskNewer(update)) {
      // フォルダのファイルは更新済み: 押すと再読み込みして反映する
      upd.textContent = `⬆ v${update.disk} に更新 — クリックで再読み込み`;
      upd.removeAttribute('href');
      upd.title = 'Muse Helper を再読み込みし、muse.ai のタブを読み込み直して新しい版にします';
      upd.style.display = 'block';
    } else if (update && update.latest && MuseHelper.isNewer(update.latest, cur)) {
      upd.textContent = `⬆ ${update.latest} があります(現在 v${cur})`;
      upd.href = update.url || MuseHelper.RELEASES_URL;
      upd.title = update.unpacked
        ? 'クリックでリリースページを開きます。インストールしたフォルダを新しくすると(git pull など)、ここから再読み込みで更新できます'
        : 'クリックでリリースページを開きます';
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
      (f.exactReset ? '' : '※ リセット時刻は 0:00 と仮定しています\n')
    );
  }

  function render() {
    renderFull();
    applyCompact();
  }

  // 縮小表示: 「57%」だけ(古い値なら ⚠、更新があれば ⬆ を添える)。詳細はマウスを乗せると出る
  function applyCompact() {
    if (!el) return;
    const rows = [small, autoRow, pace, warn, upd];
    if (!compact || !state || !MuseHelper.alive()) {
      el.style.minWidth = '120px';
      el.style.padding = '6px 10px';
      el.dataset.compact = '';
      return;
    }
    const warned = warn.style.display !== 'none';
    const updated = upd.style.display !== 'none';
    const remain = Math.max(0, 100 - state.used);
    const color = big.firstChild && big.firstChild.style ? big.firstChild.style.color : '';
    big.textContent = '';
    const a = document.createElement('span');
    a.textContent = `${remain}%`;
    a.style.color = color;
    big.appendChild(a);
    if (warned) big.append(Object.assign(document.createElement('span'), { textContent: ' ⚠', style: 'color:#fbbf24;font-size:12px' }));
    if (updated) big.append(Object.assign(document.createElement('span'), { textContent: ' ⬆', style: 'color:#93c5fd;font-size:12px' }));
    if (!warned && autoRow.style.display !== 'none') {
      big.append(Object.assign(document.createElement('span'), { textContent: ' ⏸', title: '自動更新は停止中', style: 'color:#c4b5fd;font-size:12px' }));
    }
    rows.forEach((r) => { r.style.display = 'none'; });
    el.style.minWidth = '0';
    el.style.padding = '4px 9px';
    el.dataset.compact = '1';
    el.title = el.title.replace(/クリックで縮小表示.*$/m, 'クリックで元の表示に戻します。');
  }

  function renderFull() {
    if (!el) build();
    small.style.display = ''; // 縮小表示で隠した行を戻す(他の行は下で表示/非表示を決め直す)
    if (!MuseHelper.alive()) {
      // 拡張機能が再読み込み・更新された後の古いスクリプト。ふだんはすぐ読み込み直すので(下の orphanCheck)、
      // ここが見えるのは読み込み直せなかったとき
      upd.style.display = 'none';
      warn.textContent = '⚠ 拡張機能が更新されました — ページを再読み込みしてください';
      warn.style.display = 'block';
      el.style.borderColor = '#fbbf24';
      return;
    }
    renderUpdate();
    if (!state) {
      big.textContent = 'Muse: 未取得';
      small.textContent = '設定画面を一度開くと自動で取得します';
      warn.style.display = 'none';
      autoRow.style.display = 'none';
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

    const now = Date.now();
    const days = state.reset && !state.resetAt ? daysUntil(state.reset) : null;
    const resetPassed = state.resetAt ? now >= state.resetAt : days != null && days < 0;
    const stale = age > STALE_MS;
    const auto = !!(autoStatus && autoStatus.auto);
    const autoFailing = auto && !!autoStatus.lastError;

    const parts = [];
    if (state.resetAt) {
      // 正確な日時: 「11/24 9:11リセット(あと14時間)」
      const r = new Date(state.resetAt);
      const clock = MuseHelper.when(state.resetAt, MuseHelper.fmt12(), true).split(' ').slice(1).join(' ');
      parts.push(`${r.getMonth() + 1}/${r.getDate()} ${clock}リセット(${MuseHelper.until(state.resetAt - now)})`);
    } else if (state.reset) {
      const rest = days == null ? '' : days > 0 ? `(あと${days}日)` : days === 0 ? '(今日)' : '(済)';
      parts.push(`${state.reset}リセット${rest}`);
    }
    if (!stale) parts.push(ago(age) + '更新');
    small.textContent = parts.join(' ・ ');

    // 古い値・自動更新の失敗は別の行で目立たせる
    const howToUpdate = auto ? '自動更新を待つか設定画面で更新' : '設定画面を一度開くと自動更新';
    if (autoFailing && (stale || resetPassed)) {
      warn.textContent = '⚠ 自動更新に失敗 — 設定画面を開き直してください';
    } else if (resetPassed) {
      warn.textContent = `⚠ リセット後の値は未取得 — ${howToUpdate}`;
    } else if (stale) {
      warn.textContent = `⚠ ${ago(age)}の値 — ${howToUpdate}`;
    }
    warn.style.display = resetPassed || stale ? 'block' : 'none';
    // 自動更新の状態(状態がまだ届いていないときは出さない。古い値の警告が出ているときはそちらに任せる)
    const autoKnown = !!autoStatus;
    const showAuto = autoKnown && !(resetPassed || stale) && (!auto || autoFailing);
    if (showAuto) {
      if (!auto) {
        autoRow.textContent = '⏸ 自動更新は停止中 — 設定 → 一般 を開くと再開';
        autoRow.style.color = '#c4b5fd';
      } else {
        autoRow.textContent = `⚠ 自動更新に失敗 — ${Math.round(autoStatus.intervalMs / 60000)}分後に再試行します`;
        autoRow.style.color = '#fcd34d';
      }
    }
    autoRow.style.display = showAuto ? 'block' : 'none';
    // 自動更新が止まっている間は枠を点線にする
    el.style.borderStyle = autoKnown && !auto ? 'dashed' : 'solid';
    el.style.borderColor = stale || resetPassed ? '#fbbf24' : color;
    el.style.opacity = stale || resetPassed ? '.85' : '1';
    const paceDetail = renderPace();
    const autoLine = auto
      ? `自動更新: 有効(${Math.round(autoStatus.intervalMs / 60000)}分ごと)` +
        (autoStatus.lastError ? `\n  前回の取得に失敗: ${autoStatus.lastError}` : '')
      : '自動更新: 停止中(設定画面の「一般」を一度開くと始まり、次からはページを開くだけで自動更新します)';
    el.title =
      `${state.label || '週間使用量'}\n` +
      (state.extra ? `追加トークン: 残り${state.extra}\n` : '') +
      paceDetail + '\n' + autoLine + '\nドラッグで移動できます。\nクリックで縮小表示にします。';
    checkNotify();
  }

  // ---------- 使用率の通知 ----------
  // 残りが NOTIFY_LOW% 以下になったとき、リセットまでに上限に届く見込みになったときに、
  // background.js に通知を頼む(同じ週に同じ通知は1回だけ。重複の判定と設定の確認は background 側)
  const notifyAsked = new Set(); // このタブで background に頼んだ通知(30秒ごとの再描画で何度も頼まないため)
  function checkNotify() {
    if (!state || !MuseHelper.alive()) return;
    const now = Date.now();
    if (now - state.at > STALE_MS) return; // 古い値では通知しない
    const f = MuseHelper.forecast(state, history);
    if (!f || f.resetPassed) return;
    const week = String(f.resetAt);
    const remain = Math.max(0, 100 - state.used);
    const fmt12 = MuseHelper.fmt12();
    const resetText = MuseHelper.when(f.resetAt, fmt12, f.exactReset);
    const send = (id, title, message) => {
      if (notifyAsked.has(`${id}:${week}`)) return;
      notifyAsked.add(`${id}:${week}`);
      try { chrome.runtime.sendMessage({ type: 'museNotify', id: `${id}:${week}`, title, message }, () => void chrome.runtime.lastError); } catch (e) {}
    };
    if (remain <= MuseHelper.NOTIFY_LOW) {
      send('low', `Muse の残りが ${remain}% になりました`, `${state.used}% 使用済み。リセットは ${resetText} です。`);
    }
    const hit = [f.avg, f.recent].filter((p) => p && !p.insufficient && p.hitAt != null && p.hitAt > now).sort((a, b) => a.hitAt - b.hitAt)[0];
    if (hit) {
      const which = hit === f.recent ? '直近のペース' : '今週の平均ペース';
      send('hit', 'このペースだとリセット前に上限に達します',
        `${which}が続くと ${MuseHelper.when(hit.hitAt, fmt12)} ごろに上限に達する見込みです(リセットは ${resetText})。`);
    }
  }

  // ---------- タイムスタンプ表示形式(MAIN world の timestamps.js へ属性で伝える) ----------
  function applyTsFormat(v) {
    document.documentElement.setAttribute('data-muse-ts-format', v === '12' ? '12' : '24');
  }
  function applyTsMode(v) {
    document.documentElement.setAttribute('data-muse-ts-mode', v === 'rel' || v === 'both' ? v : 'abs');
  }
  // 日付の区切り線・応答時間(オフのときだけ "0")
  const onOff = (attr, v) => document.documentElement.setAttribute(attr, v === false ? '0' : '1');
  const SEP_KEY = MuseHelper.DATE_SEP_KEY, RESP_KEY = MuseHelper.RESP_TIME_KEY;
  try {
    chrome.storage.local.get([TS_FMT_KEY, TS_MODE_KEY, SEP_KEY, RESP_KEY], (v) => {
      applyTsFormat(v && v[TS_FMT_KEY]);
      applyTsMode(v && v[TS_MODE_KEY]);
      onOff('data-muse-date-sep', v && v[SEP_KEY]);
      onOff('data-muse-resp-time', v && v[RESP_KEY]);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[TS_FMT_KEY]) applyTsFormat(changes[TS_FMT_KEY].newValue);
      if (area === 'local' && changes[TS_MODE_KEY]) applyTsMode(changes[TS_MODE_KEY].newValue);
      if (area === 'local' && changes[SEP_KEY]) onOff('data-muse-date-sep', changes[SEP_KEY].newValue);
      if (area === 'local' && changes[RESP_KEY]) onOff('data-muse-resp-time', changes[RESP_KEY].newValue);
    });
  } catch (e) {}

  // ページを開いたら、インストールしたフォルダが新しくなっていないか確認する(1分ごとの確認を待たずにボタンを出すため)
  try { chrome.runtime.sendMessage({ type: 'museCheckDisk' }, () => void chrome.runtime.lastError); } catch (e) {}

  // 拡張機能が更新・再読み込みされたら(chrome://extensions の ↻ など)、このタブも読み込み直す。
  // 古いスクリプトは chrome.* が使えず下書きも保存できないので、入力欄の文章はこのタブの sessionStorage に預け、
  // 読み込み直したあと drafts.js が下書きに保存して入力欄に戻す
  const orphanCheck = setInterval(() => {
    if (MuseHelper.alive()) return;
    clearInterval(orphanCheck);
    // 預けられなかったら、文章が消えないよう読み込み直さない(バッジに警告を出したまま)
    if (MuseHelper.stashComposer()) location.reload();
  }, 2000);

  // デベロッパーモードのとき: 拡張機能のファイルが変わったら自動で再読み込みしてもらう(background.js の devCheck)。
  // 1.5秒ごとに確認を頼む(background が止まっていても、この依頼で起きる)
  let devTimer = 0;
  function devWatch(on) {
    clearInterval(devTimer);
    devTimer = 0;
    if (!on) return;
    devTimer = setInterval(() => {
      if (!MuseHelper.alive()) return clearInterval(devTimer);
      try { chrome.runtime.sendMessage({ type: 'museDevCheck' }, () => void chrome.runtime.lastError); } catch (e) {}
    }, 1500);
  }
  try {
    chrome.storage.local.get(MuseHelper.DEV_MODE_KEY, (v) => devWatch(!!(v && v[MuseHelper.DEV_MODE_KEY])));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[MuseHelper.DEV_MODE_KEY]) devWatch(!!changes[MuseHelper.DEV_MODE_KEY].newValue);
    });
  } catch (e) {}

  // ほかのタブで「再読み込みして更新」が押されたら、拡張機能の再読み込みを待ってからこのタブも読み込み直す
  window.addEventListener('storage', (e) => {
    if (e.key !== MuseHelper.RELOAD_SIGNAL || !e.newValue) return;
    if (Date.now() - Number(e.newValue) > 60 * 1000) return;
    setTimeout(() => { MuseHelper.stashComposer(); location.reload(); }, 2000);
  });

  // ---------- 起動 ----------
  let timer;
  // Muse Helper が自分で足した部品の中の変化には反応しない
  const OWN = '#muse-usage-badge, .muse-helper-pane, .muse-helper-nav, .muse-ts-label, .muse-date-sep, #muse-helper-counter, #muse-helper-draft-chip, .muse-bm-btn, #muse-helper-bookmarks, #muse-helper-keys-help, #muse-helper-search, #muse-helper-snippets, #muse-helper-guard, .muse-collapse-btn, .muse-bm-count';
  const isOwn = (n) => {
    const e = n && (n.nodeType === 1 ? n : n.parentElement);
    return !!(e && e.closest(OWN));
  };
  const obs = new MutationObserver((list) => {
    if (list.every((m) => isOwn(m.target))) return;
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
    chrome.storage.local.get([STORE_KEY, POS_KEY, HISTORY_KEY, PACE_BADGE_KEY, COMPACT_KEY, MuseHelper.UPDATE_KEY], (v) => {
      showPace = !(v && v[PACE_BADGE_KEY] === false);
      compact = !!(v && v[COMPACT_KEY]);
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
      if (changes[COMPACT_KEY]) compact = !!changes[COMPACT_KEY].newValue;
      if (el && (changes[MuseHelper.UPDATE_KEY] || changes[STORE_KEY] || changes[HISTORY_KEY] || changes[TS_FMT_KEY] || changes[PACE_BADGE_KEY] || changes[COMPACT_KEY])) render();
    });
  } catch (e) {
    start();
  }
})();
