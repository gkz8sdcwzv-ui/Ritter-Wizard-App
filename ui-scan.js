/* Alte Blöcke einscannen: Foto → Texterkennung (läuft im Browser) → Kontrollansicht → Partie speichern.
   Auf dem Block stehen pro Runde die Ansage und die laufende Gesamtpunktzahl. Die Stiche stehen nicht drauf;
   sie werden aus beidem zurückgerechnet (Punkte-Differenz + "alle Stiche einer Runde = Kartenzahl"). */
'use strict';

const SCAN_NAMES = { C: 'Carl', E: 'Eric', S: 'Sandra', A: 'Andreas' };   // Buchstabe auf dem Block → Spieler
const SCAN_ROUNDS = 15;                                                   // immer 4 Spieler
const SCAN_VENDOR = 'vendor/tesseract/';

/* M steht für Mama = Sandra, P für Papa = Andreas */
function scanLetter(ch) {
  ch = String(ch || '').trim().toUpperCase();
  if (ch === 'M') ch = 'S';
  if (ch === 'P') ch = 'A';
  return SCAN_NAMES[ch] ? ch : null;
}

/* ---------- Rückrechnen der Stiche ---------- */

const scanInt = v => /^-?\d{1,4}$/.test(String(v).trim()) ? parseInt(v, 10) : null;

/* prev/scores: Gesamtpunkte vor bzw. nach der Runde, bids: Ansagen (alles Zahlen oder null).
   Liefert { sols: [[Stiche je Spieler], …] } oder { sols: [], why } */
function scanSolveRound(cards, prev, bids, scores) {
  const cand = [];
  for (let i = 0; i < prev.length; i++) {
    const b = bids[i], s = scores[i];
    if (b === null || s === null) return { sols: [], why: 'unvollständig' };
    if (b < 0 || b > cards) return { sols: [], why: 'bid', who: i };
    const d = s - prev[i];
    let c = [];
    if (d === 20 + 10 * b) c = [b];
    else if (d < 0 && d % 10 === 0) c = [b - (-d / 10), b + (-d / 10)].filter(t => t >= 0 && t <= cards);
    if (!c.length) return { sols: [], why: 'score', who: i };
    cand.push(c);
  }
  let sols = [[]];
  for (const c of cand) sols = sols.flatMap(s => c.map(t => s.concat(t)));
  sols = sols.filter(s => s.reduce((a, b) => a + b, 0) === cards);
  return sols.length ? { sols } : { sols: [], why: 'sum' };
}

/* Wertet den ganzen Block aus: pro Runde Status und gewählte Lösung */
function scanAnalyze(sc) {
  const prev = [0, 0, 0, 0], res = [];
  let last = -1, gap = false;
  sc.cells.forEach((c, r) => {
    const vals = c.b.concat(c.s);
    const filled = vals.filter(v => String(v).trim() !== '').length;
    if (filled) { if (r - last > 1) gap = true; last = r; }
  });
  for (let r = 0; r < SCAN_ROUNDS; r++) {
    const c = sc.cells[r], bids = c.b.map(scanInt), scores = c.s.map(scanInt);
    const any = c.b.concat(c.s).some(v => String(v).trim() !== '');
    if (!any || r > last) { res.push({ state: 'empty' }); continue; }
    const out = scanSolveRound(r + 1, prev, bids, scores);
    if (!out.sols.length) res.push({ state: out.why === 'unvollständig' ? 'incomplete' : 'bad', why: out.why, who: out.who });
    else {
      const pick = Math.min(c.pick || 0, out.sols.length - 1);
      res.push({ state: out.sols.length > 1 ? 'ambiguous' : 'ok', sols: out.sols, pick, tricks: out.sols[pick], b: bids, s: scores });
    }
    if (scores.every(s => s !== null)) scores.forEach((s, i) => { prev[i] = s; });   // ein Fehler soll nicht alle Folgerunden verfälschen
  }
  const ok = res.slice(0, last + 1).every(x => x.state === 'ok' || x.state === 'ambiguous');
  return { rows: res, last, rounds: last + 1, ok: ok && last >= 0 && !gap, gap, totals: prev.slice() };
}

/* ---------- Spalten-Köpfe & Zahlen aus der Texterkennung ---------- */

