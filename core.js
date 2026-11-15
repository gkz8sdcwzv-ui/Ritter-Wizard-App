/* Wizard Super Power App – Daten, Regeln, Statistik */
'use strict';

const STORE_KEY = 'wizard-super-power-v1';
const EMOJIS = ['🧙‍♂️','🧙‍♀️','🧝‍♀️','🧝‍♂️','🧛','🧚‍♀️','🧞','🦹','🐉','🦄','🦉','🐸','🦊','🐺','🦁','🐙','👑','🔮','⚡️','🌙','⭐️','🔥','🍀','🎩','💎','🗡️','🃏','👻','🤡','🤖'];

let db = loadDb();

function emptyDb() { return { v: 1, players: [], games: [] }; }

function loadDb() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.players) && Array.isArray(d.games)) return d;
    }
  } catch (e) { console.warn('Konnte Daten nicht laden', e); }
  return emptyDb();
}

function saveDb() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { alert('Speichern fehlgeschlagen: ' + e.message); }
  if (typeof syncMarkDirty === 'function') syncMarkDirty();   // gemeinsamer Spielstand, siehe sync.js
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* ---------- Regeln ---------- */

function roundsFor(n) { return Math.floor(60 / n); }

function pts(bid, tricks) {
  return bid === tricks ? 20 + 10 * tricks : -10 * Math.abs(bid - tricks);
}

function dealerOf(g, roundNo) {            // roundNo 1-basiert → Sitzindex
  return ((g.firstDealer || 0) + roundNo - 1) % g.playerIds.length;
}

function bidOrder(g, roundNo) {            // links vom Geber beginnt, Geber zuletzt
  const n = g.playerIds.length, d = dealerOf(g, roundNo), o = [];
  for (let k = 1; k <= n; k++) o.push((d + k) % n);
  return o;
}

function calcGame(g) {
  const n = g.playerIds.length, cum = Array(n).fill(0), rows = [];
  for (const r of g.rounds) {
    const p = r.b.map((b, i) => pts(b, r.t[i]));
    p.forEach((v, i) => cum[i] += v);
    rows.push({ b: r.b, t: r.t, p, c: cum.slice(), hit: p.map(v => v > 0) });
  }
  return { n, rows, total: cum.slice(), place: placesOf(cum) };
}

function placesOf(total) {
  return total.map(v => 1 + total.filter(o => o > v).length);
}

/* ---------- Spieler ---------- */

function playerById(id) { return db.players.find(p => p.id === id); }
function pName(id) { const p = playerById(id); return p ? p.name : '???'; }
function pEmoji(id) { const p = playerById(id); return p ? p.emoji : '❓'; }

function addPlayer(name, extra) {
  name = name.trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!name) return null;
  const dup = db.players.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (dup) { dup.archived = false; saveDb(); return dup; }
  const used = new Set(db.players.map(p => p.emoji));
  const emoji = EMOJIS.find(e => !used.has(e)) || EMOJIS[db.players.length % EMOJIS.length];
  const p = Object.assign({ id: uid(), name, emoji, created: Date.now(), archived: false }, extra || {});
  db.players.push(p);
  saveDb();
  return p;
}

function playerHasGames(id) { return db.games.some(g => g.playerIds.includes(id)); }

/* ---------- Spiele ---------- */

function activeGame() { return db.games.find(g => g.status === 'active'); }

function newGame(playerIds, opt) {
  const g = {
    id: uid(), started: Date.now(), ended: null, status: 'active',
    playerIds: playerIds.slice(), total: roundsFor(playerIds.length),
    rounds: [], pending: null, firstDealer: 0, opt: Object.assign({ noEven: false }, opt || {})
  };
  startRound(g);
  db.games.push(g);
  saveDb();
  return g;
}

function startRound(g) {
  const n = g.playerIds.length;
  g.pending = { phase: 'b', b: Array(n).fill(null), t: Array(n).fill(null) };
}

