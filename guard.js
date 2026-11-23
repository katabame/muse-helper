// 残りが少ないときの送信前の確認(isolated world)。
// 使用率の残りが設定の値(既定 10%)以下のとき、送信(Enter / 送信ボタン)を一度止めて、
// 入力欄の上に「残り 8% です。送信しますか？」と出す。「送信する」を押すと送信し、その後30分は確認しない。
(() => {
  'use strict';
  const M = MuseHelper;
  const CHIP = 'muse-helper-guard';
  const QUIET = 30 * 60 * 1000; // 確認して送ったあと、この時間は聞かない
  const STALE = 6 * 60 * 60 * 1000; // これより古い使用率では確認しない

  let threshold = 10; // 0 ならオフ
  let usage = null; // content.js が保存した使用率 { used, at, resetAt }
  let sendMode = 'enter';
  let quietUntil = 0;
  let bypass = false; // 「送信する」を押したあとの送信は止めない

  function remaining() {
    if (!threshold || !usage || !Number.isFinite(usage.used)) return null;
    if (Date.now() - (usage.at || 0) > STALE) return null;
    if (usage.resetAt && Date.now() >= usage.resetAt) return null; // リセット済み
    const r = Math.max(0, 100 - usage.used);
    return r <= threshold ? r : null;
  }
  const shouldAsk = () => !bypass && Date.now() >= quietUntil && remaining() != null && !document.getElementById(CHIP);

  const isSendButton = (b) => b && /送信|send/i.test(b.getAttribute('aria-label') || '');

  // 確認を出す。resend: 「送信する」で実際に送る処理
  function ask(t, resend) {
    const r = remaining();
    const { anchor, card } = M.composerLayout(t);
    const chip = document.createElement('div');
    chip.id = CHIP;
    chip.setAttribute('role', 'alertdialog');
    chip.setAttribute('aria-label', '送信の確認');
    const dark = document.documentElement.classList.contains('dark');
    chip.style.cssText = 'position:absolute;bottom:100%;margin-bottom:6px;z-index:2;display:flex;align-items:center;gap:8px;' +
      'padding:6px 6px 6px 12px;border-radius:12px;font:12px/1.4 system-ui,sans-serif;white-space:nowrap;pointer-events:auto;' +
      `color:${dark ? '#f0efec' : '#1a1a19'};background:${dark ? '#262624' : '#fff'};border:1px solid #dc2626;box-shadow:0 4px 16px rgba(0,0,0,.18);`;
    const msg = document.createElement('span');
    msg.textContent = `残り ${r}% です。送信しますか？`;
    const mk = (label, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'font:inherit;cursor:pointer;border:0;border-radius:8px;padding:4px 10px;' +
        (primary ? 'color:#fff;background:#dc2626;' : 'color:inherit;background:rgba(128,128,128,.16);');
      return b;
    };
    const yes = mk('送信する', true);
    const no = mk('やめる', false);
    const done = (send) => {
      chip.remove();
      document.removeEventListener('keydown', onKey, true);
      t.focus();
      if (!send) return;
      quietUntil = Date.now() + QUIET;
      bypass = true;
      try { resend(); } finally { setTimeout(() => { bypass = false; }, 0); }
    };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(false); }
    };
    document.addEventListener('keydown', onKey, true);
    chip.append(msg, yes, no);
    const host = anchor || card.parentElement;
    if (host) {
      host.appendChild(chip);
      const hr = host.getBoundingClientRect(), cr = card.getBoundingClientRect();
      chip.style.left = `${Math.max(0, cr.left - hr.left) + 16}px`;
    }
    yes.focus();
  }

  // Enter での送信(「Enter で送信」のとき)。Ctrl/⌘+Enter モードでは sendkey.js が送信ボタンを押すので、下のクリックで止まる
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    if (!t || t !== M.composerInput() || !t.value.trim()) return;
    if (sendMode === 'mod-enter' && !e.__museHelperSynthetic) return; // 改行は sendkey.js が処理する
    if (!shouldAsk()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ask(t, () => {
      const btn = [...M.composerLayout(t).card.querySelectorAll('button')].find((b) => isSendButton(b) && !b.disabled);
      if (btn) return btn.click();
      const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      ev.__museHelperSynthetic = true;
      t.dispatchEvent(ev);
    });
  }, true);

  // 送信ボタンのクリック
  window.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('button');
    const t = M.composerInput();
    if (!b || !t || !isSendButton(b) || !M.composerLayout(t).card.contains(b) || !t.value.trim()) return;
    if (!shouldAsk()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ask(t, () => b.click());
  }, true);

  try {
    const K = [M.LOW_CONFIRM_KEY, M.USAGE_KEY, M.SEND_KEY_KEY];
    const apply = (k, v) => {
      if (k === M.LOW_CONFIRM_KEY) threshold = Number.isFinite(v) ? v : 10;
      if (k === M.USAGE_KEY) usage = v || null;
      if (k === M.SEND_KEY_KEY) sendMode = v === 'mod-enter' ? 'mod-enter' : 'enter';
    };
    chrome.storage.local.get(K, (v) => K.forEach((k) => apply(k, v && v[k])));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') K.forEach((k) => { if (changes[k]) apply(k, changes[k].newValue); });
    });
  } catch (e) {}
})();
