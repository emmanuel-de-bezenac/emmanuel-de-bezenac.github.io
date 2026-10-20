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
  const OCEAN = '#eef3f7', LAND = '#dcdad5', COAST = '#a9a6a0', INK = '#111111';
  const N_MEMBERS = 49, HOURS_PER_SECOND = 20;
  const CURATED = ['2025294N14290', '2025308N09144', '2025305N08140', '2025276N20147'];
  const EXPLAIN = { hid: '2025223N17337', hour: 150 };   // Hurricane Erin, 17 Aug 2025 00 UTC

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
  const KT = 0.5144, NO_WIND = '#9a9a9a';
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
  function rankCorrected(model, w) {
    if (w == null) return null;
    const src = qmap.models[model], dst = qmap.ibtracs, n = src.length - 1;
    if (w <= src[0]) return dst[0];
    if (w >= src[n]) return dst[n];
    let i = 0;
    while (src[i + 1] < w) i++;
    const f = src[i + 1] === src[i] ? 0 : (w - src[i]) / (src[i + 1] - src[i]);
    return dst[i] + f * (dst[i + 1] - dst[i]);
  }
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
  const shown = (hid, m) => { const g = guesses[hid] || {}; return !!g.done || (g.physics != null && m === 'ifsens_e2s'); };
  const player = { storm: null, t: 0, playing: false, panels: [], frame: null };
  const chips = document.getElementById('storm-chips');
  const withTracks = index.filter(s => s.tracks);
  const ordered = [...CURATED.map(h => withTracks.find(s => s.hid === h)).filter(Boolean),
                   ...withTracks.filter(s => !CURATED.includes(s.hid)).sort((a, b) => a.start.localeCompare(b.start))];
  const chipFor = {};
  ordered.forEach((s, i) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false' }, s.name);
    b.addEventListener('click', () => selectStorm(s.hid, true));
    chipFor[s.hid] = b;
    if (i < 8) chips.append(b);
  });
  if (ordered.length > 8) {
    const sel = el('select', { class: 'chip', 'aria-label': 'More storms' });
    sel.append(el('option', { value: '' }, `${ordered.length - 8} more storms…`));
    ordered.slice(8).forEach(s => sel.append(el('option', { value: s.hid }, `${s.name} (${s.start})`)));
    sel.addEventListener('change', () => { if (sel.value) selectStorm(sel.value, true); });
    chips.append(sel);
    player.moreSelect = sel;
  }

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
    block('no data', NO_WIND, 'No wind reported', [], 'IBTrACS has no wind from the USA agencies at these times, usually before the storm forms and after it becomes post-tropical.').classList.add('none');
    const unit = el('span', {}, 'm/s'); unit.style.left = `${100 * CATS.length / (CATS.length + 1)}%`; ticks.append(unit);
    bar.append(blocks, ticks);
    const seg = document.getElementById('windcorr'), explain = document.getElementById('wc-explain');
    const EXPLAIN = {
      raw: 'The 10 m wind each model gives near the storm centre. The models compute wind on a grid of about 25 km, ' +
           'which smooths the peak, so even an exact forecast is weaker than the observed wind.',
      rank: 'Each member\'s wind is replaced by the observed wind of the same rank among all 2025 winds of its model, ' +
            'as in the "ranks only" view of section 4. This removes each model\'s overall bias; which members are strong or weak does not change.',
    };
    const setMode = v => {
      player.corrected = v === 'rank';
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
      explain.textContent = EXPLAIN[v];
    };
    setMode('raw');
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { setMode(b.dataset.v); draw(); }));
  }
  const playBtn = document.getElementById('play');
  const scrub = document.getElementById('scrub');
  playBtn.addEventListener('click', () => setPlaying(!player.playing));
  scrub.addEventListener('input', () => { setPlaying(false); player.t = +scrub.value; draw(); });

  function setPlaying(on) {
    player.playing = on;
    playBtn.textContent = on ? 'Pause' : 'Play';
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
    if (player.moreSelect) player.moreSelect.value = ordered.slice(8).some(s => s.hid === hid) ? hid : '';
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
    storm.order.forEach((m, i) => {
      const letter = 'ABC'[i];
      const cell = el('div');
      const head = el('div', { class: 'panel-head' }, letter);
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
    if (storm.impact) head.append(el('div', { class: 'impact' }, storm.impact));
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
  const HIST_H = 78, HIST_MAX = 85, HIST_BIN = 2.5, HIST_TOP = 16, HIST_AXIS = 15;
  const histCounts = winds => {
    const c = new Array(Math.round(HIST_MAX / HIST_BIN)).fill(0);
    for (const w of winds) if (w != null) c[Math.min(c.length - 1, Math.floor(Math.max(0, w) / HIST_BIN))]++;
    return c;
  };
  function drawHist(p, counts, yMax, obsMs) {
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
    ctx.fillStyle = '#ece9e4'; ctx.fillRect(0, base, W, 1);
    ctx.font = '10px Inter, system-ui, sans-serif'; ctx.fillStyle = '#8a8a8a'; ctx.textBaseline = 'top';
    for (const w of [0, 20, 40, 60, 80]) {
      ctx.textAlign = w === 0 ? 'left' : 'center';
      ctx.fillText(w === 80 ? '80 m/s' : String(w), X(w), base + 3);
    }
    if (obsMs != null) {
      const x = Math.min(W - 1, X(Math.min(obsMs, HIST_MAX)));
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(x - 1, HIST_TOP - 2, 2, base - HIST_TOP + 2);
      ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
      ctx.textAlign = x > W * 0.6 ? 'right' : 'left';
      ctx.fillText('observed', x + (x > W * 0.6 ? -4 : 4), HIST_TOP - 4);
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
          dots.push([x, y, wind(now[2])]); members.add(tr.mb);
        }
      }
      ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      for (const [c, path] of paths) { ctx.strokeStyle = c; ctx.stroke(path); }
      ctx.globalAlpha = 0.9;
      for (const [x, y, w] of dots) {
        ctx.beginPath(); ctx.arc(x, y, 3.6, 0, 2 * Math.PI);
        ctx.fillStyle = windColor(w); ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // observed track: dark casing, then each segment in the wind colour of its first point
      const seg = [];
      for (const q of obsPts) { if (q[0] > t) break; seg.push([F.X(q[1]), F.Y(q[2]), q[3]]); }
      const o = posAt(obsPts, t);
      if (o && seg.length) seg.push([F.X(o[0]), F.Y(o[1]), seg[seg.length - 1][2]]);
      const jump = (a, b) => Math.abs(b[0] - a[0]) > F.width / 2;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.lineWidth = 4.4; ctx.strokeStyle = '#2b2b2b';
      seg.forEach((q, i) => (i === 0 || jump(seg[i - 1], q)) ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]));
      ctx.stroke();
      ctx.lineWidth = 2.4;
      for (let i = 1; i < seg.length; i++) {
        if (jump(seg[i - 1], seg[i])) continue;
        ctx.beginPath(); ctx.moveTo(seg[i - 1][0], seg[i - 1][1]); ctx.lineTo(seg[i][0], seg[i][1]);
        ctx.strokeStyle = windColor(seg[i - 1][2] == null ? null : seg[i - 1][2] * KT); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      if (o && seg.length) {
        const [x, y] = seg[seg.length - 1];
        ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 2 * Math.PI);
        const kt = obsWindAt(storm.obs, t);
        ctx.fillStyle = windColor(kt == null ? null : kt * KT); ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = '#2b2b2b'; ctx.stroke();
      }
      // infobox
      const n = members.size;
      const scored = storm.nll_t.map((h, i) => [h, storm.nll[p.model][i]]).filter(([h, v]) => h <= t && v != null);
      const nll = scored.length ? (scored.reduce((a, [, v]) => a + v, 0) / scored.length).toFixed(2) : '–';
      const found = el('span'), score = el('span');
      found.append(document.createTextNode('storm found in '), el('b', {}, `${n} of ${N_MEMBERS}`),
        document.createTextNode(` members (${Math.round(100 * n / N_MEMBERS)}%)`));
      score.append(document.createTextNode('track NLL so far: '), el('b', {}, nll));
      p.info.replaceChildren(found, score);
      const winds = dots.map(d => d[2]).filter(w => w != null);
      hists.push([p, histCounts(winds)]);
      p.histNote.replaceChildren();
      if (obsMs != null && winds.length) {
        const weaker = winds.filter(w => w < obsMs).length;
        p.histNote.append(document.createTextNode('observed wind above '),
          el('b', {}, weaker === winds.length ? `all ${winds.length}` : `${weaker} of ${winds.length}`),
          document.createTextNode(` members (${Math.round(100 * weaker / winds.length)}%)`));
      }
    }
    // one vertical scale for the three panels, so their bar heights compare
    const yMax = Math.max(5, ...hists.map(([, c]) => Math.max(...c)));
    for (const [p, counts] of hists) drawHist(p, counts, yMax, obsMs);
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

  function renderGuess() {
    const storm = player.storm, box = document.getElementById('guess-box');
    box.replaceChildren();
    const letter = m => 'ABC'[storm.order.indexOf(m)];
    const physics = letter('ifsens_e2s'), fgn = letter('fgn'), gencast = letter('gencast_op');
    const g = guesses[storm.hid] || {};
    const redraw = () => { const t = player.t; buildPanels(); player.t = t; scrub.value = Math.round(t); draw(); };
    const finish = skipped => {
      Object.assign(guessOf(storm.hid), { done: true, skipped });
      if (!skipped && chipFor[storm.hid] && !chipFor[storm.hid].querySelector('.done')) chipFor[storm.hid].append(el('span', { class: 'done' }, '✓'));
      redraw();
    };
    const skip = () => { const b = el('button', { class: 'skip', type: 'button' }, 'Show the answer'); b.addEventListener('click', () => finish(true)); return b; };
    const ask = (step, question, hint, letters, onPick) => {
      box.append(el('div', { class: 'step' }, step), el('div', { class: 'q' }, question));
      if (hint) box.append(el('div', { class: 'hint' }, hint));
      const opts = el('div', { class: 'opts' });
      for (const L of letters) {
        const b = el('button', { class: 'btn', type: 'button' }, L);
        b.addEventListener('click', () => onPick(L));
        opts.append(b);
      }
      opts.append(skip());
      box.append(opts);
    };
    const physicsVerdict = () => g.physics === physics ? `Correct: ${physics} is IFS-ENS, ECMWF's physics-based ensemble.`
      : `Not this time: ${physics} is IFS-ENS, ECMWF's physics-based ensemble. You chose ${g.physics}, which is ${NAME[storm.order['ABC'.indexOf(g.physics)]]}.`;

    if (!g.done && g.physics == null) {
      ask('Step 1 of 2', 'Which panel is the physics-based model?', null, 'ABC',
          L => { Object.assign(guessOf(storm.hid), { physics: L, okPhysics: L === physics }); redraw(); });
      return;
    }
    if (!g.done) {
      box.append(el('div', { class: 'verdict' }, physicsVerdict()));
      box.lastChild.style.margin = '0 0 0.9rem';
      const ai = [...'ABC'].filter(L => L !== physics);
      ask('Step 2 of 2', `${ai[0]} and ${ai[1]} are the AI models. Which one is FGN?`,
          'GenCast generates each member by diffusion (iterative denoising). FGN, the newer model, is trained with a probabilistic score (CRPS) and gets its members from perturbations learned by the network.',
          ai, L => { Object.assign(guessOf(storm.hid), { fgn: L, okFgn: L === fgn }); finish(false); });
      return;
    }

    if (g.skipped) {
      box.append(el('div', { class: 'verdict' }, `${physics} is IFS-ENS (physics), ${gencast} is GenCast and ${fgn} is FGN.`));
    } else {
      box.append(el('div', { class: 'verdict' }, physicsVerdict()));
      box.append(el('div', { class: 'verdict' }, g.fgn === fgn
        ? `Correct: ${fgn} is FGN and ${gencast} is GenCast.`
        : `Not this time: ${fgn} is FGN and ${gencast} is GenCast.`));
    }
    const played = Object.values(guesses).filter(x => x.done && !x.skipped);
    if (played.length) {
      const ok = key => played.filter(x => x[key]).length;
      box.append(el('div', { class: 'tally' },
        `Your score so far: physics model found on ${ok('okPhysics')} of ${played.length} storms, FGN and GenCast told apart on ${ok('okFgn')} of ${played.length}.`));
    }
    const table = el('table', { class: 'scores' });
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
    box.append(table);
    const again = el('button', { class: 'btn', type: 'button' }, 'Hide the names again');
    again.style.marginTop = '0.8rem';
    again.addEventListener('click', () => { delete guesses[storm.hid]; chipFor[storm.hid]?.querySelector('.done')?.remove(); redraw(); });
    box.append(again);
  }

  // ---------------------------------------------------------------- 2. explainer
  const ex = { model: 'fgn', marker: null, bwScale: 1, showMean: false };
  const bwInput = document.getElementById('bw'), bwVal = document.getElementById('bw-val');
  bwInput.addEventListener('input', () => { ex.bwScale = +bwInput.value; drawExplain(); });
  document.getElementById('show-mean').addEventListener('change', e => { ex.showMean = e.target.checked; drawExplain(); });
  const exStorm = await loadStorm(EXPLAIN.hid).catch(() => null);
  const exModels = document.getElementById('explain-models');
  const exCanvas = document.getElementById('explain-canvas');
  const exWrap = document.getElementById('explain-wrap');
  const exReadout = document.getElementById('explain-readout');
  if (exStorm) {
    ['fgn', 'gencast_op', 'ifsens_e2s'].forEach(m => {
      const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(m === ex.model) }, NAME[m]);
      b.addEventListener('click', () => {
        ex.model = m;
        exModels.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b)));
        drawExplain();
      });
      exModels.append(b);
    });
    const reset = el('button', { class: 'btn', type: 'button' }, 'Put the dot back on the observed position');
    reset.addEventListener('click', () => { ex.marker = null; drawExplain(); });
    exModels.append(reset);
    const obsNow = posAt(exStorm.obs.map(p => [p[0], p[1], p[2]]), EXPLAIN.hour);
    ex.obs = obsNow;
    ex.storm = { ...exStorm, extent: [obsNow[0] - 16, obsNow[0] + 16, obsNow[1] - 11, obsNow[1] + 13], center: 0 };
    const date = fmtDate(new Date(Date.parse(exStorm.init.replace('Z', ':00Z')) + EXPLAIN.hour * 3600e3));
    document.getElementById('explain-caption').textContent =
      `Hurricane Erin, ${date}, ${(EXPLAIN.hour / 24).toFixed(1)} days after the forecasts started. Dots: member positions; shading: the smoothed density. ` +
      'The smoothing width starts from a fixed rule (Scott\'s rule) and the slider scales it; the paper chooses the width by cross-validation, so the values differ slightly.';
    let dragging = false;
    const setMarker = evt => {
      const r = exCanvas.getBoundingClientRect(), F = ex.frame;
      const x = evt.clientX - r.left, y = evt.clientY - r.top;
      const [lon0, , , lat1] = ex.storm.extent;
      ex.marker = [lon0 + x / F.width * (ex.storm.extent[1] - lon0), lat1 - y / F.height * (lat1 - ex.storm.extent[2])];
      drawExplain();
    };
    exCanvas.addEventListener('pointerdown', e => { dragging = true; exCanvas.setPointerCapture(e.pointerId); setMarker(e); });
    exCanvas.addEventListener('pointermove', e => { if (dragging) setMarker(e); });
    exCanvas.addEventListener('pointerup', () => { dragging = false; });
  }
  function resizeExplain() {
    if (!exStorm) return;
    const dpr = window.devicePixelRatio || 1, width = exWrap.clientWidth;
    ex.frame = mapFrame(ex.storm, width);
    ex.base = basemap(ex.frame, dpr); ex.dpr = dpr;
    exCanvas.width = width * dpr; exCanvas.height = ex.frame.height * dpr;
    exCanvas.style.height = ex.frame.height + 'px';
    drawExplain();
  }
  // km on a plane tangent at the observed position
  function toKm([lon, lat]) {
    const c = Math.cos(ex.obs[1] * Math.PI / 180);
    return [(lon - ex.obs[0]) * 111.2 * c, (lat - ex.obs[1]) * 111.2];
  }
  function kde(pointsKm) {
    const n = pointsKm.length;
    const mean = [d3.mean(pointsKm, p => p[0]), d3.mean(pointsKm, p => p[1])];
    const sd = Math.sqrt((d3.variance(pointsKm, p => p[0]) + d3.variance(pointsKm, p => p[1])) / 2) || 50;
    const h = Math.max(sd * Math.pow(n, -1 / 6), 25) * ex.bwScale;
    const norm = 1 / (n * 2 * Math.PI * h * h);
    return ([x, y]) => {
      let s = 0;
      for (const p of pointsKm) { const dx = x - p[0], dy = y - p[1]; s += Math.exp(-(dx * dx + dy * dy) / (2 * h * h)); }
      return { density: s * norm, h, mean };
    };
  }
  function drawExplain() {
    if (!exStorm || !ex.frame) return;
    const F = ex.frame, ctx = exCanvas.getContext('2d');
    ctx.setTransform(ex.dpr, 0, 0, ex.dpr, 0, 0);
    ctx.drawImage(ex.base, 0, 0, F.width, F.height);
    const members = exStorm.models[ex.model].map(([, pts]) => posAt(pts, EXPLAIN.hour)).filter(Boolean);
    const ptsKm = members.map(toKm);
    const f = ptsKm.length >= 2 ? kde(ptsKm) : null;
    if (f) {
      // density shading on a coarse grid, one hue, alpha proportional to density
      const cell = 6, cols = Math.ceil(F.width / cell), rows = Math.ceil(F.height / cell);
      const [lon0, lon1, lat0, lat1] = ex.storm.extent;
      const vals = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const lon = lon0 + (i + 0.5) * cell / F.width * (lon1 - lon0), lat = lat1 - (j + 0.5) * cell / F.height * (lat1 - lat0);
        vals.push(f(toKm([lon, lat])).density);
      }
      const vmax = d3.max(vals) || 1;
      vals.forEach((v, k) => {
        const a = Math.min(0.75, 0.75 * Math.sqrt(v / vmax));
        if (a < 0.02) return;
        ctx.fillStyle = `rgba(55, 55, 90, ${a})`;
        ctx.fillRect((k % cols) * cell, Math.floor(k / cols) * cell, cell, cell);
      });
    }
    for (const [lon, lat] of members) {
      ctx.beginPath(); ctx.arc(F.X(lon), F.Y(lat), 3.2, 0, 2 * Math.PI);
      ctx.fillStyle = COLOR[ex.model]; ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    // observed position (ring) and draggable marker (dot)
    ctx.beginPath(); ctx.arc(F.X(ex.obs[0]), F.Y(ex.obs[1]), 7, 0, 2 * Math.PI);
    ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    if (ex.showMean && members.length) {
      const mlon = d3.mean(members, p => p[0]), mlat = d3.mean(members, p => p[1]);
      const x = F.X(mlon), y = F.Y(mlat);
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke();
    }
    const m = ex.marker || ex.obs;
    ctx.beginPath(); ctx.arc(F.X(m[0]), F.Y(m[1]), 6, 0, 2 * Math.PI);
    ctx.fillStyle = INK; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();

    const at = p => f ? -Math.log(Math.max(f(toKm(p)).density, 1e-300)) : NaN;
    const nllMarker = at(m), nllObs = at(ex.obs);
    const i = exStorm.nll_t.indexOf(EXPLAIN.hour);
    const paper = i >= 0 ? exStorm.nll[ex.model][i] : null;
    const distKm = f ? Math.hypot(...f([0, 0]).mean) : NaN;
    exReadout.replaceChildren();
    const block = (label, big, small) => {
      const d = el('div', { class: 'row' });
      d.append(el('div', { class: 'lbl' }, label), el('div', { class: 'big' }, big));
      if (small) d.append(el('div', {}, small));
      exReadout.append(d);
    };
    block('NLL at the black dot', isFinite(nllMarker) ? nllMarker.toFixed(2) : '–',
      ex.marker ? 'Drag it back towards the members and the score drops.' : 'The dot is on the observed position of Erin. Drag it.');
    block('NLL at the observed position', isFinite(nllObs) ? nllObs.toFixed(2) : '–',
      paper != null ? `In the paper, at this time: ${paper.toFixed(2)}.` : '');
    bwVal.textContent = f ? `${Math.round(f([0, 0]).h)} km` : '–';
    block(`${NAME[ex.model]} at this time`, `${members.length} / ${N_MEMBERS}`,
      `members find the storm. Their mean position${ex.showMean ? ' (the cross)' : ''} is ${Math.round(distKm)} km from the observed one.`);
  }
  resizeExplain();

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
      .forEach(([v, k]) => { const d = el('div', { class: 'stat' }); d.append(el('div', { class: 'v' }, v), el('div', { class: 'k' }, k)); stats.append(d); });
    const share = Object.fromEntries(MODELS.map(m => [m, list.filter(s => s.winner === m).length]));
    const bar = document.getElementById('sharebar'), leg = document.getElementById('sharelegend');
    bar.replaceChildren(); leg.replaceChildren();
    document.querySelector('#sharebar').previousElementSibling.textContent = `Lowest NLL of the three models, share of the ${nStorms} storms`;
    ['fgn', 'gencast_op', 'ifsens_e2s'].forEach(m => {
      if (!share[m]) return;
      const d = el('div', {}, share[m] / nStorms >= 0.12 ? `${NAME[m]} ${Math.round(100 * share[m] / nStorms)}%` : '');
      d.style.flex = String(share[m]); d.style.background = COLOR[m];
      d.addEventListener('pointermove', e => showTip(e, NAME[m], [['storms with the lowest NLL', `${share[m]} of ${nStorms}`, COLOR[m]]]));
      d.addEventListener('pointerleave', hideTip);
      bar.append(d);
    });
    ['fgn', 'gencast_op', 'ifsens_e2s'].forEach(m => {
      const l = el('span'); const sw = el('span', { class: 'swatch' }); sw.style.background = COLOR[m]; sw.style.height = '8px'; sw.style.width = '12px';
      l.append(sw, document.createTextNode(`${NAME[m]}: ${share[m]} storm${share[m] === 1 ? '' : 's'}`)); leg.append(l);
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

  // ---------------------------------------------------------------- 4. intensity
  Promise.all(['intensity_bias', 'pressure_wind'].map(n => fetch(`data/${n}.json`).then(r => r.ok ? r.json() : null).catch(() => null)))
    .then(([bias, pw]) => {
      if (!window.BlogIntensity) return;
      if (bias) window.BlogIntensity.renderBias(document.getElementById('bias-chart'), bias);
      if (pw) window.BlogIntensity.renderPressureWind(document.getElementById('pw-chart'), pw);
    });

  selectStorm(ordered[0].hid, false);
})();