const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/* words: [{ text, bbox:{x0,y0,x1,y1} }] → { cols:[Buchstabe×4]|null, cells:[{b[4],s[4]}…], found } */
function scanParse(words) {
  const toks = words.map(w => ({
    t: String(w.text).replace(/[−–—]/g, '-').trim(),
    x: (w.bbox.x0 + w.bbox.x1) / 2, y: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0
  })).filter(t => t.t);
  const nums = toks.filter(t => /^-?\d{1,4}$/.test(t.t)).map(t => Object.assign({ v: parseInt(t.t, 10) }, t));
  const empty = { cols: null, cells: Array.from({ length: SCAN_ROUNDS }, () => ({ b: ['', '', '', ''], s: ['', '', '', ''] })), found: 0 };
  if (nums.length < 8) return empty;

  const mh = median(nums.map(n => n.h)), minY = Math.min(...nums.map(n => n.y));
  let heads = toks.filter(t => /^[A-Za-z]$/.test(t.t) && scanLetter(t.t) && t.y < minY + 0.5 * mh);
  if (heads.length > 4) heads = heads.sort((a, b) => b.h - a.h).slice(0, 4);
  if (heads.length !== 4) return empty;
  heads.sort((a, b) => a.x - b.x);
  const spacing = median(heads.slice(1).map((h, i) => h.x - heads[i].x));
  if (!(spacing > 0)) return empty;
  const cols = heads.map(h => scanLetter(h.t));

  const rowsY = [];                                     // Zeilen: Zahlen mit ähnlicher Höhe zusammenfassen
  nums.slice().sort((a, b) => a.y - b.y).forEach(n => {
    const row = rowsY[rowsY.length - 1];
    if (row && n.y - row.y < 1.2 * mh) { row.items.push(n); row.y = row.items.reduce((a, b) => a + b.y, 0) / row.items.length; }
    else rowsY.push({ y: n.y, items: [n] });
  });

  const out = { cols, cells: empty.cells, found: 0 };
  rowsY.slice(0, SCAN_ROUNDS).forEach((row, r) => {
    const per = [[], [], [], []];
    row.items.forEach(n => {
      const ci = Math.round((n.x - heads[0].x) / spacing);
      if (ci >= 0 && ci < 4 && Math.abs(n.x - (heads[0].x + ci * spacing)) < 0.7 * spacing) per[ci].push(n);
    });
    per.forEach((list, i) => {
      list.sort((a, b) => b.h - a.h);
      let score = null, bid = null;
      if (list.length >= 2) { score = list[0]; bid = list[1]; }
      else if (list.length === 1) { const n = list[0]; if (n.v < 0 || n.v > 15 || n.h >= 0.9 * mh) score = n; else bid = n; }
      if (score) { out.cells[r].s[i] = String(score.v); out.found++; }
      if (bid) { out.cells[r].b[i] = String(bid.v); out.found++; }
    });
  });
  return out;
}

/* ---------- Zustand & Oberfläche ---------- */

function newScan() {
  return {
    step: 'start', img: null, zoom: false, busy: '', msg: '', date: new Date().toISOString().slice(0, 10),
    cols: ['C', 'E', 'S', 'A'], ocr: {},         // ocr: 'r-i-f' → true (von der Erkennung, noch ungeprüft)
    cells: Array.from({ length: SCAN_ROUNDS }, () => ({ b: ['', '', '', ''], s: ['', '', '', ''], pick: 0 }))
  };
}

function scanStatusHtml(a, r) {
  const x = a.rows[r];
  const name = i => esc(SCAN_NAMES[ui.scan.cols[i]] || '?');
  switch (x.state) {
    case 'ok': return `<span class="sok">✓ Stiche ${x.tricks.join(' · ')}</span>`;
    case 'ambiguous': return `<span class="swarn">⚠ ${x.pick + 1}/${x.sols.length} möglich: Stiche ${x.tricks.join(' · ')}
      <button class="mini" data-act="scanCycle" data-r="${r}">andere</button></span>`;
    case 'incomplete': return '<span class="sbad">noch Felder offen</span>';
    case 'bad': return `<span class="sbad">✗ ${x.why === 'bid' ? `Ansage von ${name(x.who)} größer als Kartenzahl`
      : x.why === 'score' ? `Punkte von ${name(x.who)} passen nicht zur Ansage`
      : 'Stiche ergeben nicht ' + (r + 1) + ' – Zahlen prüfen'}</span>`;
    default: return '';
  }
}

