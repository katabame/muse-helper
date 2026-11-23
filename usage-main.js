// ページ側(MAIN world)で動作: Muse の React Query キャッシュから使用率のデータを読み、5分ごとに取り直す。
//
// 使用率は ["subscription", <ユーザーID>, "agreement"] というクエリに入っている
// ({ usage: { percentUsed, resetsAt, quotaStatus }, usageRowLabel, topupBalance, topupTotal, ... })。
// このクエリは設定画面を開いたときに初めて作られるため、それを見つけたら取得処理(queryFn)を覚えておき、
// 以降は設定画面を開かなくても queryClient.fetchQuery で取り直す。
// 結果は window.postMessage で isolated world の content.js / settings.js へ渡す。
(() => {
  'use strict';
  if (window.__museUsageInstalled) return;
  window.__museUsageInstalled = true;

  const REFRESH_MS = 5 * 60 * 1000; // 自動更新の間隔
  const MSG = 'muse-helper';

  let qc = null; // QueryClient
  let opts = null; // 覚えた { queryKey, queryFn }
  let lastFetchAt = 0; // 最後に取得できた時刻
  let lastAttemptAt = 0; // 最後に取得を試みた時刻(失敗しても5分は間をあける)
  let lastError = '';
  let fetching = false;
  const dbg = { findAttempts: 0, events: 0, usageEvents: 0, emits: 0, lastEmit: null, posts: 0 };

  const isUsageKey = (k) => Array.isArray(k) && k[0] === 'subscription' && k[2] === 'agreement';

  function post(type, payload) {
    dbg.posts++;
    try { window.postMessage({ source: MSG, type, ...payload }, location.origin); } catch (e) {}
  }

  function postStatus() {
    post('usage-status', { auto: !!opts, lastFetchAt, lastError, intervalMs: REFRESH_MS });
  }

  // クエリの結果を渡す(必要な項目だけ)
  function emit(q) {
    const d = q && q.state && q.state.data;
    const u = d && d.usage;
    if (!u || !Number.isFinite(u.percentUsed)) return;
    // Muse 自身が取得した直後に、こちらからも重ねて取り直さないようにする
    if (q.state.dataUpdatedAt) lastFetchAt = Math.max(lastFetchAt, q.state.dataUpdatedAt);
    dbg.emits++;
    dbg.lastEmit = { percentUsed: u.percentUsed, resetsAt: u.resetsAt, at: q.state.dataUpdatedAt };
    post('usage', {
      data: {
        percentUsed: u.percentUsed,
        resetsAt: Number.isFinite(u.resetsAt) ? u.resetsAt * 1000 : null,
        quotaStatus: typeof u.quotaStatus === 'string' ? u.quotaStatus : '',
        label: typeof d.usageRowLabel === 'string' ? d.usageRowLabel : '',
        topupBalance: Number.isFinite(d.topupBalance) ? d.topupBalance : null,
        topupTotal: Number.isFinite(d.topupTotal) ? d.topupTotal : null,
        at: q.state.dataUpdatedAt || Date.now(),
      },
    });
  }

  function remember(q) {
    if (q && isUsageKey(q.queryKey) && q.options && typeof q.options.queryFn === 'function') {
      const first = !opts;
      opts = { queryKey: q.queryKey, queryFn: q.options.queryFn };
      if (first) postStatus();
    }
  }

  // ---------- QueryClient を探す ----------
  // 本物の QueryClient か。
  // Muse には、どんなプロパティ名でも関数を返す Proxy(通信クライアントなど)もあり、
  // getQueryCache を「持っている」ように見えるうえ、呼ぶと Muse 側で例外になる(副作用の恐れもある)。
  // ありえない名前のプロパティを読んで(読むだけなら副作用はない)関数が返ってくるものは Proxy とみなして除外し、
  // 残ったものだけ getQueryCache() の戻り値の形を確かめる。
  function isQueryClient(v) {
    if (!v || typeof v !== 'object') return false;
    try {
      if (typeof v.getQueryCache !== 'function' || typeof v.fetchQuery !== 'function') return false;
      if (typeof v['__museHelperNoSuchProp_' + Math.random().toString(36).slice(2)] !== 'undefined') return false;
      const c = v.getQueryCache();
      return !!c && typeof c.getAll === 'function' && typeof c.subscribe === 'function' && Array.isArray(c.getAll());
    } catch (e) {
      return false;
    }
  }

  function findClient() {
    dbg.findAttempts++;
    const host = document.querySelector('[data-message-id]') ||
      [...document.querySelectorAll('body > div *')].find((e) => Object.keys(e).some((k) => k.startsWith('__reactFiber$')));
    if (!host) return null;
    const fk = Object.keys(host).find((k) => k.startsWith('__reactFiber$'));
    if (!fk) return null;
    let f = host[fk];
    // 祖先側に QueryClientProvider がいるはずなので、まず上にたどる
    for (; f; f = f.return) {
      const p = f.memoizedProps;
      for (const v of [p && p.client, p && p.value]) if (isQueryClient(v)) return v;
    }
    return null;
  }

  function attach(client) {
    const cache = client.getQueryCache();
    qc = client;
    cache.getAll().filter((q) => isUsageKey(q.queryKey)).forEach((q) => { remember(q); emit(q); });
    cache.subscribe((ev) => {
      dbg.events++;
      const q = ev && ev.query;
      if (!q || !isUsageKey(q.queryKey)) return;
      dbg.usageEvents++;
      dbg.lastUsageEvent = `${ev.type}/${ev.action && ev.action.type}`;
      remember(q);
      if (ev.type === 'updated' && ev.action && ev.action.type === 'success') emit(q);
    });
    postStatus();
  }

  // ---------- 自動更新 ----------
  async function refresh() {
    if (!qc || !opts || fetching) return;
    fetching = true;
    lastAttemptAt = Date.now();
    try {
      await qc.fetchQuery({ ...opts, staleTime: 0 }); // 成功するとキャッシュの購読経由で emit される
      lastFetchAt = Date.now();
      lastError = '';
    } catch (e) {
      lastError = String((e && e.message) || e).slice(0, 200);
    } finally {
      fetching = false;
      postStatus();
    }
  }

  function tick() {
    if (!qc) {
      const c = findClient();
      if (c) {
        try { attach(c); } catch (e) { qc = null; dbg.attachError = String((e && e.message) || e).slice(0, 200); }
      }
      return;
    }
    if (opts && document.visibilityState === 'visible' && Date.now() - Math.max(lastFetchAt, lastAttemptAt) >= REFRESH_MS) refresh();
  }

  // 調査用: 今すぐ取り直す(devtools-main.js から使う)
  window.__museUsageRefresh = async () => {
    if (!qc) return { ok: false, reason: 'QueryClient が見つかっていません' };
    if (!opts) return { ok: false, reason: '取得処理をまだ覚えていません(このタブで設定画面の「一般」を一度開いてください)' };
    await refresh();
    return { ok: !lastError, lastError, lastFetchAt: lastFetchAt ? new Date(lastFetchAt).toLocaleTimeString() : null };
  };

  // 調査用: DevTools の Console で __museUsageDebug() を実行すると内部状態を返す
  window.__museUsageDebug = () => ({
    clientFound: !!qc,
    fetchRemembered: !!opts,
    usageQueriesInCache: qc ? qc.getQueryCache().getAll().filter((q) => isUsageKey(q.queryKey)).map((q) => ({
      status: q.state.status, hasUsage: !!(q.state.data && q.state.data.usage), updatedSecAgo: q.state.dataUpdatedAt ? Math.round((Date.now() - q.state.dataUpdatedAt) / 1000) : null,
    })) : null,
    lastFetchAt: lastFetchAt ? new Date(lastFetchAt).toLocaleTimeString() : null,
    lastError,
    ...dbg,
  });

  // isolated world 側(設定画面など)からの状態の問い合わせ
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === MSG && e.data.type === 'usage-status-request') postStatus();
  });
  // タブに戻ってきたとき、前回から5分以上たっていればすぐ取り直す
  document.addEventListener('visibilitychange', tick);
  setInterval(tick, 5000);
  tick();
})();
