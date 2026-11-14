/* Punkteverlauf als Liniendiagramm (SVG, mit Fadenkreuz-Tooltip) */
'use strict';

// Kategoriale Farben in fester Reihenfolge je Sitzplatz (dunkle Fläche #1a1a19)
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];

function chartHtml(g) {
  return `<section class="viz-root" data-chart="${g.id}">
    <h3>Punkteverlauf</h3>
    <div class="viz-legend"></div>
    <div class="viz-plot"></div>
  </section>`;
}

function mountCharts() {
  document.querySelectorAll('[data-chart]').forEach(root => {
    const g = db.games.find(x => x.id === root.dataset.chart);
    if (g && g.rounds.length) drawChart(root, g);
  });
}

function niceStep(span, target) {
  const raw = span / target, pow = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw);
}

function drawChart(root, g) {
  const c = calcGame(g), n = c.n, R = c.rows.length;
  const series = g.playerIds.map((id, i) => ({ name: pName(id), color: SERIES[i], vals: [0].concat(c.rows.map(r => r.c[i])) }));
  const plot = root.querySelector('.viz-plot'), legend = root.querySelector('.viz-legend');
  const W = Math.max(280, plot.clientWidth), H = 250, m = { l: 40, r: 14, t: 10, b: 26 };
  const all = series.flatMap(s => s.vals);
  const step = niceStep(Math.max(Math.max(...all) - Math.min(...all), 40), 5);
  const y0 = Math.floor(Math.min(0, ...all) / step) * step, y1 = Math.ceil(Math.max(...all, 20) / step) * step;
  const X = r => m.l + (W - m.l - m.r) * r / R;
  const Y = v => m.t + (H - m.t - m.b) * (1 - (v - y0) / (y1 - y0));

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Punkteverlauf pro Runde">`;
  for (let v = y0; v <= y1; v += step)
    svg += `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>
      <text class="tick" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  const xs = Math.max(1, Math.ceil(R / (W < 420 ? 5 : 10)));
  for (let r = 0; r <= R; r += xs) svg += `<text class="tick" x="${X(r)}" y="${H - 8}" text-anchor="middle">${r}</text>`;
  svg += `<line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
  for (const s of series) {
    svg += `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
      points="${s.vals.map((v, r) => X(r).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}"/>`;
  }
  for (const s of series)
    svg += `<circle class="dot" cx="${X(R)}" cy="${Y(s.vals[R])}" r="4" fill="${s.color}"/>`;
  svg += '</svg><div class="viz-tip" hidden></div>';
  plot.innerHTML = svg;

  // Legende: Linien-Schlüssel + Name + Endstand (Text in Textfarbe, nicht in Serienfarbe)
  legend.textContent = '';
  series.forEach(s => {
    const item = document.createElement('span'), key = document.createElement('i'), val = document.createElement('b');
    item.className = 'viz-li'; key.style.background = s.color;
    val.textContent = s.vals[R];
    item.append(key, document.createTextNode(s.name + ' '), val);
    legend.appendChild(item);
  });

  const el = plot.querySelector('svg'), cross = plot.querySelector('.cross'), tip = plot.querySelector('.viz-tip');
  const show = ev => {
    const box = el.getBoundingClientRect();
    const r = Math.max(0, Math.min(R, Math.round((ev.clientX - box.left - m.l) / (W - m.l - m.r) * R)));
    cross.setAttribute('x1', X(r)); cross.setAttribute('x2', X(r)); cross.setAttribute('visibility', 'visible');
    tip.textContent = '';
    const head = document.createElement('div');
    head.className = 'viz-tip-h';
    head.textContent = r === 0 ? 'Start' : 'Nach Runde ' + r;
    tip.appendChild(head);
    series.slice().sort((a, b) => b.vals[r] - a.vals[r]).forEach(s => {
      const row = document.createElement('div'), key = document.createElement('i'), val = document.createElement('b');
      key.style.background = s.color;
      val.textContent = s.vals[r];
      row.append(key, val, document.createTextNode(' ' + s.name));
      tip.appendChild(row);
    });
    tip.hidden = false;
    const left = X(r) > W / 2 ? X(r) - tip.offsetWidth - 10 : X(r) + 10;
    tip.style.left = Math.max(0, left) + 'px';
  };
  el.addEventListener('pointermove', show);
  el.addEventListener('pointerdown', show);
  el.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}
