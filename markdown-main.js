// ページ側(MAIN world)で動作: メッセージの元の文章(Markdown)を React の内部データから読んで、isolated world へ渡す。
// copy-markdown.js(「Markdownとしてコピー」)が window.postMessage で { type: 'md-request', id } を送ってくるので、
// [data-message-id] の要素の配下の部品の props から msg.content(元の Markdown)を探して { type: 'md-response', id, text } で返す。
(() => {
  'use strict';
  if (window.__museMdInstalled) return;
  window.__museMdInstalled = true;

  const MSG = 'muse-helper';

  // メッセージ要素の配下(と少し上)の部品の props から元の文章を探す
  function markdownOf(id) {
    const el = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    const fk = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (!fk) return null;
    const pick = (p) => {
      if (!p || typeof p !== 'object') return null;
      const m = p.msg || p.message;
      if (m && typeof m.content === 'string' && (m.id == null || m.id === id || m.messageId === id)) return m.content;
      const a = p.messageActions || p.actions;
      if (a && typeof a.copyContent === 'string') return a.copyContent;
      return null;
    };
    // 上(祖先)を少し見る
    let f = el[fk];
    for (let d = 0; f && d < 6; d++, f = f.return) {
      const t = pick(f.memoizedProps);
      if (t != null) return t;
    }
    // 配下を幅優先で見る(多すぎるときは打ち切る)
    const queue = [el[fk].child];
    for (let n = 0; queue.length && n < 3000; n++) {
      const c = queue.shift();
      if (!c) continue;
      const t = pick(c.memoizedProps);
      if (t != null) return t;
      if (c.child) queue.push(c.child);
      if (c.sibling) queue.push(c.sibling);
    }
    return null;
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.source !== MSG || m.type !== 'md-request' || typeof m.id !== 'string') return;
    let text = null;
    try { text = markdownOf(m.id); } catch (err) {}
    window.postMessage({ source: MSG, type: 'md-response', id: m.id, text }, location.origin);
  });
})();
