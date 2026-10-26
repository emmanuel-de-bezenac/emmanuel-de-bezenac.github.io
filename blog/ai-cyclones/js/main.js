const ICON_PLAY = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M5.5 3.5 L12.5 8 L5.5 12.5 Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="miter"/></svg>', ICON_PAUSE = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="4.5" y="3.5" width="2.5" height="9" fill="none" stroke="currentColor" stroke-width="1.25"/><rect x="9" y="3.5" width="2.5" height="9" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>';
(async function () {
  'use strict';
  const MODELS = ['gencast_op', 'ifsens_e2s', 'fgn'];
  const NAME = { gencast_op: 'GenCast', ifsens_e2s: 'IFS-ENS', fgn: 'FGN' };
  const KIND = { gencast_op: 'AI, Google DeepMind', ifsens_e2s: 'physics, ECMWF', fgn: 'AI, Google DeepMind' };
  const DESC = {
    gencast_op: 'Diffusion model: generates each member by iteratively denoising. Trained on ERA5, fine-tuned on ECMWF analyses.',
    ifsens_e2s: 'Numerical model that solves the equations of the atmosphere; perturbed initial conditions and model physics give the members.',
    fgn: 'Neural network trained with a probabilistic score (CRPS); members come from learned perturbations of the network. Google WeatherNext 2.',
  };
  const COLOR = { gencast_op: '#1D9E75', ifsens_e2s: '#378ADD', fgn: '#E24B4A' };
  const OCEAN = THEME.ocean, LAND = THEME.land, COAST = THEME.coast, INK = THEME.ink;
  const N_MEMBERS = 49, HOURS_PER_SECOND = 20;
  const CURATED = ['2025294N14290', '2025308N09144', '2025305N08140', '2025276N20147'];
  // Section 2 examples: times at which the model with the closest ensemble mean has the highest NLL
  // (found by comparing per_timestep_nll.csv with the member mean positions over all 2025 storms)
  const CASES = [
    { hid: '2025054S17051', hour: 114, label: 'Members split into two groups', name: 'Cyclone Garance',
      text: 'FGN\'s members split into two groups, west and east of the storm. Their mean falls between the groups, ' +
            'close to the storm but where few members are: it is the closest of the three means, yet FGN gives the ' +
            'observed position the least probability and has the highest NLL. GenCast\'s mean is farther away, but its ' +
            'members surround the storm, and its NLL is the lowest.' },
    { hid: '2025082S13116', hour: 138, label: 'Members spread in all directions', name: 'Cyclone Courtney',
      text: 'IFS-ENS\'s members are spread in all directions around the storm, so their mean lands close to it: the ' +
            'closest of the three. The spread gives every position a low probability, so IFS-ENS has the highest NLL. ' +
            'FGN\'s members are grouped north-east of the storm; its mean is farther away, but it gives the observed ' +
            'position more probability and has the lowest NLL.' },
  ];

  const el = (tag, attrs = {}, text) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const tooltip = document.getElementById('tooltip');
  function showTip(evt, title, rows, note) {
    tooltip.replaceChildren(el('div', { class: 't' }, title));
    for (const [label, value, color] of rows) {
      const r = el('div', { class: 'r' });
      const l = el('span');
      if (color) { const s = el('span', { class: 'swatch' }); s.style.background = color; l.append(s); }
      l.append(document.createTextNode(label));
      r.append(l, el('b', {}, value));
      tooltip.append(r);
    }
    if (note) { const n = el('div', {}, note); n.style.cssText = 'margin-top:0.3rem;color:var(--text-2);max-width:240px'; tooltip.append(n); }
    tooltip.style.display = 'block';
    const x = Math.min(evt.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8);
    const y = Math.min(evt.clientY + 14, window.innerHeight - tooltip.offsetHeight - 8);
    tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
  }
  const hideTip = () => { tooltip.style.display = 'none'; };

  const [index, world, qmap] = await Promise.all([
    fetch('data/storms.json').then(r => r.json()),
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json').then(r => r.json()),
    fetch('data/wind_qmap.json').then(r => r.json()),
  ]);
  const land = topojson.feature(world, world.objects.land);
  const stormCache = new Map();
  const loadStorm = hid => {
    if (!stormCache.has(hid)) stormCache.set(hid, fetch(`data/storms/${hid}.json`).then(r => r.json()));
    return stormCache.get(hid);
  };

  // ---------------------------------------------------------------- geometry
  const wrap = (lon, center) => ((((lon - center + 180) % 360) + 360) % 360) - 180;
  function mapFrame(storm, width) {
    const [lon0, lon1, lat0, lat1] = storm.extent;
    const x0 = wrap(lon0, storm.center), x1 = wrap(lon1, storm.center);
    const height = Math.round(width * Math.min(1, (lat1 - lat0) / (x1 - x0)));
    const sx = width / (x1 - x0), sy = height / (lat1 - lat0);
    const X = lon => (wrap(lon, storm.center) - x0) * sx;
    const Y = lat => (lat1 - lat) * sy;
    const k = 180 / Math.PI;
    const projection = d3.geoEquirectangular().rotate([-storm.center, 0])
      .scale(sx * k).translate([-x0 * sx, lat1 * sy]);
    return { width, height, X, Y, projection, kmPerPx: 111.2 / sx };
  }
  function basemap(frame, dpr) {
    const c = document.createElement('canvas');
    c.width = frame.width * dpr; c.height = frame.height * dpr;
    const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.fillStyle = OCEAN; ctx.fillRect(0, 0, frame.width, frame.height);
    const path = d3.geoPath(frame.projection, ctx);
    ctx.beginPath(); path(land); ctx.fillStyle = LAND; ctx.fill();
    ctx.lineWidth = 0.6; ctx.strokeStyle = COAST; ctx.stroke();
    return c;
  }
  // position of a track at hour t, by linear interpolation; null outside its span
  function posAt(pts, t) {
    if (!pts.length || t < pts[0][0] || t > pts[pts.length - 1][0]) return null;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] >= t) {
        const [h0, x0, y0] = pts[i - 1], [h1, x1, y1] = pts[i];
        const f = h1 === h0 ? 1 : (t - h0) / (h1 - h0);
        let dx = x1 - x0; if (dx > 180) dx -= 360; if (dx < -180) dx += 360;
        const w0 = pts[i - 1][3], w1 = pts[i][3];
        const w = w0 == null || w1 == null ? (w0 ?? w1 ?? null) : w0 + f * (w1 - w0);
        return [x0 + f * dx, y0 + f * (y1 - y0), w];
      }
    }
    return [pts[0][1], pts[0][2]];
  }
  function category(kt) {
    if (kt < 34) return 'tropical depression';
    if (kt < 64) return 'tropical storm';
    return 'Category ' + (1 + [83, 96, 113, 137].filter(b => kt >= b).length);
  }
  // Wind colour, the same for the observed track (IBTrACS, kt converted to m/s) and the members (m/s):
  // one colour per Saffir-Simpson category, yellow-orange to dark red; grey where there is no wind value
  const KT = 0.5144, NO_WIND = THEME.coast;
  const CAT_COLOR = ['#f6c45a', '#f39434', '#e8641f', '#d23f1a', '#ad2318', '#821319', '#4f0a12'];
  // Saffir-Simpson scale: lower bound in kt, name, wind range, what it means
  const CATS = [
    [0, 'TD', 'Tropical depression', 'below 34 kt · below 17 m/s', 'An organised system with a closed circulation, not yet named.'],
    [34, 'TS', 'Tropical storm', '34–63 kt · 17–33 m/s', 'The storm is given a name at this stage.'],
    [64, '1', 'Category 1 hurricane or typhoon', '64–82 kt · 33–43 m/s', 'Damage to roofs, trees and power lines.'],
    [83, '2', 'Category 2', '83–95 kt · 43–49 m/s', 'Extensive damage; power cuts lasting days to weeks.'],
    [96, '3', 'Category 3 (major)', '96–112 kt · 49–58 m/s', 'Devastating damage; electricity and water cut for days to weeks.'],
    [113, '4', 'Category 4 (major)', '113–136 kt · 58–70 m/s', 'Catastrophic damage; areas uninhabitable for weeks or months.'],
    [137, '5', 'Category 5 (major)', '137 kt or more · 70 m/s or more', 'Catastrophic damage; a large share of framed homes destroyed.'],
  ];
  const catOf = ms => CATS.filter(([kt]) => ms >= kt * KT).length - 1;
  const windColor = ms => ms == null ? NO_WIND : CAT_COLOR[catOf(ms)];
  // rank correction (export_blog_data.wind_qmap): the quantile of w among the model's member winds,
  // then the IBTrACS wind at that quantile; both by linear interpolation between percentiles
  // share of the model's winds below w (0 to 1)
  function rankOf(model, w) {
    const src = qmap.models[model], n = src.length - 1;
    if (w <= src[0]) return 0;
    if (w >= src[n]) return 1;
    let i = 0;
    while (src[i + 1] < w) i++;
    const f = src[i + 1] === src[i] ? 0 : (w - src[i]) / (src[i + 1] - src[i]);
    return (i + f) / n;
  }
  // observed wind with share q of the observed winds below it
  function observedAt(q) {
    const dst = qmap.ibtracs, n = dst.length - 1, x = q * n, i = Math.min(n - 1, Math.floor(x));
    return dst[i] + (x - i) * (dst[i + 1] - dst[i]);
  }
  const rankCorrected = (model, w) => w == null ? null : observedAt(rankOf(model, w));
  function obsWindAt(obs, t) {
    const v = obs.filter(p => p[3] != null);
    if (!v.length || t < v[0][0] || t > v[v.length - 1][0]) return null;
    for (let i = 1; i < v.length; i++) if (v[i][0] >= t) {
      const f = (t - v[i - 1][0]) / ((v[i][0] - v[i - 1][0]) || 1);
      return v[i - 1][3] + f * (v[i][3] - v[i - 1][3]);
    }
    return v[0][3];
  }
  const fmtDate = d => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

  // ---------------------------------------------------------------- 1. player
  // hid -> { physics, fgn: letters guessed, done: names shown, skipped: shown without guessing }
  const guesses = {};
  const guessOf = hid => (guesses[hid] ??= {});
  // a panel is labelled once its model is known: IFS-ENS after the first guess, all three at the end
  const shown = (hid, m) => {
    const g = guesses[hid] || {};
    return player.mode === 'show' || !!g.done || (g.physics != null && m === 'ifsens_e2s');
  };
  const player = { storm: null, t: 0, playing: false, panels: [], frame: null };
  const chips = document.getElementById('storm-chips');
  const withTracks = index.filter(s => s.tracks);
  const ordered = [...CURATED.map(h => withTracks.find(s => s.hid === h)).filter(Boolean),
                   ...withTracks.filter(s => !CURATED.includes(s.hid)).sort((a, b) => a.start.localeCompare(b.start))];
  const chipFor = {};
  ordered.forEach(s => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' }, s.name);
    b.addEventListener('click', () => selectStorm(s.hid, true));
    chipFor[s.hid] = b;
  });
  // as many storm chips as fit on one line next to the "more storms" menu; the rest go in the menu
  let nChips = 0;
  function layoutChips() {
    const sel = el('select', { class: 'chip', 'aria-label': 'More storms' });
    // a menu is as wide as its widest option: measure it holding every storm, so that it cannot widen afterwards
    const head = el('option', { value: '' }, `${ordered.length} more storms…`);
    const opt = s => el('option', { value: s.hid }, s.name);
    sel.append(head, ...ordered.map(opt));
    chips.replaceChildren(sel);
    nChips = 0;
    // a box has wrapped when its top is below the middle of the first one
    const wrapped = (x, first) => x.getBoundingClientRect().top > first.top + first.height / 2;
    for (const s of ordered) {
      const b = chipFor[s.hid];
      chips.insertBefore(b, sel);
      const first = chips.firstChild.getBoundingClientRect();
      if (wrapped(b, first) || wrapped(sel, first)) { b.remove(); break; }
      nChips++;
    }
    const rest = ordered.slice(nChips);
    if (!rest.length) { sel.remove(); player.moreSelect = null; return; }
    head.textContent = `${rest.length} more storms…`;
    sel.replaceChildren(head, ...rest.map(opt));
    sel.addEventListener('change', () => { if (sel.value) selectStorm(sel.value, true); });
    if (rest.some(s => s.hid === player.hid)) sel.value = player.hid;
    player.moreSelect = sel;
  }
  layoutChips();
  if (document.fonts) document.fonts.ready.then(layoutChips);
  window.addEventListener('load', layoutChips);
  let chipTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(chipTimer); chipTimer = setTimeout(layoutChips, 150); });

  {
    // colour bar: one block per category (hover for its meaning), lower bounds in m/s below
    const bar = document.getElementById('windbar');
    const blocks = el('div', { class: 'blocks' }), ticks = el('div', { class: 'ticks' });
    const block = (label, color, name, rows, note) => {
      const b = el('span', { tabindex: '0' }, label);
      b.style.background = color;
      const tip = e => showTip(e, name, rows, note);
      b.addEventListener('pointerenter', tip); b.addEventListener('pointermove', tip);
      b.addEventListener('pointerleave', hideTip);
      blocks.append(b);
      return b;
    };
    CATS.forEach(([kt, label, name, range, note], i) => {
      const b = block(label, CAT_COLOR[i], name, [['Sustained wind', range]], note);
      if (i < 2) b.classList.add('light');
      if (i > 0) { const t = el('span', {}, String(Math.round(kt * KT))); t.style.left = `${100 * i / (CATS.length + 1)}%`; ticks.append(t); }
    });
    block('no data', NO_WIND, 'No wind reported', [], 'IBTrACS has no wind from the USA agencies at these times.').classList.add('none');
    const unit = el('span', {}, 'm/s'); unit.style.left = `${100 * CATS.length / (CATS.length + 1)}%`; ticks.append(unit);
    bar.append(blocks, ticks);
    const seg = document.getElementById('windcorr'), explain = document.getElementById('wc-explain');
    const EXPLAIN = {
      raw: 'Maximum 10 m wind within about 220 km of each member\'s storm centre, as the model gives it.',
      rank: 'Winds are mapped to observed values of the same rank, matching the overall observed distribution. Predicted positions stay unchanged. This changes the display, not the forecast.',
    };
    // both texts sit in the same grid cell and only one is visible, so the cell keeps the height of the longer one
    const texts = Object.fromEntries(Object.entries(EXPLAIN).map(([k, t]) => [k, el('span', {}, t)]));
    explain.classList.add('stack'); explain.replaceChildren(...Object.values(texts));
    const setMode = v => {
      player.corrected = v === 'rank';
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
      Object.entries(texts).forEach(([k, s]) => { s.style.visibility = k === v ? 'visible' : 'hidden'; });
    };
    setMode('raw');
    // a switch: clicking the selected side (or its half of the box) flips to the other state
    const other = v => v === 'raw' ? 'rank' : 'raw';
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      setMode(b.getAttribute('aria-pressed') === 'true' ? other(b.dataset.v) : b.dataset.v); draw();
    }));
  }
  // "Guess the models" (names hidden until the reader answers) or "Show the models" (names shown, no questions)
  // the article shows the names; guessing them is the separate game page (game.html)
  player.mode = 'show';
  const modeSeg = document.getElementById('mode');
  if (modeSeg) modeSeg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    player.mode = b.dataset.v;
    modeSeg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    const t = player.t; buildPanels(); player.t = t; draw();
  }));
  const playBtn = document.getElementById('play');
  const scrub = document.getElementById('scrub');
  playBtn.addEventListener('click', () => setPlaying(!player.playing));
  scrub.addEventListener('input', () => { setPlaying(false); player.t = +scrub.value; draw(); });

  function setPlaying(on) {
    player.playing = on;
    playBtn.innerHTML = on ? ICON_PAUSE : ICON_PLAY; playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (on) {
      if (player.t >= player.storm.end_h) player.t = player.storm.start_h;
      let last = performance.now();
      const step = now => {
        if (!player.playing) return;
        player.t = Math.min(player.storm.end_h, player.t + (now - last) / 1000 * HOURS_PER_SECOND);
        last = now; scrub.value = Math.round(player.t); draw();
        if (player.t >= player.storm.end_h) { setPlaying(false); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  async function selectStorm(hid, scroll) {
    setPlaying(false);
    for (const [h, b] of Object.entries(chipFor)) b.setAttribute('aria-pressed', String(h === hid));
    player.hid = hid;
    if (player.moreSelect) player.moreSelect.value = ordered.slice(nChips).some(s => s.hid === hid) ? hid : '';
    const storm = await loadStorm(hid);
    player.storm = storm;
    player.t = storm.start_h;
    scrub.min = Math.floor(storm.start_h); scrub.max = Math.ceil(storm.end_h); scrub.value = scrub.min;
    // tracks in degrees per model, member id kept for the detection count
    player.tracks = {};
    for (const m of MODELS) player.tracks[m] = storm.models[m].map(([mb, pts]) => ({ mb, pts }));
    buildPanels();
    if (scroll) document.getElementById('player-fig').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function buildPanels() {
    const storm = player.storm, root = document.getElementById('player');
    root.replaceChildren();
    player.panels = [];
    const revealed = !!(guesses[storm.hid] || {}).done;
    // names shown (the game is on its own page): the same model in the same place for every storm
    const order = player.mode === 'show' ? ['ifsens_e2s', 'gencast_op', 'fgn'] : storm.order;
    order.forEach((m, i) => {
      const letter = 'ABC'[i];
      const cell = el('div');
      const head = el('div', { class: 'panel-head' }, shown(storm.hid, m) ? '' : letter);
      if (shown(storm.hid, m)) {
        const who = el('span', { class: 'who' }, NAME[m]);
        who.style.color = COLOR[m];
        who.append(el('span', { class: 'kind' }, KIND[m]));
        head.append(who);
      }
      const wrapEl = el('div', { class: 'map-wrap' });
      const canvas = el('canvas');
      const info = el('div', { class: 'infobox' });
      wrapEl.append(canvas);
      const hist = el('canvas', { class: 'hist' }), histNote = el('div', { class: 'histnote' });
      cell.append(head, info, wrapEl, hist, histNote);
      root.append(cell);
      player.panels.push({ model: m, canvas, info, wrapEl, hist, histNote });
    });
    const head = document.getElementById('stormhead');
    head.replaceChildren(el('div', { class: 'name' }, storm.title || `${storm.name}, ${storm.init.slice(0, 4)}`),
      el('div', { class: 'init' }, `All forecasts started ${fmtDate(new Date(storm.init.replace('Z', ':00Z')))}`));
    const clock = el('div', { class: 'clock' });
    player.clock = {
      day: document.getElementById('now-day'), date: document.getElementById('now-date'),
      obs: el('div', { class: 'obs' }), caption: el('div', { class: 'caption' }),
    };
    clock.append(player.clock.obs, player.clock.caption);
    document.getElementById('clockrow').replaceChildren(clock);
    resizePlayer();
    renderGuess();
  }

  function resizePlayer() {
    if (!player.storm || !player.panels.length) return;
    const dpr = window.devicePixelRatio || 1;
    const width = player.panels[0].wrapEl.clientWidth;
    player.frame = mapFrame(player.storm, width);
    const base = basemap(player.frame, dpr);
    for (const p of player.panels) {
      p.canvas.width = width * dpr; p.canvas.height = player.frame.height * dpr;
      p.canvas.style.height = player.frame.height + 'px';
      p.hist.width = width * dpr; p.hist.height = HIST_H * dpr; p.hist.style.height = HIST_H + 'px';
      p.base = base; p.dpr = dpr;
    }
    draw();
  }
  window.addEventListener('resize', () => { resizePlayer(); resizeExplain(); });

  // histogram of the member winds at the current time, one bar per 2.5 m/s from 0 to 85 m/s
  const HIST_H = 90, HIST_MAX = 85, HIST_BIN = 2.5, HIST_TOP = 16, HIST_AXIS = 27;
  const histCounts = winds => {
    const c = new Array(Math.round(HIST_MAX / HIST_BIN)).fill(0);
    for (const w of winds) if (w != null) c[Math.min(c.length - 1, Math.floor(Math.max(0, w) / HIST_BIN))]++;
    return c;
  };
  function drawHist(p, counts, yMax, obsMs, closest) {
    const ctx = p.hist.getContext('2d'), W = p.hist.width / p.dpr;
    ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
    ctx.clearRect(0, 0, W, HIST_H);
    const X = w => w / HIST_MAX * W, base = HIST_H - HIST_AXIS, hMax = base - HIST_TOP;
    counts.forEach((n, i) => {
      if (!n) return;
      const h = Math.max(2, n / yMax * hMax);
      ctx.fillStyle = windColor((i + 0.5) * HIST_BIN);
      ctx.fillRect(X(i * HIST_BIN) + 0.5, base - h, X(HIST_BIN) - 1, h);
    });
    ctx.fillStyle = THEME.rule; ctx.fillRect(0, base, W, 1);
    ctx.font = '10px IBM Plex Mono, ui-monospace, monospace'; ctx.fillStyle = THEME.mute; ctx.textBaseline = 'top';
    for (const w of [0, 20, 40, 60, 80]) {
      ctx.textAlign = w === 0 ? 'left' : 'center';
      ctx.fillText(String(w), X(w), base + 3);
    }
    ctx.textAlign = 'center'; ctx.fillText('wind speed (m/s)', W / 2, base + 15);
    ctx.textBaseline = 'alphabetic';
    // label to the right of its line, or to the left near the right edge; returns its [x0, x1]
    const label = (x, text, font, color, side) => {
      ctx.font = font;
      const w = ctx.measureText(text).width, right = side ?? (x <= W * 0.6);
      const x0 = right ? x + 4 : x - 4 - w;
      return { x0, x1: x0 + w, draw: () => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.fillText(text, x0, HIST_TOP - 4); } };
    };
    let obsLab = null;
    if (obsMs != null) {
      const x = Math.min(W - 1, X(Math.min(obsMs, HIST_MAX)));
      ctx.fillStyle = THEME.ink; ctx.fillRect(x - 1, HIST_TOP - 2, 2, base - HIST_TOP + 2);
      obsLab = label(x, 'observed', '600 10px IBM Plex Mono, ui-monospace, monospace', THEME.ink);
      obsLab.draw();
    }
    // the member closest to the observed position: thin dashed grey line, label on the side away
    // from the observed label, left out if neither side is free
    if (closest && closest.w != null) {
      const x = Math.min(W - 1, X(Math.min(closest.w, HIST_MAX)));
      ctx.strokeStyle = THEME.mute; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.moveTo(x + 0.5, HIST_TOP - 2); ctx.lineTo(x + 0.5, base); ctx.stroke(); ctx.setLineDash([]);
      const font = '10px IBM Plex Mono, ui-monospace, monospace';
      const free = l => l.x0 >= 0 && l.x1 <= W && (!obsLab || l.x1 + 6 < obsLab.x0 || l.x0 > obsLab.x1 + 6);
      const lab = [label(x, 'closest', font, THEME.mute, true), label(x, 'closest', font, THEME.mute, false)].find(free);
      if (lab) lab.draw();
    }
  }

  function draw() {
    const storm = player.storm, t = player.t, F = player.frame;
    if (!storm || !F) return;
    const obsPts = storm.obs;     // [h, lon, lat, wind_kt]
    const obsKt = obsWindAt(storm.obs, t), obsMs = obsKt == null ? null : obsKt * KT;
    const hists = [];
    for (const p of player.panels) {
      const ctx = p.canvas.getContext('2d');
      ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
      ctx.drawImage(p.base, 0, 0, F.width, F.height);
      const members = new Set(), dots = [];
      // each segment takes the wind colour of its first point; segments of one colour share a path
      const paths = new Map();
      const pathFor = w => {
        const c = windColor(w);
        if (!paths.has(c)) paths.set(c, new Path2D());
        return paths.get(c);
      };
      const wind = player.corrected ? w => rankCorrected(p.model, w) : w => w;
      for (const tr of player.tracks[p.model]) {
        const pts = tr.pts;
        if (!pts.length || pts[0][0] > t) continue;
        let prev = null;
        const seg = (x, y, w) => {
          if (prev && Math.abs(x - prev[0]) <= F.width / 2) { const path = pathFor(prev[2]); path.moveTo(prev[0], prev[1]); path.lineTo(x, y); }
          prev = [x, y, w];
        };
        for (const q of pts) { if (q[0] > t) break; seg(F.X(q[1]), F.Y(q[2]), wind(q[3])); }
        const now = posAt(pts, t);
        if (now) {
          const x = F.X(now[0]), y = F.Y(now[1]);
          seg(x, y, wind(now[2]));
          dots.push([x, y, wind(now[2]), now[0], now[1]]); members.add(tr.mb);
        }
      }
      ctx.lineWidth = 1; ctx.globalAlpha = 0.35;
      for (const [c, path] of paths) { ctx.strokeStyle = c; ctx.stroke(path); }
      ctx.globalAlpha = 0.8;
      for (const [x, y, w] of dots) {
        ctx.beginPath(); ctx.arc(x, y, 3.1, 0, 2 * Math.PI);
        ctx.fillStyle = windColor(w); ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = THEME.bg; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // observed track: dark casing, then each segment in the wind colour of its first point
      const seg = [];
      for (const q of obsPts) { if (q[0] > t) break; seg.push([F.X(q[1]), F.Y(q[2]), q[3]]); }
      const o = posAt(obsPts, t);
      if (o && seg.length) seg.push([F.X(o[0]), F.Y(o[1]), seg[seg.length - 1][2]]);
      const jump = (a, b) => Math.abs(b[0] - a[0]) > F.width / 2;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.lineWidth = 4.4; ctx.strokeStyle = THEME.ink;
      seg.forEach((q, i) => (i === 0 || jump(seg[i - 1], q)) ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]));
      ctx.stroke();
      ctx.lineWidth = 2.4;
      for (let i = 1; i < seg.length; i++) {
        if (jump(seg[i - 1], seg[i])) continue;
        ctx.beginPath(); ctx.moveTo(seg[i - 1][0], seg[i - 1][1]); ctx.lineTo(seg[i][0], seg[i][1]);
        ctx.strokeStyle = windColor(seg[i - 1][2] == null ? null : seg[i - 1][2] * KT); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      // member closest to the observed position (km on a plane tangent at the observation)
      let closest = null;
      if (o) {
        const c = Math.cos(o[1] * Math.PI / 180);
        for (const [, , w, lon, lat] of dots) {
          const km = Math.hypot(((lon - o[0] + 540) % 360 - 180) * 111.2 * c, (lat - o[1]) * 111.2);
          if (!closest || km < closest.km) closest = { w, km };
        }
      }
      if (o && seg.length) {
        const [x, y] = seg[seg.length - 1];
        ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 2 * Math.PI);
        const kt = obsWindAt(storm.obs, t);
        ctx.fillStyle = windColor(kt == null ? null : kt * KT); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = THEME.ink; ctx.stroke();
      }
      // infobox
      const n = members.size;
      const scored = storm.nll_t.map((h, i) => [h, storm.nll[p.model][i]]).filter(([h, v]) => h <= t && v != null);
      const nll = scored.length ? (scored.reduce((a, [, v]) => a + v, 0) / scored.length).toFixed(2) : '–';
      const found = el('span'), score = el('span');
      found.append(el('b', {}, `${n}/${N_MEMBERS}`), document.createTextNode(' members'));
      score.append(document.createTextNode('NLL '), el('b', {}, nll));
      p.info.replaceChildren(found, score);
      const winds = dots.map(d => d[2]).filter(w => w != null);
      hists.push([p, histCounts(winds), closest]);
      p.histNote.replaceChildren();
      if (obsMs != null && winds.length) {
        const weaker = winds.filter(w => w < obsMs).length;
        p.histNote.append(document.createTextNode('observed above '),
          el('b', {}, weaker === winds.length ? `all ${winds.length}` : `${weaker} of ${winds.length}`));
      }
      if (closest && closest.w != null) {
        const line = el('span');
        line.append(document.createTextNode(' · closest member '), el('b', {}, `${Math.round(closest.w)} m/s`));
        p.histNote.append(line);
      }
    }
    // one vertical scale for the three panels, so their bar heights compare
    const yMax = Math.max(5, ...hists.map(([, c]) => Math.max(...c)));
    for (const [p, counts, closest] of hists) drawHist(p, counts, yMax, obsMs, closest);
    const c = player.clock;
    c.day.textContent = `Day ${(t / 24).toFixed(1)}`;
    c.date.textContent = fmtDate(new Date(Date.parse(storm.init.replace('Z', ':00Z')) + t * 3600e3));
    const kt = obsWindAt(storm.obs, t);
    c.obs.replaceChildren();
    if (kt != null) {
      const sw = el('span', { class: 'obs-sw' }); sw.style.background = windColor(kt * KT);
      c.obs.append(sw, document.createTextNode(`Observed: ${category(kt)}, ${Math.round(kt * KT)} m/s (${Math.round(kt)} kt)`));
    }
    const ev = storm.events.filter(e => e[0] <= t).pop();
    c.caption.textContent = ev ? ev[1] : '';
  }

  function scoreTable() {
    const storm = player.storm, table = el('table', { class: 'scores' });
    const hr = el('tr'); ['Panel', 'Model', `Track NLL on ${storm.name}`, ''].forEach(h => hr.append(el('th', {}, h)));
    table.append(hr);
    const ranked = [...MODELS].sort((a, b) => storm.storm_nll[a] - storm.storm_nll[b]);
    storm.order.forEach((m, i) => {
      const tr = el('tr');
      tr.append(el('td', {}, 'ABC'[i]));
      const name = el('td'); const sw = el('span', { class: 'swatch' }); sw.style.background = COLOR[m];
      name.append(sw, document.createTextNode(`${NAME[m]} (${KIND[m]})`));
      tr.append(name);
      tr.append(el('td', { class: 'num' }, `${storm.storm_nll[m].toFixed(2)}  ·  ${['lowest', 'second', 'highest'][ranked.indexOf(m)]}`));
      tr.append(el('td', {}, DESC[m]));
      table.append(tr);
    });
    return table;
  }

  function renderGuess() {
    // game on: each panel carries its own guess (IFS-ENS, GenCast or FGN); game off: names shown
    const storm = player.storm, box = document.getElementById('guess-box');
    box.replaceChildren();
    const g = guesses[storm.hid] || {};
    const redraw = () => { const t = player.t; buildPanels(); player.t = t; scrub.value = Math.round(t); draw(); };
    const played = Object.values(guesses).filter(x => x.done && !x.skipped);
    const gscore = document.getElementById('gscore');
    if (gscore) gscore.textContent = player.mode === 'guess' && played.length
      ? `score ${played.reduce((a, x) => a + x.correct, 0)} / ${3 * played.length} panels · ${played.length} storm${played.length === 1 ? '' : 's'}` : '';
    if (player.mode === 'show') return;   // track scores come in sections 2 and 3, once NLL is explained
    const pick = g.pick || {};
    const order = ['ifsens_e2s', 'gencast_op', 'fgn'];
    const score = () => {
      const gg = guessOf(storm.hid);
      gg.correct = player.panels.filter((p, i) => gg.pick['ABC'[i]] === p.model).length;
      gg.done = true;
      if (chipFor[storm.hid] && !chipFor[storm.hid].querySelector('.done')) chipFor[storm.hid].append(el('span', { class: 'done' }, '✓'));
      redraw();
    };
    player.panels.forEach((p, i) => {
      const L = 'ABC'[i];
      const ov = el('div', { class: 'pguess', role: 'group', 'aria-label': `Your guess for panel ${L}` });
      if (g.done) {
        const ok = pick[L] === p.model;
        ov.classList.add(g.skipped ? 'shown' : ok ? 'ok' : 'no');
        if (!g.skipped) ov.append(el('span', { class: 'mark' }, ok ? '✓' : '✗'));
        ov.append(el('span', {}, g.skipped || ok ? NAME[p.model] : `${NAME[p.model]}, not ${pick[L] ? NAME[pick[L]] : '–'}`));
      } else {
        for (const m of order) {
          const b = el('button', { type: 'button', 'aria-pressed': String(pick[L] === m) }, NAME[m]);
          b.addEventListener('click', () => {
            const gg = guessOf(storm.hid); gg.pick = { ...(gg.pick || {}) };
            for (const k of Object.keys(gg.pick)) if (gg.pick[k] === m) delete gg.pick[k];   // each model once
            if (pick[L] === m) delete gg.pick[L]; else gg.pick[L] = m;
            if (Object.keys(gg.pick).length === 3) score(); else renderGuess();   // scored as soon as all three are labelled
          });
          ov.append(b);
        }
      }
      p.wrapEl.querySelector('.pguess')?.remove();
      p.wrapEl.append(ov);
    });
    const row = el('div', { class: 'opts' });
    if (!g.done) {
      const n = Object.keys(pick).length;
      box.append(el('div', { class: 'q' }, 'Label each panel: one is IFS-ENS, the physics-based ensemble; the other two are the AI models GenCast and FGN.'));
      const skip = el('button', { class: 'skip', type: 'button' }, 'Show the answer');
      skip.addEventListener('click', () => { Object.assign(guessOf(storm.hid), { done: true, skipped: true }); redraw(); });
      row.append(el('span', { class: 'count' }, `${n}/3 labelled`), skip);
      box.append(row);
      return;
    }
    box.append(el('div', { class: 'q' }, g.skipped ? 'Answer shown.' : `${g.correct} of 3 panels right.`));
    const again = el('button', { class: 'skip', type: 'button' }, 'Try this storm again');
    again.addEventListener('click', () => { delete guesses[storm.hid]; chipFor[storm.hid]?.querySelector('.done')?.remove(); redraw(); });
    row.append(again);
    box.append(row, scoreTable());
  }

  // ---------------------------------------------------------------- 2. explainer
  // Three models side by side at one storm and time: members, smoothed density, ensemble mean (cross),
  // observed position (ring) and a black dot the reader drags; the dot is shared by the three maps.
  const exRoot = document.getElementById('explain-panels'), exText = document.getElementById('explain-text');
  const exCases = document.getElementById('explain-cases');
  const ex = { case: null, marker: null, panels: [] };
  const EX_ORDER = ['fgn', 'gencast_op', 'ifsens_e2s'];
  // km on a plane tangent at the observed position
  const toKm = ([lon, lat]) => {
    const c = Math.cos(ex.obs[1] * Math.PI / 180);
    return [((lon - ex.obs[0] + 540) % 360 - 180) * 111.2 * c, (lat - ex.obs[1]) * 111.2];
  };
  // Gaussian KDE in km; the bandwidth is chosen as in the paper (compute_traj_metrics._kde_bandwidth):
  // 5-fold cross-validation, folds in member order, 100 values from half a grid cell (13.9 km) to
  // max(4 x 13.9 km, 5 x the mean of the x and y standard deviations)
  const logDensity = (P, h, [x, y]) => {
    const e = P.map(p => -((x - p[0]) ** 2 + (y - p[1]) ** 2) / (2 * h * h)), m = Math.max(...e);
    return m + Math.log(e.reduce((a, v) => a + Math.exp(v - m), 0)) - Math.log(P.length * 2 * Math.PI * h * h);
  };
  function cvBandwidth(P) {
    const n = P.length, k = Math.min(5, n), floor = 27.8 / 2;
    const sd = i => Math.sqrt(d3.mean(P, p => (p[i] - d3.mean(P, q => q[i])) ** 2));
    const ceil = Math.max(4 * floor, 5 * (sd(0) + sd(1)) / 2);
    const bounds = [0];
    for (let f = 0; f < k; f++) bounds.push(bounds[f] + Math.floor(n / k) + (f < n % k ? 1 : 0));
    let best = null, bestScore = -Infinity;
    for (let b = 0; b < 100; b++) {
      const h = floor + b * (ceil - floor) / 99;
      let score = 0;
      for (let f = 0; f < k; f++) {
        const test = P.slice(bounds[f], bounds[f + 1]), train = [...P.slice(0, bounds[f]), ...P.slice(bounds[f + 1])];
        for (const q of test) score += logDensity(train, h, q);
      }
      if (score > bestScore) { bestScore = score; best = h; }
    }
    return best;
  }
  // the explainer is optional: a page without its panels skips it
  (exRoot ? CASES : []).forEach((c, i) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(i === 0) }, c.label);
    b.addEventListener('click', () => {
      exCases.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      selectCase(c);
    });
    exCases.append(b);
  });
  async function selectCase(c) {
    const storm = await loadStorm(c.hid);
    ex.case = c; ex.marker = null;
    ex.obs = posAt(storm.obs.map(p => p.slice(0, 3)), c.hour);
    ex.storm = { ...storm, extent: [ex.obs[0] - 9, ex.obs[0] + 9, ex.obs[1] - 8, ex.obs[1] + 8], center: 0 };
    const i = storm.nll_t.indexOf(c.hour);
    exRoot.replaceChildren();
    ex.panels = EX_ORDER.map(m => {
      const members = storm.models[m].map(([, pts]) => posAt(pts, c.hour)).filter(Boolean);
      const P = members.map(toKm);
      const h = cvBandwidth(P);
      const mean = [d3.mean(P, p => p[0]), d3.mean(P, p => p[1])];
      const cell = el('div'), head = el('div', { class: 'panel-head' });
      const who = el('span', { class: 'who' }, NAME[m]); who.style.color = COLOR[m];
      head.append(who);
      const wrap = el('div', { class: 'map-wrap' }), canvas = el('canvas'), stats = el('table', { class: 'exstats' });
      wrap.append(canvas); cell.append(head, wrap, stats); exRoot.append(cell);
      const panel = { m, members, P, h, mean, canvas, wrap, stats, n: members.length,
                      dist: Math.hypot(...mean), nll: -logDensity(P, h, [0, 0]), paper: i >= 0 ? storm.nll[m][i] : null };
      let dragging = false;
      const setMarker = evt => {
        const r = canvas.getBoundingClientRect(), F = ex.frame, [lon0, lon1, lat0, lat1] = ex.storm.extent;
        ex.marker = [lon0 + (evt.clientX - r.left) / F.width * (lon1 - lon0), lat1 - (evt.clientY - r.top) / F.height * (lat1 - lat0)];
        drawExplain();
      };
      canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); setMarker(e); });
      canvas.addEventListener('pointermove', e => { if (dragging) setMarker(e); });
      canvas.addEventListener('pointerup', () => { dragging = false; });
      return panel;
    });
    const date = fmtDate(new Date(Date.parse(storm.init.replace('Z', ':00Z')) + c.hour * 3600e3));
    exText.replaceChildren(el('b', {}, `${c.name}, ${date}, day ${(c.hour / 24).toFixed(2).replace(/0$/, '')} of the forecast. `),
                           document.createTextNode(c.text));
    resizeExplain();
  }
  function resizeExplain() {
    if (!ex.panels.length) return;
    const dpr = window.devicePixelRatio || 1, width = ex.panels[0].wrap.clientWidth;
    ex.frame = mapFrame(ex.storm, width);
    const F = ex.frame, base = basemap(F, dpr), [lon0, lon1, lat0, lat1] = ex.storm.extent;
    // density on a 5 px grid for each panel; one shading scale for the three panels, so that a spread
    // ensemble (low density everywhere) looks lighter than a concentrated one
    const cell = 5, cols = Math.ceil(F.width / cell), rows = Math.ceil(F.height / cell);
    const grids = ex.panels.map(p => {
      const vals = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++)
        vals.push(Math.exp(logDensity(p.P, p.h, toKm([lon0 + (i + 0.5) * cell / F.width * (lon1 - lon0), lat1 - (j + 0.5) * cell / F.height * (lat1 - lat0)]))));
      return vals;
    });
    const vmax = d3.max(grids.flat()) || 1;
    ex.panels.forEach((p, n) => {
      p.canvas.width = width * dpr; p.canvas.height = F.height * dpr; p.canvas.style.height = F.height + 'px';
      // basemap and shading, drawn once per size: alpha grows with the square root of the density
      const bg = document.createElement('canvas'); bg.width = width * dpr; bg.height = F.height * dpr;
      const ctx = bg.getContext('2d'); ctx.scale(dpr, dpr); ctx.drawImage(base, 0, 0, F.width, F.height);
      grids[n].forEach((v, k) => {
        const a = 0.7 * Math.sqrt(v / vmax);
        if (a < 0.02) return;
        ctx.fillStyle = `rgba(${THEME.dens}, ${a})`;
        ctx.fillRect((k % cols) * cell, Math.floor(k / cols) * cell, cell, cell);
      });
      p.bg = bg; p.dpr = dpr;
    });
    drawExplain();
  }
  function drawExplain() {
    if (!ex.panels.length || !ex.frame) return;
    const F = ex.frame, mk = ex.marker || ex.obs;
    const best = key => Math.min(...ex.panels.map(p => p[key]));
    for (const p of ex.panels) {
      const ctx = p.canvas.getContext('2d');
      ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
      ctx.drawImage(p.bg, 0, 0, F.width, F.height);
      for (const [lon, lat] of p.members) {
        ctx.beginPath(); ctx.arc(F.X(lon), F.Y(lat), 3, 0, 2 * Math.PI);
        ctx.fillStyle = COLOR[p.m]; ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = THEME.bg; ctx.stroke();
      }
      // ensemble mean: cross with a white halo
      const c = Math.cos(ex.obs[1] * Math.PI / 180);
      const mx = F.X(ex.obs[0] + p.mean[0] / (111.2 * c)), my = F.Y(ex.obs[1] + p.mean[1] / 111.2);
      for (const [w, col] of [[3.5, THEME.bg], [1.8, INK]]) {
        ctx.lineWidth = w; ctx.strokeStyle = col; ctx.beginPath();
        ctx.moveTo(mx - 7, my - 7); ctx.lineTo(mx + 7, my + 7); ctx.moveTo(mx + 7, my - 7); ctx.lineTo(mx - 7, my + 7); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(F.X(ex.obs[0]), F.Y(ex.obs[1]), 8, 0, 2 * Math.PI);
      ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(F.X(mk[0]), F.Y(mk[1]), 5.5, 0, 2 * Math.PI);
      ctx.fillStyle = INK; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = THEME.bg; ctx.stroke();

      p.stats.replaceChildren();
      const row = (label, value, strong) => {
        const tr = el('tr'); tr.append(el('td', {}, label));
        const td = el('td', { class: 'num' }, value); if (strong) td.style.fontWeight = '700';
        tr.append(td); p.stats.append(tr);
      };
      row('Mean position, distance to the storm', `${Math.round(p.dist)} km`, p.dist === best('dist'));
      row('NLL at the observed position', p.nll.toFixed(2), p.nll === best('nll'));
      if (ex.marker) row('NLL at the light dot', (-logDensity(p.P, p.h, toKm(mk))).toFixed(2), false);
    }
  }
  if (exRoot && CASES.length) selectCase(CASES[0]);

  // ---------------------------------------------------------------- 3. season
  const BASINS = { all: 'All basins', WP: 'West Pacific', SI: 'South Indian', EP: 'East Pacific', NA: 'North Atlantic', SP: 'South Pacific', NI: 'North Indian' };
  const basinOf = s => s.basin || 'NA';
  let basin = 'all';
  const filterRow = document.getElementById('basin-filter');
  Object.entries(BASINS).forEach(([code, label]) => {
    const n = code === 'all' ? index.length : index.filter(s => basinOf(s) === code).length;
    if (!n) return;
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(code === basin) }, `${label} (${n})`);
    b.addEventListener('click', () => {
      basin = code;
      filterRow.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
      renderSeason();
    });
    filterRow.append(b);
  });
  const subset = () => basin === 'all' ? index : index.filter(s => basinOf(s) === basin);

  const svg = d3.select('#worldmap');
  function renderSeason() {
    const list = subset(), nStorms = list.length;
    const beats = (a, b) => list.filter(s => s.nll[a] < s.nll[b]).length;
    const stats = document.getElementById('stats');
    stats.replaceChildren();
    [[`${beats('fgn', 'ifsens_e2s')} / ${nStorms}`, 'storms on which FGN has a lower NLL than IFS-ENS'],
     [`${beats('gencast_op', 'ifsens_e2s')} / ${nStorms}`, 'storms on which GenCast has a lower NLL than IFS-ENS'],
     [`${beats('fgn', 'gencast_op')} / ${nStorms}`, 'storms on which FGN has a lower NLL than GenCast']]
      .forEach(([v, k]) => {
        const d = el('div', { class: 'stat' }), big = el('div', { class: 'v' }, v);
        d.append(big, el('div', { class: 'k' }, k)); stats.append(d);
      });
    const share = Object.fromEntries(MODELS.map(m => [m, list.filter(s => s.winner === m).length]));
    const bar = document.getElementById('sharebar'), leg = document.getElementById('sharelegend');
    bar.replaceChildren(); leg.replaceChildren();
    ['fgn', 'gencast_op', 'ifsens_e2s'].forEach(m => {
      if (!share[m]) return;
      const wide = share[m] / nStorms >= 0.12, lab = `${NAME[m]} ${Math.round(100 * share[m] / nStorms)}%`; const d = el('div', wide ? {} : { class: 'out' }, wide ? lab : null); if (!wide) { const t = el('span', {}, lab); t.style.color = COLOR[m]; d.append(t); }
      d.style.flex = String(share[m]); d.style.background = COLOR[m];
      d.addEventListener('pointermove', e => showTip(e, NAME[m], [['storms with the lowest NLL', `${share[m]} of ${nStorms}`, COLOR[m]]]));
      d.addEventListener('pointerleave', hideTip);
      bar.append(d);
    });
    ['fgn', 'gencast_op', 'ifsens_e2s'].forEach(m => {
      const l = el('span'); const sw = el('span', { class: 'swatch' }); sw.style.background = COLOR[m]; sw.style.height = '8px'; sw.style.width = '12px';
      l.append(sw, document.createTextNode(`${NAME[m]}: ${share[m]} storm${share[m] === 1 ? '' : 's'} (${Math.round(100 * share[m] / nStorms)}%)`)); leg.append(l);
    });
    drawWorld(list);
    const table = document.getElementById('storm-table');
    table.replaceChildren();
    const head = el('tr');
    ['Storm', 'Basin', 'Start', 'Peak (kt)', 'GenCast', 'IFS-ENS', 'FGN'].forEach(h => head.append(el('th', {}, h)));
    table.append(head);
    [...list].sort((a, b) => a.start.localeCompare(b.start)).forEach(s => {
      const tr = el('tr');
      [s.name, basinOf(s), s.start, Math.round(s.peak_kt)].forEach(v => tr.append(el('td', {}, String(v))));
      MODELS.forEach(m => tr.append(el('td', m === s.winner ? { class: 'best' } : {}, s.nll[m].toFixed(2))));
      table.append(tr);
    });
    const duel = document.getElementById('duel');
    if (window.BlogSeason && duel) window.BlogSeason.renderDuel(duel, list);
  }

  function drawWorld(list) {
    // equirectangular, 360° of longitude across the width, 60°N to 45°S
    const width = svg.node().clientWidth, scale = width / (2 * Math.PI), height = Math.round(scale * 105 * Math.PI / 180);
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('height', height);
    svg.selectAll('*').remove();
    // centred on 170°E so the map edge (10°W) crosses no storm track
    const projection = d3.geoEquirectangular().rotate([-170, 0]).scale(scale)
      .translate([width / 2, scale * 60 * Math.PI / 180])
      .clipExtent([[0, 0], [width, height]]);
    const path = d3.geoPath(projection);
    svg.append('path').datum(land).attr('d', path).attr('fill', LAND).attr('stroke', COAST).attr('stroke-width', 0.5);
    const g = svg.append('g');
    const shown = list.filter(s => s.obs && s.obs.length > 1);
    const geo = s => ({ type: 'LineString', coordinates: s.obs });
    const tracks = g.selectAll('path.track').data(shown).join('path').attr('class', 'track')
      .attr('d', s => path(geo(s))).attr('stroke', s => COLOR[s.winner]);
    g.selectAll('path.hit').data(shown).join('path').attr('class', 'hit').attr('d', s => path(geo(s)))
      .attr('tabindex', 0).attr('role', 'button').attr('aria-label', s => `${s.name}, ${s.start}`)
      .on('pointermove focus', (e, s) => {
        tracks.classed('dim', d => d !== s);
        const ev = e.type === 'focus' ? (() => { const r = e.target.getBoundingClientRect(); return { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }; })() : e;
        showTip(ev, `${s.name} · ${s.start} · peak ${Math.round(s.peak_kt)} kt`,
          [...MODELS].sort((a, b) => s.nll[a] - s.nll[b]).map(m => [NAME[m], s.nll[m].toFixed(2), COLOR[m]]));
      })
      .on('pointerleave blur', () => { tracks.classed('dim', false); hideTip(); })
      .on('click keydown', (e, s) => {
        if (e.type === 'keydown' && e.key !== 'Enter') return;
        hideTip(); tracks.classed('dim', false); if (s.tracks) selectStorm(s.hid, true);
      });
  }
  renderSeason();
  window.addEventListener('resize', () => drawWorld(subset()));
  window.addEventListener('open-storm', e => selectStorm(e.detail.hid, true));

  fetch('data/leadtime_wins.json').then(r => r.ok ? r.json() : null).then(d => {
    const c = document.getElementById('leadtime');
    if (d && window.BlogSeason && c) window.BlogSeason.renderLeadtime(c, d);
  }).catch(() => {});

  // ---------------------------------------------------------------- 4b. rank rescaling
  // Share of winds below each speed for each model and for IBTrACS (wind_qmap.json); the selected wind
  // goes up to its model's curve, across to the observed curve and down to the rescaled wind.
  if (document.getElementById('rank-chart')) {
    const rk = { model: 'fgn', w: 30 };
    const svgR = d3.select('#rank-chart'), readout = document.getElementById('rank-readout');
    const chipsR = document.getElementById('rank-models');
    ['fgn', 'gencast_op', 'ifsens_e2s'].forEach(m => {
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(m === rk.model) }, NAME[m]);
      b.addEventListener('click', () => {
        rk.model = m;
        chipsR.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
        drawRank();
      });
      chipsR.append(b);
    });
    document.getElementById('rank-caption').textContent =
      `Maximum winds of the 41 storms of 2025, all lead times pooled. Observed: IBTrACS, ${qmap.n.ibtracs} values. ` +
      `Models: the maximum 10 m wind within about 220 km of the tracked centre, in the members' track points inside the ` +
      `period with an observed wind (FGN ${qmap.n.fgn}, GenCast ${qmap.n.gencast_op}, IFS-ENS ${qmap.n.ifsens_e2s} values). ` +
      'Many agency estimates are in steps of 5 kt, hence the steps in the observed curve. ' +
      'The coloured strip under the axis gives the Saffir-Simpson category of each speed.';
    function drawRank() {
      const W = svgR.node().clientWidth, H = Math.round(Math.min(340, Math.max(240, W * 0.6)));
      const mg = { l: 44, r: 12, t: 12, b: 46 }, iw = W - mg.l - mg.r, ih = H - mg.t - mg.b;
      svgR.attr('viewBox', `0 0 ${W} ${H}`).attr('height', H);
      svgR.selectAll('*').remove();
      const g = svgR.append('g').attr('transform', `translate(${mg.l},${mg.t})`);
      const x = d3.scaleLinear([0, 85], [0, iw]), y = d3.scaleLinear([0, 1], [ih, 0]);
      g.append('g').selectAll('line').data([0.25, 0.5, 0.75, 1]).join('line')
        .attr('x1', 0).attr('x2', iw).attr('y1', y).attr('y2', y).attr('stroke', THEME.rule);
      // category strip under the axis
      CATS.forEach(([kt], i) => {
        const lo = kt * KT, hi = i + 1 < CATS.length ? CATS[i + 1][0] * KT : 85;
        g.append('rect').attr('x', x(lo)).attr('width', Math.max(0, x(hi) - x(lo)) - 1).attr('y', ih + 3).attr('height', 5)
          .attr('fill', CAT_COLOR[i]);
      });
      const axisText = (sel) => sel.attr('font-size', 10).attr('fill', THEME.mute).attr('font-family', 'IBM Plex Mono, ui-monospace, monospace');
      g.append('g').selectAll('text').data(d3.range(0, 81, 10)).join('text')
        .attr('x', x).attr('y', ih + 21).attr('text-anchor', 'middle').text(d => d).call(axisText);
      g.append('text').attr('x', iw).attr('y', ih + 38).attr('text-anchor', 'end').text('maximum wind (m/s)').call(axisText);
      g.append('g').selectAll('text').data([0, 0.25, 0.5, 0.75, 1]).join('text')
        .attr('x', -6).attr('y', d => y(d) + 3).attr('text-anchor', 'end').text(d => `${d * 100}%`).call(axisText);
      g.append('text').attr('x', 0).attr('y', -2).text('share of winds below').call(axisText);
      const line = vals => d3.line()(vals.map((v, i) => [x(Math.min(v, 85)), y(i / (vals.length - 1))]));
      for (const m of MODELS) {
        g.append('path').attr('d', line(qmap.models[m])).attr('fill', 'none').attr('stroke', COLOR[m])
          .attr('stroke-width', m === rk.model ? 2.5 : 1.2).attr('opacity', m === rk.model ? 1 : 0.35);
      }
      g.append('path').attr('d', line(qmap.ibtracs)).attr('fill', 'none').attr('stroke', INK).attr('stroke-width', 2.5);
      // direct labels at the 75% height
      const lab = (v, text, color) => g.append('text').attr('x', x(Math.min(v, 85)) + 5).attr('y', y(0.75) + 4)
        .attr('font-size', 11).attr('font-weight', 600).attr('fill', color).text(text);
      lab(qmap.models[rk.model][75], NAME[rk.model], COLOR[rk.model]);
      lab(qmap.ibtracs[75], 'observed', INK);
      // the path of the selected wind
      const q = rankOf(rk.model, rk.w), w2 = observedAt(q);
      const path = [[x(rk.w), ih], [x(rk.w), y(q)], [x(w2), y(q)], [x(w2), ih]];
      g.append('path').attr('d', d3.line()(path)).attr('fill', 'none').attr('stroke', INK).attr('stroke-width', 1.3)
        .attr('stroke-dasharray', '4 3');
      g.append('path').attr('d', d3.line()([[x(w2) - 5, y(q) - 4], [x(w2), y(q)], [x(w2) - 5, y(q) + 4]]))
        .attr('fill', 'none').attr('stroke', INK).attr('stroke-width', 1.3);
      for (const [v, c] of [[rk.w, COLOR[rk.model]], [w2, INK]]) {
        g.append('circle').attr('cx', x(v)).attr('cy', ih).attr('r', 5).attr('fill', c).attr('stroke', THEME.bg).attr('stroke-width', 1.5);
      }
      readout.replaceChildren(el('div', { class: 'big' }, `${rk.w.toFixed(0)} → ${w2.toFixed(0)} m/s`));
      readout.append(el('div', {},
        `A ${NAME[rk.model]} member with a maximum wind of ${rk.w.toFixed(0)} m/s (${category(rk.w / KT)}) is stronger than ` +
        `${Math.round(100 * q)}% of all ${NAME[rk.model]} winds of 2025. ${Math.round(100 * q)}% of the observed winds are below ` +
        `${w2.toFixed(0)} m/s, so in the player it is shown at ${w2.toFixed(0)} m/s: ${category(w2 / KT)}.`));
      // pointer sets the wind
      svgR.append('rect').attr('x', mg.l).attr('y', mg.t).attr('width', iw).attr('height', ih).attr('fill', 'transparent')
        .on('pointermove pointerdown', e => {
          const [px] = d3.pointer(e, g.node());
          const w = Math.max(5, Math.min(qmap.models[rk.model][100], x.invert(px)));
          if (Math.abs(w - rk.w) >= 0.25) { rk.w = Math.round(w * 2) / 2; drawRank(); }
        });
    }
    drawRank();
    window.addEventListener('resize', drawRank);
  }

  // ---------------------------------------------------------------- 4. intensity
  Promise.all(['intensity_bias', 'pressure_wind'].map(n => fetch(`data/${n}.json`).then(r => r.ok ? r.json() : null).catch(() => null)))
    .then(([bias, pw]) => {
      if (!window.BlogIntensity || !document.getElementById('bias-chart')) return;
      if (bias) window.BlogIntensity.renderBias(document.getElementById('bias-chart'), bias);
      if (pw) window.BlogIntensity.renderPressureWind(document.getElementById('pw-chart'), pw);
    });

  selectStorm(ordered[0].hid, false);
})();
