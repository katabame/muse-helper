// GitHub Releases の最新版を1時間ごとに確認し、結果を chrome.storage に保存する。
importScripts('common.js');
const { UPDATE_KEY, API_LATEST } = MuseHelper;
const ALARM = 'museUpdateCheck';
const DISK_ALARM = 'museDiskCheck'; // フォルダの確認(1分ごと。GitHub には通信しない)

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
  next.disk = await diskVersion();
  next.unpacked = await isUnpacked();
  await chrome.storage.local.set({ [UPDATE_KEY]: next });
  return next;
}

// ---------- 再読み込みして更新(パッケージ化されていない拡張機能) ----------
// フォルダのファイル(manifest.json)のバージョン。git pull などで新しくなっていれば、拡張機能の再読み込みで反映できる
async function diskVersion() {
  try {
    const r = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    return (await r.json()).version || null;
  } catch (e) {
    return null;
  }
}
// ストアからインストールした拡張機能の manifest には update_url が入る
let emojiCache = null;
async function emojiNames() {
  if (!emojiCache) {
    emojiCache = fetch(chrome.runtime.getURL('emoji-ja.json')).then((r) => r.json()).catch(() => { emojiCache = null; return null; });
  }
  return emojiCache;
}

// フォルダだけを確認する(1分ごと・muse.ai のページを開いたとき)。変わったときだけ保存する
// (毎回保存すると、すべてのタブでバッジの描き直しが起きるため)
async function checkDisk() {
  const [disk, unpacked] = await Promise.all([diskVersion(), isUnpacked()]);
  const prev = (await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY] || {};
  if (prev.disk === disk && prev.unpacked === unpacked) return prev;
  const next = { ...prev, disk, unpacked };
  await chrome.storage.local.set({ [UPDATE_KEY]: next });
  return next;
}
async function isUnpacked() {
  try { return (await chrome.management.getSelf()).installType === 'development'; } catch (e) {}
  return !chrome.runtime.getManifest().update_url;
}
// 拡張機能を再読み込みする(開いている muse.ai のタブの読み込み直しは、押したタブから localStorage で合図する)
function reloadSelf() {
  chrome.runtime.reload();
}

function schedule() {
  chrome.alarms.create(ALARM, { periodInMinutes: 60 });
  chrome.alarms.create(DISK_ALARM, { periodInMinutes: 1 });
  check();
  scheduleReset();
}

chrome.runtime.onInstalled.addListener(schedule); // インストール時・拡張機能の更新時
chrome.runtime.onStartup.addListener(schedule); // Chrome 起動時
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) check();
  if (a.name === DISK_ALARM) checkDisk();
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
  // リアクションの絵文字の名前(reactions.js)。ページ側から拡張機能のファイルを読めないので、ここで読んで渡す
  if (msg && msg.type === 'museEmojiNames') {
    emojiNames().then(sendResponse);
    return true;
  }
  // muse.ai のページを開いたときのフォルダの確認
  if (msg && msg.type === 'museCheckDisk') {
    checkDisk().then(sendResponse);
    return true;
  }
  // 「再読み込みして更新」
  if (msg && msg.type === 'museReloadSelf') {
    reloadSelf();
    return;
  }
  if (msg && msg.type === 'museNotify' && msg.id && msg.title) {
    notify(msg, msg.focusTab ? _sender.tab : null).then(sendResponse);
    return true;
  }
});
