(() => {
  'use strict';
  const STORE_KEY = 'museUsageBadge';
  const POS_KEY = 'museUsageBadgePos';
  const STALE_MS = 60 * 60 * 1000; // 1時間以上更新がなければ「古い」表示

  let state = null; // { label, used, reset, extra, at }

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
    render();
    return true;
  }

  // ---------- 保存 ----------
  function save() {
    try { chrome.storage.local.set({ [STORE_KEY]: state }); } catch (e) {}
  }

  // ---------- 表示 ----------
  let el, big, small, dragging = null;

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
    el.append(big, small);
    document.documentElement.appendChild(el);

    // ドラッグで移動(位置は保存)
    el.addEventListener('pointerdown', (e) => {
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

  function ago(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'たった今';
    if (m < 60) return `${m}分前`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}時間前` : `${Math.floor(h / 24)}日前`;
  }

  function render() {
    if (!el) build();
    if (!state) {
      big.textContent = 'Muse: 未取得';
      small.textContent = '設定画面を開くと取得します';
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
    b.textContent = `  (使用 ${state.used}%)`;
    b.style.cssText = 'font-weight:400;font-size:11px;opacity:.8';
    big.append(a, b);

    const parts = [];
    if (state.reset) parts.push(`${state.reset}リセット`);
    parts.push(age > STALE_MS ? `⚠ ${ago(age)}の値` : ago(age) + '更新');
    small.textContent = parts.join(' ・ ');
    el.style.borderColor = color;
    el.title =
      `${state.label || '週間使用量'}\n` +
      (state.extra ? `追加トークン: 残り${state.extra}\n` : '') +
      '値は設定画面(利用状況)を開いたときに更新されます。\nドラッグで移動できます。';
  }

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
    chrome.storage.local.get([STORE_KEY, POS_KEY], (v) => {
      if (v && v[STORE_KEY]) state = v[STORE_KEY];
      start();
      const p = v && v[POS_KEY];
      if (p && el) {
        el.style.left = p.left;
        el.style.top = p.top;
        el.style.right = 'auto';
      }
    });
  } catch (e) {
    start();
  }
})();