function scanSummaryHtml(a) {
  const sc = ui.scan;
  if (a.last < 0) return '<p class="hint center">Noch nichts eingetragen.</p>';
  const amb = a.rows.filter(x => x.state === 'ambiguous').length, bad = a.rows.filter(x => x.state === 'bad' || x.state === 'incomplete').length;
  const order = [0, 1, 2, 3].sort((p, q) => a.totals[q] - a.totals[p]);
  return `<p class="estatus">${a.rounds} von ${SCAN_ROUNDS} Runden${a.rounds < SCAN_ROUNDS ? ' – wird als abgebrochene Partie gespeichert' : ''}
    ${bad ? `· <b class="sbad">${bad} Runde(n) prüfen</b>` : a.gap ? '· <b class="sbad">Lücke zwischen den Runden</b>' : '· alles stimmig ✓'}
    ${amb ? `· ${amb}× mehrdeutig (Stiche geraten)` : ''}</p>
    <p class="estatus">${order.map(i => `${esc(SCAN_NAMES[sc.cols[i]] || '?')} <b>${a.totals[i]}</b>`).join(' · ')}</p>`;
}

function scanHtml() {
  const sc = ui.scan;
  if (sc.step === 'start') return `
  <button class="link back" data-act="scanCancel">← Zurück</button>
  <section class="card">
    <h2>📷 Alten Block einscannen</h2>
    <p class="hint">Mach ein gerades Foto vom ganzen Block (bei gutem Licht, Spaltenköpfe <b>C, E, M/S, P/A</b> mit drauf). Die Texterkennung läuft komplett auf deinem Gerät – das Foto wird nirgends hochgeladen.</p>
    <p class="hint">Handschrift erkennt sie nur mit Fehlern. Deshalb prüfst du danach alles in einer Tabelle neben dem Foto; die App rechnet mit und zeigt dir, wo etwas nicht passt.</p>
    ${sc.busy ? `<p class="estatus" id="scanBusy">⏳ ${esc(sc.busy)}</p>` : `
    <label class="btn gold big filebtn">📷 Foto aufnehmen oder auswählen
      <input type="file" id="scanFile" accept="image/*" data-scan="file" hidden></label>
    <button class="link" data-act="scanManual">Ohne Foto von Hand eintragen</button>`}
    ${sc.msg ? `<p class="estatus sbad">${esc(sc.msg)}</p>` : ''}
  </section>`;

  const a = scanAnalyze(sc), opts = k => Object.keys(SCAN_NAMES).map(l => `<option value="${l}" ${l === k ? 'selected' : ''}>${esc(SCAN_NAMES[l])}</option>`).join('');
  let grid = '';
  for (let r = 0; r < SCAN_ROUNDS; r++) {
    const c = sc.cells[r];
    grid += `<div class="srow"><span class="srn">${r + 1}</span>${[0, 1, 2, 3].map(i => `
      <input class="sb ${sc.ocr[`${r}-${i}-b`] ? 'ocr' : ''}" data-scan="cell" data-r="${r}" data-i="${i}" data-f="b" value="${esc(c.b[i])}" inputmode="numeric" maxlength="2" aria-label="Runde ${r + 1} Ansage ${SCAN_NAMES[sc.cols[i]]}" autocomplete="off">
      <input class="ss ${sc.ocr[`${r}-${i}-s`] ? 'ocr' : ''}" data-scan="cell" data-r="${r}" data-i="${i}" data-f="s" value="${esc(c.s[i])}" inputmode="text" maxlength="5" aria-label="Runde ${r + 1} Punkte ${SCAN_NAMES[sc.cols[i]]}" autocomplete="off">`).join('')}</div>
      <div class="sst" id="sst-${r}">${scanStatusHtml(a, r)}</div>`;
  }
  return `
  <button class="link back" data-act="scanCancel">← Abbrechen</button>
  <section class="card scan">
    <h2>📷 Block prüfen</h2>
    ${sc.img ? `<img class="scanimg ${sc.zoom ? 'zoom' : ''}" src="${sc.img}" alt="Foto des Blocks" data-act="scanZoom"><p class="hint center">Foto antippen zum Vergrößern.</p>` : ''}
    ${sc.msg ? `<p class="estatus">${esc(sc.msg)}</p>` : ''}
    <p class="hint">Je Spieler: <b>Ansage</b> (klein) und <b>Gesamtpunkte</b> nach der Runde. Goldgestrichelte Felder wurden erkannt und sind noch ungeprüft.</p>
    <label class="datefield">Datum der Partie <input type="date" data-scan="date" value="${esc(sc.date)}"></label>
    <div class="sgrid">
      <div class="srow shead"><span class="srn"></span>${[0, 1, 2, 3].map(i => `<span class="shc"><select data-scan="col" data-i="${i}">${opts(sc.cols[i])}</select></span>`).join('')}</div>
      ${grid}
    </div>
    <div id="scanSummary">${scanSummaryHtml(a)}</div>
    <div class="btnrow"><button class="btn gold big" id="scanSave" data-act="scanSave" ${a.ok && new Set(sc.cols).size === 4 ? '' : 'disabled'}>Partie speichern</button></div>
  </section>`;
}

