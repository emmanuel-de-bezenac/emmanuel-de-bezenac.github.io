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
  const BLIND = '#d9480f', OCEAN = '#eef3f7', LAND = '#dcdad5', COAST = '#a9a6a0', INK = '#111111';
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
  function showTip(evt, title, rows) {
    tooltip.replaceChildren(el('div', { class: 't' }, title));
    for (const [label, value, color] of rows) {
      const r = el('div', { class: 'r' });
      const l = el('span');
      if (color) { const s = el('span', { class: 'swatch' }); s.style.background = color; l.append(s); }
      l.append(document.createTextNode(label));
      r.append(l, el('b', {}, value));
      tooltip.append(r);
    }
    tooltip.style.display = 'block';
    const x = Math.min(evt.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8);
    const y = Math.min(evt.clientY + 14, window.innerHeight - tooltip.offsetHeight - 8);
    tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
  }
  const hideTip = () => { tooltip.style.display = 'none'; };

  const [index, world] = await Promise.all([
    fetch('data/storms.json').then(r => r.json()),
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json').then(r => r.json()),
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
  const guesses = {};      // hid -> letter guessed
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

  // wind colour: one hue (orange), light to dark, over 10-45 m/s
  const WIND_MIN = 10, WIND_MAX = 45;
  const windColor = w => w == null ? '#bbb' : d3.interpolateOranges(0.3 + 0.7 * Math.max(0, Math.min(1, (w - WIND_MIN) / (WIND_MAX - WIND_MIN))));
  const windBtn = document.getElementById('windmode'), windKey = document.getElementById('windkey');
  {
    const ramp = document.getElementById('windramp');
    const bar = el('i'); bar.style.background = `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1).map(f => windColor(WIND_MIN + f * (WIND_MAX - WIND_MIN))).join(',')})`;
    ramp.append(el('span', {}, `${WIND_MIN} m/s`), bar, el('span', {}, `${WIND_MAX} m/s or more`));
  }
  windBtn.addEventListener('click', () => {
    player.wind = !player.wind;
    windBtn.setAttribute('aria-pressed', String(player.wind));
    windKey.hidden = !player.wind;
    draw();
  });
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
    const revealed = guesses[storm.hid] != null;
    storm.order.forEach((m, i) => {
      const letter = 'ABC'[i];
      const cell = el('div');
      const head = el('div', { class: 'panel-head' }, letter);
      if (revealed) {
        const who = el('span', { class: 'who' }, NAME[m]);
        who.style.color = COLOR[m];
        who.append(el('span', { class: 'kind' }, KIND[m]));
        head.append(who);
      }
      const wrapEl = el('div', { class: 'map-wrap' });
      const canvas = el('canvas');
      const info = el('div', { class: 'infobox' });
      wrapEl.append(canvas, info);
      cell.append(head, wrapEl);
      root.append(cell);
      player.panels.push({ model: m, canvas, info, wrapEl });
    });
    const clock = el('div', { class: 'clock' });
    player.clock = {
      day: el('div', { class: 'day' }), date: el('div', { class: 'date' }),
      obs: el('div', { class: 'obs' }), caption: el('div', { class: 'caption' }),
    };
    const title = el('div', { class: 'date' });
    title.style.fontWeight = '600'; title.style.color = 'var(--text)';
    title.textContent = storm.title || `${storm.name}, ${storm.init.slice(0, 4)}`;
    const impact = el('div', { class: 'caption' }, storm.impact || '');
    impact.style.minHeight = '0'; impact.style.color = '#b02a1a';
    const legend = el('div', { class: 'legend' });
    const l1 = el('div'); l1.append(el('span', { class: 'key-line' }), document.createTextNode(`${storm.name}, observed`));
    const l2 = el('div'); const dot = el('span', { class: 'key-dot' });
    if (revealed) dot.style.background = 'var(--text-3)';
    l2.append(dot, document.createTextNode('storm centre in one member'));
    const l3 = el('div', {}, `Forecasts started ${fmtDate(new Date(storm.init.replace('Z', ':00Z')))}`);
    legend.append(l1, l2, l3);
    const colA = el('div'), colB = el('div'), colC = el('div');
    colA.append(title, impact, legend);
    colB.append(player.clock.day, player.clock.date, player.clock.obs);
    colC.append(player.clock.caption);
    clock.append(colA, colB, colC);
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
      p.base = base; p.dpr = dpr;
    }
    draw();
  }
  window.addEventListener('resize', () => { resizePlayer(); resizeExplain(); });

  function draw() {
    const storm = player.storm, t = player.t, F = player.frame;
    if (!storm || !F) return;
    const revealed = guesses[storm.hid] != null;
    const obsPts = storm.obs.map(p => [p[0], p[1], p[2]]);
    for (const p of player.panels) {
      const ctx = p.canvas.getContext('2d');
      ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
      ctx.drawImage(p.base, 0, 0, F.width, F.height);
      const color = revealed ? COLOR[p.model] : BLIND;
      const members = new Set(), dots = [];
      ctx.lineWidth = 0.8; ctx.strokeStyle = color; ctx.globalAlpha = 0.35;
      for (const tr of player.tracks[p.model]) {
        const pts = tr.pts;
        if (!pts.length || pts[0][0] > t) continue;
        ctx.beginPath();
        let prevX = null;
        for (const q of pts) {
          if (q[0] > t) break;
          const x = F.X(q[1]), y = F.Y(q[2]);
          if (prevX == null || Math.abs(x - prevX) > F.width / 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          prevX = x;
        }
        const now = posAt(pts, t);
        if (now) {
          const x = F.X(now[0]), y = F.Y(now[1]);
          if (prevX != null && Math.abs(x - prevX) <= F.width / 2) ctx.lineTo(x, y);
          dots.push([x, y, now[2]]); members.add(tr.mb);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 0.9;
      for (const [x, y, w] of dots) {
        ctx.beginPath(); ctx.arc(x, y, player.wind ? 3.6 : 3, 0, 2 * Math.PI);
        ctx.fillStyle = player.wind ? windColor(w) : color; ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // observed track
      ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = INK;
      let prevX = null, last = null;
      for (const q of obsPts) {
        if (q[0] > t) break;
        const x = F.X(q[1]), y = F.Y(q[2]);
        if (prevX == null || Math.abs(x - prevX) > F.width / 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        prevX = x; last = [x, y];
      }
      const o = posAt(obsPts, t);
      if (o) { const x = F.X(o[0]), y = F.Y(o[1]); if (prevX != null && Math.abs(x - prevX) <= F.width / 2) ctx.lineTo(x, y); last = [x, y]; }
      ctx.stroke();
      if (last && o) {
        ctx.beginPath(); ctx.arc(last[0], last[1], 5, 0, 2 * Math.PI);
        ctx.fillStyle = INK; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
      // infobox
      const n = members.size;
      const scored = storm.nll_t.map((h, i) => [h, storm.nll[p.model][i]]).filter(([h, v]) => h <= t && v != null);
      const nll = scored.length ? (scored.reduce((a, [, v]) => a + v, 0) / scored.length).toFixed(2) : '–';
      p.info.replaceChildren(
        document.createTextNode('storm found in '), el('b', {}, `${n} of ${N_MEMBERS}`),
        document.createTextNode(` members (${Math.round(100 * n / N_MEMBERS)}%)`), el('br'),
        document.createTextNode('track NLL so far: '), el('b', {}, nll));
    }
    const c = player.clock;
    c.day.textContent = `Day ${(t / 24).toFixed(1)}`;
    c.date.textContent = fmtDate(new Date(Date.parse(storm.init.replace('Z', ':00Z')) + t * 3600e3));
    const kt = obsWindAt(storm.obs, t);
    c.obs.textContent = kt == null ? '' : `Observed: ${category(kt)}, ${Math.round(kt)} kt`;
    const ev = storm.events.filter(e => e[0] <= t).pop();
    c.caption.textContent = ev ? ev[1] : '';
  }

  function renderGuess() {
    const storm = player.storm, box = document.getElementById("guess-box");
    box.replaceChildren();
    const physics = 'ABC'[storm.order.indexOf('ifsens_e2s')];
    const g = guesses[storm.hid];
    if (g == null) {
      box.append(el('div', { class: 'q' }, 'Which panel is the physics-based model?'));
      const opts = el('div', { class: 'opts' });
      for (const L of 'ABC') {
        const b = el('button', { class: 'btn', type: 'button' }, L);
        b.addEventListener('click', () => {
          guesses[storm.hid] = L;
          if (chipFor[storm.hid] && !chipFor[storm.hid].querySelector('.done')) chipFor[storm.hid].append(el('span', { class: 'done' }, '✓'));
          const t = player.t; buildPanels(); player.t = t; scrub.value = Math.round(t); draw();
        });
        opts.append(b);
      }
      box.append(opts);
      return;
    }
    box.append(el('div', { class: 'verdict' },
      g === physics ? `Correct: ${physics} is IFS-ENS, ECMWF's physics-based ensemble.`
                    : `Not this time: ${physics} is IFS-ENS, ECMWF's physics-based ensemble. You chose ${g}, which is ${NAME[storm.order['ABC'.indexOf(g)]]}.`));
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
    again.addEventListener('click', () => { delete guesses[storm.hid]; const t = player.t; buildPanels(); player.t = t; draw(); });
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
