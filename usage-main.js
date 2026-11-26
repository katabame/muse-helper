// ページ側(MAIN world)で動作: Muse の React Query キャッシュから使用率のデータを読み、5分ごとに取り直す。
//
// 使用率は ["subscription", <ユーザーID>, "agreement"] というクエリに入っている
// ({ usage: { percentUsed, resetsAt, quotaStatus }, usageRowLabel, topupBalance, topupTotal, ... })。
// このクエリは設定画面を開いたときに初めて作られるため、それを見つけたら取得処理(queryFn)を覚えておき、
// 以降は設定画面を開かなくても queryClient.fetchQuery で取り直す。
// さらに、その取得で使われた Next.js のサーバーアクションの呼び出し(POST + Next-Action ヘッダー)を
// localStorage に覚えておき、ページを開き直したあとも(設定画面を開かずに)同じ呼び出しで取り直す。
// Muse が更新されてアクションが変わると失敗するので、そのときは設定画面を一度開けば覚え直す。
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

  // どれかのタブが最後に取得を試みた時刻(muse.ai を複数のタブで開いていても、5分に1回だけ取りに行くため)。
  // 取得した値は chrome.storage 経由でほかのタブにも届く
  const SHARED_KEY = 'museHelperUsageFetchAt';
  const sharedAt = () => { try { return Number(localStorage.getItem(SHARED_KEY)) || 0; } catch (e) { return 0; } };
  const markShared = () => { try { localStorage.setItem(SHARED_KEY, String(Date.now())); } catch (e) {} };
  const RECIPE_KEY = 'museHelperUsageAction'; // 覚えたサーバーアクションの呼び出し { url, headers, body, at }
  const KEEP_HEADERS = ['next-action', 'next-router-state-tree', 'content-type', 'accept'];
  let recipe = null;
  try { recipe = JSON.parse(localStorage.getItem(RECIPE_KEY) || 'null'); } catch (e) {}
  if (!recipe || typeof recipe.url !== 'string' || !recipe.headers || !recipe.headers['next-action']) recipe = null;
  let recipeFails = 0; // 続けて失敗した回数(2回で使えなくなったとみなす)
  const recipeOk = () => !!recipe && recipeFails < 2;

  const isUsageKey = (k) => Array.isArray(k) && k[0] === 'subscription' && k[2] === 'agreement';

  function post(type, payload) {
    dbg.posts++;
    try { window.postMessage({ source: MSG, type, ...payload }, location.origin); } catch (e) {}
  }

  function postStatus() {
    let err = lastError;
    if (!opts && recipe && !recipeOk()) err = 'Muse が更新されたため、設定画面の「一般」を一度開き直してください';
    post('usage-status', { auto: !!opts || recipeOk(), lastFetchAt, lastError: err, intervalMs: REFRESH_MS });
  }

  // クエリの結果を渡す(必要な項目だけ)
  function emit(q) {
    const d = q && q.state && q.state.data;
    if (!d || !d.usage || !Number.isFinite(d.usage.percentUsed)) return;
    // Muse 自身が取得した直後に、こちらからも重ねて取り直さないようにする
    if (q.state.dataUpdatedAt) lastFetchAt = Math.max(lastFetchAt, q.state.dataUpdatedAt);
    emitData(d, q.state.dataUpdatedAt || Date.now());
  }
  function emitData(d, at) {
    const u = d.usage;
    dbg.emits++;
    dbg.lastEmit = { percentUsed: u.percentUsed, resetsAt: u.resetsAt, at };
    post('usage', {
      data: {
        percentUsed: u.percentUsed,
        resetsAt: Number.isFinite(u.resetsAt) ? u.resetsAt * 1000 : null,
        quotaStatus: typeof u.quotaStatus === 'string' ? u.quotaStatus : '',
        label: typeof d.usageRowLabel === 'string' ? d.usageRowLabel : '',
        topupBalance: Number.isFinite(d.topupBalance) ? d.topupBalance : null,
        topupTotal: Number.isFinite(d.topupTotal) ? d.topupTotal : null,
        at,
      },
    });
  }

  // ---------- サーバーアクションの呼び出しを覚える・呼び直す ----------
  // 応答(Next.js の RSC 形式。「1:{...}」のような行の並び)から、usage.percentUsed を持つオブジェクトを探す
  function findUsage(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 8) return null;
    if (o.usage && typeof o.usage === 'object' && Number.isFinite(o.usage.percentUsed)) return o;
    for (const v of Array.isArray(o) ? o : Object.values(o)) {
      const r = findUsage(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
  function parseUsage(text) {
    if (typeof text !== 'string' || !text.includes('percentUsed')) return null;
    for (const line of text.split('\n')) {
      const m = line.match(/^[0-9a-f]+:(.*)$/);
      for (const src of m ? [m[1]] : [line]) {
        try { const r = findUsage(JSON.parse(src)); if (r) return r; } catch (e) {}
      }
    }
    return null;
  }

  const origFetch = window.fetch;
  function headerObj(h) {
    const out = {};
    if (!h) return out;
    const each = h instanceof Headers ? [...h.entries()] : Array.isArray(h) ? h : Object.entries(h);
    for (const [k, v] of each) out[String(k).toLowerCase()] = String(v);
    return out;
  }
  // Muse のページ自身へのサーバーアクション(POST + Next-Action)で、応答に使用率が入っていたものを覚える
  function learn(input, init, promise) {
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method !== 'POST') return;
    const h = { ...headerObj(input && input.headers), ...headerObj(init && init.headers) };
    if (!h['next-action'] || typeof (init && init.body) !== 'string') return;
    const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
    if (url.origin !== location.origin) return;
    const headers = {};
    for (const k of KEEP_HEADERS) if (h[k]) headers[k] = h[k];
    const body = init.body;
    promise.then((res) => res.clone().text()).then((text) => {
      if (!parseUsage(text)) return;
      recipe = { url: url.pathname + url.search, headers, body, at: Date.now() };
      recipeFails = 0;
      try { localStorage.setItem(RECIPE_KEY, JSON.stringify(recipe)); } catch (e) {}
      dbg.learnedAt = new Date().toLocaleTimeString();
      postStatus();
    }).catch(() => {});
  }
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try { learn(input, init, p); } catch (e) {}
    return p;
  };

  // 覚えた呼び出しで取り直す(設定画面を開いていないとき)
  async function replay() {
    if (!recipeOk() || fetching) return;
    fetching = true;
    lastAttemptAt = Date.now();
    try {
      const res = await origFetch.call(window, recipe.url, { method: 'POST', headers: recipe.headers, body: recipe.body, credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = parseUsage(await res.text());
      if (!d) throw new Error('応答に使用率が含まれていません');
      lastFetchAt = Date.now();
      lastError = '';
      recipeFails = 0;
      emitData(d, lastFetchAt);
    } catch (e) {
      recipeFails++;
      lastError = String((e && e.message) || e).slice(0, 200);
    } finally {
      fetching = false;
      postStatus();
    }
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
    }
    // タブが裏にあっても取り直す(バッジや通知・使用率の記録を新しく保つため)。
    // ただし、ほかのタブが5分以内に取りに行っていれば任せる
    if (fetching || Date.now() - Math.max(lastFetchAt, lastAttemptAt, sharedAt()) < REFRESH_MS) return;
    if (qc && opts) { markShared(); refresh(); }
    else if (recipeOk()) { markShared(); replay(); }
  }

  // 調査用: 今すぐ取り直す(devtools-main.js から使う)
  window.__museUsageRefresh = async () => {
    if (!(qc && opts) && recipeOk()) await replay();
    else if (!qc) return { ok: false, reason: 'QueryClient が見つかっていません' };
    else if (!opts) return { ok: false, reason: '取得処理をまだ覚えていません(設定画面の「一般」を一度開いてください)' };
    else await refresh();
    return { ok: !lastError, lastError, lastFetchAt: lastFetchAt ? new Date(lastFetchAt).toLocaleTimeString() : null };
  };

  // 調査用: DevTools の Console で __museUsageDebug() を実行すると内部状態を返す
  window.__museUsageDebug = () => ({
    clientFound: !!qc,
    fetchRemembered: !!opts,
    actionRemembered: recipe ? { at: new Date(recipe.at).toLocaleString(), fails: recipeFails } : null,
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
  // (裏のタブのタイマーは Chrome により間引かれ、1分に1回程度になることがある)
  document.addEventListener('visibilitychange', tick);
  setInterval(tick, 5000);
  tick();
})();
