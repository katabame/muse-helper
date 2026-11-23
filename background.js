// GitHub Releases の最新版を1時間ごとに確認し、結果を chrome.storage に保存する。
importScripts('common.js');
const { UPDATE_KEY, API_LATEST } = MuseHelper;
const ALARM = 'museUpdateCheck';

async function check() {
  const prev = (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY] || {};
  const headers = { Accept: 'application/vnd.github+json' };
  // ETag 付きの条件付きリクエストにする(304 は API の回数制限に数えられない)
  if (prev.etag) headers['If-None-Match'] = prev.etag;
  let next;
  try {
    const r = await fetch(API_LATEST, { headers, cache: 'no-store' });
    if (r.status === 304) {
      next = { ...prev, error: '' };
    } else if (r.status === 404) {
      next = { latest: null, url: '', etag: '', error: '' }; // リリースがまだ無い
    } else if (r.ok) {
      const j = await r.json();
      next = { latest: j.tag_name || null, url: j.html_url || '', etag: r.headers.get('ETag') || '', error: '' };
    } else {
      next = { ...prev, error: `HTTP ${r.status}` };
    }
  } catch (e) {
    next = { ...prev, error: String((e && e.message) || e) };
  }
  next.checkedAt = Date.now();
  await chrome.storage.local.set({ [UPDATE_KEY]: next });
  return next;
}

function schedule() {
  chrome.alarms.create(ALARM, { periodInMinutes: 60 });
  check();
}

chrome.runtime.onInstalled.addListener(schedule); // インストール時・拡張機能の更新時
chrome.runtime.onStartup.addListener(schedule); // Chrome 起動時
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) check();
});

// ---------- 使用率の通知 ----------
// content.js から { id, title, message } が届く。id は「種類:週」で、同じ id は一度だけ通知する。
const { NOTIFY_KEY, NOTIFIED_KEY } = MuseHelper;
let notifyQueue = Promise.resolve(); // 複数のタブから同時に届いても重複させないよう順番に処理する

function notify({ id, title, message, force }) {
  notifyQueue = notifyQueue.then(async () => {
    const v = await chrome.storage.local.get([NOTIFY_KEY, NOTIFIED_KEY]);
    if (!force && v[NOTIFY_KEY] === false) return { shown: false, reason: 'disabled' };
    const done = v[NOTIFIED_KEY] || {};
    if (!force && done[id]) return { shown: false, reason: 'already' };
    await chrome.notifications.create(force ? `muse-test-${Date.now()}` : `muse-${id}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
      priority: 1,
    });
    if (!force) {
      // 古い記録(2週間より前の週)は消す
      const limit = Date.now() - 14 * 24 * 60 * 60 * 1000;
      for (const k of Object.keys(done)) if (done[k] < limit) delete done[k];
      done[id] = Date.now();
      await chrome.storage.local.set({ [NOTIFIED_KEY]: done });
    }
    return { shown: true };
  }).catch((e) => ({ shown: false, reason: String((e && e.message) || e) }));
  return notifyQueue;
}

// 通知をクリックしたら閉じる
chrome.notifications.onClicked.addListener((id) => chrome.notifications.clear(id));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // 設定パネルの「今すぐ確認」
  if (msg && msg.type === 'museCheckUpdate') {
    check().then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'museNotify' && msg.id && msg.title) {
    notify(msg).then(sendResponse);
    return true;
  }
});
