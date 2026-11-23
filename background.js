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

// 設定パネルの「今すぐ確認」から呼ばれる
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'museCheckUpdate') {
    check().then(sendResponse);
    return true;
  }
});
