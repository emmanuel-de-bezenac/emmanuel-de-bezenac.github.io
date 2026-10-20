/* Section 4 of the AI-cyclones post ("The right place, but too weak").
   1. renderBias: bias of the maximum 10 m wind by lead time, relative to HRES-fc0.
   2. renderPressureWind: joint distribution of minimum pressure and maximum wind per
      source, as kernel-density contours, in values or in normal scores of the ranks.
   Requires d3 v7 as a global. All text is inserted with textContent. */
(function () {
  'use strict';

  const COLOR = {
    fgn: '#E24B4A', gencast_op: '#1D9E75', ifsens_e2s: '#378ADD',
    hres: '#8E44AD', era5: '#C2670F', ibtracs: '#1a1a1a',
  };
  const LABEL = {
    fgn: 'FGN', gencast_op: 'GenCast', ifsens_e2s: 'IFS-ENS',
    hres: 'HRES-fc0', era5: 'ERA5', ibtracs: 'IBTrACS',
  };
  const colorOf = k => COLOR[k] || '#888888';
  const labelOf = k => LABEL[k] || String(k);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ DOM helpers
  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }
  // short line of the series colour, used as the key in legends, tooltips and readouts
  function lineKey(color, dashed, width) {
    width = width || 18;
    const s = svgEl('svg', { width, height: 8, class: 'bi-key', 'aria-hidden': 'true', focusable: 'false' });
    const l = svgEl('line', { x1: 1, x2: width - 1, y1: 4, y2: 4, stroke: color, 'stroke-width': 2 });
    if (dashed) l.setAttribute('stroke-dasharray', '4 2.5');
    else l.setAttribute('stroke-linecap', 'round');
    s.append(l);
    return s;
  }

  const STYLE_ID = 'bi-intensity-style';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = el('style', { id: STYLE_ID });
    s.textContent = `
.bi-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.2rem 0.3rem; margin-bottom: 0.5rem; }
.bi-leg { font-family: var(--sans, system-ui, sans-serif); font-size: 0.78rem; line-height: 1.4; color: var(--text-2, #555);
  background: none; border: 1px solid transparent; border-radius: 100px; padding: 0.2rem 0.55rem; cursor: pointer;
  display: inline-flex; align-items: center; gap: 0.4rem; transition: border-color .15s, color .15s; }
.bi-leg:hover { border-color: var(--border, #ece9e4); color: var(--text, #1a1a1a); }
.bi-leg:focus-visible { outline: 2px solid var(--text-3, #8a8a8a); outline-offset: 1px; }
.bi-leg[aria-pressed="false"] { color: var(--text-3, #8a8a8a); }
.bi-leg[aria-pressed="false"] .bi-key { opacity: 0.25; }
.bi-key { display: inline-block; flex: none; vertical-align: middle; }
.bi-check { font-family: var(--sans, system-ui, sans-serif); font-size: 0.78rem; color: var(--text-2, #555);
  display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; margin-left: auto; padding: 0.2rem 0; }
.bi-check input { accent-color: var(--text, #1a1a1a); margin: 0; }
.bi-ckey { font-size: 0.74rem; color: var(--text-3, #8a8a8a); display: flex; flex-wrap: wrap; gap: 0.2rem 1rem; margin: -0.2rem 0 0.4rem 0.55rem; }
.bi-ckey span { display: inline-flex; align-items: center; gap: 0.4rem; }
.bi-svg { display: block; overflow: visible; font-family: var(--sans, system-ui, sans-serif); touch-action: pan-y; }
.bi-svg:focus { outline: none; }
.bi-svg:focus-visible { outline: 2px solid var(--text-3, #8a8a8a); outline-offset: 3px; border-radius: 4px; }
.bi-svg .bi-src { transition: opacity .15s; }
.bi-tip { position: fixed; pointer-events: none; z-index: 30; display: none; min-width: 150px;
  background: var(--surface, #fff); border: 1px solid var(--border, #ece9e4); border-radius: 6px;
  padding: 0.45rem 0.65rem; font-family: var(--sans, system-ui, sans-serif); font-size: 0.76rem; line-height: 1.55;
  color: var(--text-2, #555); box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
.bi-tip .t { font-weight: 600; color: var(--text, #1a1a1a); margin-bottom: 0.15rem; }
.bi-tip .r { display: flex; align-items: center; gap: 0.45rem; white-space: nowrap; }
.bi-tip .r b { font-weight: 600; color: var(--text, #1a1a1a); font-variant-numeric: tabular-nums; min-width: 3.4em; text-align: right; }
.bi-tip .r .s { color: var(--text-3, #8a8a8a); font-variant-numeric: tabular-nums; }
.bi-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
p.bi-note { padding: 0; margin: 0.5rem 0 0; max-width: none; }
.bi-rho > span { display: inline-flex; align-items: center; gap: 0.35rem; margin: 0 1rem 0 0; white-space: nowrap; font-variant-numeric: tabular-nums; }
.bi-rho .lead-in { margin-right: 0.6rem; }
details.bi-table { margin-top: 0.6rem; }
`;
    document.head.append(s);
  }

  // one tooltip per chart; value first, then key and label
  function makeTip(container) {
    const tip = el('div', { class: 'bi-tip', 'aria-hidden': 'true' });
    container.append(tip);
    return {
      show(title, rows, cx, cy) {
        tip.replaceChildren(el('div', { class: 't' }, title));
        for (const r of rows) {
          const row = el('div', { class: 'r' });
          row.append(el('b', {}, r.value));
          if (r.color) row.append(lineKey(r.color, r.dashed, 14));
          row.append(document.createTextNode(r.label));
          if (r.extra) row.append(el('span', { class: 's' }, r.extra));
          tip.append(row);
        }
        tip.style.display = 'block';
        const w = tip.offsetWidth, h = tip.offsetHeight;
        let x = cx + 16;
        if (x + w > window.innerWidth - 8) x = cx - w - 16;
        x = Math.max(8, x);
        const y = Math.max(8, Math.min(cy - h / 2, window.innerHeight - h - 8));
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
      },
      hide() { tip.style.display = 'none'; },
    };
  }

  // re-render on window resize when the container width changes
  function watchResize(container, redraw) {
    if (container.__biCleanup) container.__biCleanup();
    let w = container.clientWidth, raf = 0;
    const handler = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const nw = container.clientWidth;
        if (nw !== w) { w = nw; redraw(); }
      });
    };
    window.addEventListener('resize', handler);
    container.__biCleanup = () => { window.removeEventListener('resize', handler); cancelAnimationFrame(raf); };
  }
  const widthOf = container => Math.max(300, container.clientWidth || 640);

  const fmtSigned1 = d3.format('+.1f');     // d3 uses the unicode minus
  const fmt2 = d3.format('.2f');
  const fmtTick = d3.format('~f');
  const num = v => (v == null || !isFinite(v)) ? null : +v;

  // ================================================================== 1. bias by lead time
  const BIAS_ORDER = ['fgn', 'gencast_op', 'ifsens_e2s', 'era5'];
  const Y_TITLE = 'Bias of maximum 10 m wind (% of mean HRES-fc0)';

  function renderBias(container, data) {
    injectStyle();
    if (container.__biCleanup) container.__biCleanup();
    container.replaceChildren();

    const leadH = data.lead_h.map(Number);
    const lead = leadH.map(h => h / 24);
    const keys = BIAS_ORDER.filter(k => data.series[k])
      .concat(Object.keys(data.series).filter(k => !BIAS_ORDER.includes(k)));
    const S = keys.map(k => ({
      key: k,
      mean: lead.map((_, i) => num(data.series[k].mean[i])),
      std: lead.map((_, i) => num((data.series[k].std || [])[i])),
      dashed: k === 'era5',
    }));
    const state = { visible: new Set(keys), spread: false, idx: null };

    // controls: legend buttons and spread toggle, one row
    const row = el('div', { class: 'bi-row', role: 'group', 'aria-label': 'Series shown' });
    S.forEach(s => {
      const b = el('button', { type: 'button', class: 'bi-leg', 'aria-pressed': 'true' });
      b.append(lineKey(colorOf(s.key), s.dashed), document.createTextNode(labelOf(s.key)));
      b.addEventListener('click', () => {
        if (state.visible.has(s.key)) state.visible.delete(s.key); else state.visible.add(s.key);
        b.setAttribute('aria-pressed', String(state.visible.has(s.key)));
        draw();
      });
      row.append(b);
    });
    const chkLabel = el('label', { class: 'bi-check' });
    const chk = el('input', { type: 'checkbox' });
    chkLabel.append(chk, document.createTextNode('Show spread across storms'));
    chk.addEventListener('change', () => { state.spread = chk.checked; draw(); });
    row.append(chkLabel);

    const holder = el('div');
    const tBar = num(data.t_bar_ms);
    const note = el('p', { class: 'note bi-note' },
      `Relative to HRES-fc0. Mean over ${data.n_storms} storms; 100% = ${tBar == null ? '–' : String(+tBar.toFixed(1))} m/s.`);
    const live = el('div', { class: 'bi-sr', 'aria-live': 'polite' });
    container.append(row, holder, note, buildBiasTable(lead, S), live);
    const tip = makeTip(container);

    function rowsAt(i) {
      return S.filter(s => state.visible.has(s.key) && s.mean[i] != null)
        .sort((a, b) => b.mean[i] - a.mean[i])
        .map(s => ({
          value: fmtSigned1(s.mean[i]) + '%', label: labelOf(s.key), color: colorOf(s.key), dashed: s.dashed,
          extra: s.std[i] != null ? '± ' + s.std[i].toFixed(1) : null,
        }));
    }
    const leadTitle = i => `Lead ${+lead[i].toFixed(2)} days (${leadH[i]} h)`;

    function draw() {
      tip.hide();
      state.idx = null;
      const W = widthOf(container);
      const narrow = W < 520;
      const m = { left: 40, right: narrow ? 72 : 82, bottom: 40, top: 0 };
      holder.replaceChildren();
      const svgN = svgEl('svg', {
        class: 'bi-svg', width: W, tabindex: 0, role: 'img',
        'aria-label': 'Line chart: bias of the maximum 10 m wind against lead time, for each model. ' +
          'Use the left and right arrow keys to read the values at each lead time.',
      });
      holder.append(svgN);
      const svg = d3.select(svgN);

      // y-axis title above the plot, on two lines when it does not fit
      const title = svg.append('text').attr('x', 0).attr('y', 12)
        .style('fill', 'var(--text-2)').style('font-size', '12px').text(Y_TITLE);
      const len = title.node().getComputedTextLength() || Y_TITLE.length * 6.4;
      let titleH = 14;
      if (len > W - 4) {
        title.text(null);
        title.append('tspan').attr('x', 0).text('Bias of maximum 10 m wind');
        title.append('tspan').attr('x', 0).attr('dy', '1.3em').text('(% of mean HRES-fc0)');
        titleH = 30;
      }
      m.top = titleH + 14;
      const iw = W - m.left - m.right;
      const ih = Math.round(Math.max(200, Math.min(320, iw * 0.5)));
      const H = m.top + ih + m.bottom;
      svg.attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);

      // scales: domain from all series so that toggling a series does not move the axis
      const vals = [0];
      S.forEach(s => s.mean.forEach((v, i) => {
        if (v == null) return;
        vals.push(v);
        if (state.spread && s.std[i] != null) vals.push(v - s.std[i], v + s.std[i]);
      }));
      const x = d3.scaleLinear(d3.extent(lead), [0, iw]);
      const y = d3.scaleLinear(d3.extent(vals), [ih, 0]).nice(narrow ? 4 : 6);
      const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

      // grid, zero line, ticks
      const yt = y.ticks(narrow ? 4 : 6);
      g.append('g').selectAll('line').data(yt.filter(v => v !== 0)).join('line')
        .attr('x1', 0).attr('x2', iw).attr('y1', v => y(v)).attr('y2', v => y(v))
        .style('stroke', 'var(--border)').attr('stroke-width', 1).attr('shape-rendering', 'crispEdges');
      g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', y(0)).attr('y2', y(0))
        .style('stroke', 'var(--text-3)').attr('stroke-width', 1).attr('shape-rendering', 'crispEdges');
      g.append('g').selectAll('text').data(yt).join('text')
        .attr('x', -8).attr('y', v => y(v)).attr('dy', '0.32em').attr('text-anchor', 'end')
        .style('fill', 'var(--text-3)').style('font-size', '11px').style('font-variant-numeric', 'tabular-nums')
        .text(v => fmtTick(v) + '%');
      const xt = x.ticks(Math.max(3, Math.floor(iw / 55))).filter(v => Number.isInteger(v));
      g.append('g').selectAll('text').data(xt).join('text')
        .attr('x', v => x(v)).attr('y', ih + 17).attr('text-anchor', 'middle')
        .style('fill', 'var(--text-3)').style('font-size', '11px').style('font-variant-numeric', 'tabular-nums')
        .text(v => fmtTick(v));
      g.append('text').attr('x', iw / 2).attr('y', ih + 35).attr('text-anchor', 'middle')
        .style('fill', 'var(--text-2)').style('font-size', '12px').text('Lead time (days)');

      const idxs = d3.range(lead.length);
      const vis = S.filter(s => state.visible.has(s.key));

      // spread bands (behind the lines)
      if (state.spread) {
        g.append('g').selectAll('path').data(vis).join('path')
          .attr('d', s => d3.area()
            .defined(i => s.mean[i] != null && s.std[i] != null)
            .x(i => x(lead[i])).y0(i => y(s.mean[i] - s.std[i])).y1(i => y(s.mean[i] + s.std[i]))(idxs))
          .attr('fill', s => colorOf(s.key)).attr('fill-opacity', 0.1).attr('stroke', 'none');
      }
      // lines
      g.append('g').selectAll('path').data(vis).join('path')
        .attr('d', s => d3.line().defined(i => s.mean[i] != null).x(i => x(lead[i])).y(i => y(s.mean[i]))(idxs))
        .attr('fill', 'none').attr('stroke', s => colorOf(s.key)).attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round').attr('stroke-linecap', s => s.dashed ? 'butt' : 'round')
        .attr('stroke-dasharray', s => s.dashed ? '6 4' : null);

      // direct labels at the right end, shifted apart vertically; leader line when shifted
      const ends = vis.map(s => {
        let li = -1;
        for (let i = s.mean.length - 1; i >= 0; i--) if (s.mean[i] != null) { li = i; break; }
        return li < 0 ? null : { s, x0: x(lead[li]), ty: y(s.mean[li]) };
      }).filter(Boolean).sort((a, b) => a.ty - b.ty);
      const gap = 15;                                   // >= 12 px between label baselines
      ends.forEach((e, k) => { e.ly = k === 0 ? e.ty : Math.max(e.ty, ends[k - 1].ly + gap); });
      for (let k = ends.length - 1; k >= 0; k--) {
        const lim = k === ends.length - 1 ? ih + 4 : ends[k + 1].ly - gap;
        if (ends[k].ly > lim) ends[k].ly = lim;
      }
      const lab = g.append('g');
      ends.forEach(e => {
        if (Math.abs(e.ly - e.ty) > 40) return;           // too far from its line: legend and tooltip carry it
        const lx = iw + 18;
        if (Math.abs(e.ly - e.ty) > 2) {
          lab.append('path').attr('d', `M${e.x0 + 3},${e.ty}L${lx - 3},${e.ly}`)
            .attr('fill', 'none').style('stroke', 'var(--text-3)').attr('stroke-width', 1);
        }
        lab.append('text').attr('x', lx).attr('y', e.ly).attr('dy', '0.32em')
          .style('fill', 'var(--text-2)').style('font-size', '11.5px').text(labelOf(e.s.key));
      });

      // crosshair
      const cross = g.append('g').style('display', 'none').attr('pointer-events', 'none');
      const vline = cross.append('line').attr('y1', 0).attr('y2', ih)
        .style('stroke', 'var(--text-3)').attr('stroke-width', 1);
      const dots = cross.append('g');

      function setIdx(i, evt) {
        state.idx = i;
        const cx = x(lead[i]);
        cross.style('display', null);
        vline.attr('x1', cx).attr('x2', cx);
        dots.selectAll('circle').data(vis.filter(s => s.mean[i] != null), s => s.key).join('circle')
          .attr('cx', cx).attr('cy', s => y(s.mean[i])).attr('r', 4)
          .attr('fill', s => colorOf(s.key)).style('stroke', 'var(--bg, #fff)').attr('stroke-width', 2);
        const rows = rowsAt(i);
        let px, py;
        if (evt) { px = evt.clientX; py = evt.clientY; }
        else {
          const r = svgN.getBoundingClientRect();
          px = r.left + m.left + cx; py = r.top + m.top + ih / 3;
        }
        tip.show(leadTitle(i), rows, px, py);
        if (!evt) live.textContent = leadTitle(i) + ': ' + rows.map(r => `${r.label} ${r.value}`).join(', ');
      }
      function clear() { state.idx = null; cross.style('display', 'none'); tip.hide(); }
      const nearest = px => d3.leastIndex(lead, d => Math.abs(d - x.invert(px)));

      g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'none')
        .attr('pointer-events', 'all').style('cursor', 'crosshair')
        .on('pointermove', evt => setIdx(nearest(d3.pointer(evt, g.node())[0]), evt))
        .on('pointerleave', clear);

      svg.on('keydown', evt => {
        const n = lead.length;
        let i = state.idx == null ? Math.floor(n / 2) : state.idx;
        if (evt.key === 'ArrowRight') i = Math.min(n - 1, i + 1);
        else if (evt.key === 'ArrowLeft') i = Math.max(0, i - 1);
        else if (evt.key === 'Home') i = 0;
        else if (evt.key === 'End') i = n - 1;
        else if (evt.key === 'Escape') { clear(); return; }
        else return;
        evt.preventDefault();
        setIdx(i, null);
      });
      svg.on('focus', () => { if (state.idx == null) setIdx(Math.floor(lead.length / 2), null); });
      svg.on('blur', clear);
    }

    draw();
    watchResize(container, draw);
  }

  // table view of the bias chart, one row per whole day of lead time
  function buildBiasTable(lead, S) {
    const det = el('details', { class: 'table bi-table' });
    det.append(el('summary', {}, 'Table of values'));
    const table = el('table');
    const hr = el('tr');
    hr.append(el('th', {}, 'Lead (days)'));
    S.forEach(s => hr.append(el('th', {}, labelOf(s.key) + ' (%)')));
    table.append(hr);
    let rows = d3.range(lead.length).filter(i => Math.abs(lead[i] - Math.round(lead[i])) < 1e-9);
    if (rows.length < 2) rows = d3.range(lead.length);
    rows.forEach(i => {
      const tr = el('tr');
      tr.append(el('td', {}, String(+lead[i].toFixed(2))));
      S.forEach(s => tr.append(el('td', {}, s.mean[i] == null ? '–'
        : fmtSigned1(s.mean[i]) + (s.std[i] != null ? ' ± ' + s.std[i].toFixed(1) : ''))));
      table.append(tr);
    });
    det.append(table);
    return det;
  }

  // ================================================================== 2. pressure and wind
  const PW_ORDER = ['ibtracs', 'hres', 'era5', 'fgn', 'gencast_op', 'ifsens_e2s'];
  const PW_DRAW = ['fgn', 'gencast_op', 'ifsens_e2s', 'era5', 'hres', 'ibtracs'];   // references on top
  const LEVELS = [0.7, 0.3];             // fraction of the source's points inside the contour
  const N2 = 80, N1 = 160;               // grid sizes, 2D and 1D
  const RANK_EXT = { x0: -3.6, x1: 3.6, y0: -3.6, y1: 3.6 };
  const AXES = {
    values: { x: 'Minimum pressure (hPa)', y: 'Maximum wind (m/s)' },
    ranks: { x: 'Pressure, normal score', y: 'Wind, normal score' },
  };
  const prepCache = new WeakMap();

  // inverse standard normal CDF, Acklam's rational approximation (relative error < 1.2e-9)
  function invNorm(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425;
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p < pl || p > 1 - pl) {
      const q = Math.sqrt(-2 * Math.log(p < pl ? p : 1 - p));
      const z = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
      return p < pl ? z : -z;
    }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // normal scores of within-sample ranks; ties get their average rank
  function normalScores(v) {
    const n = v.length;
    const idx = Array.from({ length: n }, (_, i) => i).sort((p, q) => v[p] - v[q]);
    const out = new Float64Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && v[idx[j + 1]] === v[idx[i]]) j++;
      const z = invNorm(((i + j) / 2 + 1 - 0.5) / n);
      for (let k = i; k <= j; k++) out[idx[k]] = z;
      i = j + 1;
    }
    return out;
  }

  function gaussKernel(sigmaCells) {
    const s = Math.max(sigmaCells, 1e-3);
    const r = Math.max(1, Math.ceil(4 * s));
    const w = new Float64Array(2 * r + 1);
    let t = 0;
    for (let k = -r; k <= r; k++) { w[k + r] = Math.exp(-0.5 * (k / s) * (k / s)); t += w[k + r]; }
    for (let k = 0; k < w.length; k++) w[k] /= t;
    return { w, r };
  }
  function conv1d(a, n, stride, offset, K, out) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -K.r; k <= K.r; k++) {
        const j = i + k;
        if (j >= 0 && j < n) s += a[offset + j * stride] * K.w[k + K.r];
      }
      out[offset + i * stride] = s;
    }
  }
  const sd = arr => { const v = d3.deviation(arr); return v && isFinite(v) ? v : 0; };

  // 1D KDE (Scott's rule) on N1 cells over [lo, hi]; returns a probability density per cell
  function kde1d(xs, lo, hi) {
    const n = xs.length, du = (hi - lo) / N1;
    const G = new Float64Array(N1);
    for (let k = 0; k < n; k++) {
      const u = (xs[k] - lo) / du - 0.5, i0 = Math.floor(u), f = u - i0;
      if (i0 >= 0 && i0 < N1) G[i0] += 1 - f;
      if (i0 + 1 >= 0 && i0 + 1 < N1) G[i0 + 1] += f;
    }
    const h = sd(xs) * Math.pow(n, -1 / 5);
    const out = new Float64Array(N1);
    conv1d(G, N1, 1, 0, gaussKernel(h / du), out);
    for (let i = 0; i < N1; i++) out[i] /= n * du;
    return out;
  }

  // 2D Gaussian KDE with scipy's default bandwidth (Scott's factor n^(-1/6) times the
  // source's own covariance, so the kernel follows the correlation), computed by linear
  // binning on an N2 x N2 grid and convolution. As in the paper figure, the level for
  // "fraction q of the points inside" is the (1 - q) quantile of the density evaluated
  // at the source's own points. Returns the contours in grid units, keyed by q.
  function kde2dContours(xs, ys, ext) {
    const n = xs.length, N = N2;
    const dx = (ext.x1 - ext.x0) / N, dy = (ext.y1 - ext.y0) / N;
    const G = new Float64Array(N * N);
    const add = (i, j, w) => { if (i >= 0 && i < N && j >= 0 && j < N) G[j * N + i] += w; };
    for (let k = 0; k < n; k++) {
      const u = (xs[k] - ext.x0) / dx - 0.5, v = (ys[k] - ext.y0) / dy - 0.5;
      const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
      add(i0, j0, (1 - fu) * (1 - fv)); add(i0 + 1, j0, fu * (1 - fv));
      add(i0, j0 + 1, (1 - fu) * fv); add(i0 + 1, j0 + 1, fu * fv);
    }
    // bandwidth matrix in grid cells
    const mx = d3.mean(xs), my = d3.mean(ys);
    let cxx = 0, cyy = 0, cxy = 0;
    for (let k = 0; k < n; k++) {
      const a = xs[k] - mx, b = ys[k] - my;
      cxx += a * a; cyy += b * b; cxy += a * b;
    }
    const f2 = Math.pow(n, -1 / 3) / (n - 1);
    let hxx = Math.max(cxx * f2 / (dx * dx), 0.04), hyy = Math.max(cyy * f2 / (dy * dy), 0.04);
    let hxy = cxy * f2 / (dx * dy);
    const rmax = 0.98 * Math.sqrt(hxx * hyy);          // keep the matrix invertible
    hxy = Math.max(-rmax, Math.min(rmax, hxy));
    const det = hxx * hyy - hxy * hxy;
    const ixx = hyy / det, iyy = hxx / det, ixy = -hxy / det;
    const rx = Math.max(1, Math.ceil(4 * Math.sqrt(hxx))), ry = Math.max(1, Math.ceil(4 * Math.sqrt(hyy)));
    const kw = 2 * rx + 1, K = new Float64Array(kw * (2 * ry + 1));
    for (let b = -ry; b <= ry; b++) for (let a = -rx; a <= rx; a++) {
      const q = ixx * a * a + 2 * ixy * a * b + iyy * b * b;
      K[(b + ry) * kw + (a + rx)] = q < 32 ? Math.exp(-0.5 * q) : 0;
    }
    // scatter each non-empty bin through the kernel
    const D = new Float64Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const w = G[j * N + i];
      if (!w) continue;
      for (let b = Math.max(-ry, -j); b <= Math.min(ry, N - 1 - j); b++) {
        const row = (j + b) * N, krow = (b + ry) * kw + rx;
        for (let a = Math.max(-rx, -i); a <= Math.min(rx, N - 1 - i); a++) D[row + i + a] += w * K[krow + a];
      }
    }
    // density at the points, by bilinear interpolation on the grid
    const at = new Float64Array(n);
    const val = (i, j) => (i >= 0 && i < N && j >= 0 && j < N) ? D[j * N + i] : 0;
    for (let k = 0; k < n; k++) {
      const u = (xs[k] - ext.x0) / dx - 0.5, v = (ys[k] - ext.y0) / dy - 0.5;
      const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
      at[k] = val(i0, j0) * (1 - fu) * (1 - fv) + val(i0 + 1, j0) * fu * (1 - fv) +
              val(i0, j0 + 1) * (1 - fu) * fv + val(i0 + 1, j0 + 1) * fu * fv;
    }
    at.sort();
    if (!(at[n - 1] > 0)) return null;
    const out = {}, values = Array.from(D);
    for (const q of LEVELS) {
      const t = d3.quantileSorted(at, 1 - q);
      out[q] = t > 0 ? d3.contours().size([N, N]).thresholds([t])(values)[0] : null;
    }
    return out;
  }

  function preparePW(data) {
    if (prepCache.has(data)) return prepCache.get(data);
    const srcs = PW_ORDER.filter(k => data.sources[k])
      .concat(Object.keys(data.sources).filter(k => !PW_ORDER.includes(k)));
    const pts = {};
    for (const s of srcs) {
      const P = data.sources[s].pmin || [], V = data.sources[s].vmax || [];
      const px = [], py = [];
      for (let i = 0; i < Math.min(P.length, V.length); i++) {
        if (P[i] != null && V[i] != null && isFinite(P[i]) && isFinite(V[i])) { px.push(+P[i]); py.push(+V[i]); }
      }
      pts[s] = { px, py };
    }
    const use = srcs.filter(s => pts[s].px.length >= 5);
    // shared extent in values mode: union of each source's 0.5-99.5% range, padded
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of use) {
      const sx = Float64Array.from(pts[s].px).sort(), sy = Float64Array.from(pts[s].py).sort();
      x0 = Math.min(x0, d3.quantileSorted(sx, 0.005)); x1 = Math.max(x1, d3.quantileSorted(sx, 0.995));
      y0 = Math.min(y0, d3.quantileSorted(sy, 0.005)); y1 = Math.max(y1, d3.quantileSorted(sy, 0.995));
    }
    const wide = { x0: x0 - ((x1 - x0) * 0.06 || 1), x1: x1 + ((x1 - x0) * 0.06 || 1),
                   y0: Math.max(0, y0 - ((y1 - y0) * 0.06 || 1)), y1: y1 + ((y1 - y0) * 0.06 || 1) };
    // Values-mode extent: union of the bounding boxes of every source's 70% contour
    // (computed on the wide extent), padded by 15% on each side. The long IBTrACS tail
    // towards low pressure and high wind falls outside it.
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    const wdx = (wide.x1 - wide.x0) / N2, wdy = (wide.y1 - wide.y0) / N2;
    for (const s of use) {
      const c = kde2dContours(pts[s].px, pts[s].py, wide);
      if (!c || !c[0.7]) continue;
      for (const poly of c[0.7].coordinates) for (const [gx, gy] of poly[0]) {
        const vx = wide.x0 + gx * wdx, vy = wide.y0 + gy * wdy;
        if (vx < bx0) bx0 = vx;
        if (vx > bx1) bx1 = vx;
        if (vy < by0) by0 = vy;
        if (vy > by1) by1 = vy;
      }
    }
    const valExt = isFinite(bx0) && bx1 > bx0 && by1 > by0
      ? { x0: bx0 - 0.15 * (bx1 - bx0), x1: bx1 + 0.15 * (bx1 - bx0),
          y0: Math.max(0, by0 - 0.15 * (by1 - by0)), y1: by1 + 0.15 * (by1 - by0) }
      : wide;

    const modes = { values: { ext: valExt, per: {} }, ranks: { ext: RANK_EXT, per: {} } };
    for (const s of use) {
      const { px, py } = pts[s];
      const zx = normalScores(px), zy = normalScores(py);
      for (const [mode, X, Y] of [['values', px, py], ['ranks', zx, zy]]) {
        const ext = modes[mode].ext;
        modes[mode].per[s] = {
          contours: kde2dContours(X, Y, ext),
          mx: kde1d(X, ext.x0, ext.x1),
          my: kde1d(Y, ext.y0, ext.y1),
        };
      }
    }
    for (const mode of Object.values(modes)) {
      mode.maxX = d3.max(use, s => d3.max(mode.per[s].mx)) || 1;
      mode.maxY = d3.max(use, s => d3.max(mode.per[s].my)) || 1;
    }
    const prep = { srcs: use, modes };
    prepCache.set(data, prep);
    return prep;
  }

  function renderPressureWind(container, data) {
    injectStyle();
    if (container.__biCleanup) container.__biCleanup();
    container.replaceChildren();
    const prep = preparePW(data);
    const srcs = prep.srcs;
    const state = { mode: 'values', visible: new Set(srcs), hl: null };
    const meta = s => data.sources[s] || {};
    const rho = s => (data.spearman || {})[s];

    // values / ranks toggle
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Values or ranks' });
    const segBtns = [['values', 'Values'], ['ranks', 'Ranks only']].map(([mode, text]) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(mode === state.mode) }, text);
      b.addEventListener('click', () => {
        if (state.mode === mode) return;
        state.mode = mode;
        segBtns.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
        draw(true);
      });
      seg.append(b);
      return b;
    });

    // legend: source buttons
    const row = el('div', { class: 'bi-row', role: 'group', 'aria-label': 'Sources shown' });
    const legBtns = {};
    srcs.forEach(s => {
      const b = el('button', { type: 'button', class: 'bi-leg', 'aria-pressed': 'true' });
      b.append(lineKey(colorOf(s), false), document.createTextNode(labelOf(s)));
      b.addEventListener('click', () => {
        if (state.visible.has(s)) state.visible.delete(s); else state.visible.add(s);
        b.setAttribute('aria-pressed', String(state.visible.has(s)));
        if (!state.visible.has(s) && state.hl === s) state.hl = null;
        applyStyles();
      });
      const on = () => { if (state.visible.has(s)) { state.hl = s; applyStyles(); } };
      const off = () => { state.hl = null; applyStyles(); };
      b.addEventListener('pointerenter', on); b.addEventListener('focus', on);
      b.addEventListener('pointerleave', off); b.addEventListener('blur', off);
      legBtns[s] = b;
      row.append(b);
    });
    const ckey = el('div', { class: 'bi-ckey' });
    const k1 = el('span'); k1.append(contourKey(false), document.createTextNode('solid: 30% of points'));
    const k2 = el('span'); k2.append(contourKey(true), document.createTextNode('dashed: 70% of points'));
    ckey.append(k1, k2);

    const holder = el('div');
    // rank-correlation readout
    const rhoRow = el('div', { class: 'rho bi-rho' });
    rhoRow.append(el('span', { class: 'lead-in' }, 'Rank correlation between wind and pressure:'));
    PW_ORDER.concat(srcs.filter(s => !PW_ORDER.includes(s))).forEach(s => {
      const r = rho(s);
      if (!r || r.rho == null) return;
      const sp = el('span');
      const ci = r.lo95 != null && r.hi95 != null ? ` [${fmt2(r.lo95)}, ${fmt2(r.hi95)}]` : '';
      sp.append(lineKey(colorOf(s), false, 12), document.createTextNode(`${labelOf(s)} ${fmt2(r.rho)}${ci}`));
      rhoRow.append(sp);
    });
    const note = el('p', { class: 'note bi-note' },
      'IBTrACS winds are 1-minute sustained winds; the other sources are instantaneous gridded winds.');
    container.append(seg, row, ckey, holder, rhoRow, note);
    const tip = makeTip(container);

    let svg = null, geom = null;

    function applyStyles() {
      if (!svg) return;
      svg.selectAll('.bi-src').each(function () {
        const s = this.getAttribute('data-src');
        this.style.display = state.visible.has(s) ? null : 'none';
        this.style.opacity = state.hl == null || state.hl === s ? 1 : 0.12;
      });
    }

    function contourTip(evt, s) {
      const r = rho(s), md = meta(s), rows = [];
      if (md.n_rows != null) rows.push({ value: d3.format(',')(md.n_rows), label: 'storm times' });
      if (md.n_storms != null) rows.push({ value: String(md.n_storms), label: 'storms' });
      if (r && r.rho != null) rows.push({ value: fmt2(r.rho), label: 'rank correlation' });
      tip.show(labelOf(s), rows, evt.clientX, evt.clientY);
    }

    // one layer per mode: axes, marginals and contours; mode changes cross-fade two layers
    function buildLayer(mode) {
      const { W, m, iw, ih, strip, gap } = geom;
      const M = prep.modes[mode], ext = M.ext;
      const x = d3.scaleLinear([ext.x0, ext.x1], [0, iw]);
      const y = d3.scaleLinear([ext.y0, ext.y1], [ih, 0]);
      const layer = svg.append('g').attr('class', 'bi-layer');
      const main = layer.append('g').attr('transform', `translate(${m.left},${m.top + strip + gap})`);

      const tickFmt = d3.format('d');
      const xt = mode === 'ranks' ? d3.range(-3, 4) : x.ticks(Math.max(3, Math.floor(iw / 60)));
      const yt = mode === 'ranks' ? d3.range(-3, 4) : y.ticks(Math.max(3, Math.floor(ih / 50)));
      const grid = main.append('g').style('stroke', 'var(--border)').attr('stroke-width', 1)
        .attr('shape-rendering', 'crispEdges');
      grid.selectAll('line.h').data(yt).join('line').attr('class', 'h')
        .attr('x1', 0).attr('x2', iw).attr('y1', v => y(v)).attr('y2', v => y(v));
      grid.selectAll('line.v').data(xt).join('line').attr('class', 'v')
        .attr('y1', 0).attr('y2', ih).attr('x1', v => x(v)).attr('x2', v => x(v));
      const tickStyle = s => s.style('fill', 'var(--text-3)').style('font-size', '11px')
        .style('font-variant-numeric', 'tabular-nums');
      main.append('g').selectAll('text').data(xt).join('text')
        .attr('x', v => x(v)).attr('y', ih + 17).attr('text-anchor', 'middle').call(tickStyle).text(v => tickFmt(v));
      main.append('g').selectAll('text').data(yt).join('text')
        .attr('x', -8).attr('y', v => y(v)).attr('dy', '0.32em').attr('text-anchor', 'end').call(tickStyle)
        .text(v => tickFmt(v));
      main.append('text').attr('x', iw / 2).attr('y', ih + 35).attr('text-anchor', 'middle')
        .style('fill', 'var(--text-2)').style('font-size', '12px').text(AXES[mode].x);
      main.append('text').attr('transform', `translate(${-m.left + 12},${ih / 2}) rotate(-90)`)
        .attr('text-anchor', 'middle').style('fill', 'var(--text-2)').style('font-size', '12px').text(AXES[mode].y);

      // marginal strips: pressure above, wind to the right
      const top = layer.append('g').attr('transform', `translate(${m.left},${m.top})`);
      const right = layer.append('g').attr('transform', `translate(${m.left + iw + gap},${m.top + strip + gap})`);
      top.append('line').attr('x1', 0).attr('x2', iw).attr('y1', strip).attr('y2', strip)
        .style('stroke', 'var(--border)').attr('shape-rendering', 'crispEdges');
      right.append('line').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', ih)
        .style('stroke', 'var(--border)').attr('shape-rendering', 'crispEdges');
      const hM = d3.scaleLinear([0, M.maxX], [strip, 2]);
      const wM = d3.scaleLinear([0, M.maxY], [0, strip - 2]);
      const du = (ext.x1 - ext.x0) / N1, dv = (ext.y1 - ext.y0) / N1;
      const idx = d3.range(N1);

      // contours in grid units -> pixels
      const dx = (ext.x1 - ext.x0) / N2, dy = (ext.y1 - ext.y0) / N2;
      const path = d3.geoPath(d3.geoTransform({
        point(gx, gy) { this.stream.point(x(ext.x0 + gx * dx), y(ext.y0 + gy * dy)); },
      }));
      const cg = main.append('g');

      PW_DRAW.filter(s => srcs.includes(s)).concat(srcs.filter(s => !PW_DRAW.includes(s))).forEach(s => {
        const P = M.per[s], col = colorOf(s);
        top.append('path').attr('class', 'bi-src').attr('data-src', s)
          .attr('d', d3.line().x(i => x(ext.x0 + (i + 0.5) * du)).y(i => hM(P.mx[i]))(idx))
          .attr('fill', 'none').attr('stroke', col).attr('stroke-width', 1.5).attr('stroke-linejoin', 'round');
        right.append('path').attr('class', 'bi-src').attr('data-src', s)
          .attr('d', d3.line().x(i => wM(P.my[i])).y(i => y(ext.y0 + (i + 0.5) * dv))(idx))
          .attr('fill', 'none').attr('stroke', col).attr('stroke-width', 1.5).attr('stroke-linejoin', 'round');
        if (!P.contours) return;
        const sg = cg.append('g').attr('class', 'bi-src').attr('data-src', s);
        for (const p of LEVELS) {
          const d = P.contours[p] && path(P.contours[p]);
          if (!d) continue;
          sg.append('path').attr('d', d).attr('fill', 'none').attr('stroke', col)
            .attr('stroke-width', p === 0.3 ? 2 : 1.5).attr('stroke-linejoin', 'round')
            .attr('stroke-dasharray', p === 0.3 ? null : '5 3.5');
          sg.append('path').attr('d', d).attr('fill', 'none').attr('stroke', 'transparent')
            .attr('stroke-width', 12).attr('pointer-events', 'stroke').style('cursor', 'default')
            .on('pointerenter', evt => { state.hl = s; applyStyles(); contourTip(evt, s); })
            .on('pointermove', evt => contourTip(evt, s))
            .on('pointerleave', () => { state.hl = null; applyStyles(); tip.hide(); });
        }
      });
      return layer;
    }

    // draw(false): build the SVG (first render and resize). draw(true): mode change, which
    // keeps the SVG and its size and only cross-fades the layers, so the page does not move.
    function draw(animate) {
      tip.hide();
      const scrollY = window.scrollY;
      const label = `Contours of minimum pressure against maximum wind for each source, ${state.mode === 'ranks' ? 'as normal scores of the ranks' : 'in hPa and m/s'}.`;
      if (!animate || !svg) {
        const W = widthOf(container);
        const narrow = W < 520;
        const strip = narrow ? 34 : 46, gap = 6;
        const m = { left: 46, right: 4, top: 4, bottom: 42 };
        // joint plot close to square, left-aligned; the marginal strips follow it
        const iw = Math.max(160, Math.min(W - m.left - m.right - strip - gap, 560));
        const ih = Math.min(iw, 520);
        const SW = m.left + iw + gap + strip + m.right;
        const H = m.top + strip + gap + ih + m.bottom;
        geom = { W: SW, m, iw, ih, strip, gap };
        holder.replaceChildren();
        const svgN = svgEl('svg', { class: 'bi-svg', width: SW, height: H, viewBox: `0 0 ${SW} ${H}`, role: 'img' });
        holder.append(svgN);
        svg = d3.select(svgN).attr('aria-label', label);
        buildLayer(state.mode);
        applyStyles();
      } else {
        svg.attr('aria-label', label);
        const old = svg.selectAll('g.bi-layer').style('pointer-events', 'none').interrupt();
        const layer = buildLayer(state.mode);
        applyStyles();
        if (reducedMotion()) {
          old.remove();
        } else {
          old.transition().duration(500).ease(d3.easeCubicInOut).style('opacity', 0).remove();
          layer.style('opacity', 0).transition().duration(500).ease(d3.easeCubicInOut).style('opacity', 1);
        }
      }
      if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'instant' });
    }

    draw(false);
    watchResize(container, () => draw(false));
  }

  function contourKey(dashed) {
    const s = svgEl('svg', { width: 22, height: 8, class: 'bi-key', 'aria-hidden': 'true', focusable: 'false' });
    const l = svgEl('line', { x1: 1, x2: 21, y1: 4, y2: 4, 'stroke-width': dashed ? 1.5 : 2 });
    l.style.stroke = 'var(--text-2)';
    if (dashed) l.setAttribute('stroke-dasharray', '5 3.5');
    else l.setAttribute('stroke-linecap', 'round');
    s.append(l);
    return s;
  }

  window.BlogIntensity = { renderBias, renderPressureWind };
})();
