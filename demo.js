/* Demo-Daten: zufällige, aber plausible Spiele zum Ausprobieren der Statistiken */
'use strict';

function loadDemoData() {
  let seed = 4711;
  const rnd = () => {                       // mulberry32
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const cast = [['Merlin', 0.66, 1.3], ['Gandalf', 0.6, 1.1], ['Hermine', 0.63, 0.9], ['Morgana', 0.52, 1.2],
                ['Radagast', 0.45, 0.8], ['Circe', 0.55, 1.0], ['Saruman', 0.5, 1.4]];
  const players = cast.map(([name, acc, pull]) => ({ p: addPlayer(name + ' (Demo)', { demo: true }), acc, pull }));
  const day = 86400000;
  let when = Date.now() - 170 * day;

  for (let k = 0; k < 16; k++) {
    const n = 3 + Math.floor(rnd() * 4);
    const seats = players.slice().sort(() => rnd() - 0.5).slice(0, n);
    const total = roundsFor(n), rounds = [];
    for (let c = 1; c <= total; c++) {
      const t = Array(n).fill(0);
      const wsum = seats.reduce((a, s) => a + s.pull, 0);
      for (let x = 0; x < c; x++) {
        let r = rnd() * wsum, i = 0;
        while (i < n - 1 && (r -= seats[i].pull) > 0) i++;
        t[i]++;
      }
      const b = t.map((v, i) => {
        if (rnd() < seats[i].acc) return v;
        const off = (rnd() < 0.8 ? 1 : 2) * (rnd() < 0.55 ? 1 : -1);
        const bid = Math.max(0, Math.min(c, v + off));
        return bid === v ? Math.min(c, v + 1) === v ? v - 1 : v + 1 : bid;
      });
      rounds.push({ b, t });
    }
    when += (5 + rnd() * 12) * day;
    db.games.push({
      id: uid() + k, started: when, ended: when + 5400000, status: 'finished', demo: true,
      playerIds: seats.map(s => s.p.id), total, rounds, pending: null,
      firstDealer: Math.floor(rnd() * n), opt: { noEven: false }
    });
  }
  saveDb();
}

function removeDemoData() {
  db.games = db.games.filter(g => !g.demo);
  db.players = db.players.filter(p => !p.demo || playerHasGames(p.id));
  saveDb();
}

function hasDemoData() { return db.games.some(g => g.demo) || db.players.some(p => p.demo); }
