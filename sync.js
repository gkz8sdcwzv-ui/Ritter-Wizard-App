/* Gemeinsamer Spielstand: Abgleich über Firebase Realtime Database (REST + Live-Stream).
   Jeder Spieler und jede Partie liegt als eigener Eintrag in der Gruppe – so überschreiben
   sich zwei Handys nicht gegenseitig, solange sie nicht dieselbe Partie gleichzeitig ändern. */
'use strict';

const SYNC_URL = 'https://happy-family-wizard-app-default-rtdb.europe-west1.firebasedatabase.app';
const SYNC_META = 'wizard-super-power-sync-v1';

const sync = {
  code: null,          // Gruppen-Code (zugleich "Passwort": nur wer ihn kennt, kommt an die Daten)
  base: {},            // letzter bekannter Stand der Gruppe: 'players/ID' | 'games/ID' → JSON
  dirty: new Set(),    // lokal geändert, noch nicht hochgeladen
  mode: 'resume',      // 'upload' | 'discard' nur bis zum ersten Abgleich nach dem Beitritt
  state: 'off', msg: '', es: null, mirror: null, sending: false, retry: null, reopen: null
};

function syncLoadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(SYNC_META));
    if (m && m.code) { sync.code = m.code; sync.base = m.base || {}; sync.dirty = new Set(m.dirty || []); }
  } catch (e) { /* kein gespeicherter Abgleich */ }
}

function syncSaveMeta() {
  try {
    if (!sync.code) localStorage.removeItem(SYNC_META);
    else localStorage.setItem(SYNC_META, JSON.stringify({ code: sync.code, base: sync.base, dirty: [...sync.dirty] }));
  } catch (e) { console.warn('Sync-Status nicht speicherbar', e); }
}

function syncEntities() {
  const m = {};
  db.players.forEach(p => m['players/' + p.id] = JSON.stringify(p));
  db.games.forEach(g => m['games/' + g.id] = JSON.stringify(g));
  return m;
}

function syncSetState(state, msg) {
  sync.state = state; sync.msg = msg || '';
  const dot = $('#syncDot');
  if (dot) { dot.hidden = state === 'off'; dot.className = 'sync-dot ' + state; dot.textContent = syncStateText(); }
  const st = $('#syncStatus');
  if (st) { st.className = 'sync-status ' + state; st.textContent = syncStateText(true); }
}

function syncStateText(long) {
  const n = sync.dirty.size;
  switch (sync.state) {
    case 'online': return n ? '☁️ wird übertragen …' : long ? '☁️ Verbunden – alle Geräte sehen denselben Stand' : '☁️ synchron';
    case 'connecting': return '☁️ verbinde …';
    case 'offline': return long ? `📴 Keine Verbindung – ${n ? n + ' Änderung(en) werden' : 'Änderungen werden'} nachgereicht, sobald wieder Netz da ist` : '📴 offline';
    case 'error': return '⚠️ ' + (sync.msg || 'Abgleich gestört');
    default: return '';
  }
}

/* ---------- lokal → Gruppe ---------- */

function syncMarkDirty() {                 // wird von saveDb() nach jeder Änderung aufgerufen
  if (!sync.code || sync.mode !== 'resume') return;
  const cur = syncEntities();
  for (const k of new Set([...Object.keys(cur), ...Object.keys(sync.base)]))
    if (cur[k] !== sync.base[k]) sync.dirty.add(k);
  syncSaveMeta();
  syncFlush();
}

function syncFlush() {
  if (!sync.code || sync.sending || !sync.dirty.size || sync.mode !== 'resume') return;
  const cur = syncEntities(), body = {}, code = sync.code;
  sync.dirty.forEach(k => body[k] = k in cur ? cur[k] : null);
  sync.sending = true;
  fetch(`${SYNC_URL}/groups/${code}.json`, { method: 'PATCH', body: JSON.stringify(body) })
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      sync.sending = false;
      if (sync.code !== code) return;
      const now = syncEntities();
      for (const k in body) {
        if ((k in now ? now[k] : null) !== body[k]) continue;        // inzwischen erneut geändert
        sync.dirty.delete(k);
        if (body[k] === null) delete sync.base[k]; else sync.base[k] = body[k];
      }
      syncSaveMeta();
      if (sync.state !== 'connecting') syncSetState('online');
      syncFlush();
    })
    .catch(e => {
      sync.sending = false;
      if (sync.code !== code) return;
      if (/HTTP 40[13]/.test(e.message)) syncSetState('error', 'Zugriff verweigert – Datenbank-Regeln prüfen');
      else if (/HTTP 404/.test(e.message)) syncSetState('error', 'Online-Datenbank nicht gefunden');
      else syncSetState('offline');
      clearTimeout(sync.retry);
      sync.retry = setTimeout(syncFlush, 6000);
    });
}

/* ---------- Gruppe → lokal ---------- */