/* Während des Tippens nur Status und Zusammenfassung aktualisieren – so verliert das Feld nicht den Fokus */
function scanRefresh() {
  const sc = ui.scan, a = scanAnalyze(sc);
  for (let r = 0; r < SCAN_ROUNDS; r++) { const el = $('#sst-' + r); if (el) el.innerHTML = scanStatusHtml(a, r); }
  const s = $('#scanSummary'); if (s) s.innerHTML = scanSummaryHtml(a);
  const b = $('#scanSave'); if (b) b.disabled = !(a.ok && new Set(sc.cols).size === 4);
}

document.addEventListener('input', e => {
  const el = e.target, sc = ui.scan;
  if (!sc || !el.dataset || !el.dataset.scan) return;
  if (el.dataset.scan === 'cell') {
    sc.cells[+el.dataset.r][el.dataset.f === 'b' ? 'b' : 's'][+el.dataset.i] = el.value.trim();
    sc.cells[+el.dataset.r].pick = 0;
    delete sc.ocr[`${el.dataset.r}-${el.dataset.i}-${el.dataset.f}`];
    el.classList.remove('ocr');
  } else if (el.dataset.scan === 'col') sc.cols[+el.dataset.i] = el.value;
  else if (el.dataset.scan === 'date') sc.date = el.value;
  else return;
  scanRefresh();
});
document.addEventListener('change', e => {
  const el = e.target;
  if (ui.scan && el.dataset && el.dataset.scan === 'file' && el.files && el.files[0]) scanStart(el.files[0]);
});

/* ---------- Foto & Texterkennung ---------- */

function scanLoadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Die Texterkennung konnte nicht geladen werden.'));
    document.head.appendChild(s);
  });
}

function scanPrepare(file) {                 // Foto verkleinern, Graustufen, Kontrast strecken
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Das Foto konnte nicht gelesen werden.')); };
    img.onload = () => {
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      const view = document.createElement('canvas'), vk = Math.min(1, 1100 / cv.width);
      view.width = Math.round(cv.width * vk); view.height = Math.round(cv.height * vk);
      view.getContext('2d').drawImage(cv, 0, 0, view.width, view.height);
      const px = g.getImageData(0, 0, cv.width, cv.height), d = px.data, hist = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10 | 0; d[i] = y; hist[y]++; }
      const n = d.length / 4; let lo = 0, hi = 255, acc = 0;
      while (lo < 255 && (acc += hist[lo]) < n * 0.02) lo++;
      acc = 0; while (hi > 0 && (acc += hist[hi]) < n * 0.02) hi--;
      const span = Math.max(40, hi - lo);
      for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, (d[i] - lo) * 255 / span)); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      g.putImageData(px, 0, 0);
      res({ canvas: cv, preview: view.toDataURL('image/jpeg', 0.8) });
    };
    img.src = url;
  });
}

