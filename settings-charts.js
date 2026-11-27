// 設定画面(settings.js)のグラフ(isolated world)。
// - 使用率の推移(今週の折れ線・目安・予測・先週との比較)
// - 利用の記録(日ごとの送信数の棒グラフ、曜日と時間帯ごとの送信数)
// どれも SVG で描き、マウスを乗せると値を出し、「表で見る」で同じ値を表でも読めるようにする。
// 系列の色は settings.js の CSS 変数(--muse-helper-series など)で、明暗のモードごとに決める。
(() => {
  'use strict';
  const el = MuseHelper.el;
  // SVG の要素を作る(attrs を属性に、parent があればその子に)
  const SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, parent) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  // ---------- 使用率の推移グラフ ----------
  // 今週(週の始まり〜リセット)の使用率の折れ線と、目安(週の経過割合)の線、平均ペースでの予測(破線)。
  // 先週の記録があれば、1週間ずらして同じ位置に重ねる(そのときは凡例を出す)。
  // 目安・予測・上限・先週は線の端に直接ラベルを付ける。マウスを乗せると各記録の値が出る。

  // usage: 使用率 { used, reset, resetAt, at }、history: 使用率の記録 [{ used, at }]、fmt12: 12時間表記か
  function renderChart(box, usage, history, fmt12) {
    const M = MuseHelper;
    const f = M.forecast(usage, history);
    // 中身が変わっていなければ作り直さない(「表で見る」の開閉やマウスを乗せた表示を保つため)
    const last = history[history.length - 1];
    const sig = JSON.stringify([f && f.used, f && f.resetAt, f && f.resetPassed, history.length, last && last.at, fmt12]);
    if (box.dataset.sig === sig && box.firstChild) return;
    box.dataset.sig = sig;
    const wasOpen = !!box.querySelector('details[open]');
    box.textContent = '';
    if (!f || f.resetPassed) {
      box.style.display = 'none';
      return;
    }
    box.style.display = '';
    // 今週の記録(最後に値が下がった後)+ 週の始まり(0%)+ 最新値
    let pts = history.filter((p) => p.at >= f.weekStart && p.at <= f.at && Number.isFinite(p.used)).sort((a, b) => a.at - b.at);
    for (let i = pts.length - 1; i > 0; i--) if (pts[i].used < pts[i - 1].used) { pts = pts.slice(i); break; }
    if (!pts.length || pts[pts.length - 1].at < f.at) pts.push({ at: f.at, used: f.used });
    const anchor = { at: f.weekStart, used: 0, anchor: true };

    // 先週(1週間前の同じ期間)の記録。時刻を1週間ずらして今週の軸に重ねる
    const prevPts = history.filter((p) => p.at >= f.weekStart - M.WEEK && p.at < f.weekStart && Number.isFinite(p.used)).sort((a, b) => a.at - b.at);
    for (let i = prevPts.length - 1; i > 0; i--) if (prevPts[i].used < prevPts[i - 1].used) { prevPts.splice(0, i); break; }
    const prev = prevPts.length >= 2 ? prevPts.map((p) => ({ at: p.at + M.WEEK, used: p.used })) : null;
    // 先週の同じ時刻の値(記録の間は直線で補う。記録の範囲外は null)
    const prevAt = (t) => {
      if (!prev || t < prev[0].at || t > prev[prev.length - 1].at) return null;
      const i = prev.findIndex((p) => p.at >= t);
      if (prev[i].at === t || i === 0) return prev[i].used;
      const a = prev[i - 1], b = prev[i];
      return a.used + ((b.used - a.used) * (t - a.at)) / (b.at - a.at);
    };
    const pct = (v) => `${Math.round(v * 10) / 10}%`;
    const prevNow = prevAt(f.at);

    const W = 560, H = 176, L = 34, R = 62, T = 12, B = 24;
    const x = (t) => L + ((t - f.weekStart) / (f.resetAt - f.weekStart)) * (W - L - R);
    const y = (v) => T + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - T - B);

    // 凡例(2系列のときだけ)
    if (prev) {
      const legend = el('div', 'text-caption-1 text-text-secondary');
      legend.style.cssText = 'display:flex;gap:16px;margin-bottom:4px;';
      const d = new Date(f.weekStart - M.WEEK), e = new Date(f.weekStart - 1);
      for (const [color, text] of [['var(--muse-helper-series)', '今週'],
        ['var(--muse-helper-prev)', `先週(${d.getMonth() + 1}/${d.getDate()}〜${e.getMonth() + 1}/${e.getDate()})`]]) {
        const item = el('span', '');
        item.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
        const sw = el('span', '');
        sw.style.cssText = `display:inline-block;width:14px;height:2px;border-radius:1px;background:${color};`;
        item.append(sw, text);
        legend.appendChild(item);
      }
      box.appendChild(legend);
    }

    const wrap = el('div', '');
    wrap.style.cssText = 'position:relative;';
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
      'aria-label': `今週の使用率の推移。現在 ${f.used}%、目安 ${Math.round(f.target)}%` +
        (prevNow != null ? `、先週の同じ時点 ${Math.round(prevNow)}%` : '') });
    svg.style.cssText = 'display:block;overflow:visible;font:10px ' + MuseHelper.FONT + ';';
    wrap.appendChild(svg);
    box.appendChild(wrap);

    // 目盛り(1px・実線・控えめ)
    const grid = s('g', { stroke: 'currentColor', 'stroke-opacity': '0.12', 'stroke-width': '1' }, svg);
    for (const v of [0, 50, 100]) {
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v) }, grid);
      const t = s('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = `${v}%`;
    }
    const d0 = new Date(f.weekStart);
    for (let d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1); d.getTime() < f.resetAt; d.setDate(d.getDate() + 1)) {
      const xx = x(d.getTime());
      s('line', { x1: xx, x2: xx, y1: T, y2: H - B }, grid);
      if (xx - L < 18 || W - R - xx < 12) continue; // 端に近すぎる日付は文字を省く(軸の文字と重なるため)
      const t = s('text', { x: xx, y: H - B + 14, 'text-anchor': 'middle', fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = `${d.getMonth() + 1}/${d.getDate()}`;
    }

    const label = (xx, yy, text, anchorPos = 'start') => {
      const t = s('text', { x: xx, y: yy, 'text-anchor': anchorPos, fill: 'currentColor', 'fill-opacity': '0.75' }, svg);
      t.textContent = text;
    };
    // 右端のラベル(上限・予測・先週)は、重ならないよう最後にまとめて並べる
    const right = [{ y: y(100) + 3.5, text: '上限', fixed: true }];
    // 上限(100%)と目安の線
    s('line', { x1: x(f.weekStart), y1: y(0), x2: x(f.resetAt), y2: y(100), stroke: 'currentColor', 'stroke-opacity': '0.45', 'stroke-width': '1.5' }, svg);
    // 「目安」は線の途中(週の 15% 地点)、線の左上に
    const tx = f.weekStart + (f.resetAt - f.weekStart) * 0.15;
    label(x(tx) - 4, y(15) - 6, '目安', 'end');

    // 平均ペースでの予測(破線)
    const series = 'var(--muse-helper-series)';
    if (f.avg && !f.avg.insufficient) {
      const endT = f.avg.hitAt != null ? f.avg.hitAt : f.resetAt;
      const endV = f.avg.hitAt != null ? 100 : f.avg.atReset;
      s('line', { x1: x(f.at), y1: y(f.used), x2: x(endT), y2: y(endV), stroke: series, 'stroke-width': '2',
        'stroke-dasharray': '5 4', 'stroke-opacity': '0.8', 'stroke-linecap': 'round' }, svg);
      if (f.avg.hitAt == null) right.push({ y: y(endV) + 3.5, text: `予測 ${Math.round(endV)}%` });
      else label(x(endT), y(100) - 4, `${M.when(endT, fmt12)} 上限`, 'middle');
    }

    // 先週(今週の線の下に描く)
    if (prev) {
      s('path', { d: prev.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.used).toFixed(1)}`).join(' '),
        fill: 'none', stroke: 'var(--muse-helper-prev)', 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      const end = prev[prev.length - 1];
      const text = `先週 ${Math.round(end.used)}%`;
      // 週の終わりまで記録があれば右端の列に、途中で途切れていれば線の端に
      if (f.resetAt - end.at <= 12 * M.HOUR) right.push({ y: y(end.used) + 3.5, text });
      else label(x(end.at) + 6, y(end.used) - 6, text);
    }
    right.sort((a, b) => a.y - b.y);
    for (let i = 1; i < right.length; i++) right[i].y = Math.max(right[i].y, right[i - 1].y + 12);
    right.forEach((r) => label(W - R + 6, r.y, r.text));

    // 実績(折れ線)。週の始まり〜最初の記録は記録がないので薄く
    const all = [anchor, ...pts];
    const path = (list) => list.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.used).toFixed(1)}`).join(' ');
    s('path', { d: path(all.slice(0, 2)), fill: 'none', stroke: series, 'stroke-width': '2', 'stroke-opacity': '0.35', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    if (pts.length > 1) s('path', { d: path(pts), fill: 'none', stroke: series, 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    // 最新値の点(8px、面の色の輪)
    s('circle', { cx: x(f.at), cy: y(f.used), r: '4', fill: series, stroke: 'var(--muse-helper-surface)', 'stroke-width': '2' }, svg);

    // マウスを乗せたとき: 一番近い記録に縦線と値
    const hair = s('line', { y1: T, y2: H - B, stroke: 'currentColor', 'stroke-opacity': '0.35', 'stroke-width': '1', visibility: 'hidden' }, svg);
    const dot = s('circle', { r: '4', fill: series, stroke: 'var(--muse-helper-surface)', 'stroke-width': '2', visibility: 'hidden' }, svg);
    const pdot = s('circle', { r: '4', fill: 'var(--muse-helper-prev)', stroke: 'var(--muse-helper-surface)', 'stroke-width': '2', visibility: 'hidden' }, svg);
    // 乗せられる位置: 今週の記録 + 今より先にある先週の記録
    const spots = [...pts.map((p) => ({ at: p.at, used: p.used })),
      ...(prev || []).filter((p) => p.at > f.at).map((p) => ({ at: p.at, used: null }))];
    const tip = el('div', 'text-caption-1 text-text-primary');
    tip.style.cssText = 'position:absolute;top:0;pointer-events:none;display:none;white-space:nowrap;padding:4px 8px;border-radius:8px;' +
      'background:var(--muse-helper-surface);box-shadow:0 1px 6px rgba(0,0,0,.25);';
    wrap.appendChild(tip);
    const hit = s('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const p = spots.reduce((a, b) => (Math.abs(x(b.at) - px) < Math.abs(x(a.at) - px) ? b : a));
      const target = Math.round(((p.at - f.weekStart) / (f.resetAt - f.weekStart)) * 100);
      const pv = prevAt(p.at);
      hair.setAttribute('x1', x(p.at)); hair.setAttribute('x2', x(p.at)); hair.setAttribute('visibility', 'visible');
      if (p.used != null) { dot.setAttribute('cx', x(p.at)); dot.setAttribute('cy', y(p.used)); }
      dot.setAttribute('visibility', p.used != null ? 'visible' : 'hidden');
      if (pv != null) { pdot.setAttribute('cx', x(p.at)); pdot.setAttribute('cy', y(pv)); }
      pdot.setAttribute('visibility', pv != null ? 'visible' : 'hidden');
      tip.textContent = '';
      if (p.used != null) {
        tip.append(el('b', '', `${p.used}%`), ' 使用');
        if (pv != null) tip.append(` ・ 先週 ${pct(pv)}`);
        tip.append(` ・ 目安 ${target}% ・ ${M.when(p.at, fmt12, true)}`);
      } else {
        tip.append('先週 ', el('b', '', pct(pv)), ` ・ 目安 ${target}% ・ ${M.when(p.at - M.WEEK, fmt12, true)}`);
      }
      tip.style.display = 'block';
      const left = (x(p.at) / W) * r.width;
      tip.style.left = `${Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth)}px`;
    });
    hit.addEventListener('pointerleave', () => {
      hair.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      pdot.setAttribute('visibility', 'hidden');
      tip.style.display = 'none';
    });

    // 表で見る(色や図に頼らず値を確認できるように)
    const details = el('details', 'text-caption-1 text-text-secondary');
    details.style.cssText = 'margin-top:4px;';
    const summary = el('summary', '', `表で見る(記録 ${pts.length} 件)`);
    summary.style.cursor = 'pointer';
    details.appendChild(summary);
    const table = el('table', '');
    table.style.cssText = 'margin-top:4px;border-collapse:collapse;font-variant-numeric:tabular-nums;';
    if (prev) {
      const tr = el('tr', '');
      for (const t of ['日時', '使用率', '先週の同時刻']) {
        const th = el('th', '', t);
        th.style.cssText = 'padding:1px 0 1px 16px;font-weight:normal;text-align:right;';
        tr.appendChild(th);
      }
      tr.firstChild.style.cssText = 'padding:1px 16px 1px 0;font-weight:normal;text-align:left;';
      table.appendChild(tr);
    }
    // 同じ値が続く記録は1行にまとめる(「11/24 3:13 am 〜 5:16 am」)。先週の値は、まとめた最後の時刻で比べる
    const groups = [];
    for (const p of pts) {
      const g = groups[groups.length - 1];
      if (g && g.used === p.used) g.to = p.at;
      else groups.push({ used: p.used, from: p.at, to: p.at });
    }
    const range = (g) => {
      const a = M.when(g.from, fmt12, true), b = M.when(g.to, fmt12, true);
      if (g.from === g.to) return a;
      const [da, ...ta] = a.split(' '), [db, ...tb] = b.split(' ');
      return da === db ? `${da} ${ta.join(' ')} 〜 ${tb.join(' ')}` : `${a} 〜 ${b}`;
    };
    groups.slice(-50).reverse().forEach((g) => {
      const tr = el('tr', '');
      const a = el('td', '', range(g));
      const b = el('td', 'text-text-primary', `${g.used}%`);
      a.style.cssText = 'padding:1px 16px 1px 0;';
      b.style.textAlign = 'right';
      tr.append(a, b);
      if (prev) {
        const pv = prevAt(g.to);
        const c = el('td', '', pv != null ? pct(pv) : '—');
        c.style.cssText = 'padding:1px 0 1px 16px;text-align:right;';
        tr.appendChild(c);
      }
      table.appendChild(tr);
    });
    details.appendChild(table);
    details.open = wasOpen;
    box.appendChild(details);
  }

  // 日ごとの送信数の棒グラフ(1系列なので凡例なし。マウスを乗せると値、表で見るで一覧)
  function renderActivityChart(box, list, fmt12, wasOpen) {
    const WD = ['日', '月', '火', '水', '木', '金', '土'];
    const W = 560, H = 140, L = 30, R = 8, T = 10, B = 22;
    const max = Math.max(...list.map((x) => x.sent));
    const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
    const top = Math.max(step * Math.ceil(max / step), step * 2);
    const slot = (W - L - R) / list.length;
    const bw = Math.max(4, slot - 2); // 2px の間隔
    const x = (i) => L + i * slot + (slot - bw) / 2;
    const y = (v) => T + (1 - v / top) * (H - T - B);
    const label = (d) => `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;

    const wrap = el('div', '');
    wrap.style.cssText = 'position:relative;';
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
      'aria-label': `直近28日の送信数。合計 ${list.reduce((a, b) => a + b.sent, 0)}件、最多 ${max}件` });
    svg.style.cssText = 'display:block;overflow:visible;font:10px ' + MuseHelper.FONT + ';';
    wrap.appendChild(svg);
    box.appendChild(wrap);

    const grid = s('g', { stroke: 'currentColor', 'stroke-opacity': '0.12', 'stroke-width': '1' }, svg);
    for (const v of [0, top / 2, top]) {
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v) }, grid);
      const t = s('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = String(v);
    }
    list.forEach((p, i) => {
      if ((list.length - 1 - i) % 7) return; // 今日から7日おきに日付
      const t = s('text', { x: x(i) + bw / 2, y: H - B + 14, 'text-anchor': 'middle', fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = i === list.length - 1 ? '今日' : `${p.d.getMonth() + 1}/${p.d.getDate()}`;
    });
    // 棒(上の角だけ 4px の丸み。0件は描かない)
    const series = 'var(--muse-helper-series)';
    const bars = list.map((p, i) => {
      if (!p.sent) return null;
      const x0 = x(i), y0 = y(p.sent), y1 = y(0), r = Math.min(4, bw / 2, y1 - y0);
      return s('path', { d: `M${x0},${y1} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${y1} Z`, fill: series }, svg);
    });

    const tip = el('div', 'text-caption-1 text-text-primary');
    tip.style.cssText = 'position:absolute;top:0;pointer-events:none;display:none;white-space:nowrap;padding:4px 8px;border-radius:8px;' +
      'background:var(--muse-helper-surface);box-shadow:0 1px 6px rgba(0,0,0,.25);';
    wrap.appendChild(tip);
    const hit = s('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(list.length - 1, Math.floor((px - L) / slot)));
      const p = list[i];
      bars.forEach((b, j) => b && b.setAttribute('fill-opacity', j === i ? '1' : '0.55'));
      tip.textContent = '';
      tip.append(`${label(p.d)} `, el('b', '', `送信 ${p.sent}件`), ` ・ 返信 ${p.recv}件 ・ ${p.sentChars.toLocaleString()}字`);
      tip.style.display = 'block';
      const left = ((x(i) + bw / 2) / W) * r.width;
      tip.style.left = `${Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth)}px`;
    });
    hit.addEventListener('pointerleave', () => {
      bars.forEach((b) => b && b.removeAttribute('fill-opacity'));
      tip.style.display = 'none';
    });

    const details = el('details', 'text-caption-1 text-text-secondary');
    details.style.cssText = 'margin-top:4px;';
    const summary = el('summary', '', '表で見る(直近28日)');
    summary.style.cursor = 'pointer';
    details.appendChild(summary);
    const table = el('table', '');
    table.style.cssText = 'margin-top:4px;border-collapse:collapse;font-variant-numeric:tabular-nums;';
    const head = el('tr', '');
    ['日付', '送信', '返信', '送信した文字数'].forEach((h, i) => {
      const th = el('th', '', h);
      th.style.cssText = `padding:1px ${i ? '0 1px 16px' : '16px 1px 0'};font-weight:normal;text-align:${i ? 'right' : 'left'};`;
      head.appendChild(th);
    });
    table.appendChild(head);
    [...list].reverse().forEach((p) => {
      const tr = el('tr', '');
      [label(p.d), `${p.sent}件`, `${p.recv}件`, `${p.sentChars.toLocaleString()}字`].forEach((v, i) => {
        const td = el('td', i === 1 ? 'text-text-primary' : '', v);
        td.style.cssText = `padding:1px ${i ? '0 1px 16px' : '16px 1px 0'};text-align:${i ? 'right' : 'left'};`;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    details.appendChild(table);
    details.open = wasOpen;
    box.appendChild(details);
  }

  // 曜日と時間帯ごとの送信数(直近28日の合計)。1つの色の濃さで表す(数が多いほど濃い)
  function renderHeatmap(box, list, wasOpen) {
    const WD = ['月', '火', '水', '木', '金', '土', '日'];
    const grid = WD.map(() => new Array(24).fill(0));
    for (const p of list) {
      if (!p.hours) continue;
      const wd = (p.d.getDay() + 6) % 7; // 月曜始まり
      for (const [h, n] of Object.entries(p.hours)) grid[wd][Number(h)] += n;
    }
    const max = Math.max(...grid.flat());
    const level = (n) => (!n ? 0 : Math.min(5, Math.ceil((n / max) * 5)));
    box.appendChild(el('div', 'text-caption-1 text-text-secondary', 'よく送る曜日と時間帯(直近28日の送信数)'));

    const W = 560, L = 22, T = 4, B = 18, cw = (W - L) / 24, ch = 14, H = T + ch * 7 + B;
    const wrap = el('div', '');
    wrap.style.cssText = 'position:relative;margin-top:4px;';
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': '曜日と時間帯ごとの送信数' });
    svg.style.cssText = 'display:block;overflow:visible;font:10px ' + MuseHelper.FONT + ';';
    wrap.appendChild(svg);
    box.appendChild(wrap);
    WD.forEach((w, r) => {
      const t = s('text', { x: L - 6, y: T + r * ch + ch / 2 + 3.5, 'text-anchor': 'end', fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = w;
    });
    for (const h of [0, 6, 12, 18]) {
      const t = s('text', { x: L + h * cw, y: H - 4, fill: 'currentColor', 'fill-opacity': '0.6' }, svg);
      t.textContent = `${h}時`;
    }
    const cells = [];
    grid.forEach((rowv, r) => rowv.forEach((n, h) => {
      // 2px の間隔をあけたマス
      cells.push(s('rect', { x: L + h * cw + 1, y: T + r * ch + 1, width: cw - 2, height: ch - 2, rx: 2, fill: `var(--seq-${level(n)})` }, svg));
    }));
    const tip = el('div', 'text-caption-1 text-text-primary');
    tip.style.cssText = 'position:absolute;top:0;pointer-events:none;display:none;white-space:nowrap;padding:4px 8px;border-radius:8px;' +
      'background:var(--muse-helper-surface);box-shadow:0 1px 6px rgba(0,0,0,.25);transform:translateY(-100%);';
    wrap.appendChild(tip);
    const outline = s('rect', { width: cw, height: ch, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', rx: 3, visibility: 'hidden' }, svg);
    const hit = s('rect', { x: L, y: T, width: W - L, height: ch * 7, fill: 'transparent' }, svg);
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
      const h = Math.max(0, Math.min(23, Math.floor((px - L) / cw))), row = Math.max(0, Math.min(6, Math.floor((py - T) / ch)));
      outline.setAttribute('x', L + h * cw);
      outline.setAttribute('y', T + row * ch);
      outline.setAttribute('visibility', 'visible');
      tip.textContent = '';
      tip.append(`${WD[row]}曜 ${h}時台 `, el('b', '', `${grid[row][h]}件`));
      tip.style.display = 'block';
      const left = ((L + h * cw + cw / 2) / W) * r.width;
      tip.style.left = `${Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth)}px`;
      tip.style.top = `${((T + row * ch) / H) * r.height - 4}px`;
    });
    hit.addEventListener('pointerleave', () => { outline.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; });

    // 凡例(少ない → 多い)
    const legend = el('div', 'text-caption-1 text-text-secondary');
    legend.style.cssText = 'display:flex;align-items:center;gap:3px;justify-content:flex-end;margin-top:2px;';
    legend.append('少ない ');
    for (let i = 0; i <= 5; i++) {
      const sw = el('span', '');
      sw.style.cssText = `display:inline-block;width:12px;height:10px;border-radius:2px;background:var(--seq-${i});`;
      legend.appendChild(sw);
    }
    legend.append(' 多い');
    box.appendChild(legend);

    // 表で見る: 送信の多い時間帯の上位
    const details = el('details', 'text-caption-1 text-text-secondary');
    details.style.cssText = 'margin-top:4px;';
    const summary = el('summary', '', '表で見る(送信の多い時間帯)');
    summary.style.cursor = 'pointer';
    details.appendChild(summary);
    const top = [];
    grid.forEach((rowv, r) => rowv.forEach((n, h) => { if (n) top.push({ r, h, n }); }));
    top.sort((a, b) => b.n - a.n);
    const table = el('table', '');
    table.style.cssText = 'margin-top:4px;border-collapse:collapse;font-variant-numeric:tabular-nums;';
    top.slice(0, 15).forEach((c) => {
      const tr = el('tr', '');
      const a = el('td', '', `${WD[c.r]}曜 ${c.h}時台`);
      const b = el('td', 'text-text-primary', `${c.n}件`);
      a.style.cssText = 'padding:1px 16px 1px 0;';
      b.style.textAlign = 'right';
      tr.append(a, b);
      table.appendChild(tr);
    });
    details.appendChild(table);
    details.open = wasOpen;
    box.appendChild(details);
  }

  MuseHelper.settingsCharts = { renderChart, renderActivityChart, renderHeatmap };
})();