function syncOpen() {
  if (sync.es) sync.es.close();
  clearTimeout(sync.reopen);
  sync.mirror = null;
  syncSetState('connecting');
  const code = sync.code, url = `${SYNC_URL}/groups/${code}.json`;
  const es = sync.es = new EventSource(url);
  const on = type => ev => {
    if (sync.es !== es) return;
    let d;
    try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (d) syncApply(type, d.path, d.data);
  };
  es.addEventListener('put', on('put'));
  es.addEventListener('patch', on('patch'));
  es.addEventListener('cancel', () => { if (sync.es === es) syncSetState('error', 'Zugriff verweigert – Datenbank-Regeln prüfen'); });
  es.onerror = () => {
    if (sync.es !== es) return;
    if (sync.state !== 'error') syncSetState('offline');
    if (es.readyState !== 2) return;       // Browser verbindet von selbst neu
    fetch(url + '?shallow=true').then(r => {
      if (sync.es !== es) return;
      if (r.status === 404) syncSetState('error', 'Online-Datenbank nicht gefunden');
      else if (r.status === 401 || r.status === 403) syncSetState('error', 'Zugriff verweigert – Datenbank-Regeln prüfen');
    }).catch(() => {});
    sync.reopen = setTimeout(() => { if (sync.es === es) syncOpen(); }, 8000);
  };
}

function syncApply(type, path, data) {
  const set = (p, v) => {
    const segs = p.split('/').filter(Boolean);
    if (!segs.length) { sync.mirror = v && typeof v === 'object' ? v : {}; return; }
    if (!sync.mirror) return;
    let o = sync.mirror;
    for (let i = 0; i < segs.length - 1; i++) o = (o[segs[i]] && typeof o[segs[i]] === 'object') ? o[segs[i]] : (o[segs[i]] = {});
    if (v === null) delete o[segs[segs.length - 1]]; else o[segs[segs.length - 1]] = v;
  };
  if (type === 'put') set(path, data);
  else for (const k in data) set(path + '/' + k, data[k]);
  if (sync.mirror) syncMerge();
}

function syncMerge() {
  const remote = {};
  for (const kind of ['players', 'games']) {
    const o = sync.mirror[kind];
    if (o && typeof o === 'object') for (const id in o) if (typeof o[id] === 'string') remote[kind + '/' + id] = o[id];
  }
  if (sync.mode === 'discard' && !Object.keys(remote).length) sync.mode = 'upload';   // leere Gruppe: nichts wegwerfen
  if (sync.mode === 'upload') syncAdoptPlayers(remote);
  const cur = syncEntities();
  if (sync.mode === 'upload') for (const k in cur) if (cur[k] !== remote[k]) sync.dirty.add(k);
  sync.mode = 'resume';

  const wasActive = activeGame() && activeGame().id;
  let changed = false;
  for (const k of new Set([...Object.keys(remote), ...Object.keys(cur), ...Object.keys(sync.base)])) {
    if (sync.dirty.has(k)) continue;        // lokale Änderung hat Vorrang und wird gleich hochgeladen
    if (remote[k] !== cur[k]) {
      if (k in remote) cur[k] = remote[k]; else delete cur[k];
      changed = true;
    }
    if (k in remote) sync.base[k] = remote[k]; else delete sync.base[k];
  }
  if (changed) {
    const parse = prefix => Object.keys(cur).filter(k => k.startsWith(prefix)).map(k => {
      try { return JSON.parse(cur[k]); } catch (e) { return null; }
    }).filter(Boolean);
    db.players = parse('players/');
    db.games = parse('games/').sort((a, b) => a.started - b.started);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* nur Zwischenspeicher */ }
    const done = wasActive && db.games.find(g => g.id === wasActive);
    if (done && done.status === 'finished' && ui.view === 'game' && !ui.resultGid) ui.resultGid = done.id;
    syncRender();
  }
  syncSaveMeta();
  syncSetState('online');
  syncFlush();
}

/* Beim ersten Hochladen: gleichnamige Spieler der Gruppe übernehmen statt Dubletten anzulegen */
function syncAdoptPlayers(remote) {
  const byName = {};
  for (const k in remote) if (k.startsWith('players/')) {
    try { const p = JSON.parse(remote[k]); byName[p.name.toLowerCase()] = p.id; } catch (e) { /* ignorieren */ }
  }
  for (const p of db.players.slice()) {
    const rid = byName[p.name.toLowerCase()];
    if (!rid || rid === p.id) continue;
    const swap = id => id === p.id ? rid : id;
    db.games.forEach(g => { g.playerIds = g.playerIds.map(swap); });
    ui.setup.sel = ui.setup.sel.map(swap);
    db.players = db.players.filter(x => x !== p);
  }
}

function syncRender() {                     // Neuzeichnen, ohne ein gerade getipptes Namensfeld zu leeren
  const i = $('#newName'), v = i ? i.value : '', f = i && document.activeElement === i;
  render();
  const j = $('#newName');
  if (j && v) { j.value = v; if (f) j.focus(); }
}

/* ---------- Verbinden / Trennen ---------- */

const syncValidCode = c => /^[A-Za-z0-9_-]{12,40}$/.test(c);
const syncLink = () => location.origin + location.pathname + '#g=' + sync.code;
const syncIsLocal = () => location.protocol === 'file:' || /^(localhost|127\.|\[::1\])/.test(location.host);