function commitRound(g) {
  g.rounds.push({ b: g.pending.b.slice(), t: g.pending.t.slice() });
  if (g.rounds.length >= g.total) {
    g.pending = null; g.status = 'finished'; g.ended = Date.now();
  } else startRound(g);
  saveDb();
}

function reopenLastRound(g) {
  if (!g.rounds.length) return;
  const r = g.rounds.pop();
  g.pending = { phase: 't', b: r.b.slice(), t: r.t.slice() };
  saveDb();
}

function abortGame(g) {
  if (!g.rounds.length) db.games = db.games.filter(x => x !== g);
  else { g.pending = null; g.status = 'aborted'; g.ended = Date.now(); }
  saveDb();
}

/* ---------- Statistik ---------- */

const RECORDS = [
  { key: 'high',      icon: '🏔️', title: 'All-Time High',            sub: 'Höchste Endpunktzahl in einem Spiel',                 fmt: v => v + ' Pkt.' },
  { key: 'low',       icon: '🕳️', title: 'All-Time Low',             sub: 'Niedrigste Endpunktzahl in einem Spiel',              fmt: v => v + ' Pkt.', asc: true },
  { key: 'dominance', icon: '👑', title: 'Dominanteste Performance', sub: 'Größter Vorsprung des Siegers auf Platz 2',           fmt: v => '+' + v + ' Pkt.' },
  { key: 'share',     icon: '🦁', title: 'Löwenanteil',              sub: 'Punkte im Vergleich zum Schnitt der Mitspieler',      fmt: v => '+' + v + ' Pkt.' },
  { key: 'ppr',       icon: '⚗️', title: 'Effizienteste Performance', sub: 'Meiste Punkte pro Runde (fair bei jeder Spielerzahl)', fmt: v => v.toFixed(1).replace('.', ',') + ' / Runde' },
  { key: 'tricks',    icon: '🃏', title: 'Meiste Stiche',            sub: 'Meiste Stiche in einem Spiel',                        fmt: v => v + ' Stiche' },
  { key: 'streakAll', icon: '🔥', title: 'Längste Treffer-Serie',    sub: 'Richtige Ansagen in Folge – spielübergreifend',       fmt: v => v + ' in Folge' },
  { key: 'streakGame',icon: '🎯', title: 'Beste Serie in einem Spiel', sub: 'Richtige Ansagen in Folge innerhalb eines Spiels',  fmt: v => v + ' in Folge' },
  { key: 'accuracy',  icon: '🔮', title: 'Hellseher-Spiel',          sub: 'Höchste Trefferquote in einem Spiel',                 fmt: v => Math.round(v) + ' %' },
  { key: 'coup',      icon: '💥', title: 'Größter Coup',             sub: 'Meiste Punkte in einer einzigen Runde',               fmt: v => '+' + v + ' Pkt.' },
  { key: 'disaster',  icon: '💀', title: 'Größtes Desaster',         sub: 'Höchster Punktabzug in einer einzigen Runde',         fmt: v => v + ' Pkt.', asc: true },
  { key: 'missStreak',icon: '🌧️', title: 'Längste Pechsträhne',      sub: 'Falsche Ansagen in Folge – spielübergreifend',        fmt: v => v + ' in Folge' },
  { key: 'comeback',  icon: '🚀', title: 'Größte Aufholjagd',        sub: 'Größter Rückstand, der noch zum Sieg gedreht wurde',  fmt: v => v + ' Pkt. Rückstand' },
  { key: 'closest',   icon: '😅', title: 'Knappster Sieg',           sub: 'Kleinster Vorsprung auf Platz 2',                     fmt: v => '+' + v + ' Pkt.', asc: true },
  { key: 'blind',     icon: '🙈', title: 'Blindflug',                sub: 'Niedrigste Trefferquote in einem Spiel',              fmt: v => Math.round(v) + ' %', asc: true }
];