async function scanStart(file) {
  const sc = ui.scan;
  const busy = t => { sc.busy = t; const el = $('#scanBusy'); if (el) el.textContent = '⏳ ' + t; else render(); };
  sc.msg = ''; busy('Foto wird vorbereitet …');
  let words = null;
  try {
    const prep = await scanPrepare(file);
    sc.img = prep.preview;
    busy('Texterkennung wird geladen (beim ersten Mal ca. 20 MB) …');
    await scanLoadScript(SCAN_VENDOR + 'tesseract.min.js');
    const base = new URL(SCAN_VENDOR, location.href).href.replace(/\/$/, '');   // volle Adresse, sonst findet der Worker die Dateien nicht
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: base + '/worker.min.js', corePath: base, langPath: base, gzip: true,
      logger: m => { if (m.status === 'recognizing text') busy(`Block wird gelesen … ${Math.round((m.progress || 0) * 100)} %`); }
    });
    await worker.setParameters({ tessedit_char_whitelist: '0123456789-CEMSPA', tessedit_pageseg_mode: '11' });
    busy('Block wird gelesen …');
    const { data } = await worker.recognize(prep.canvas);
    await worker.terminate();
    words = data.words || (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)));
  } catch (e) {
    sc.msg = (e && e.message ? e.message : 'Die Erkennung ist fehlgeschlagen.') + ' Du kannst die Werte trotzdem von Hand eintragen.';
  }
  sc.busy = ''; sc.step = 'review';
  if (words) {
    const p = scanParse(words);
    if (p.cols) sc.cols = p.cols;
    p.cells.forEach((c, r) => [0, 1, 2, 3].forEach(i => {
      if (c.b[i] !== '') { sc.cells[r].b[i] = c.b[i]; sc.ocr[`${r}-${i}-b`] = true; }
      if (c.s[i] !== '') { sc.cells[r].s[i] = c.s[i]; sc.ocr[`${r}-${i}-s`] = true; }
    }));
    sc.msg = p.found
      ? `${p.found} Werte erkannt${p.cols ? '' : ' (Spaltenköpfe nicht sicher – Spieler oben prüfen)'}. Bitte alle goldgestrichelten Felder mit dem Foto vergleichen.`
      : 'Es konnte nichts sicher gelesen werden (Spaltenköpfe oder Zahlen nicht erkannt). Trag die Werte mit Hilfe des Fotos von Hand ein.';
  }
  render(); window.scrollTo(0, 0);
}

/* ---------- Aktionen ---------- */

ACT.scanOpen = () => { ui.scan = newScan(); ui.histGid = null; render(); window.scrollTo(0, 0); };
ACT.scanCancel = () => {
  const sc = ui.scan;
  if (sc && sc.step === 'review' && (sc.img || sc.cells.some(c => c.b.concat(c.s).some(v => v !== ''))) && !confirm('Eingaben verwerfen?')) return;
  ui.scan = null; render(); window.scrollTo(0, 0);
};
ACT.scanManual = () => { ui.scan.step = 'review'; ui.scan.msg = ''; render(); };
ACT.scanZoom = () => { ui.scan.zoom = !ui.scan.zoom; render(); };
ACT.scanCycle = d => {
  const c = ui.scan.cells[+d.r], a = scanAnalyze(ui.scan), x = a.rows[+d.r];
  c.pick = ((x.pick || 0) + 1) % x.sols.length;
  scanRefresh();
};

ACT.scanSave = () => {
  const sc = ui.scan, a = scanAnalyze(sc);
  if (!a.ok || new Set(sc.cols).size !== 4) return;
  const ids = sc.cols.map(k => addPlayer(SCAN_NAMES[k]).id);
  const started = new Date(sc.date + 'T12:00:00').getTime() || Date.now();
  const done = a.rounds === SCAN_ROUNDS;
  const g = {
    id: uid(), started, ended: started + 5400000, status: done ? 'finished' : 'aborted', imported: true,
    playerIds: ids, total: SCAN_ROUNDS, pending: null, firstDealer: 0, opt: { noEven: false },
    rounds: a.rows.slice(0, a.rounds).map(x => ({ b: x.b, t: x.tricks }))
  };
  db.games.push(g);
  db.games.sort((p, q) => p.started - q.started);
  saveDb();
  ui.scan = null; ui.histGid = g.id;
  render(); window.scrollTo(0, 0);
};
