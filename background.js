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
  scheduleReset();
}

chrome.runtime.onInstalled.addListener(schedule); // インストール時・拡張機能の更新時
chrome.runtime.onStartup.addListener(schedule); // Chrome 起動時
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) check();
  if (a.name.startsWith(RESET_ALARM)) onReset(Number(a.name.slice(RESET_ALARM.length)));
});

// ---------- 通知 ----------
// content.js などから { id, title, message, pref } が届く。id は「種類:週」などで、同じ id は一度だけ通知する。
// pref は、オフにできる設定のキー(省略時は使用率の通知の設定)。
const { NOTIFY_KEY, NOTIFIED_KEY } = MuseHelper;
const CLICK_KEY = 'museNotifyTabs'; // 通知 ID → 押したときに前面に出すタブ(storage.session)
let notifyQueue = Promise.resolve(); // 複数のタブから同時に届いても重複させないよう順番に処理する

function notify({ id, title, message, force, pref }, tab) {
  notifyQueue = notifyQueue.then(async () => {
    const key = pref || NOTIFY_KEY;
    const v = await chrome.storage.local.get([key, NOTIFIED_KEY]);
    if (!force && v[key] === false) return { shown: false, reason: 'disabled' };
    const done = v[NOTIFIED_KEY] || {};
    if (!force && done[id]) return { shown: false, reason: 'already' };
    const nid = force ? `muse-test-${Date.now()}` : `muse-${id}`;
    if (tab && tab.id != null) {
      try {
        const m = (await chrome.storage.session.get(CLICK_KEY))[CLICK_KEY] || {};
        m[nid] = { tabId: tab.id, windowId: tab.windowId };
        await chrome.storage.session.set({ [CLICK_KEY]: m });
      } catch (e) {}
    }
    await chrome.notifications.create(nid, {
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

// 通知をクリックしたら閉じる(返信の通知なら、そのタブを前面に出す)
chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  try {
    const m = (await chrome.storage.session.get(CLICK_KEY))[CLICK_KEY] || {};
    const t = m[id];
    if (!t) return;
    delete m[id];
    await chrome.storage.session.set({ [CLICK_KEY]: m });
    await chrome.tabs.update(t.tabId, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
  } catch (e) {}
});

// ---------- リセットの通知 ----------
// 使用率のデータに正確なリセット日時(resetAt)があれば、その時刻にアラームを仕掛けて通知する
// (muse.ai のタブを閉じていても届く)。
const { USAGE_KEY, RESET_NOTIFY_KEY } = MuseHelper;
const RESET_ALARM = 'museReset:'; // 後ろにリセット日時(ms)を付ける(通知時に、その後に取り直した次週の日時と混ざらないように)

async function scheduleReset() {
  const u = (await chrome.storage.local.get(USAGE_KEY))[USAGE_KEY];
  const at = u && Number.isFinite(u.resetAt) && u.resetAt > Date.now() ? u.resetAt : null;
  const name = at ? RESET_ALARM + at : '';
  for (const a of await chrome.alarms.getAll()) {
    // 予定が変わった古いアラームは消す(すでに過ぎて鳴る前のものは残す)
    if (a.name.startsWith(RESET_ALARM) && a.name !== name && Number(a.name.slice(RESET_ALARM.length)) > Date.now()) chrome.alarms.clear(a.name);
  }
  // リセット直後は Muse 側の切り替えに少し時間がかかることがあるので、1分あとに通知する
  if (at && !(await chrome.alarms.get(name))) chrome.alarms.create(name, { when: at + 60 * 1000 });
}

async function onReset(resetAt) {
  if (!Number.isFinite(resetAt)) return;
  const v = await chrome.storage.local.get('museTsFormat');
  const t = MuseHelper.when(resetAt, v.museTsFormat === '12', true);
  notify({ id: `reset:${resetAt}`, pref: RESET_NOTIFY_KEY, title: 'Muse の使用率がリセットされました',
    message: `${t} に週の使用量がリセットされました。` });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[USAGE_KEY]) scheduleReset();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // 設定パネルの「今すぐ確認」
  if (msg && msg.type === 'museCheckUpdate') {
    check().then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'museNotify' && msg.id && msg.title) {
    notify(msg, msg.focusTab ? _sender.tab : null).then(sendResponse);
    return true;
  }
});
