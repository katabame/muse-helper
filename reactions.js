// リアクションの絵文字の説明(isolated world)。
// Muse のリアクション(role="img" aria-label="アシスタントのリアクション: 👍")にマウスを乗せると、
// 絵文字を大きく表示し、日本語の名前(「サムズアップ」)を添えたツールチップを出す(tooltip.js の仕組みを使う)。
// 名前は Unicode CLDR の日本語の読み上げ名(emoji-ja.json。cldr-json の annotations/ja から作成、Unicode License v3)。
(() => {
  'use strict';
  const M = MuseHelper;
  // 相手のリアクション: <span role="img" aria-label="アシスタントのリアクション: 👍">
  // 自分のリアクション: <button aria-label="❤️のリアクションを削除">(押すと削除される)
  const SELECTOR = '[role="img"][aria-label*="リアクション"], button[aria-label*="のリアクション"]';

  let names = null; // { 絵文字: 名前 }
  let loading = null;
  function load() {
    if (names || loading) return loading;
    // 名前のデータは background.js に読んでもらう(content script からの fetch では拡張機能のファイルを読めない)
    loading = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'museEmojiNames' }, (j) => {
          void chrome.runtime.lastError;
          if (j && typeof j === 'object') names = j;
          else loading = null; // 失敗したら次にマウスを乗せたときに読み直す
          resolve();
        });
      } catch (e) {
        loading = null;
        resolve();
      }
    });
    return loading;
  }

  const VS16 = /️/g;
  const SKIN = /[\u{1F3FB}-\u{1F3FF}]/gu;
  const SKIN_NAMES = { '\u{1F3FB}': '明るい肌色', '\u{1F3FC}': 'やや明るい肌色', '\u{1F3FD}': '中間の肌色', '\u{1F3FE}': 'やや濃い肌色', '\u{1F3FF}': '濃い肌色' };

  // 絵文字の名前。異体字セレクター(FE0F)や肌の色の違いを吸収し、見つからなければ ZWJ でつないだ部品の名前を並べる
  function nameOf(emoji) {
    if (!names) return '';
    const tries = [emoji, emoji.replace(VS16, ''), emoji.replace(SKIN, ''), emoji.replace(SKIN, '').replace(VS16, '')];
    for (const t of tries) {
      if (names[t]) {
        const skin = (emoji.match(SKIN) || [])[0];
        return skin && t !== emoji && !names[emoji] ? `${names[t]}(${SKIN_NAMES[skin]})` : names[t];
      }
    }
    const parts = emoji.replace(VS16, '').split('‍').filter(Boolean);
    if (parts.length > 1) {
      const ns = parts.map((p) => names[p.replace(SKIN, '')] || '').filter(Boolean);
      if (ns.length) return ns.join(' + ');
    }
    return '';
  }

  const codePoints = (s) => [...s].filter((c) => c !== '️' && c !== '‍')
    .map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ');

  M.tooltip.provide(SELECTOR, (el) => {
    load();
    const label = el.getAttribute('aria-label') || '';
    let who, emoji;
    if (el.tagName === 'BUTTON') {
      // 「❤️のリアクションを削除」(「リアクションする」ボタンなど、絵文字のないものは対象外)
      const m = label.match(/^(.+?)のリアクション/);
      if (!m) return null;
      emoji = m[1].trim();
      who = /削除/.test(label) ? '自分のリアクション(クリックで削除)' : '自分のリアクション';
    } else {
      const i = label.lastIndexOf(':');
      who = i >= 0 ? label.slice(0, i).trim() : 'リアクション';
      // Muse のラベルの「アシスタント」を実際の名前に
      if (M.assistantName()) who = who.replace(/^アシスタント/, M.assistantName());
      emoji = (i >= 0 ? label.slice(i + 1) : el.textContent).trim();
    }
    if (!emoji || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(emoji)) return null;
    // 名前は表示する時点で引く(マウスを乗せてから表示までの間に読み込みが終わるように)
    return () => {
      const name = nameOf(emoji);
      if (!names) load();
      return { big: emoji, text: `${name || (names ? '(名前不明)' : '(名前を読み込み中)')}\n${who}${name ? '' : `\n${codePoints(emoji)}`}` };
    };
  });

  // リアクションを選ぶところ(メッセージのメニューの 👍❤️😂… と、「その他のリアクション」の絵文字の一覧)。
  // ボタンは aria-label="😀でリアクションする" / 「いいね！」でリアクション。次々に見比べるので早めに出す
  const PICKER = 'button[aria-label$="でリアクションする"], button[aria-label$="でリアクション"]';
  M.tooltip.provide(PICKER, (el) => {
    load();
    const emoji = el.textContent.trim();
    if (!emoji || emoji.length > 16 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(emoji)) return null;
    return () => {
      if (!names) load();
      const name = nameOf(emoji);
      return { big: emoji, text: name || (names ? `(名前不明)\n${codePoints(emoji)}` : '(名前を読み込み中)') };
    };
  }, { delay: 150 });

  load();
})();
