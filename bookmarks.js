// メッセージのブックマーク(isolated world)。
// - メッセージの時刻ラベル(timestamps.js が付ける)の横に ☆ ボタンを足し、押すと保存する
// - 一覧は画面右上のパネル(Alt+B / 設定画面から開く)。項目を押すとそのメッセージへ移動する
//   別の会話のメッセージなら、その会話を開いてから移動する(sessionStorage で移動先を引き継ぐ)
// - 本文は書式ごと保存し(許可したタグだけの木構造)、読み込まれていないメッセージでもパネルで全文を読める
// - 読み込まれていないメッセージへ移動するときは、見つかるまで会話を上へ読み込む(設定でオフにできる)
(() => {
  'use strict';
  const M = MuseHelper;
  const KEY = M.BOOKMARKS_KEY;
  const JUMP = 'museHelperJump';
  const BTN = 'muse-bm-btn';
  const PANEL = 'muse-helper-bookmarks';
  const SVG = 'http://www.w3.org/2000/svg';
  const STAR = 'M12 3.6l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.62l-5.1 2.68.97-5.68L3.75 9.6l5.7-.83z';

  let marks = {}; // { [メッセージID]: { path, title, text, body, len, at, user, savedAt, memo } }
  let viewing = null; // 全文を表示中のブックマーク ID
  let autoLoad = true; // 読み込まれていないメッセージへ移動するとき、過去のメッセージを自動で読み込む
  let loading = null; // 自動で読み込み中 { id, count, still, timer }
  let editing = null; // メモを編集中のブックマーク ID
  let query = ''; // 一覧の絞り込み
  let sort = 'chat'; // 'chat'(会話ごと)| 'added'(追加した順)
  let sidebarBadge = true; // サイドバーの会話にブックマーク数を出す
  let names = {}; // { [会話のパス]: サイドバーでの名前 }
  let loaded = false;
  let note = ''; // パネルに出す一時的なお知らせ

  const style = document.createElement('style');
  style.textContent = `
    .${BTN} { all: unset; box-sizing: border-box; pointer-events: auto; cursor: pointer; display: inline-flex; vertical-align: -2px;
      margin: 0 2px 0 6px; padding: 1px; border-radius: 4px; color: inherit; visibility: hidden; }
    .${BTN} svg { width: 12px; height: 12px; display: block; }
    .${BTN} path { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
    [data-message-id]:hover .${BTN}, .${BTN}:focus-visible, .${BTN}[aria-pressed="true"] { visibility: visible; }
    .${BTN}[aria-pressed="true"] { color: #c98500; }
    .${BTN}[aria-pressed="true"] path { fill: currentColor; }
    .${BTN}:focus-visible { outline: 2px solid #2a78d6; }

    #${PANEL} { position: fixed; top: 64px; right: 16px; z-index: 2147483000; width: min(360px, calc(100vw - 32px));
      max-height: min(70vh, 640px); display: flex; flex-direction: column; box-sizing: border-box;
      font: 13px/1.45 system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif; color: #1a1a19; background: #fff; border: 1px solid rgba(0,0,0,.1);
      border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,.18); pointer-events: auto; }
    html.dark #${PANEL} { color: #f0efec; background: #262624; border-color: rgba(255,255,255,.1); }
    #${PANEL} button { all: unset; box-sizing: border-box; cursor: pointer; }
    #${PANEL} button:focus-visible { outline: 2px solid #2a78d6; outline-offset: -2px; }
    #${PANEL} .bm-head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 14px; font-weight: 600; }
    #${PANEL} .bm-head span { flex: 1; }
    #${PANEL} .bm-close { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; opacity: .6; }
    #${PANEL} .bm-close:hover { opacity: 1; background: rgba(128,128,128,.15); }
    #${PANEL} .bm-body { overflow-y: auto; padding: 0 6px 8px; }
    #${PANEL} .bm-tools { display: flex; gap: 6px; padding: 0 10px 8px 14px; }
    #${PANEL} .bm-q { all: unset; box-sizing: border-box; flex: 1; min-width: 0; padding: 4px 8px; font-size: 12px;
      border: 1px solid rgba(128,128,128,.4); border-radius: 6px; }
    #${PANEL} .bm-q:focus { border-color: #2a78d6; }
    #${PANEL} .bm-sort { font: 12px system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif; color: inherit; background: transparent; border: 1px solid rgba(128,128,128,.4); border-radius: 6px; padding: 2px 4px; }
    html.dark #${PANEL} .bm-sort option { background: #262624; }
    .muse-bm-count { flex: none; margin-left: auto; padding-left: 6px; font: 11px/1 system-ui,-apple-system,"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI",Meiryo,sans-serif; color: #c98500; pointer-events: none; }
    .muse-bm-count::before { content: "★" attr(data-count); }
    #${PANEL} .bm-note { margin: 0 8px 8px; padding: 6px 8px; border-radius: 8px; font-size: 12px; background: rgba(217,119,6,.14); }
    #${PANEL} .bm-empty { padding: 4px 8px 8px; font-size: 12px; opacity: .65; }
    #${PANEL} .bm-group { margin: 8px 8px 2px; font-size: 11px; opacity: .6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #${PANEL} .bm-item { display: flex; align-items: flex-start; gap: 4px; border-radius: 8px; }
    #${PANEL} .bm-item:hover { background: rgba(128,128,128,.12); }
    #${PANEL} .bm-go { flex: 1; min-width: 0; padding: 6px 8px; border-radius: 8px; }
    #${PANEL} .bm-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
    #${PANEL} .bm-meta { font-size: 11px; opacity: .6; }
    #${PANEL} .bm-memo { margin-top: 2px; font-size: 12px; padding-left: 8px; border-left: 2px solid #c98500; word-break: break-word; white-space: pre-wrap; }
    #${PANEL} .bm-memo-input { all: unset; box-sizing: border-box; display: block; width: 100%; margin: 4px 0 2px; padding: 4px 8px;
      font-size: 12px; border: 1px solid rgba(128,128,128,.45); border-radius: 6px; }
    #${PANEL} .bm-memo-input:focus { border-color: #2a78d6; }
    #${PANEL} .bm-memo-hint { font-size: 11px; opacity: .55; }
    #${PANEL} .bm-del { width: 24px; height: 24px; margin: 6px 4px 0 0; display: grid; place-items: center; border-radius: 6px; opacity: 0; }
    #${PANEL} .bm-actions { display: flex; margin: 6px 4px 0 0; }
    #${PANEL} .bm-del { margin: 0; }
    #${PANEL} .bm-item:hover .bm-del, #${PANEL} .bm-del:focus-visible { opacity: .6; }
    #${PANEL} .bm-del:hover { opacity: 1 !important; background: rgba(128,128,128,.18); }
    #${PANEL}.bm-wide { width: min(600px, calc(100vw - 32px)); max-height: min(80vh, 820px); }
    #${PANEL} .bm-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 8px 8px; }
    #${PANEL} .bm-btn { padding: 3px 10px; font-size: 12px; border-radius: 6px; background: rgba(128,128,128,.16); }
    #${PANEL} .bm-btn:hover { background: rgba(128,128,128,.26); }
    #${PANEL} .bm-btn.primary { color: #fff; background: #2a78d6; }
    #${PANEL} .bm-btn.primary:hover { background: #1f66bd; }
    #${PANEL} .bm-note .bm-btn { margin-left: 8px; }
    #${PANEL} .bm-view-meta { padding: 0 10px; font-size: 11px; opacity: .6; }
    #${PANEL} .bm-view-memo { margin: 6px 10px 0; }
    #${PANEL} .bm-doc { padding: 6px 10px 12px; font-size: 13.5px; line-height: 1.65; word-break: break-word; overflow-wrap: anywhere; }
    #${PANEL} .bm-doc > :first-child { margin-top: 0; }
    #${PANEL} .bm-doc p, #${PANEL} .bm-doc ul, #${PANEL} .bm-doc ol, #${PANEL} .bm-doc pre, #${PANEL} .bm-doc blockquote, #${PANEL} .bm-doc table { margin: .6em 0; }
    #${PANEL} .bm-doc h1, #${PANEL} .bm-doc h2, #${PANEL} .bm-doc h3, #${PANEL} .bm-doc h4, #${PANEL} .bm-doc h5, #${PANEL} .bm-doc h6 { margin: 1em 0 .4em; font-weight: 700; line-height: 1.35; }
    #${PANEL} .bm-doc h1 { font-size: 1.35em; } #${PANEL} .bm-doc h2 { font-size: 1.2em; } #${PANEL} .bm-doc h3 { font-size: 1.08em; }
    #${PANEL} .bm-doc h4, #${PANEL} .bm-doc h5, #${PANEL} .bm-doc h6 { font-size: 1em; }
    #${PANEL} .bm-doc ul { list-style: disc; padding-left: 1.5em; } #${PANEL} .bm-doc ol { list-style: decimal; padding-left: 1.6em; }
    #${PANEL} .bm-doc ul ul { list-style: circle; } #${PANEL} .bm-doc li { margin: .2em 0; display: list-item; }
    #${PANEL} .bm-doc strong, #${PANEL} .bm-doc b { font-weight: 700; } #${PANEL} .bm-doc em, #${PANEL} .bm-doc i { font-style: italic; }
    #${PANEL} .bm-doc del, #${PANEL} .bm-doc s { text-decoration: line-through; }
    #${PANEL} .bm-doc a { color: #2a78d6; text-decoration: underline; }
    #${PANEL} .bm-doc code { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 1px 4px; border-radius: 4px; background: rgba(128,128,128,.15); }
    #${PANEL} .bm-doc pre { white-space: pre-wrap; padding: 8px 10px; border-radius: 8px; background: rgba(128,128,128,.12); }
    #${PANEL} .bm-doc pre code { padding: 0; background: none; }
    #${PANEL} .bm-doc blockquote { padding-left: 10px; border-left: 3px solid rgba(128,128,128,.45); opacity: .85; }
    #${PANEL} .bm-doc hr { border: 0; border-top: 1px solid rgba(128,128,128,.35); margin: 1em 0; }
    #${PANEL} .bm-doc table { border-collapse: collapse; display: block; overflow-x: auto; font-size: 12.5px; }
    #${PANEL} .bm-doc th, #${PANEL} .bm-doc td { border: 1px solid rgba(128,128,128,.35); padding: 3px 8px; text-align: left; vertical-align: top; }
    #${PANEL} .bm-doc th { font-weight: 700; background: rgba(128,128,128,.1); }
    #${PANEL} .bm-doc .bm-pre { white-space: pre-wrap; }
    #${PANEL} .bm-partial { margin: 0 10px 10px; font-size: 11px; opacity: .6; }
  `;
  document.documentElement.appendChild(style);

  function star() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', STAR);
    svg.appendChild(p);
    return svg;
  }
  function pencil() {
    const svg = cross();
    svg.firstChild.setAttribute('d', 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4');
    svg.firstChild.setAttribute('stroke-width', '1.8');
    svg.firstChild.setAttribute('stroke-linejoin', 'round');
    return svg;
  }
  function cross() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    svg.appendChild(p);
    return svg;
  }
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function docIcon() {
    const svg = cross();
    svg.firstChild.setAttribute('d', 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5');
    svg.firstChild.setAttribute('fill', 'none');
    svg.firstChild.setAttribute('stroke-width', '1.7');
    svg.firstChild.setAttribute('stroke-linejoin', 'round');
    return svg;
  }

  // ---------- 本文の保存(書式つき) ----------
  // 本文を、許可したタグだけの木構造にして保存する: 文字列 | { t: タグ, c: [子], h?: リンク先, w?: 1(改行を保つ) }
  // 表示するときは createElement で組み立て直す(HTML の文字列は使わない)
  const KEEP = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'code', 'pre',
    'blockquote', 'a', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 's', 'sup', 'sub']);
  const ALLOWED = new Set([...KEEP, 'div']);
  // sr-only: Muse が読み上げ用に入れている見えない文字(「自分:」「アシスタントメッセージ:」など。タブや状況で変わる)
  const SKIP = `${M.OWN_IN_MESSAGE}, .muse-collapse-btn, .sr-only, button, svg, script, style, textarea, input, select, [aria-hidden="true"]`;
  const MAX_CHARS = 50000; // 1件に保存する本文の上限(文字)

  function serialize(root) {
    let budget = MAX_CHARS;
    const walk = (node) => {
      if (budget <= 0) return [];
      if (node.nodeType === Node.TEXT_NODE) {
        let t = node.textContent;
        if (!t) return [];
        if (t.length > budget) t = t.slice(0, budget) + '…';
        budget -= t.length;
        return [t];
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches(SKIP)) return [];
      const cs = getComputedStyle(node);
      if (cs.display === 'none') return [];
      const kids = [];
      for (const c of node.childNodes) kids.push(...walk(c));
      const tag = node.tagName.toLowerCase();
      if (KEEP.has(tag)) {
        const n = { t: tag, c: kids };
        if (tag === 'a') {
          const h = node.getAttribute('href') || '';
          if (/^https?:/i.test(h)) n.h = h;
        }
        if (tag !== 'pre' && tag !== 'code' && cs.whiteSpace.startsWith('pre')) n.w = 1;
        return [n];
      }
      if (!kids.length) return [];
      // そのほかの要素: ブロックなら div として区切りを保ち、インラインなら中身だけ残す
      if (/^(inline|contents)/.test(cs.display) && !cs.whiteSpace.startsWith('pre')) return kids;
      if (kids.length === 1 && typeof kids[0] === 'object' && kids[0].t === 'div') return kids; // 入れ子の div をまとめる
      const n = { t: 'div', c: kids };
      if (cs.whiteSpace.startsWith('pre')) n.w = 1;
      return [n];
    };
    return walk(root);
  }

  function build(nodes, parent, depth = 0) {
    if (!Array.isArray(nodes) || depth > 60) return;
    for (const n of nodes) {
      if (typeof n === 'string') { parent.appendChild(document.createTextNode(n)); continue; }
      if (!n || typeof n !== 'object' || !ALLOWED.has(n.t)) continue;
      const e = document.createElement(n.t);
      if (n.t === 'a' && typeof n.h === 'string' && /^https?:/i.test(n.h)) {
        e.href = n.h;
        e.target = '_blank';
        e.rel = 'noopener noreferrer';
      }
      if (n.w) e.className = 'bm-pre';
      build(n.c, e, depth + 1);
      parent.appendChild(e);
    }
  }

  // ---------- Markdown の表示 ----------
  // Muse が本文を Markdown の記号のまま表示しているメッセージ(書式のタグを含まない本文)は、ここで整えて表示する
  const RICH = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'pre', 'table', 'blockquote', 'strong', 'b', 'em', 'i', 'code', 'a', 'hr', 'del', 's']);
  function hasRich(nodes) {
    return Array.isArray(nodes) && nodes.some((n) => n && typeof n === 'object' && (RICH.has(n.t) || hasRich(n.c)));
  }
  // 改行を保って文字を取り出す(ブロックの区切りと br は改行にする)
  function sourceText(nodes) {
    let out = '';
    const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
    const walk = (ns) => {
      for (const n of ns || []) {
        if (typeof n === 'string') out += n;
        else if (n && n.t === 'br') out += '\n';
        else if (n && (n.t === 'div' || n.t === 'p' || n.t === 'li')) { nl(); walk(n.c); nl(); }
        else if (n) walk(n.c);
      }
    };
    walk(nodes);
    return out.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  }

  function inline(text, parent) {
    // `コード` / **太字** / __太字__ / *斜体* / _斜体_ / ~~取り消し~~ / [文字](URL) / https://...
    const RE = /(`+)([\s\S]+?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*(?!\s)([\s\S]+?)\*|(?<![\w])_(?!\s)([\s\S]+?)_(?![\w])|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,、。!?！？])/g;
    let last = 0;
    for (let m; (m = RE.exec(text));) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      let e;
      if (m[1]) { e = el('code', '', m[2]); }
      else if (m[3] != null || m[4] != null) { e = el('strong'); inline(m[3] != null ? m[3] : m[4], e); }
      else if (m[5] != null) { e = el('del'); inline(m[5], e); }
      else if (m[6] != null || m[7] != null) { e = el('em'); inline(m[6] != null ? m[6] : m[7], e); }
      else {
        e = el('a');
        e.href = m[9] || m[10];
        e.target = '_blank';
        e.rel = 'noopener noreferrer';
        if (m[8] != null) inline(m[8], e); else e.textContent = m[10];
      }
      parent.appendChild(e);
      last = RE.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  // 段落の中の改行は br にする(チャットの文章は1行ずつ改行していることが多いので)
  function inlineLines(lines, parent) {
    lines.forEach((l, i) => { if (i) parent.appendChild(el('br')); inline(l, parent); });
  }

  const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  function markdown(src, parent, depth = 0) {
    const lines = src.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/))) { // コードブロック
        const fence = m[1];
        const body = [];
        for (i++; i < lines.length && !lines[i].trim().startsWith(fence); i++) body.push(lines[i]);
        i++;
        const pre = el('pre');
        pre.appendChild(el('code', '', body.join('\n')));
        parent.appendChild(pre);
        continue;
      }
      if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) { // 見出し
        const h = el('h' + m[1].length);
        inline(m[2], h);
        parent.appendChild(h);
        i++;
        continue;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { parent.appendChild(el('hr')); i++; continue; } // 区切り線
      if (/^\s*>/.test(line)) { // 引用
        const body = [];
        for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ''));
        const q = el('blockquote');
        if (depth < 8) markdown(body.join('\n'), q, depth + 1);
        parent.appendChild(q);
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) { // 表
        const table = el('table');
        const thead = el('thead');
        const hr = el('tr');
        for (const c of cells(line)) { const th = el('th'); inline(c, th); hr.appendChild(th); }
        thead.appendChild(hr);
        const tbody = el('tbody');
        for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) {
          const tr = el('tr');
          for (const c of cells(lines[i])) { const td = el('td'); inline(c, td); tr.appendChild(td); }
          tbody.appendChild(tr);
        }
        table.append(thead, tbody);
        parent.appendChild(table);
        continue;
      }
      if (LIST.test(line)) { // リスト(字下げで入れ子)
        const stack = []; // [{ indent, list, li }]
        for (; i < lines.length; i++) {
          const l = lines[i];
          const lm = l.match(LIST);
          if (!lm) {
            // 項目の続きの行(字下げされている)。空行のあとに字下げのない行が来たら終わり
            if (l.trim() && /^\s/.test(l) && stack.length) { stack[stack.length - 1].li.appendChild(el('br')); inline(l.trim(), stack[stack.length - 1].li); continue; }
            if (!l.trim() && i + 1 < lines.length && (LIST.test(lines[i + 1]) || /^\s+\S/.test(lines[i + 1]))) continue;
            break;
          }
          const indent = lm[1].replace(/\t/g, '    ').length;
          const ordered = /\d/.test(lm[2]);
          while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
          // 同じ字下げで番号つき / 箇条書きが切り替わったら、別のリストにする
          if (stack.length && indent === stack[stack.length - 1].indent && (stack[stack.length - 1].list.tagName === 'OL') !== ordered) stack.pop();
          let top = stack[stack.length - 1];
          if (!top || indent > top.indent) {
            const list = el(ordered ? 'ol' : 'ul');
            if (ordered && parseInt(lm[2], 10) !== 1) list.start = parseInt(lm[2], 10);
            (top ? top.li : parent).appendChild(list);
            top = { indent, list, li: null };
            stack.push(top);
          }
          const li = el('li');
          inline(lm[3], li);
          top.list.appendChild(li);
          top.li = li;
        }
        continue;
      }
      // 段落: 空行や、ほかのブロックの始まりまで
      const para = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        if (!l.trim() || /^\s*(```|~~~|#{1,6}\s|>)/.test(l) || LIST.test(l) || /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) break;
        if (l.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) break;
        para.push(l);
      }
      const p = el('p');
      inlineLines(para, p);
      parent.appendChild(p);
    }
  }

  // 絞り込み用の文字(保存した本文から)
  function flat(nodes) {
    let out = '';
    const walk = (ns) => { if (Array.isArray(ns)) for (const n of ns) { if (typeof n === 'string') out += n; else if (n && n.c) { walk(n.c); out += ' '; } } };
    walk(nodes);
    return out;
  }

  // 画面にあるメッセージから本文を取り込む。
  // 保存し直すのは、まだ全文がないとき・古い形式のとき・本文が伸びたとき(返信の途中で保存した)だけにする。
  // 「違ったら上書き」にすると、muse.ai を複数のタブで開いているときに、タブごとに少しだけ違う本文で
  // 互いに上書きし合って止まらなくなる
  const BODY_VERSION = 2;
  function capture(id, msgEl) {
    const b = marks[id];
    if (!b) return false;
    const quick = M.messageText(msgEl).length;
    if (b.body && b.v === BODY_VERSION && msgEl.__museBmSeen === quick) return false; // このタブで前回から変わっていない
    msgEl.__museBmSeen = quick;
    const body = serialize(msgEl);
    const plain = flat(body).replace(/\s+/g, ' ').trim();
    if (!plain) return false;
    if (b.body && b.v === BODY_VERSION && plain.length <= (b.len || 0)) return false;
    b.text = plain.slice(0, 160);
    b.body = body;
    b.len = plain.length;
    b.v = BODY_VERSION;
    return true;
  }

  function save() {
    try { chrome.storage.local.set({ [KEY]: marks }); } catch (e) {}
  }

  // 会話の名前(タブのタイトル。サービス名だけなら空)
  function chatTitle() {
    const t = document.title.replace(/\s*[|\-–—]\s*Muse\s*$/i, '').trim();
    return /^muse$/i.test(t) ? '' : t.slice(0, 80);
  }

  function toggle(msgEl) {
    const id = msgEl.getAttribute('data-message-id');
    if (!id) return;
    if (marks[id]) {
      delete marks[id];
    } else {
      const m = M.messages().find((x) => x.el === msgEl);
      marks[id] = {
        path: location.pathname,
        title: chatTitle(),
        text: M.messageText(msgEl).replace(/^(自分|相手|ユーザー|アシスタント)(メッセージ)?[:：]\s*/, '').slice(0, 160),
        at: m && m.at,
        user: !!(m && m.user),
        savedAt: Date.now(),
      };
      capture(id, msgEl);
    }
    save();
    ensure();
    render();
  }

  // ---------- 時刻ラベルの ☆ ボタン ----------
  // ボタンには文字を入れない(timestamps.js はラベルの textContent で描き直しの要否を判断するため)
  function ensure() {
    if (!loaded) return;
    badges();
    let changed = false;
    for (const m of M.messages()) {
      // 本文をまだ全部保存していないブックマーク(以前に保存したもの・返信の途中で保存したもの)は取り込み直す
      if (marks[m.id] && capture(m.id, m.el)) changed = true;
      const label = m.el.querySelector(':scope > .muse-ts-label');
      if (!label) continue;
      let b = label.querySelector(':scope > .' + BTN);
      if (!b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = BTN;
        b.appendChild(star());
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const msg = b.closest('[data-message-id]');
          if (msg) toggle(msg);
        });
        label.appendChild(b);
      }
      const on = String(!!marks[m.id]);
      if (b.getAttribute('aria-pressed') !== on) {
        b.setAttribute('aria-pressed', on);
        const t = on === 'true' ? 'ブックマークを外す' : 'ブックマークに追加';
        b.setAttribute('aria-label', t);
        b.title = t;
      }
    }
    if (changed) save();
  }

  // ---------- サイドバーの会話のブックマーク数 ----------
  // サイドバーの会話の行(data-testid="hatch-thread-row")はリンクではなく、会話の ID も持っていない。
  // そこで、開いている会話の行(aria-current="page")の名前を、今のパスと組にして覚えておき(museThreadNames)、
  // 名前で行を見分けて「★2」を出す。文字は CSS で出す(行の textContent は変えない)
  const ROW = '[data-testid="hatch-thread-row"]';
  const rowName = (r) => r.textContent.replace(/\s+/g, ' ').trim();

  // 画面の切り替えの途中は、パスと「開いている行」が一瞬食い違うことがあるので、
  // 表示中の会話(data-hatch-route-key="thread:<ID>")がパスと一致し、同じ組を1秒以上続けて見たときだけ覚える
  let seenPair = null; // { path, name, at }
  function learn() {
    const cur = document.querySelector(`${ROW}[aria-current="page"]`);
    const name = cur && rowName(cur);
    const path = location.pathname;
    const id = path.split('/').pop();
    const pane = document.querySelector('[data-hatch-route-key^="thread:"]');
    if (!name || !id || (pane && pane.getAttribute('data-hatch-route-key') !== `thread:${id}`)) { seenPair = null; return; }
    if (names[path] === name) return;
    if (!seenPair || seenPair.path !== path || seenPair.name !== name) { seenPair = { path, name, at: Date.now() }; return; }
    if (Date.now() - seenPair.at < 1000) return;
    names = { ...names, [path]: name };
    try { chrome.storage.local.set({ [M.THREAD_NAMES_KEY]: names }); } catch (e) {}
  }
  setInterval(() => { if (loaded && M.alive()) badges(); }, 2000);

  function setBadge(host, n, before) {
    let badge = host.querySelector(':scope > .muse-bm-count');
    if (!n) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'muse-bm-count';
      if (before && before.parentElement === host) host.insertBefore(badge, before); else host.appendChild(badge);
    }
    if (badge.dataset.count !== String(n)) {
      badge.dataset.count = String(n);
      badge.title = `ブックマーク ${n}件`;
    }
  }

  function badges() {
    learn();
    const counts = {};
    if (sidebarBadge) for (const b of Object.values(marks)) counts[b.path] = (counts[b.path] || 0) + 1;
    // 名前 → パス(覚えた名前と、ブックマークを保存したときのタブのタイトル)
    const byName = {};
    const add = (name, path) => { if (name) (byName[name] = byName[name] || new Set()).add(path); };
    for (const [path, name] of Object.entries(names)) add(name, path);
    for (const b of Object.values(marks)) if (!names[b.path]) add(b.title, b.path);
    for (const r of document.querySelectorAll(ROW)) {
      let n = 0;
      if (sidebarBadge) {
        // 開いている会話の行は今のパスで確実に分かる。ほかは名前で(同じ名前の会話が複数あるときは出さない)
        const paths = r.getAttribute('aria-current') === 'page' ? [location.pathname] : [...(byName[rowName(r)] || [])];
        if (paths.length === 1) n = counts[paths[0]] || 0;
      }
      setBadge(r, n, r.querySelector(':scope > button[data-slot="dropdown-menu-trigger"]'));
    }
    // リンク(a 要素)で作られた会話の一覧にも対応しておく
    for (const a of document.querySelectorAll('a[href]')) {
      if (a.closest(`[role="dialog"], [data-message-id], #${PANEL}`)) continue;
      let path = '';
      try { const u = new URL(a.href, location.href); if (u.origin === location.origin) path = u.pathname; } catch (e) {}
      setBadge(a, path && path !== '/' ? counts[path] || 0 : 0);
    }
  }

  // ---------- 一覧のパネル ----------
  const panel = () => document.getElementById(PANEL);

  function open() {
    if (panel()) return render();
    const p = el('div');
    p.id = PANEL;
    p.setAttribute('role', 'region');
    p.setAttribute('aria-label', 'ブックマーク');
    const head = el('div', 'bm-head');
    const title = el('span', 'bm-title', 'ブックマーク');
    const close = el('button', 'bm-close');
    close.type = 'button';
    close.setAttribute('aria-label', '閉じる');
    close.title = '閉じる(Esc)';
    close.appendChild(cross());
    close.addEventListener('click', hide);
    head.append(title, close);
    const tools = el('div', 'bm-tools');
    const q = el('input', 'bm-q');
    q.type = 'search';
    q.placeholder = '本文・メモ・会話名で絞り込み';
    q.setAttribute('aria-label', 'ブックマークを絞り込む');
    q.value = query;
    q.addEventListener('input', () => { query = q.value; render(); });
    const so = el('select', 'bm-sort');
    so.setAttribute('aria-label', '並び順');
    for (const [v, t] of [['chat', '会話ごと'], ['added', '追加した順']]) {
      const o = el('option', '', t);
      o.value = v;
      so.appendChild(o);
    }
    so.value = sort;
    so.addEventListener('change', () => {
      sort = so.value;
      try { chrome.storage.local.set({ [M.BOOKMARK_SORT_KEY]: sort }); } catch (e) {}
      render();
    });
    tools.append(q, so);
    p.append(head, tools, el('div', 'bm-body'));
    document.body.appendChild(p);
    render();
    close.focus();
  }
  function hide() {
    const p = panel();
    editing = null;
    viewing = null;
    stopLoad();
    if (p) p.remove();
    note = '';
  }
  const toggleOpen = () => (panel() ? hide() : open());

  function render() {
    const p = panel();
    if (!p) return;
    const list = Object.entries(marks).map(([id, b]) => ({ id, ...b }));
    p.querySelector('.bm-title').textContent = `ブックマーク(${list.length}件)`;
    const body = p.querySelector('.bm-body');
    body.textContent = '';
    if (viewing && !marks[viewing]) viewing = null;
    p.classList.toggle('bm-wide', !!viewing);
    p.querySelector('.bm-tools').style.display = viewing ? 'none' : '';
    if (loading) {
      const n = el('div', 'bm-note', `過去のメッセージを読み込んでいます…(読み込み済み ${loading.count} 件)`);
      const stop = el('button', 'bm-btn', '中止');
      stop.type = 'button';
      stop.addEventListener('click', () => { const id = loading && loading.id; stopLoad(); if (id) view(id, ''); });
      n.appendChild(stop);
      body.appendChild(n);
    } else if (note) body.appendChild(el('div', 'bm-note', note));
    if (viewing) return renderView(body, viewing);
    if (!list.length) {
      body.appendChild(el('div', 'bm-empty', 'メッセージにマウスを乗せ、時刻の横の ☆ を押すと追加できます。'));
      return;
    }
    const chatName = (b) => (b.path === location.pathname ? 'この会話' : b.title || '別の会話');
    const q = query.trim().toLowerCase();
    const shown = q ? list.filter((b) => `${b.body ? flat(b.body) : b.text}\n${b.memo || ''}\n${b.title || ''}`.toLowerCase().includes(q)) : list;
    if (!shown.length) {
      body.appendChild(el('div', 'bm-empty', '一致するブックマークはありません。'));
      return;
    }
    // 会話ごと: 今の会話を先頭に、ほかは新しく追加した順。会話の中は発言の順
    // 追加した順: 新しく追加したものから、会話の名前を添えて
    const groups = new Map();
    if (sort === 'added') {
      groups.set('', shown.sort((a, b) => b.savedAt - a.savedAt));
    } else {
      shown.sort((a, b) => (a.at || a.savedAt) - (b.at || b.savedAt));
      for (const b of shown) {
        if (!groups.has(b.path)) groups.set(b.path, []);
        groups.get(b.path).push(b);
      }
    }
    const order = [...groups.keys()].sort((a, b) => {
      if (a === location.pathname) return -1;
      if (b === location.pathname) return 1;
      return Math.max(...groups.get(b).map((x) => x.savedAt)) - Math.max(...groups.get(a).map((x) => x.savedAt));
    });
    const fmt12 = M.fmt12();
    for (const path of order) {
      const items = groups.get(path);
      if (sort !== 'added') body.appendChild(el('div', 'bm-group', chatName(items[0])));
      for (const b of items) {
        const row = el('div', 'bm-item');
        const go = el('button', 'bm-go');
        go.type = 'button';
        go.append(el('div', 'bm-text', b.text || '(本文なし)'),
          el('div', 'bm-meta', `${sort === 'added' ? `${chatName(b)} ・ ` : ''}${b.at ? M.when(b.at, fmt12, true) : '時刻不明'} ・ ${b.user ? '自分' : '相手'}`));
        if (b.memo && editing !== b.id) go.appendChild(el('div', 'bm-memo', b.memo));
        go.addEventListener('click', () => jump(b.id));
        if (editing === b.id) {
          // メモの編集(Enter で保存、Esc で取り消し、欄の外を押しても保存)
          const box = el('div', 'bm-go');
          box.append(el('div', 'bm-text', b.text || '(本文なし)'));
          const input = el('input', 'bm-memo-input');
          input.type = 'text';
          input.maxLength = 200;
          input.value = b.memo || '';
          input.placeholder = 'メモ(例: あとで聞き直す)';
          input.setAttribute('aria-label', 'メモ');
          const commit = (keep) => {
            if (editing !== b.id) return;
            editing = null;
            if (keep && marks[b.id]) {
              const v = input.value.trim();
              if (v) marks[b.id].memo = v; else delete marks[b.id].memo;
              save();
            }
            render();
          };
          input.addEventListener('keydown', (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') { e.preventDefault(); commit(true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(false); }
          });
          input.addEventListener('blur', () => commit(true));
          box.append(input, el('div', 'bm-memo-hint', 'Enter で保存 ・ Esc で取り消し'));
          row.append(box);
          body.appendChild(row);
          setTimeout(() => input.focus());
          continue;
        }
        const edit = el('button', 'bm-del');
        edit.type = 'button';
        edit.setAttribute('aria-label', b.memo ? 'メモを編集' : 'メモを追加');
        edit.title = b.memo ? 'メモを編集' : 'メモを追加';
        edit.appendChild(pencil());
        edit.addEventListener('click', () => { editing = b.id; render(); });
        const del = el('button', 'bm-del');
        del.type = 'button';
        del.setAttribute('aria-label', 'ブックマークを削除');
        del.title = '削除';
        del.appendChild(cross());
        del.addEventListener('click', () => {
          delete marks[b.id];
          save();
          ensure();
          render();
        });
        const full = el('button', 'bm-del');
        full.type = 'button';
        full.setAttribute('aria-label', '全文を表示');
        full.title = '全文を表示';
        full.appendChild(docIcon());
        full.addEventListener('click', () => view(b.id, ''));
        const actions = el('div', 'bm-actions');
        actions.append(full, edit, del);
        row.append(go, actions);
        body.appendChild(row);
      }
    }
  }

  // ---------- 全文の表示 ----------
  function view(id, msg) {
    if (!marks[id]) return;
    editing = null;
    viewing = id;
    note = msg || '';
    if (panel()) render(); else open();
    const p = panel();
    if (p) { p.querySelector('.bm-body').scrollTop = 0; const back = p.querySelector('.bm-back'); if (back) back.focus(); }
  }
  function backToList() {
    viewing = null;
    note = '';
    render();
  }

  function renderView(body, id) {
    const b = marks[id];
    const bar = el('div', 'bm-bar');
    const back = el('button', 'bm-btn bm-back', '← 一覧へ');
    back.type = 'button';
    back.addEventListener('click', backToList);
    const go = el('button', 'bm-btn primary', 'メッセージへ移動');
    go.type = 'button';
    go.addEventListener('click', () => jump(id));
    bar.append(back, go);
    body.appendChild(bar);
    const chat = b.path === location.pathname ? 'この会話' : b.title || '別の会話';
    body.appendChild(el('div', 'bm-view-meta', `${chat} ・ ${b.at ? M.when(b.at, M.fmt12(), true) : '時刻不明'} ・ ${b.user ? '自分' : '相手'}`));
    if (b.memo) body.appendChild(el('div', 'bm-memo bm-view-memo', b.memo));
    const doc = el('div', 'bm-doc');
    if (Array.isArray(b.body) && b.body.length) {
      if (hasRich(b.body)) build(b.body, doc);
      else markdown(sourceText(b.body), doc); // Markdown の記号のままの本文は整えて表示する
    }
    else doc.textContent = b.text || '(本文なし)';
    body.appendChild(doc);
    if (!b.body) body.appendChild(el('div', 'bm-partial', '保存されているのは冒頭の一部だけです。このメッセージが画面に読み込まれると、全文が保存されます。'));
    else if (b.len >= MAX_CHARS) body.appendChild(el('div', 'bm-partial', `とても長いメッセージのため、先頭の約${MAX_CHARS.toLocaleString()}文字だけを保存しています。`));
  }

  // ---------- 移動 ----------
  const findMessage = (id) => [...document.querySelectorAll('[data-message-id]')].find((x) => x.getAttribute('data-message-id') === id);
  const NOT_LOADED = 'このメッセージはまだ読み込まれていないため、保存した本文を表示しています。';

  // 見つからなかったとき: 自動で読み込むか、全文を表示する
  function fallback(id) {
    if (autoLoad) startLoad(id);
    else view(id, NOT_LOADED);
  }

  function jump(id) {
    const b = marks[id];
    if (!b) return;
    stopLoad();
    if (b.path === location.pathname) {
      const target = findMessage(id);
      if (target) {
        // 読み込み済みでも、離れた位置へのスムーズスクロールは途中で Muse が表示を組み立て直してずれるので、
        // 自動読み込みのあとと同じく、すぐに動かして落ち着くまで合わせ直す
        hide();
        settle(id);
      } else {
        fallback(id);
      }
      return;
    }
    // 別の会話: Muse(Next.js)の画面の切り替えで移動し(再読み込みしない)、メッセージが出るのを待つ。
    // 切り替えが使えなければ、ページを読み込み直して移動する
    hide();
    navigate(b.path).then((ok) => {
      if (ok) return waitAndScroll(id);
      try { sessionStorage.setItem(JUMP, id); } catch (e) {}
      location.assign(b.path);
    });
  }

  // nav-main.js(MAIN world)に画面の切り替えを頼む。1秒以内に返事がなければ失敗とみなす
  function navigate(path) {
    return new Promise((resolve) => {
      const reqId = Math.random().toString(36).slice(2);
      const done = (ok) => { window.removeEventListener('message', onMsg); clearTimeout(timer); resolve(ok); };
      const onMsg = (e) => {
        const m = e.data;
        if (e.source === window && m && m.source === 'muse-helper' && m.type === 'navigate-result' && m.id === reqId) done(!!m.ok);
      };
      const timer = setTimeout(() => done(false), 1000);
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'muse-helper', type: 'navigate', id: reqId, path }, location.origin);
    });
  }

  // 読み込み直して移動してきたとき
  function resumeJump() {
    let id = null;
    try { id = sessionStorage.getItem(JUMP); sessionStorage.removeItem(JUMP); } catch (e) {}
    if (id) waitAndScroll(id);
  }

  // 会話を開いたあと、メッセージが表示されるまで待って移動する。
  // 会話のメッセージが出てから1.5秒たっても見つからなければ(まだ読み込まれていない)、自動で読み込むか全文を表示する
  function waitAndScroll(id) {
    const until = Date.now() + 15000;
    let shownAt = 0;
    (function wait() {
      const target = findMessage(id);
      if (target) return settle(id);
      const pane = document.querySelector('[data-hatch-route-key^="thread:"]');
      const ready = M.messages().length && (!pane || pane.getAttribute('data-hatch-route-key') === `thread:${location.pathname.split('/').pop()}`);
      if (ready && !shownAt) shownAt = Date.now();
      if (shownAt && Date.now() - shownAt > 1500) return fallback(id);
      if (Date.now() < until) return setTimeout(wait, 300);
      fallback(id);
    })();
  }

  // ---------- 過去のメッセージの自動読み込み ----------
  // 会話の一覧を一番上までスクロールして、Muse に過去のメッセージを読み込ませる。見つかったら移動する。
  // 6秒続けて件数が増えなければ(会話の先頭まで読み込んだ)、あきらめて全文を表示する
  const LOAD_LIMIT = 120000;
  function scroller() {
    const first = document.querySelector('[data-message-id]');
    for (let e = first && first.parentElement; e && e !== document.body; e = e.parentElement) {
      const oy = getComputedStyle(e).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight) return e;
    }
    return null;
  }
  function startLoad(id) {
    stopLoad();
    const st = { id, count: document.querySelectorAll('[data-message-id]').length, still: 0, timer: 0, until: Date.now() + LOAD_LIMIT };
    loading = st;
    viewing = null;
    note = '';
    if (panel()) render(); else open();
    const step = () => {
      if (loading !== st) return;
      const target = findMessage(id);
      if (target) {
        loading = null;
        hide();
        settle(id);
        return;
      }
      const n = document.querySelectorAll('[data-message-id]').length;
      if (n > st.count) { st.count = n; st.still = 0; } else st.still++;
      if (st.still >= 12 || Date.now() > st.until) {
        loading = null;
        view(id, '会話を読み込みましたが、このメッセージは見つかりませんでした(削除されたか、ほかの会話へ移された可能性があります)。保存した本文を表示しています。');
        return;
      }
      const s = scroller();
      if (s) {
        // 一番上へ(下から積み上げる並びでは scrollTop が負になるので、十分に小さい値を入れる)。
        // すでに一番上なら少し戻して、次の回にもう一度上へ動かす(読み込みのきっかけを作る)
        const before = s.scrollTop;
        s.scrollTop = -s.scrollHeight;
        if (s.scrollTop === before) s.scrollTop = before + 80;
      }
      render();
      st.timer = setTimeout(step, 500);
    };
    st.timer = setTimeout(step, 100);
  }
  // 見つけたメッセージを画面の中央に合わせる。
  // 見つけた直後は、Muse が過去のメッセージを読み込んだり、新しい側のメッセージの表示を組み立て直したりして
  // 位置がずれ続ける(下から積み上げる並びなので、下側の高さが変わると上下に動く)。そこで、
  // - スムーズスクロールを使わず、すぐに動かす(途中の位置で測って合わせ直すと行き過ぎるため)
  // - 位置と件数が 1.2 秒続けて変わらなくなるまで合わせ直す(最短 1.5 秒・最長 10 秒)
  // - その間にユーザーがスクロールやキー操作をしたら、すぐにやめる
  function scrollerOf(e) {
    for (let p = e && e.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
  }
  // 見えている範囲(入力欄が会話の上に重なっている分は除く)
  function visibleBox(s) {
    const sr = s.getBoundingClientRect();
    let top = Math.max(sr.top, 0), bottom = Math.min(sr.bottom, window.innerHeight);
    const input = M.composerInput && M.composerInput();
    if (input) {
      const cr = M.composerLayout(input).card.getBoundingClientRect();
      if (cr.top > top + 100 && cr.top < bottom) bottom = cr.top - 8;
    }
    return { top, bottom, height: bottom - top };
  }
  let settling = null;
  function settle(id) {
    if (settling) settling.stop();
    const started = Date.now();
    let calm = 0, lastCount = -1, timer = 0;
    const stop = () => {
      clearTimeout(timer);
      ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((t) => window.removeEventListener(t, stop, true));
      if (settling === me) settling = null;
    };
    const me = { stop };
    settling = me;
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((t) => window.addEventListener(t, stop, { capture: true, passive: true }));
    const tick = () => {
      if (settling !== me) return;
      const target = findMessage(id);
      const s = target && scrollerOf(target);
      if (!target || !s) { stop(); if (target) M.scrollToMessage(target, 'center'); return; }
      const r = target.getBoundingClientRect();
      const v = visibleBox(s);
      // 画面より長いメッセージは先頭を見える範囲の上に合わせる
      const delta = r.height > v.height - 48 ? r.top - v.top - 24 : (r.top + r.height / 2) - (v.top + v.height / 2);
      const count = document.querySelectorAll('[data-message-id]').length;
      if (Math.abs(delta) > 2) {
        s.scrollTo({ top: s.scrollTop + delta, behavior: 'instant' });
        calm = 0;
      } else if (count === lastCount) calm++;
      else calm = 0;
      lastCount = count;
      const elapsed = Date.now() - started;
      if ((calm >= 8 && elapsed > 1500) || elapsed > 10000) {
        stop();
        target.classList.add('muse-helper-flash'); // 位置は動かさずに光らせる
        clearTimeout(target.__museFlash);
        target.__museFlash = setTimeout(() => target.classList.remove('muse-helper-flash'), 1600);
        return;
      }
      timer = setTimeout(tick, 150);
    };
    tick();
  }

  function stopLoad() {
    if (!loading) return;
    clearTimeout(loading.timer);
    loading = null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel() && !(e.target && e.target.classList && e.target.classList.contains('bm-memo-input'))) {
      e.stopPropagation();
      if (viewing && !loading) backToList(); else hide();
    }
  }, true);

  // ほかのスクリプト(keys.js・settings.js)から使う
  M.bookmarks = { open, hide, toggle: toggleOpen, count: () => Object.keys(marks).length };

  // ---------- 起動 ----------
  let timer;
  new MutationObserver((list) => {
    if (list.every((m) => m.target.closest && m.target.closest(`.${BTN}, #${PANEL}`))) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (M.alive()) ensure(); }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  try {
    chrome.storage.local.get([KEY, M.BOOKMARK_SORT_KEY, M.SIDEBAR_BADGE_KEY, M.THREAD_NAMES_KEY, M.BOOKMARK_AUTOLOAD_KEY], (v) => {
      autoLoad = !(v && v[M.BOOKMARK_AUTOLOAD_KEY] === false);
      names = (v && v[M.THREAD_NAMES_KEY]) || {};
      marks = (v && v[KEY] && typeof v[KEY] === 'object' && v[KEY]) || {};
      sort = v && v[M.BOOKMARK_SORT_KEY] === 'added' ? 'added' : 'chat';
      sidebarBadge = !(v && v[M.SIDEBAR_BADGE_KEY] === false);
      loaded = true;
      ensure();
      render();
      resumeJump();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[M.SIDEBAR_BADGE_KEY]) { sidebarBadge = changes[M.SIDEBAR_BADGE_KEY].newValue !== false; badges(); }
      if (changes[M.BOOKMARK_AUTOLOAD_KEY]) autoLoad = changes[M.BOOKMARK_AUTOLOAD_KEY].newValue !== false;
      if (changes[M.THREAD_NAMES_KEY]) { names = changes[M.THREAD_NAMES_KEY].newValue || {}; badges(); }
      if (!changes[KEY]) return;
      marks = changes[KEY].newValue || {};
      ensure();
      render();
    });
  } catch (e) {}
})();
