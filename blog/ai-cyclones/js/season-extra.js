/* season-extra.js: two charts for section 3 of the blog post ("The 2025 season").
 *
 *   window.BlogSeason.renderLeadtime(container, data)
 *     data = { lead_day: [1, 2, ...], n: [...],
 *              counts: { fgn: [...], gencast_op: [...], ifsens_e2s: [...] } }
 *     100% stacked columns: per forecast day, the share of scored (storm, time)
 *     pairs on which each model has the lowest track NLL. Share = count / n.
 *
 *   window.BlogSeason.renderDuel(container, storms)
 *     storms = the array of data/storms.json. Per storm, NLL(model 2) - NLL(model 1)
 *     for two models chosen in two selects. Clicking a storm with tracks === true
 *     dispatches window 'open-storm' with detail {hid}.
 *
 * Requires d3 v7 as a global. Each call builds its controls, legend, SVG, tooltip and a
 * visually hidden data table inside `container`, and re-renders when the container width
 * changes. Data-derived text is inserted with textContent only.
 */
(function () {
  'use strict';

  const ORDER = ['fgn', 'gencast_op', 'ifsens_e2s'];
  const LABEL = { fgn: 'FGN', gencast_op: 'GenCast', ifsens_e2s: 'IFS-ENS' };
  const COLOR = { fgn: '#E24B4A', gencast_op: '#1D9E75', ifsens_e2s: '#378ADD' };
  const INK = '#1a1a1a';
  const BASIN = {
    NA: 'North Atlantic', EP: 'Eastern Pacific', WP: 'Western Pacific',
    NI: 'North Indian', SI: 'South Indian', SP: 'South Pacific', SA: 'South Atlantic',
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MINUS = '−';
  const N_FADE = 15;              // days with fewer scored times than this are drawn faded
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ------------------------------------------------------------------ styles
  const CSS = `
.bs-root { font-family: var(--sans, 'Inter', system-ui, sans-serif); color: var(--text, #1a1a1a); position: relative; }
.bs-legend { display: flex; flex-wrap: wrap; gap: 0.35rem 1.2rem; font-size: 0.76rem; color: var(--text-2, #555); margin-bottom: 0.5rem; }
.bs-legend .bs-k { display: inline-flex; align-items: center; gap: 0.45rem; white-space: nowrap; }
.bs-sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; flex: none; }
.bs-dt { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; }
.bs-plot { width: 100%; position: relative; }
.bs-svg { display: block; overflow: visible; }
.bs-svg text { font-family: var(--sans, 'Inter', system-ui, sans-serif); }
.bs-tick { font-size: 11px; fill: var(--text-3, #8a8a8a); font-variant-numeric: tabular-nums; }
.bs-title { font-size: 12px; fill: var(--text-2, #555); }
.bs-name { font-size: 11px; fill: var(--text-2, #555); }
.bs-name.bs-link { fill: var(--text, #1a1a1a); text-decoration: underline; text-decoration-color: var(--text-4, #bbb); }
.bs-grid { stroke: var(--border, #ece9e4); stroke-width: 1; shape-rendering: crispEdges; }
.bs-zero { stroke: var(--text-3, #8a8a8a); stroke-width: 1; shape-rendering: crispEdges; }
.bs-seglab { font-size: 10.5px; font-weight: 600; pointer-events: none; font-variant-numeric: tabular-nums; }
.bs-val { font-size: 11px; fill: var(--text-2, #555); font-variant-numeric: tabular-nums; }
.bs-hl { fill: var(--border, #ece9e4); opacity: 0; }
.bs-hl.on { opacity: 0.7; }
.bs-hit { fill: transparent; outline: none; }
.bs-hit.bs-click { cursor: pointer; }
.bs-focus { fill: transparent; outline: none; pointer-events: none; }
.bs-hl.focus { opacity: 0.7; stroke: var(--text-3, #8a8a8a); stroke-width: 1; }
.bs-note { font-size: 0.8rem; color: var(--text-3, #8a8a8a); line-height: 1.6; margin-top: 0.6rem; }
.bs-head { font-family: var(--grotesk, 'Space Grotesk', system-ui, sans-serif); font-weight: 700; font-size: 1.1rem; line-height: 1.35; margin: 0.2rem 0 0.6rem; }
.bs-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.7rem; font-size: 0.8rem; color: var(--text-2, #555); }
.bs-controls select {
  font-family: inherit; font-size: 0.78rem; color: var(--text, #1a1a1a); background: var(--surface, #fff);
  border: 1px solid var(--border, #ece9e4); border-radius: 100px; padding: 0.3rem 0.8rem; cursor: pointer;
}
.bs-controls select:hover { border-color: var(--text-3, #8a8a8a); }
.bs-tip {
  position: fixed; pointer-events: none; z-index: 30; background: var(--surface, #fff);
  border: 1px solid var(--border, #ece9e4); border-radius: 6px; padding: 0.5rem 0.7rem;
  font-size: 0.76rem; line-height: 1.5; box-shadow: 0 4px 14px rgba(0,0,0,0.08);
  display: none; min-width: 170px; max-width: 280px; color: var(--text, #1a1a1a);
}
.bs-tip .bs-tt { font-weight: 600; }
.bs-tip .bs-ts { color: var(--text-3, #8a8a8a); margin-bottom: 0.25rem; }
.bs-tip .bs-r { display: flex; align-items: center; gap: 0.5rem; white-space: nowrap; }
.bs-tip .bs-r b { font-weight: 600; font-variant-numeric: tabular-nums; min-width: 3.4em; }
.bs-tip .bs-r .bs-c { color: var(--text-3, #8a8a8a); font-variant-numeric: tabular-nums; min-width: 2.6em; }
.bs-tip .bs-r .bs-l { color: var(--text-2, #555); }
.bs-tip .bs-f { color: var(--text-3, #8a8a8a); margin-top: 0.25rem; white-space: normal; }
.bs-key { display: inline-block; width: 14px; height: 2px; flex: none; }
.bs-sr { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
`;
  function injectStyle() {
    if (document.getElementById('blog-season-style')) return;
    const s = document.createElement('style');
    s.id = 'blog-season-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ----------------------------------------------------------------- helpers
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sv(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        // CSS custom properties are not reliable in SVG presentation attributes; use style.
        if ((k === 'fill' || k === 'stroke') && typeof v === 'string' && v.startsWith('var(')) e.style[k] = v;
        else e.setAttribute(k, v);
      }
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  function svText(parent, attrs, text) {
    const t = sv('text', attrs, parent);
    t.textContent = text;
    return t;
  }

  let measureCtx = null;
  function textWidth(text, font) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  }
  function fontOf(container, size, weight) {
    const fam = getComputedStyle(container).fontFamily || 'system-ui, sans-serif';
    return `${weight || 400} ${size}px ${fam}`;
  }

  // WCAG contrast: choose white or ink for text set inside a coloured fill.
  function luminance(hex) {
    const c = d3.rgb(hex);
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function inkOn(hex) {
    const L = luminance(hex);
    const white = 1.05 / (L + 0.05), ink = (L + 0.05) / (luminance(INK) + 0.05);
    return white >= ink ? '#ffffff' : INK;
  }

  const pct = v => `${Math.round(v * 100)}%`;
  const signed = (v, digits) => (v > 0 ? '+' : v < 0 ? MINUS : '') + Math.abs(v).toFixed(digits);
  function fmtDate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return String(iso);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  function ranges(nums) {
    const out = [];
    let a = null, b = null;
    for (const v of nums) {
      if (a == null) { a = b = v; continue; }
      if (v === b + 1) { b = v; continue; }
      out.push(a === b ? `${a}` : `${a}–${b}`); a = b = v;
    }
    if (a != null) out.push(a === b ? `${a}` : `${a}–${b}`);
    return out.join(', ');
  }

  // Rounded top corners (data end), square at the bottom.
  function topRoundedPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // One tooltip per chart, positioned in viewport coordinates.
  function makeTooltip(root) {
    const tip = el('div', 'bs-tip');
    tip.setAttribute('role', 'presentation');
    root.appendChild(tip);
    function place(x, y) {
      tip.style.display = 'block';
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let left = x + 14, top = y + 14;
      if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 14);
      if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - 14);
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }
    return {
      // spec: { title, sub, rows: [{color, value, count, label}], foot }
      show(spec, x, y) {
        tip.replaceChildren();
        tip.appendChild(el('div', 'bs-tt', spec.title));
        if (spec.sub) tip.appendChild(el('div', 'bs-ts', spec.sub));
        for (const r of spec.rows) {
          const row = el('div', 'bs-r');
          const key = el('span', 'bs-key');
          key.style.background = r.color || 'transparent';
          row.append(key, el('b', null, r.value));
          if (r.count != null) row.appendChild(el('span', 'bs-c', r.count));
          row.appendChild(el('span', 'bs-l', r.label));
          tip.appendChild(row);
        }
        if (spec.foot) tip.appendChild(el('div', 'bs-f', spec.foot));
        place(x, y);
      },
      hide() { tip.style.display = 'none'; },
    };
  }

  // Re-render when the plot's width changes. Returns a disconnect function.
  function watchWidth(node, render) {
    let last = -1, frame = 0;
    const run = () => {
      frame = 0;
      const w = Math.floor(node.clientWidth);
      if (w > 0 && w !== last) { last = w; render(w); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(run); };
    let ro = null;
    if ('ResizeObserver' in window) { ro = new ResizeObserver(schedule); ro.observe(node); }
    else window.addEventListener('resize', schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { last = -1; schedule(); });
    run();
    return {
      force() { last = -1; schedule(); },
      disconnect() { if (ro) ro.disconnect(); else window.removeEventListener('resize', schedule); },
    };
  }

  function resetContainer(container) {
    if (container.__bsWatch) container.__bsWatch.disconnect();
    container.replaceChildren();
    const root = el('div', 'bs-root');
    container.appendChild(root);
    return root;
  }

  // Roving tabindex over a list of focusable SVG nodes.
  function roving(nodes, keysPrev, keysNext, onActivate) {
    nodes.forEach((n, i) => {
      n.setAttribute('tabindex', i === 0 ? '0' : '-1');
      n.addEventListener('keydown', e => {
        let j = null;
        if (keysPrev.includes(e.key)) j = Math.max(0, i - 1);
        else if (keysNext.includes(e.key)) j = Math.min(nodes.length - 1, i + 1);
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = nodes.length - 1;
        else if ((e.key === 'Enter' || e.key === ' ') && onActivate) { e.preventDefault(); onActivate(i); return; }
        if (j == null) return;
        e.preventDefault();
        nodes.forEach((m, k) => m.setAttribute('tabindex', k === j ? '0' : '-1'));
        nodes[j].focus();
      });
    });
  }

  // ======================================================= 1. lead-time chart
  function renderLeadtime(container, data) {
    injectStyle();
    const root = resetContainer(container);

    const days = (data.lead_day || []).slice();
    const rows = days.map((day, i) => {
      const n = +data.n[i] || 0;
      const counts = {}, share = {};
      for (const m of ORDER) {
        const c = data.counts && data.counts[m] ? +data.counts[m][i] || 0 : 0;
        counts[m] = c;
        share[m] = n > 0 ? c / n : 0;
      }
      return { day, n, counts, share, faded: n < N_FADE };
    });

    // Legend (rect swatches mirror the bar marks).
    const legend = el('div', 'bs-legend');
    for (const m of ORDER) {
      const k = el('span', 'bs-k');
      const sw = el('span', 'bs-sw');
      sw.style.background = COLOR[m];
      k.append(sw, document.createTextNode(LABEL[m]));
      legend.appendChild(k);
    }
    root.appendChild(legend);

    const plot = el('div', 'bs-plot');
    root.appendChild(plot);

    const faded = rows.filter(r => r.faded).map(r => r.day);
    if (faded.length) {
      root.appendChild(el('p', 'bs-note',
        `Faded columns (day${faded.length > 1 ? 's' : ''} ${ranges(faded)}) rest on fewer than ${N_FADE} scored times each.`));
    }

    // Visually hidden table with the same numbers.
    const table = el('table', 'bs-sr');
    table.appendChild(el('caption', null, 'Share of scored times on which each model has the lowest track NLL, by forecast day'));
    const thead = el('thead'), hr = el('tr');
    for (const h of ['Forecast day', 'Scored times', ...ORDER.map(m => `${LABEL[m]} share (count)`)]) {
      const th = el('th', null, h); th.setAttribute('scope', 'col'); hr.appendChild(th);
    }
    thead.appendChild(hr); table.appendChild(thead);
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      const th = el('th', null, String(r.day)); th.setAttribute('scope', 'row'); tr.appendChild(th);
      tr.appendChild(el('td', null, String(r.n)));
      for (const m of ORDER) tr.appendChild(el('td', null, `${pct(r.share[m])} (${r.counts[m]})`));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    root.appendChild(table);

    const tip = makeTooltip(root);

    function tipSpec(r) {
      return {
        title: `Day ${r.day}`,
        sub: `${r.n} scored time${r.n === 1 ? '' : 's'}${r.faded ? ` (fewer than ${N_FADE})` : ''}`,
        rows: ORDER.map(m => ({ color: COLOR[m], value: pct(r.share[m]), count: String(r.counts[m]), label: LABEL[m] })),
      };
    }

    function render(width) {
      plot.replaceChildren();
      tip.hide();
      const M = { top: 26, right: 4, bottom: 42, left: 38 };
      const iw = Math.max(120, width - M.left - M.right);
      const ih = Math.round(Math.max(200, Math.min(300, width * 0.38)));
      const H = ih + M.top + M.bottom;

      const svg = sv('svg', {
        class: 'bs-svg', width, height: H, viewBox: `0 0 ${width} ${H}`,
        role: 'group', 'aria-label': 'Share of scored times with the lowest track NLL, by forecast day. Use the arrow keys to move between days.',
      }, plot);
      svText(svg, { class: 'bs-title', x: 0, y: 12 }, 'Share of scored times with the lowest NLL');
      const g = sv('g', { transform: `translate(${M.left},${M.top})` }, svg);

      const x = d3.scaleBand().domain(rows.map(r => r.day)).range([0, iw]).paddingInner(0).paddingOuter(0);
      const y = d3.scaleLinear().domain([0, 1]).range([ih, 0]);
      const slot = x.bandwidth();
      // Bars are capped at 36 px (wider than a plain bar) so that in-segment % labels can fit.
      const bw = Math.max(4, Math.min(36, slot * 0.68));

      // Gridlines and y ticks.
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        sv('line', { class: 'bs-grid', x1: 0, x2: iw, y1: Math.round(y(t)) + 0.5, y2: Math.round(y(t)) + 0.5 }, g);
        svText(g, { class: 'bs-tick', x: -8, y: y(t), dy: '0.32em', 'text-anchor': 'end' }, pct(t));
      }

      // x ticks: thin out when the slots are narrow.
      const tickEvery = slot >= 18 ? 1 : slot >= 9 ? 2 : 5;
      rows.forEach((r, i) => {
        if (i % tickEvery !== 0 && i !== rows.length - 1) return;
        svText(g, { class: 'bs-tick', x: x(r.day) + slot / 2, y: ih + 16, 'text-anchor': 'middle' }, String(r.day));
      });
      svText(g, { class: 'bs-title', x: iw / 2, y: ih + 36, 'text-anchor': 'middle' }, 'Forecast day');

      const labFont = fontOf(root, 10.5, 600);
      const hits = [];
      rows.forEach(r => {
        const x0 = x(r.day);
        const col = sv('g', {}, g);
        const hl = sv('rect', { class: 'bs-hl', x: x0 + 1, y: -4, width: Math.max(0, slot - 2), height: ih + 4, rx: 3 }, col);
        const bar = sv('g', { opacity: r.faded ? 0.35 : 1 }, col);
        const bx = x0 + (slot - bw) / 2;

        const segs = ORDER.filter(m => r.share[m] > 0);
        let cum = 0;
        segs.forEach((m, k) => {
          const s = r.share[m];
          const yBot = y(cum), yTop = y(cum + s);
          cum += s;
          const top = yTop + (k < segs.length - 1 ? 1 : 0);   // 2 px gap between segments
          const bot = yBot - (k > 0 ? 1 : 0);
          const h = bot - top;
          if (h < 0.5) return;
          if (k === segs.length - 1) {
            sv('path', { d: topRoundedPath(bx, top, bw, h, 4), fill: COLOR[m] }, bar);
          } else {
            sv('rect', { x: bx, y: top, width: bw, height: h, fill: COLOR[m] }, bar);
          }
          const lab = pct(s);
          if (textWidth(lab, labFont) + 8 <= bw && h >= 16) {
            svText(bar, {
              class: 'bs-seglab', x: bx + bw / 2, y: top + h / 2, dy: '0.35em', 'text-anchor': 'middle', fill: inkOn(COLOR[m]),
            }, lab);
          }
        });

        const hit = sv('rect', {
          class: 'bs-hit', x: x0, y: -4, width: slot, height: ih + 4,
          role: 'img',
          'aria-label': `Day ${r.day}, ${r.n} scored times: ` + ORDER.map(m => `${LABEL[m]} ${pct(r.share[m])} (${r.counts[m]})`).join(', '),
        }, col);
        hit.addEventListener('pointerenter', () => hl.classList.add('on'));
        hit.addEventListener('pointermove', e => tip.show(tipSpec(r), e.clientX, e.clientY));
        hit.addEventListener('pointerleave', () => { hl.classList.remove('on'); tip.hide(); });
        hit.addEventListener('focus', () => {
          hl.classList.add('focus');
          const b = hit.getBoundingClientRect();
          tip.show(tipSpec(r), b.left + b.width / 2, b.top + 20);
        });
        hit.addEventListener('blur', () => { hl.classList.remove('focus'); tip.hide(); });
        hits.push(hit);
      });
      roving(hits, ['ArrowLeft', 'ArrowUp'], ['ArrowRight', 'ArrowDown']);
    }

    container.__bsWatch = watchWidth(plot, render);
  }

  // ============================================================ 2. duel chart
  // Form: a horizontal lollipop chart, one row per storm, sorted by the difference.
  // With 41 storms a column layout leaves about 7 px per storm at 340 px width, too narrow
  // for storm names or a 24 px hit target. One 24 px row per storm keeps every name legible
  // and gives each storm a full-width hit target at any screen width.
  function renderDuel(container, storms) {
    injectStyle();
    const root = resetContainer(container);
    const list = (storms || []).filter(s => s && s.nll);
    const state = { m1: 'fgn', m2: 'ifsens_e2s' };

    // Controls.
    const controls = el('div', 'bs-controls');
    const sel1 = el('select'), sel2 = el('select');
    sel1.setAttribute('aria-label', 'First model');
    sel2.setAttribute('aria-label', 'Second model');
    for (const sel of [sel1, sel2]) {
      for (const m of ORDER) { const o = el('option', null, LABEL[m]); o.value = m; sel.appendChild(o); }
    }
    controls.append(sel1, el('span', null, 'vs'), sel2);
    root.appendChild(controls);

    const head = el('p', 'bs-head');
    head.setAttribute('aria-live', 'polite');
    root.appendChild(head);

    const legend = el('div', 'bs-legend');
    root.appendChild(legend);

    const plot = el('div', 'bs-plot');
    root.appendChild(plot);

    const note = el('p', 'bs-note');
    root.appendChild(note);

    const tableWrap = el('div');
    root.appendChild(tableWrap);

    const tip = makeTooltip(root);

    function computed() {
      const { m1, m2 } = state;
      const rows = list.map(s => {
        const a = +s.nll[m1], b = +s.nll[m2];
        const d = Math.round((b - a) * 1000) / 1000;
        return { s, a, b, d, better: d > 0 ? m1 : d < 0 ? m2 : null };
      }).filter(r => Number.isFinite(r.d));
      rows.sort((p, q) => q.d - p.d || String(p.s.name).localeCompare(String(q.s.name)));
      return rows;
    }

    function updateText(rows) {
      const { m1, m2 } = state;
      const w1 = rows.filter(r => r.d > 0).length, w2 = rows.filter(r => r.d < 0).length;
      const ties = rows.length - w1 - w2;
      const tieText = ties ? `; ${ties} tie${ties > 1 ? 's' : ''}` : '';
      if (w1 === w2) head.textContent = `${LABEL[m1]} and ${LABEL[m2]} each have the lower NLL on ${w1} of ${rows.length} storms${tieText}.`;
      else {
        const [lead, k] = w1 > w2 ? [m1, w1] : [m2, w2];
        head.textContent = `${LABEL[lead]} has the lower NLL on ${k} of ${rows.length} storms${tieText}.`;
      }

      legend.replaceChildren();
      for (const m of [m1, m2]) {
        const k = el('span', 'bs-k');
        const dt = el('span', 'bs-dt');
        dt.style.background = COLOR[m];
        k.append(dt, document.createTextNode(`${LABEL[m]} has the lower NLL`));
        legend.appendChild(k);
      }

      // Hidden table.
      const table = el('table', 'bs-sr');
      table.appendChild(el('caption', null, `Mean track NLL per storm, ${LABEL[m1]} and ${LABEL[m2]}, sorted by the difference`));
      const thead = el('thead'), hr = el('tr');
      for (const h of ['Storm', 'Start', 'Basin', `${LABEL[m1]} NLL`, `${LABEL[m2]} NLL`, `${LABEL[m2]} minus ${LABEL[m1]}`]) {
        const th = el('th', null, h); th.setAttribute('scope', 'col'); hr.appendChild(th);
      }
      thead.appendChild(hr); table.appendChild(thead);
      const tbody = el('tbody');
      for (const r of rows) {
        const tr = el('tr');
        const th = el('th', null, String(r.s.name)); th.setAttribute('scope', 'row'); tr.appendChild(th);
        for (const v of [fmtDate(r.s.start), BASIN[r.s.basin] || String(r.s.basin), r.a.toFixed(2), r.b.toFixed(2), signed(r.d, 2)]) {
          tr.appendChild(el('td', null, v));
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      tableWrap.replaceChildren(table);
    }

    function tipSpec(r) {
      const { m1, m2 } = state;
      const s = r.s;
      const verdict = r.better ? `${LABEL[r.better]} lower by ${Math.abs(r.d).toFixed(2)}` : 'Equal NLL';
      return {
        title: String(s.name),
        sub: `${BASIN[s.basin] || s.basin} · first observed ${fmtDate(s.start)}`,
        rows: [
          { color: COLOR[m1], value: r.a.toFixed(2), label: `${LABEL[m1]} NLL` },
          { color: COLOR[m2], value: r.b.toFixed(2), label: `${LABEL[m2]} NLL` },
          { color: null, value: signed(r.d, 2), label: `${LABEL[m2]} minus ${LABEL[m1]}` },
        ],
        foot: verdict + (s.tracks ? '. Click to open this storm in the player.' : '.'),
      };
    }

    function render(width) {
      plot.replaceChildren();
      tip.hide();
      const rows = computed();
      const { m1, m2 } = state;
      if (!rows.length) return;

      // Clip extreme differences so one storm does not compress the rest: a value more than
      // 2.5 times the 90th percentile of |d| is drawn cut at the axis edge, with its value printed.
      const absSorted = rows.map(r => Math.abs(r.d)).sort(d3.ascending);
      const p90 = d3.quantileSorted(absSorted, 0.9) || 0;
      const T = Math.max(1, 2.5 * p90);
      const kept = rows.filter(r => Math.abs(r.d) <= T).map(r => r.d);
      let lo = Math.min(0, d3.min(kept) ?? 0), hi = Math.max(0, d3.max(kept) ?? 0);
      const pad = Math.max(0.1, (hi - lo) * 0.06);
      lo = lo < 0 ? lo - pad : lo; hi = hi > 0 ? hi + pad : hi;
      if (hi - lo < 0.5) { hi += 0.25; lo -= 0.25; }
      [lo, hi] = d3.scaleLinear().domain([lo, hi]).nice().domain();
      const clipHi = rows.some(r => r.d > hi), clipLo = rows.some(r => r.d < lo);

      const nameFont = fontOf(root, 11, 400);
      const nameW = d3.max(rows, r => textWidth(String(r.s.name), nameFont)) || 60;
      const valW = 44;
      const M = {
        top: 32, bottom: 40,
        left: Math.ceil(nameW) + 12 + (clipLo ? valW : 0),
        right: 10 + (clipHi ? valW : 0),
      };
      // Compact rows. The pointer is handled by one overlay that selects the nearest row, so each
      // storm's hit area is its full-width row band and the pointer never has to land on a mark.
      const rowH = 14;
      const iw = Math.max(120, width - M.left - M.right);
      const ih = rows.length * rowH;
      const H = ih + M.top + M.bottom;

      const x = d3.scaleLinear().domain([lo, hi]).range([0, iw]);
      const cx = d => x(Math.max(lo, Math.min(hi, d)));

      const svg = sv('svg', {
        class: 'bs-svg', width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'group',
        'aria-label': `NLL difference per storm, ${LABEL[m2]} minus ${LABEL[m1]}. Use the arrow keys to move between storms.`,
      }, plot);
      const g = sv('g', { transform: `translate(${M.left},${M.top})` }, svg);

      // Grid and ticks (top and bottom, same scale).
      const ticks = x.ticks(Math.max(3, Math.min(10, Math.floor(iw / 70))));
      for (const t of ticks) {
        const xp = Math.round(x(t)) + 0.5;
        if (t !== 0) sv('line', { class: 'bs-grid', x1: xp, x2: xp, y1: -4, y2: ih + 4 }, g);
        const lab = t === 0 ? '0' : signed(t, Number.isInteger(t) ? 0 : 1);
        svText(g, { class: 'bs-tick', x: x(t), y: -10, 'text-anchor': 'middle' }, lab);
        svText(g, { class: 'bs-tick', x: x(t), y: ih + 16, 'text-anchor': 'middle' }, lab);
      }
      svText(g, { class: 'bs-title', x: iw / 2, y: ih + 34, 'text-anchor': 'middle' },
        `NLL of ${LABEL[m2]} minus NLL of ${LABEL[m1]}`);

      // Direction labels above the top ticks, either side of zero, when they fit.
      const x0 = x(0);
      const tFont = fontOf(root, 12, 400);
      const rightLab = `${LABEL[m1]} lower →`, leftLab = `← ${LABEL[m2]} lower`;
      if (x0 + 6 + textWidth(rightLab, tFont) <= iw + M.right) {
        svText(g, { class: 'bs-title', x: x0 + 6, y: -22 }, rightLab);
      }
      if (x0 - 6 - textWidth(leftLab, tFont) >= -M.left) {
        svText(g, { class: 'bs-title', x: x0 - 6, y: -22, 'text-anchor': 'end' }, leftLab);
      }

      const rowsG = sv('g', {}, g);
      sv('line', { class: 'bs-zero', x1: Math.round(x0) + 0.5, x2: Math.round(x0) + 0.5, y1: -4, y2: ih + 4 }, g);
      const marks = sv('g', {}, g);
      const hitsG = sv('g', {}, g);

      const hits = [], hls = [];
      rows.forEach((r, i) => {
        const yc = i * rowH + rowH / 2;
        const color = r.better ? COLOR[r.better] : 'var(--text-3, #8a8a8a)';
        hls.push(sv('rect', { class: 'bs-hl', x: -M.left, y: i * rowH, width: iw + M.left + M.right, height: rowH, rx: 2 }, rowsG));

        const name = svText(marks, {
          class: 'bs-name' + (r.s.tracks ? ' bs-link' : ''),
          x: -8 - (clipLo ? valW : 0), y: yc, dy: '0.35em', 'text-anchor': 'end',
        }, String(r.s.name));
        name.setAttribute('aria-hidden', 'true');

        const xe = cx(r.d);
        const cut = r.d > hi || r.d < lo;
        if (Math.abs(xe - x0) > 0.5) {
          sv('line', { x1: x0, x2: xe, y1: yc, y2: yc, stroke: color, 'stroke-width': 1.5, 'stroke-linecap': 'round' }, marks);
        }
        if (cut) {
          // Break mark: a surface-coloured slash across the stem, 14 px before the edge.
          const dir = r.d > 0 ? -1 : 1;
          const bx = xe + dir * 14;
          sv('line', { x1: bx - 2.5, x2: bx + 2.5, y1: yc + 4, y2: yc - 4, stroke: 'var(--bg, #faf9f7)', 'stroke-width': 3 }, marks);
          svText(marks, {
            class: 'bs-val', x: r.d > 0 ? iw + 8 : -8, y: yc, dy: '0.35em', 'text-anchor': r.d > 0 ? 'start' : 'end',
          }, signed(r.d, 2));
        }
        sv('circle', { cx: xe, cy: yc, r: 3.75, fill: color, stroke: 'var(--bg, #faf9f7)', 'stroke-width': 1.5 }, marks);

        // Keyboard target (no pointer events; the overlay below handles the pointer).
        const hit = sv('rect', {
          class: 'bs-focus', x: -M.left, y: i * rowH, width: iw + M.left + M.right, height: rowH,
          role: r.s.tracks ? 'button' : 'img',
          'aria-label': `${r.s.name}, ${BASIN[r.s.basin] || r.s.basin}, ${fmtDate(r.s.start)}: ${LABEL[m1]} ${r.a.toFixed(2)}, ${LABEL[m2]} ${r.b.toFixed(2)}, difference ${signed(r.d, 2)}` + (r.s.tracks ? '. Press Enter to open in the player.' : ''),
        }, hitsG);
        hit.addEventListener('focus', () => {
          hls[i].classList.add('focus');
          const b = svg.getBoundingClientRect();
          tip.show(tipSpec(r), b.left + M.left + xe, b.top + M.top + (i + 1) * rowH);
        });
        hit.addEventListener('blur', () => { hls[i].classList.remove('focus'); tip.hide(); });
        hits.push(hit);
      });
      roving(hits, ['ArrowUp', 'ArrowLeft'], ['ArrowDown', 'ArrowRight'], i => {
        if (rows[i].s.tracks) openStorm(rows[i].s.hid);
      });

      // Pointer layer over the whole chart: the nearest row is the hovered storm.
      const overlay = sv('rect', {
        class: 'bs-hit', x: -M.left, y: -6, width: iw + M.left + M.right, height: ih + 12,
      }, g);
      overlay.setAttribute('aria-hidden', 'true');
      let cur = -1;
      const rowAt = e => {
        const b = overlay.getBoundingClientRect();
        const yy = e.clientY - b.top - 6;
        return Math.max(0, Math.min(rows.length - 1, Math.floor(yy / rowH)));
      };
      const setCur = i => {
        if (cur === i) return;
        if (cur >= 0) hls[cur].classList.remove('on');
        cur = i;
        if (i >= 0) hls[i].classList.add('on');
        overlay.style.cursor = i >= 0 && rows[i].s.tracks ? 'pointer' : 'default';
      };
      const onMove = e => { const i = rowAt(e); setCur(i); tip.show(tipSpec(rows[i]), e.clientX, e.clientY); };
      overlay.addEventListener('pointermove', onMove);
      overlay.addEventListener('pointerdown', onMove);
      overlay.addEventListener('pointerleave', () => { setCur(-1); tip.hide(); });
      overlay.addEventListener('click', e => {
        const r = rows[rowAt(e)];
        if (r.s.tracks) openStorm(r.s.hid);
      });

      note.textContent = 'Differences are in NLL units (natural log). NLL has no upper bound, so a single time at which '
        + 'the storm is far from every member can dominate a storm’s mean; this is the case for GenCast on Typhoon Halong. '
        + (clipHi || clipLo ? 'Stems with a break mark are cut at the edge of the axis; their value is printed beside them. ' : '')
        + (rows.some(r => r.s.tracks) ? 'Click an underlined storm to open it in the player.' : '');
    }

    function openStorm(hid) {
      tip.hide();
      window.dispatchEvent(new CustomEvent('open-storm', { detail: { hid } }));
    }

    function sync() {
      sel1.value = state.m1;
      sel2.value = state.m2;
      updateText(computed());
    }
    sel1.addEventListener('change', () => {
      const v = sel1.value;
      if (v === state.m2) state.m2 = state.m1;
      state.m1 = v;
      sync(); watch.force();
    });
    sel2.addEventListener('change', () => {
      const v = sel2.value;
      if (v === state.m1) state.m1 = state.m2;
      state.m2 = v;
      sync(); watch.force();
    });

    sync();
    const watch = watchWidth(plot, render);
    container.__bsWatch = watch;
  }

  window.BlogSeason = { renderLeadtime, renderDuel };
})();
