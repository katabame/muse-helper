// content script と service worker で共有する定数・関数(グローバル MuseHelper として公開)。
globalThis.MuseHelper = (() => {
  'use strict';
  const REPO = 'katabame/muse-helper';

  // "v0.4.0" / "0.4.0" を [0, 4, 0] に。数字以外の部分(-beta など)は無視する。
  function parse(v) {
    return String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 4).map((x) => parseInt(x, 10) || 0);
  }

  // 拡張機能を再読み込み・更新すると、開いていたタブの content script は切り離され、
  // chrome.runtime の呼び出しが "Extension context invalidated" で失敗する。
  // バージョンは読み込み時に一度だけ取得しておく。
  let VERSION = '';
  try { VERSION = chrome.runtime.getManifest().version; } catch (e) {}

  return {
    REPO,
    UPDATE_KEY: 'museUpdate', // { latest, url, etag, checkedAt, error }
    API_LATEST: `https://api.github.com/repos/${REPO}/releases/latest`,
    RELEASES_URL: `https://github.com/${REPO}/releases/latest`,

    version: () => VERSION,

    // 拡張機能との接続が生きているか(false なら chrome.* API は使えない)
    alive() {
      try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
    },

    // tag が current より新しいか
    isNewer(tag, current) {
      const a = parse(tag), b = parse(current);
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] || 0) - (b[i] || 0);
        if (d) return d > 0;
      }
      return false;
    },

    ago(ms) {
      const m = Math.floor(ms / 60000);
      if (m < 1) return 'たった今';
      if (m < 60) return `${m}分前`;
      const h = Math.floor(m / 60);
      return h < 24 ? `${h}時間前` : `${Math.floor(h / 24)}日前`;
    },
  };
})();
