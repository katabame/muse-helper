// 開発者向けの調査ツール(MAIN world)。
// - 設定画面の「Muse Helper」→「開発者向け」のボタンから window.postMessage で呼ばれる
// - デベロッパーモードがオンのとき(<html data-muse-helper-dev="1">)は、DevTools の Console から
//   window.museHelper.*() としても使える(museHelper.help() で一覧)
// どの出力も、会話の本文などが混ざらないよう文字は短く切り、ID らしき長い数字や UUID は伏せる。
(() => {
  'use strict';
  if (window.__museDevInstalled) return;
  window.__museDevInstalled = true;

  const MSG = 'muse-helper';
  const DEV_ATTR = 'data-muse-helper-dev';
  const OWN = '#muse-usage-badge, .muse-helper-pane, .muse-helper-nav, #muse-helper-counter, #muse-helper-draft-chip, .muse-bm-btn, #muse-helper-bookmarks, #muse-helper-keys-help, #muse-helper-search, #muse-helper-snippets, #muse-helper-guard, .muse-collapse-btn, .muse-bm-count';
  const RE_USAGE = /usage|quota|limit|token|credit|plan|reset|remain|percent|budget|consum|allowance|weekly/i;

  // ID らしきもの(10桁以上の数字・UUID)を伏せる
  const mask = (s) => String(s)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d{10,}/g, '<id>');

  // 値の形だけを書き出す(数値・真偽値・日時はそのまま、文字列は長さだけ。使用率っぽい項目の短い文字列は中身も)
  function shape(v, depth = 0, key = '') {
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T/.test(v) || (RE_USAGE.test(key) && v.length < 40)) return JSON.stringify(mask(v));
      return `str(${v.length})`;
    }
    if (typeof v === 'function') return 'fn';
    if (depth > 3) return Array.isArray(v) ? `array(${v.length})` : 'obj';
    if (Array.isArray(v)) return `[${v.slice(0, 3).map((x) => shape(x, depth + 1)).join(', ')}${v.length > 3 ? `, …(${v.length})` : ''}]`;
    if (typeof v === 'object') {
      const ks = Object.keys(v).slice(0, 30);
      return `{${ks.map((k) => `${k}: ${shape(v[k], depth + 1, k)}`).join(', ')}${Object.keys(v).length > 30 ? ', …' : ''}}`;
    }
    return typeof v;
  }

  // ---------- 画面の構造 ----------
  const TARGETS = {
    settings: () => [...document.querySelectorAll('[role="dialog"]')].pop() || null,
    composer: () => {
      const t = [...document.querySelectorAll('textarea')].find((x) => !x.closest('[role="dialog"]') && x.getClientRects().length);
      let r = t;
      for (let i = 0; r && i < 7 && r.parentElement && r.parentElement !== document.body; i++) r = r.parentElement;
      return r || null;
    },
    message: () => {
      const all = [...document.querySelectorAll('[data-message-id]')];
      const m = all[all.length - 1];
      return m ? m.parentElement || m : null;
    },
  };
  const ATTRS = ['id', 'role', 'aria-label', 'aria-selected', 'aria-checked', 'data-state', 'data-active', 'type', 'contenteditable',
    'placeholder', 'data-message-id', 'data-message-role', 'data-message-side', 'title'];

  // target: 'settings' | 'composer' | 'message' | CSS セレクター | 要素
  function dom(target = 'settings', { depth = 14, maxLines = 600, text = 20 } = {}) {
    const root = target instanceof Element ? target :
      TARGETS[target] ? TARGETS[target]() : document.querySelector(target);
    if (!root) return `(見つかりませんでした: ${target})`;
    const out = [];
    (function walk(el, d) {
      if (d > depth || out.length >= maxLines) return;
      if (el !== root && el.matches(OWN)) return out.push('  '.repeat(d) + '(Muse Helper の要素)');
      const a = [el.tagName.toLowerCase()];
      for (const k of ATTRS) if (el.getAttribute(k) != null) a.push(`${k}="${mask(el.getAttribute(k)).slice(0, 60)}"`);
      if (typeof el.className === 'string' && el.className) a.push(`class="${el.className.slice(0, 140)}"`);
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, text);
      out.push('  '.repeat(d) + a.join(' ') + (txt ? `  «${mask(txt)}»` : ''));
      for (const c of el.children) if (!['svg', 'path', 'script', 'style'].includes(c.tagName.toLowerCase())) walk(c, d + 1);
    })(root, 0);
    if (out.length >= maxLines) out.push(`…(${maxLines} 行で打ち切り)`);
    return out.join('\n');
  }

  // ---------- React ----------
  function fiberOf(el) {
    const k = el && Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
    return k ? el[k] : null;
  }

  function isQueryClient(v) {
    if (!v || typeof v !== 'object') return false;
    try {
      if (typeof v.getQueryCache !== 'function' || typeof v.fetchQuery !== 'function') return false;
      if (typeof v['__museHelperNoSuchProp_' + Math.random().toString(36).slice(2)] !== 'undefined') return false;
      const c = v.getQueryCache();
      return !!c && typeof c.getAll === 'function' && Array.isArray(c.getAll());
    } catch (e) {
      return false;
    }
  }

  function queryClient() {
    const host = [...document.querySelectorAll('body > div *')].find((e) => fiberOf(e));
    for (let f = fiberOf(host); f; f = f.return) {
      const p = f.memoizedProps;
      for (const v of [p && p.client, p && p.value]) if (isQueryClient(v)) return v;
    }
    return null;
  }

  // React Query のクエリ一覧。filter(文字列)を渡すとキーに含むものだけ、withData で中身の形も出す
  function queries(filter = '', { withData = false } = {}) {
    const qc = queryClient();
    if (!qc) return '(QueryClient が見つかりませんでした)';
    const all = qc.getQueryCache().getAll();
    const out = [`クエリ ${all.length} 件${filter ? `(「${filter}」を含むもの)` : ''}`];
    all.forEach((q) => {
      const key = mask(JSON.stringify(q.queryKey));
      if (filter && !key.includes(filter)) return;
      const st = q.state || {};
      const age = st.dataUpdatedAt ? `${Math.round((Date.now() - st.dataUpdatedAt) / 1000)}秒前` : '-';
      const hit = RE_USAGE.test(key) || (st.data && typeof st.data === 'object' && RE_USAGE.test(Object.keys(st.data).join(' ')));
      out.push(`${hit ? '★' : ' '} ${key.slice(0, 160)} status=${st.status} 更新=${age} observers=${q.getObserversCount ? q.getObserversCount() : '?'}`);
      if (withData || (filter && st.data !== undefined)) out.push(`    data=${shape(st.data)}`.slice(0, 1500));
    });
    return out.join('\n');
  }

  // 要素(またはセレクター)の祖先の React 部品が持つ state / props の形
  function reactState(target, { levels = 8 } = {}) {
    const el = target instanceof Element ? target : document.querySelector(target);
    if (!el) return `(見つかりませんでした: ${target})`;
    const out = [];
    let f = fiberOf(el);
    for (let d = 0; f && d < levels; d++, f = f.return) {
      const name = (f.type && (f.type.displayName || f.type.name)) || (typeof f.type === 'string' ? f.type : '?');
      out.push(`#${d} <${name}>`);
      if (f.memoizedProps && typeof f.memoizedProps === 'object') out.push(`  props: ${shape(f.memoizedProps)}`.slice(0, 800));
      for (let h = f.memoizedState, i = 0; h && typeof h === 'object' && i < 20; i++, h = h.next) {
        const s = h.memoizedState;
        if (s && typeof s === 'object' && !Array.isArray(s)) out.push(`  state[${i}]: ${shape(s)}`.slice(0, 800));
      }
    }
    return out.join('\n');
  }

  // ページ側から見た診断情報
  function diagnose() {
    return {
      usage: typeof window.__museUsageDebug === 'function' ? window.__museUsageDebug() : '(usage-main.js が読み込まれていません)',
      timestampsInstalled: !!window.__museTsInstalled,
      queryClientFound: !!queryClient(),
      messages: document.querySelectorAll('[data-message-id]').length,
      timestampLabels: document.querySelectorAll('.muse-ts-label').length,
      settingsDialogOpen: !!TARGETS.settings(),
      composerFound: !!TARGETS.composer(),
      tsFormat: document.documentElement.getAttribute('data-muse-ts-format'),
      tsMode: document.documentElement.getAttribute('data-muse-ts-mode'),
      lastUsageReceived: document.documentElement.getAttribute('data-muse-helper-usage'),
      path: mask(location.pathname),
      userAgent: navigator.userAgent,
    };
  }

  const refreshUsage = () =>
    typeof window.__museUsageRefresh === 'function' ? window.__museUsageRefresh() : Promise.resolve({ ok: false, reason: '(usage-main.js が読み込まれていません)' });

  const COMMANDS = { dom, queries, reactState, diagnose, refreshUsage };

  // ---------- 設定画面のボタンからの呼び出し ----------
  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== MSG || m.type !== 'dev-request') return;
    let res;
    try {
      const fn = COMMANDS[m.cmd];
      if (!fn) throw new Error(`不明なコマンド: ${m.cmd}`);
      res = { ok: true, result: await fn(...(m.args || [])) };
    } catch (err) {
      res = { ok: false, error: String((err && err.message) || err) };
    }
    window.postMessage({ source: MSG, type: 'dev-response', id: m.id, ...res }, location.origin);
  });

  // ---------- Console 用(デベロッパーモードのときだけ公開) ----------
  const api = {
    help() {
      return [
        'museHelper.diagnose()                 診断情報',
        'museHelper.dom(target, opts)          画面の構造。target は "settings" | "composer" | "message" | CSS セレクター | 要素',
        'museHelper.queries(filter, opts)      React Query のクエリ一覧。opts.withData で中身の形も',
        'museHelper.reactState(target)         要素の祖先の React 部品の state / props の形',
        'museHelper.refreshUsage()             使用率を今すぐ取り直す',
        '結果は copy(museHelper.dom("settings")) のようにするとクリップボードにコピーできます。',
      ].join('\n');
    },
    ...COMMANDS,
  };
  function syncConsoleApi() {
    if (document.documentElement.getAttribute(DEV_ATTR) === '1') window.museHelper = api;
    else if (window.museHelper === api) delete window.museHelper;
  }
  new MutationObserver(syncConsoleApi).observe(document.documentElement, { attributes: true, attributeFilter: [DEV_ATTR] });
  syncConsoleApi();
})();