const ACHIEVEMENTS = [
  { key: 'firstWin', icon: '🥇', name: 'Erster Sieg',      desc: 'Ein Spiel gewonnen',                      ok: s => s.wins >= 1 },
  { key: 'hattrick', icon: '🎩', name: 'Hattrick',         desc: '3 Siege in Folge',                        ok: s => s.winStreakMax >= 3 },
  { key: 'perfect',  icon: '🔮', name: 'Perfektes Spiel',  desc: 'Alle Ansagen eines Spiels richtig',       ok: s => s.perfect >= 1 },
  { key: 'streak5',  icon: '🔥', name: 'Heiß gelaufen',    desc: '5 richtige Ansagen in Folge',             ok: s => s.maxStreak >= 5 },
  { key: 'streak10', icon: '☄️', name: 'Unaufhaltsam',     desc: '10 richtige Ansagen in Folge',            ok: s => s.maxStreak >= 10 },
  { key: 'club300',  icon: '💎', name: '300er-Club',       desc: '300 oder mehr Punkte in einem Spiel',     ok: s => s.games && s.best.v >= 300 },
  { key: 'coup',     icon: '💥', name: 'Großer Coup',      desc: 'Ansage von 5+ Stichen exakt getroffen',   ok: s => s.maxBidHit >= 5 },
  { key: 'zero',     icon: '🥷', name: 'Null-Ninja',       desc: '10 Null-Ansagen richtig',                 ok: s => s.zeroHits >= 10 },
  { key: 'under0',   icon: '🕳️', name: 'Unter Null',       desc: 'Ein Spiel im Minus beendet',              ok: s => s.games && s.worst.v < 0 },
  { key: 'veteran',  icon: '🏰', name: 'Stammgast',        desc: '10 Spiele gespielt',                      ok: s => s.games >= 10 }
];

function blankStats(id) {
  return {
    id, games: 0, wins: 0, sumPts: 0, best: { v: -Infinity, gid: null }, worst: { v: Infinity, gid: null },
    placeSum: 0, lasts: 0, rounds: 0, hits: 0, tricks: 0, bidSum: 0, zeroBids: 0, zeroHits: 0,
    over: 0, under: 0, bestRound: -Infinity, worstRound: Infinity, maxBidHit: -1,
    curStreak: 0, maxStreak: 0, curMiss: 0, maxMiss: 0, maxStreakGame: 0,
    form: [], scores: [], perfect: 0, winStreakCur: 0, winStreakMax: 0,
    elo: 1000, eloHist: [], h2h: {}
  };
}

