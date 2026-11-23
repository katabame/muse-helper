// 新しいメッセージの見張り(isolated world)。
// - 利用の記録: 自分が送ったメッセージ・届いた返信を日ごとに数える(museActivity)
// - 返信の通知: タブを見ていない間に相手の返信が書き終わったら、Chrome の通知で知らせる
//
// 「新しいメッセージ」は、このタブで初めて見えたメッセージのうち、送信時刻が直近(5分以内)のもの。
// 会話を切り替えたときや、過去のメッセージを読み込んだときに出てくる古いメッセージは数えない。
// 相手の返信は少しずつ書き足されるので、本文が数秒変わらなくなったら書き終わったとみなす。
(() => {
  'use strict';
  const M = MuseHelper;
  const KEY = M.ACTIVITY_KEY;
  const RECENT = 5 * 60 * 1000;
  const SETTLE_USER = 1000; // 自分のメッセージ: 本文がこの時間変わらなければ確定
  const SETTLE_REPLY = 4000; // 相手の返信: 書き終わったとみなすまでの時間
  const GIVE_UP = 10 * 60 * 1000; // これより長く書き続けていても確定させる
  const KEEP_DAYS = 400;
  const KEEP_IDS = 300;

  const seen = new Set();
  const pending = new Map(); // id → { user, prevUser, text, changedAt, since }
  let baselined = false;
  let replyNotify = true;
  let replyPreview = false;

  function scan() {
    if (!M.alive()) return;
    const list = M.messages();
    if (!baselined) {
      // 読み込み時にすでにあるメッセージは数えない
      list.forEach((m) => seen.add(m.id));
      baselined = true;
      return;
    }
    list.forEach((m, i) => {
      if (seen.has(m.id) || m.at == null) return; // 時刻のラベルが付くまで待つ
      seen.add(m.id);
      if (Date.now() - m.at > RECENT) return;
      pending.set(m.id, { user: m.user, prevUser: !!(list[i - 1] && list[i - 1].user), text: '', changedAt: Date.now(), since: Date.now() });
    });
  }

  function findEl(id) {
    return [...document.querySelectorAll('[data-message-id]')].find((x) => x.getAttribute('data-message-id') === id) || null;
  }

  function tick() {
    if (!pending.size || !M.alive()) return;
    const now = Date.now();
    for (const [id, p] of pending) {
      const el = findEl(id);
      if (!el) { pending.delete(id); continue; } // 会話を切り替えたなど
      const text = M.messageText(el);
      if (text !== p.text) { p.text = text; p.changedAt = now; }
      const settle = p.user ? SETTLE_USER : SETTLE_REPLY;
      if ((p.text && now - p.changedAt >= settle) || now - p.since >= GIVE_UP) {
        pending.delete(id);
        done(id, p);
      }
    }
  }

  function done(id, p) {
    record(id, p);
    if (!p.user && p.prevUser) notifyReply(id, p);
  }

  // ---------- 利用の記録 ----------
  let queue = Promise.resolve(); // 書き込みを順番に
  function record(id, p) {
    queue = queue.then(() => new Promise((resolve) => {
      try {
        chrome.storage.local.get(KEY, (v) => {
          const a = (v && v[KEY]) || {};
          const days = a.days || {};
          const ids = a.ids || [];
          // 同じ会話を複数のタブで開いていても二重に数えない
          if (ids.includes(id)) return resolve();
          const k = M.dayKey(Date.now());
          const d = days[k] || { sent: 0, recv: 0, sentChars: 0, recvChars: 0 };
          const chars = M.charCount(p.text.replace(/\s+/g, ''));
          if (p.user) { d.sent++; d.sentChars += chars; } else { d.recv++; d.recvChars += chars; }
          days[k] = d;
          const keys = Object.keys(days).sort();
          for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[old];
          chrome.storage.local.set({ [KEY]: { days, ids: ids.concat(id).slice(-KEEP_IDS) } }, () => resolve());
        });
      } catch (e) { resolve(); }
    }));
  }

  // ---------- 返信の通知 ----------
  function notifyReply(id, p) {
    if (!replyNotify) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return; // 見ているなら通知しない
    const title = document.title.replace(/\s*[|\-–—]\s*Muse\s*$/i, '').trim();
    const head = p.text.length > 80 ? `${p.text.slice(0, 80)}…` : p.text;
    try {
      chrome.runtime.sendMessage({
        type: 'museNotify', id: `reply:${id}`, pref: M.REPLY_NOTIFY_KEY, focusTab: true,
        title: '返信が届きました',
        message: replyPreview && head ? head : `${title && !/^muse$/i.test(title) ? `「${title}」に` : ''}返信が届きました。クリックすると開きます。`,
      }, () => void chrome.runtime.lastError);
    } catch (e) {}
  }

  // ---------- 起動 ----------
  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 300);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(tick, 1000);
  // 時刻のラベル(timestamps.js)が付くのを待ってから、今あるメッセージを記録対象外にする
  setTimeout(scan, 1500);

  try {
    chrome.storage.local.get([M.REPLY_NOTIFY_KEY, M.REPLY_PREVIEW_KEY], (v) => {
      replyNotify = !(v && v[M.REPLY_NOTIFY_KEY] === false);
      replyPreview = !!(v && v[M.REPLY_PREVIEW_KEY]);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[M.REPLY_NOTIFY_KEY]) replyNotify = changes[M.REPLY_NOTIFY_KEY].newValue !== false;
      if (changes[M.REPLY_PREVIEW_KEY]) replyPreview = !!changes[M.REPLY_PREVIEW_KEY].newValue;
    });
  } catch (e) {}

  // 調査・テスト用
  M.activity = { scan, tick, pendingCount: () => pending.size };
})();