function syncConnect(code, mode) {
  sync.code = code; sync.base = {}; sync.dirty = new Set(); sync.mode = mode;
  syncSaveMeta();
  try { history.replaceState(null, '', '#g=' + code); } catch (e) { /* file:// */ }
  syncOpen();
}

function syncDisconnect() {
  if (sync.es) sync.es.close();
  clearTimeout(sync.retry); clearTimeout(sync.reopen);
  sync.es = null; sync.code = null; sync.base = {}; sync.dirty = new Set(); sync.mode = 'resume';
  syncSaveMeta();
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* file:// */ }
  syncSetState('off');
}

function syncJoin(input) {
  const m = /#g=([A-Za-z0-9_-]+)/.exec(input);
  const code = (m ? m[1] : input).trim();
  if (!syncValidCode(code)) { alert('Das ist kein gültiger Gruppen-Code (mindestens 12 Zeichen, nur Buchstaben, Ziffern, - und _).'); return false; }
  if (sync.code === code) { syncOpen(); return true; }
  let mode = 'discard';
  if (db.players.length || db.games.length) {
    const what = `${db.players.length} Spieler und ${db.games.length} Partien`;
    if (confirm(`Auf diesem Gerät sind schon ${what} gespeichert.\n\nOK = diese Daten in die Gruppe mitnehmen.\nAbbrechen = nicht mitnehmen.`)) mode = 'upload';
    else if (!confirm(`Dann werden die ${what} auf diesem Gerät durch den Stand der Gruppe ersetzt. Fortfahren?`)) return false;
  }
  syncConnect(code, mode);
  return true;
}

function syncInit() {
  syncLoadMeta();
  window.addEventListener('online', () => { if (sync.code) { syncOpen(); syncFlush(); } });
  document.addEventListener('visibilitychange', () => {
    if (sync.code && !document.hidden && (sync.state !== 'online' || (sync.es && sync.es.readyState === 2))) syncOpen();
  });
  const m = /#g=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (m && syncValidCode(m[1]) && m[1] !== sync.code) {
    if (!sync.code || confirm('Dieser Link gehört zu einer anderen Gruppe als der, mit der dieses Gerät verbunden ist. Zur neuen Gruppe wechseln?')) {
      if (sync.code) syncDisconnect();
      if (syncJoin(m[1])) { render(); return; }
    }
  }
  if (sync.code) { syncOpen(); syncFlush(); }
}

/* ---------- Oberfläche ---------- */

function syncCardHtml() {
  if (!sync.code) return `<section class="card">
    <h3>☁️ Gemeinsamer Spielstand</h3>
    <p class="hint">Verbinde mehrere Handys zu einer Gruppe: Egal, wer tippt – alle sehen denselben Block, dieselben Spieler und dieselben Statistiken.</p>
    <button class="btn gold big" data-act="syncCreate">Neue Gruppe erstellen</button>
    <p class="hint center" style="margin-top:14px">… oder einer bestehenden Gruppe beitreten:</p>
    <div class="addrow">
      <input id="syncCode" type="text" placeholder="Einladungs-Link oder Gruppen-Code" data-enter="syncJoinBtn" autocomplete="off" autocapitalize="off">
      <button class="btn" data-act="syncJoinBtn">Beitreten</button>
    </div>
  </section>`;
  return `<section class="card">
    <h3>☁️ Gemeinsamer Spielstand</h3>
    <p id="syncStatus" class="sync-status ${sync.state}">${esc(syncStateText(true))}</p>
    <p class="hint">Gruppen-Code: <code>${esc(sync.code)}</code><br>Wer den Einladungs-Link öffnet, ist automatisch dabei – und kann mitschreiben. Gib ihn also nur an eure Runde weiter.</p>
    ${syncIsLocal() ? '<p class="hint">ℹ️ Die App läuft gerade nur auf diesem Rechner. Der Einladungs-Link funktioniert für andere erst, wenn die App im Internet steht.</p>' : ''}
    <div class="btnrow wrap">
      <button class="btn gold" data-act="syncShare">📨 Einladungs-Link teilen</button>
      <button class="btn danger" data-act="syncLeave">Verbindung trennen</button>
    </div>
  </section>`;
}

ACT.syncCreate = () => {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789', rnd = crypto.getRandomValues(new Uint8Array(16));
  syncConnect('wiz-' + Array.from(rnd, b => abc[b % abc.length]).join(''), 'upload');
  render();
};
ACT.syncJoinBtn = () => { if (syncJoin($('#syncCode').value)) render(); };
ACT.syncShare = () => {
  const url = syncLink();
  if (navigator.share) navigator.share({ title: 'Wizard Super Power App', text: 'Unser gemeinsamer Wizard-Block', url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => alert('Einladungs-Link kopiert:\n' + url), () => prompt('Einladungs-Link:', url));
  else prompt('Einladungs-Link:', url);
};
ACT.syncLeave = () => {
  if (!confirm('Verbindung zur Gruppe trennen? Der aktuelle Stand bleibt auf diesem Gerät erhalten, wird aber nicht mehr abgeglichen.')) return;
  syncDisconnect(); render();
};