/* filterN: nur Spiele mit dieser Spielerzahl (0 = alle) */
function computeStats(filterN) {
  const games = db.games.filter(g => g.rounds.length && (!filterN || g.playerIds.length === filterN))
    .slice().sort((a, b) => a.started - b.started);
  const P = {}, rec = {}, eloDelta = {};
  RECORDS.forEach(r => rec[r.key] = []);
  const S = id => P[id] || (P[id] = blankStats(id));
  const add = (key, pid, v, g, note) => rec[key].push({ pid, v, gid: g.id, date: g.started, note: note || '' });

  for (const g of games) {
    const c = calcGame(g), ids = g.playerIds, n = c.n, R = c.rows.length;
    const finished = g.status === 'finished';
    const gHits = Array(n).fill(0), gTricks = Array(n).fill(0), gStreak = Array(n).fill(0), gBest = Array(n).fill(0);
    const deficit = Array(n).fill(0);

    c.rows.forEach((row, ri) => {
      const lead = Math.max(...row.c);
      for (let i = 0; i < n; i++) {
        const s = S(ids[i]), b = row.b[i], t = row.t[i], p = row.p[i];
        s.rounds++; s.tricks += t; s.bidSum += b; gTricks[i] += t;
        if (b === 0) s.zeroBids++;
        if (b > t) s.over++; else if (b < t) s.under++;
        if (p > s.bestRound) s.bestRound = p;
        if (p < s.worstRound) s.worstRound = p;
        deficit[i] = Math.max(deficit[i], lead - row.c[i]);
        if (row.hit[i]) {
          s.hits++; gHits[i]++; if (b === 0) s.zeroHits++;
          if (b > s.maxBidHit) s.maxBidHit = b;
          gStreak[i]++; gBest[i] = Math.max(gBest[i], gStreak[i]);
          if (s.curMiss >= 2) add('missStreak', ids[i], s.curMiss, s._missG || g);
          s.curMiss = 0; s.curStreak++; s._hitG = g;
          s.maxStreak = Math.max(s.maxStreak, s.curStreak);
        } else {
          gStreak[i] = 0;
          if (s.curStreak >= 2) add('streakAll', ids[i], s.curStreak, s._hitG || g);
          s.curStreak = 0; s.curMiss++; s._missG = g;
          s.maxMiss = Math.max(s.maxMiss, s.curMiss);
        }
        add('coup', ids[i], p, g, `Runde ${ri + 1}: ${b} angesagt, ${t} gemacht`);
        add('disaster', ids[i], p, g, `Runde ${ri + 1}: ${b} angesagt, ${t} gemacht`);
      }
    });

    for (let i = 0; i < n; i++) {
      const s = S(ids[i]);
      s.maxStreakGame = Math.max(s.maxStreakGame, gBest[i]);
      if (gBest[i] >= 2) add('streakGame', ids[i], gBest[i], g);
    }
    if (!finished) continue;

    const sorted = c.total.slice().sort((a, b) => b - a);
    const winners = c.place.filter(p => p === 1).length;
    for (let i = 0; i < n; i++) {
      const s = S(ids[i]), tot = c.total[i], pl = c.place[i];
      s.games++; s.sumPts += tot; s.placeSum += pl; s.scores.push(tot);
      s.form.push(pl);
      if (tot > s.best.v) s.best = { v: tot, gid: g.id };
      if (tot < s.worst.v) s.worst = { v: tot, gid: g.id };
      if (pl === 1) { s.wins++; s.winStreakCur++; s.winStreakMax = Math.max(s.winStreakMax, s.winStreakCur); }
      else s.winStreakCur = 0;
      if (tot === sorted[n - 1] && pl !== 1) s.lasts++;
      if (gHits[i] === R) s.perfect++;
      const others = (c.total.reduce((a, b) => a + b, 0) - tot) / (n - 1);
      add('high', ids[i], tot, g);
      add('low', ids[i], tot, g);
      add('ppr', ids[i], tot / R, g, `${tot} Pkt. in ${R} Runden`);
      add('tricks', ids[i], gTricks[i], g, `in ${R} Runden`);
      add('accuracy', ids[i], 100 * gHits[i] / R, g, `${gHits[i]} von ${R} Ansagen richtig`);
      add('blind', ids[i], 100 * gHits[i] / R, g, `${gHits[i]} von ${R} Ansagen richtig`);
      if (tot - others > 0) add('share', ids[i], Math.round(tot - others), g, `${tot} Pkt. – Mitspieler im Schnitt ${Math.round(others)}`);
      if (pl === 1 && winners === 1) {
        add('dominance', ids[i], tot - sorted[1], g, `${tot} zu ${sorted[1]}`);
        add('closest', ids[i], tot - sorted[1], g, `${tot} zu ${sorted[1]}`);
        if (deficit[i] > 0) add('comeback', ids[i], deficit[i], g);
      }
      for (let j = 0; j < n; j++) if (j !== i) {
        const h = s.h2h[ids[j]] || (s.h2h[ids[j]] = { games: 0, ahead: 0, behind: 0 });
        h.games++;
        if (c.place[i] < c.place[j]) h.ahead++; else if (c.place[i] > c.place[j]) h.behind++;
      }
    }

    // Zauberkraft (Elo, paarweise)
    const d = {};
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) if (j !== i) {
        const exp = 1 / (1 + Math.pow(10, (S(ids[j]).elo - S(ids[i]).elo) / 400));
        const act = c.place[i] < c.place[j] ? 1 : c.place[i] > c.place[j] ? 0 : 0.5;
        sum += act - exp;
      }
      d[ids[i]] = Math.round(32 * sum / (n - 1) * 10) / 10;
    }
    for (const id of ids) { S(id).elo += d[id]; S(id).eloHist.push(S(id).elo); }
    eloDelta[g.id] = d;
  }

  // noch laufende Serien
  for (const id in P) {
    const s = P[id];
    if (s.curStreak >= 2) add('streakAll', id, s.curStreak, s._hitG, 'läuft noch');
    if (s.curMiss >= 2) add('missStreak', id, s.curMiss, s._missG, 'läuft noch');
  }

  RECORDS.forEach(r => {
    rec[r.key].sort((a, b) => (r.asc ? a.v - b.v : b.v - a.v) || a.date - b.date);
    rec[r.key] = rec[r.key].slice(0, 5);
  });
  rec.coup = rec.coup.filter(e => e.v > 0);
  rec.disaster = rec.disaster.filter(e => e.v < 0);

  return { P, rec, eloDelta, titles: computeTitles(P), gameCount: games.filter(g => g.status === 'finished').length };
}

