// ページ側(MAIN world)で動作: Reactの内部データから各メッセージの createdAt を読み、時刻ラベルを付ける。
(() => {
  'use strict';
  if (window.__museTsInstalled) return;
  window.__museTsInstalled = true;

  const CLS = 'muse-ts-label';

  function findCreatedAt(el) {
    const id = el.getAttribute('data-message-id');
    const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (!id || !fk) return null;
    let f = el[fk];
    for (let d = 0; f && d < 8; d++, f = f.return) {
      let h = f.memoizedState;
      for (let i = 0; h && typeof h === 'object' && i < 40; i++, h = h.next) {
        const s = h.memoizedState;
        const cands = [s, s && s.current, s && s.current && s.current.value];
        for (const c of cands) {
          if (c && typeof c === 'object' && c.createdAt != null && (c.id === id || c.messageId === id)) {
            const t = new Date(c.createdAt);
            if (!isNaN(t)) return t;
          }
        }
      }
    }
    return null;
  }

  // 表示形式: content.js が <html data-muse-ts-format="12|24"> に設定する(既定は24時間)
  const FMT_ATTR = 'data-muse-ts-format';
  const is12h = () => document.documentElement.getAttribute(FMT_ATTR) === '12';
  // 表示内容: <html data-muse-ts-mode="abs|rel|both">(時刻のみ / 相対時刻のみ / 両方。既定は時刻のみ)
  const MODE_ATTR = 'data-muse-ts-mode';
  const mode = () => {
    const v = document.documentElement.getAttribute(MODE_ATTR);
    return v === 'rel' || v === 'both' ? v : 'abs';
  };
  const REL_LIMIT = 7 * 24 * 60 * 60 * 1000; // 「相対時刻のみ」でも、これより前は日付と時刻で表示
  // 日付の区切り線・応答時間: <html data-muse-date-sep="0"> / data-muse-resp-time="0" でオフ(既定はオン)
  const SEP_ATTR = 'data-muse-date-sep';
  const RESP_ATTR = 'data-muse-resp-time';
  const sepOn = () => document.documentElement.getAttribute(SEP_ATTR) !== '0';
  const respOn = () => document.documentElement.getAttribute(RESP_ATTR) !== '0';
  const SEP_CLS = 'muse-date-sep';
  const RESP_MAX = 24 * 60 * 60 * 1000; // これより長い間隔は「応答時間」とみなさない

  const pad = (n) => String(n).padStart(2, '0');
  function clock(t, withSec) {
    const sec = withSec ? `:${pad(t.getSeconds())}` : '';
    if (!is12h()) return `${pad(t.getHours())}:${pad(t.getMinutes())}${sec}`;
    const h = t.getHours();
    return `${h % 12 || 12}:${pad(t.getMinutes())}${sec} ${h < 12 ? 'am' : 'pm'}`;
  }
  function relative(t, now) {
    const m = Math.floor((now - t) / 60000);
    if (m < 1) return 'たった今';
    if (m < 60) return `${m}分前`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}時間前` : `${Math.floor(h / 24)}日前`;
  }
  function format(t) {
    const now = new Date();
    const md = mode();
    if (md === 'rel' && now - t < REL_LIMIT) return relative(t, now);
    const abs = absolute(t, now);
    return md === 'both' ? `${abs}・${relative(t, now)}` : abs;
  }
  function absolute(t, now) {
    const hm = clock(t, false);
    if (t.toDateString() === now.toDateString()) return hm;
    const md = `${t.getMonth() + 1}/${t.getDate()}`;
    return t.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${t.getFullYear()}/${md} ${hm}`;
  }
  function full(t) {
    return `${t.getFullYear()}/${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${clock(t, true)}`;
  }

  // 自分(user)のメッセージか(右寄せ)
  function isUser(el) {
    const role = (el.getAttribute('data-message-role') || '').toLowerCase();
    const side = (el.getAttribute('data-message-side') || '').toLowerCase();
    return role === 'user' || side === 'right' || side === 'end';
  }

  // 応答時間: 「12秒」「3分20秒」「1時間5分」
  function duration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}秒`;
    const m = Math.floor(s / 60);
    if (m < 60) return s % 60 ? `${m}分${s % 60}秒` : `${m}分`;
    return m % 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${Math.floor(m / 60)}時間`;
  }

  // 区切り線の文字: 「今日 · 11月23日(月)」「昨日 · …」「2025年12月31日(水)」
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  function dayLabel(t) {
    const now = new Date();
    const d0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((d0(now) - d0(t)) / 86400000);
    const ymd = `${t.getFullYear() === now.getFullYear() ? '' : `${t.getFullYear()}年`}${t.getMonth() + 1}月${t.getDate()}日(${WD[t.getDay()]})`;
    return diff === 0 ? `今日 · ${ymd}` : diff === 1 ? `昨日 · ${ymd}` : ymd;
  }

  // 日付の区切り線。
  // メッセージ要素の中に入れると、Muse が要素の高さを固定しているため中身があふれて次のメッセージに重なる。
  // そこで、メッセージの列(親要素)の中で、そのメッセージの直前の兄弟として入れる(独立した1行として場所をとる)。
  // 区切り線には対象のメッセージ ID を記録し、Muse がメッセージを足して位置がずれたら付け直す。
  function setSeparator(el, t, show, keep) {
    // 以前の版(メッセージ要素の中に入れていた)の区切り線は消す
    const legacy = el.querySelector(':scope > .' + SEP_CLS);
    if (legacy) legacy.remove();
    if (!show || !el.parentElement) return;
    const id = el.getAttribute('data-message-id');
    let sep = [...el.parentElement.querySelectorAll(':scope > .' + SEP_CLS)].find((x) => x.dataset.for === id);
    keep.add(sep || null);
    const text = dayLabel(t);
    if (sep && sep.nextElementSibling === el && sep.dataset.day === t.toDateString() && sep.textContent === text) return;
    if (!sep) {
      sep = document.createElement('div');
      sep.className = SEP_CLS;
      sep.setAttribute('role', 'separator');
      sep.style.cssText =
        'display:flex;align-items:center;gap:10px;width:100%;flex:none;box-sizing:border-box;' +
        'margin:16px 0 12px;padding:0 8px;font:11px/1.2 system-ui,sans-serif;opacity:.55;pointer-events:none;white-space:nowrap;';
      for (let i = 0; i < 3; i++) {
        const part = document.createElement('span');
        if (i !== 1) part.style.cssText = 'flex:1;height:1px;background:currentColor;opacity:.35;';
        sep.appendChild(part);
      }
    }
    sep.dataset.for = id;
    keep.add(sep);
    if (sep.nextElementSibling !== el) el.parentElement.insertBefore(sep, el);
    sep.dataset.day = t.toDateString();
    sep.children[1].textContent = text;
  }

  // prev: 直前のメッセージ { t, user }(なければ null)、keep: 今回残す区切り線
  function decorate(el, t, prev, keep) {
    const iso = t.toISOString();
    const right = isUser(el);
    const align = right ? 'right' : 'left';

    // 日付の区切り線: 表示中の最初のメッセージと、直前のメッセージと日付が違うところ
    setSeparator(el, t, sepOn() && (!prev || prev.t.toDateString() !== t.toDateString()), keep);

    // 応答時間: 自分のメッセージの直後の相手のメッセージに付ける
    let resp = '';
    if (respOn() && !right && prev && prev.user) {
      const ms = t - prev.t;
      if (ms >= 0 && ms < RESP_MAX) resp = `${duration(ms)}で応答`;
    }

    let label = el.querySelector(':scope > .' + CLS);
    const text = format(t) + (resp ? `・${resp}` : '');
    if (label && label.dataset.iso === iso && label.dataset.resp === resp && label.textContent === text && label.style.textAlign === align) return;
    if (!label) {
      // 行全体(幅100%)はマウスに反応させず、Muse 側の操作を邪魔しないようにする。
      // 文字の部分(span)だけ反応させて、マウスを乗せると秒までの日時が出るようにする。
      label = document.createElement('div');
      label.className = CLS;
      label.style.cssText =
        'display:block;width:100%;flex:0 0 100%;box-sizing:border-box;padding:2px 8px 0;' +
        'font:11px/1.2 system-ui,sans-serif;opacity:.5;pointer-events:none;';
      const span = document.createElement('span');
      span.style.cssText = 'pointer-events:auto;cursor:default;';
      label.appendChild(span);
      el.appendChild(label);
    }
    const span = textSpan(label);
    label.style.textAlign = align;
    label.dataset.iso = iso;
    label.dataset.resp = resp;
    span.textContent = text;
    span.title = full(t) + (resp ? `(${resp})` : '');
  }

  // ラベル内の文字の span(古い形式のラベルなら作り直す)
  function textSpan(label) {
    let span = label.firstElementChild;
    if (!span) {
      label.textContent = '';
      span = document.createElement('span');
      span.style.cssText = 'pointer-events:auto;cursor:default;';
      label.appendChild(span);
    }
    return span;
  }

  function scan() {
    let prev = null;
    const keep = new Set();
    document.querySelectorAll('[data-message-id]').forEach((el) => {
      try {
        const t = findCreatedAt(el);
        if (!t) return;
        decorate(el, t, prev, keep);
        prev = { t, user: isUser(el) };
      } catch (e) {}
    });
    // 対象のメッセージがなくなった・不要になった区切り線を消す
    document.querySelectorAll('.' + SEP_CLS).forEach((sep) => { if (!keep.has(sep)) sep.remove(); });
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 200);
  }).observe(document.documentElement, { childList: true, subtree: true });
  // 表示形式が切り替わったら即座に描き直す
  new MutationObserver(scan).observe(document.documentElement, { attributes: true, attributeFilter: [FMT_ATTR, MODE_ATTR, SEP_ATTR, RESP_ATTR] });
  // 相対時刻(と日付の切り替わり)を反映するため、1分ごとに既存のラベルを書き直す
  setInterval(() => {
    document.querySelectorAll('.' + CLS).forEach((label) => {
      const t = new Date(label.dataset.iso);
      if (isNaN(t)) return;
      const text = format(t) + (label.dataset.resp ? `・${label.dataset.resp}` : '');
      if (label.textContent !== text) textSpan(label).textContent = text;
    });
    // 日付が変わったら「今日」「昨日」を付け直す
    document.querySelectorAll('.' + SEP_CLS).forEach((sep) => {
      const t = new Date(sep.dataset.day);
      if (!isNaN(t) && sep.children[1] && sep.children[1].textContent !== dayLabel(t)) sep.children[1].textContent = dayLabel(t);
    });
  }, 60000);
  scan();
})();