function computeTitles(P) {
  const all = Object.values(P), out = [];
  const pick = (list, f, dir) => {
    let best = null;
    for (const s of list) { const v = f(s); if (best === null || dir * (v - best.v) > 0) best = { s, v }; }
    return best;
  };
  const pct = v => Math.round(v * 100) + ' %';
  const dec = v => v.toFixed(2).replace('.', ',');
  const exp = all.filter(s => s.rounds >= 10);
  let t;
  if ((t = pick(all.filter(s => s.wins > 0), s => s.wins, 1)))
    out.push({ icon: '🏆', name: 'Seriensieger', desc: 'Meiste Siege', pid: t.s.id, val: t.v + (t.v === 1 ? ' Sieg' : ' Siege') });
  if ((t = pick(exp, s => s.hits / s.rounds, 1)))
    out.push({ icon: '🔮', name: 'Hellseher', desc: 'Beste Trefferquote', pid: t.s.id, val: pct(t.v) });
  if ((t = pick(exp, s => s.tricks / s.rounds, 1)))
    out.push({ icon: '🧲', name: 'Stichmagnet', desc: 'Meiste Stiche pro Runde', pid: t.s.id, val: dec(t.v) });
  if ((t = pick(exp, s => (s.bidSum - s.tricks) / s.rounds, 1)) && t.v > 0)
    out.push({ icon: '🎈', name: 'Optimist', desc: 'Sagt im Schnitt am meisten zu viel an', pid: t.s.id, val: '+' + dec(t.v) + ' / Runde' });
  if ((t = pick(exp, s => (s.bidSum - s.tricks) / s.rounds, -1)) && t.v < 0)
    out.push({ icon: '🦥', name: 'Tiefstapler', desc: 'Sagt im Schnitt am meisten zu wenig an', pid: t.s.id, val: dec(t.v) + ' / Runde' });
  if ((t = pick(all.filter(s => s.zeroBids >= 5), s => s.zeroHits / s.zeroBids, 1)))
    out.push({ icon: '🥷', name: 'Null-König', desc: 'Beste Quote bei Null-Ansagen', pid: t.s.id, val: pct(t.v) });
  if ((t = pick(all.filter(s => s.games >= 3), s => stdDev(s.scores), 1)))
    out.push({ icon: '🎢', name: 'Achterbahn', desc: 'Größte Schwankung der Endpunktzahlen', pid: t.s.id, val: '± ' + Math.round(t.v) });
  if ((t = pick(all.filter(s => s.lasts > 0), s => s.lasts, 1)))
    out.push({ icon: '🐌', name: 'Rote Laterne', desc: 'Am häufigsten Letzter', pid: t.s.id, val: t.v + '×' });
  return out;
}

function stdDev(a) {
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length);
}

/* Rekorde, die durch dieses Spiel (neu) aufgestellt wurden */
function recordsSetBy(gid) {
  const st = computeStats(0);
  return RECORDS.filter(r => st.rec[r.key].length && st.rec[r.key][0].gid === gid)
    .map(r => ({ r, e: st.rec[r.key][0] }));
}
