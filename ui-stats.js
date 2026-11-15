/* Wizard Super Power App – Ruhmeshalle, Spieler-Datenbank, Historie, Einstellungen */
'use strict';

const pctOf = (a, b) => b ? Math.round(100 * a / b) + ' %' : '–';
const avg1 = (a, b) => b ? (a / b).toFixed(1).replace('.', ',') : '–';

/* ================= Ruhmeshalle ================= */

VIEWS.fame = () => {
  const counts = [...new Set(db.games.filter(g => g.rounds.length).map(g => g.playerIds.length))].sort();
  if (!counts.includes(ui.fameN)) ui.fameN = 0;
  const st = computeStats(ui.fameN);
  if (!Object.keys(st.P).length) return `<section class="card center"><div class="crown">🏛️</div><h2>Ruhmeshalle</h2>
    <p class="hint">Noch ist hier alles leer. Spielt die erste Runde – dann füllen sich Rekorde, Ranglisten und Titel von selbst.</p></section>`;

  const cols = [
    ['elo', '⚡️', s => Math.round(s.elo), 'Zauberkraft'], ['games', 'Sp.', s => s.games, 'Spiele'], ['wins', 'Siege', s => s.wins, 'Siege'],
    ['winrate', 'Quote', s => s.games ? s.wins / s.games : -1, 'Siegquote', s => pctOf(s.wins, s.games)],
    ['avg', 'Ø Pkt.', s => s.games ? s.sumPts / s.games : -1e9, 'Punkte im Schnitt', s => s.games ? Math.round(s.sumPts / s.games) : '–'],
    ['hit', 'Treffer', s => s.rounds ? s.hits / s.rounds : -1, 'Trefferquote', s => pctOf(s.hits, s.rounds)],
    ['tricks', 'Stiche', s => s.tricks, 'Stiche insgesamt']
  ];
  const sc = cols.find(c => c[0] === ui.sort) || cols[0];
  const rows = Object.values(st.P).sort((a, b) => sc[2](b) - sc[2](a));

  return `
  <div class="filter">
    <button class="fchip ${ui.fameN === 0 ? 'on' : ''}" data-act="fameN" data-n="0">Alle Spiele</button>
    ${counts.map(n => `<button class="fchip ${ui.fameN === n ? 'on' : ''}" data-act="fameN" data-n="${n}">${n} Spieler</button>`).join('')}
  </div>
  <section class="card">
    <h2>🏆 Rangliste <small>${st.gameCount} ${st.gameCount === 1 ? 'Spiel' : 'Spiele'}</small></h2>
    <div class="tscroll"><table class="lb">
      <thead><tr><th>#</th><th class="l">Zauberer</th>${cols.map(c =>
        `<th class="${c[0] === sc[0] ? 'on' : ''}" data-act="sort" data-k="${c[0]}" title="${c[3]}">${c[1]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((s, i) => `<tr data-act="profile" data-id="${s.id}"><td>${i + 1}</td><td class="l">${who(s.id)}</td>
        ${cols.map(c => `<td class="${c[0] === sc[0] ? 'on' : ''}">${(c[4] || c[2])(s)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="hint">Spalte antippen zum Sortieren. <b>Zauberkraft</b> ist eine Elo-Wertung: Wer starke Gegner hinter sich lässt, gewinnt mehr.</p>
  </section>
  ${st.titles.length ? `<section class="card"><h2>🎖️ Titelträger</h2><div class="titles">
    ${st.titles.map(t => `<div class="title" data-act="profile" data-id="${t.pid}"><span class="ti">${t.icon}</span>
      <span><b>${t.name}</b><small>${t.desc}</small><span class="th">${who(t.pid)} · ${t.val}</span></span></div>`).join('')}
  </div></section>` : ''}
  <h2 class="sec">📜 Rekorde für die Ewigkeit</h2>
  <div class="recs">${RECORDS.map(r => recordHtml(r, st.rec[r.key])).join('')}</div>`;
};

function recordHtml(r, list) {
  if (!list.length) return '';
  const top = list[0];
  return `<details class="rec">
    <summary><span class="ri">${r.icon}</span>
      <span class="rt"><b>${r.title}</b><small>${r.sub}</small></span>
      <span class="rh"><span class="rv">${r.fmt(top.v)}</span><span class="rw">${who(top.pid)}</span></span></summary>
    <ol>${list.map(e => `<li data-act="openGame" data-gid="${e.gid}"><span class="rw">${who(e.pid)}</span><span class="rv">${r.fmt(e.v)}</span>
      <small>${fmtDate(e.date)}${e.note ? ' · ' + esc(e.note) : ''}</small></li>`).join('')}</ol>
  </details>`;
}

ACT.fameN = d => { ui.fameN = +d.n; render(); };
ACT.sort = d => { ui.sort = d.k; render(); };
ACT.profile = d => { ui.view = 'players'; ui.profile = d.id; ui.emojiPick = false; render(); window.scrollTo(0, 0); };
ACT.openGame = d => { ui.view = 'history'; ui.histGid = d.gid; render(); window.scrollTo(0, 0); };

/* ================= Spieler-Datenbank ================= */

VIEWS.players = () => {
  const st = computeStats(0);
  if (ui.profile && playerById(ui.profile)) return profileHtml(playerById(ui.profile), st);
  const list = db.players.slice().sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name, 'de'));
  return `
  <section class="card">
    <h2>🧙 Zauberer-Datenbank <small>${db.players.length}</small></h2>
    <div class="addrow">
      <input id="newName" type="text" maxlength="20" placeholder="Neuer Spieler …" data-enter="addPlayerDb" autocomplete="off">
      <button class="btn" data-act="addPlayerDb">＋ Hinzufügen</button>
    </div>
  </section>
  <div class="plist">${list.map(p => {
    const s = st.P[p.id];
    return `<button class="pcard ${p.archived ? 'arch' : ''}" data-act="profile" data-id="${p.id}">
      <span class="pe">${p.emoji}</span>
      <span class="pi"><b>${esc(p.name)}</b>
        <small>${s && s.games ? `${s.games} ${s.games === 1 ? 'Spiel' : 'Spiele'} · ${s.wins} ${s.wins === 1 ? 'Sieg' : 'Siege'} · ${pctOf(s.hits, s.rounds)} Treffer` : p.archived ? 'archiviert' : 'noch ohne Spiel'}</small></span>
      ${s && s.games ? `<span class="pelo">⚡️ ${Math.round(s.elo)}</span>` : ''}</button>`;
  }).join('') || '<p class="hint center">Noch keine Spieler angelegt.</p>'}</div>`;
};

ACT.addPlayerDb = () => { if (addPlayer($('#newName').value)) render(); };

function profileHtml(p, st) {
  const s = st.P[p.id] || blankStats(p.id);
  const tile = (label, value, sub) => `<div class="tile"><small>${label}</small><b>${value}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
  const titles = st.titles.filter(t => t.pid === p.id);
  const h2h = Object.entries(s.h2h).filter(([id]) => playerById(id)).sort((a, b) => b[1].games - a[1].games);
  const tend = s.rounds ? (s.bidSum - s.tricks) / s.rounds : 0;
  return `
  <button class="link back" data-act="profileBack">← Alle Zauberer</button>
  <section class="card profile">
    <button class="pe big" data-act="emojiToggle" title="Symbol ändern">${p.emoji}</button>
    <h2>${esc(p.name)} ${p.archived ? '<span class="tag">archiviert</span>' : ''}</h2>
    <p class="hint">dabei seit ${fmtDate(p.created)}${s.games ? ` · Zauberkraft ⚡️ ${Math.round(s.elo)}` : ''}</p>
    ${ui.emojiPick ? `<div class="emojis">${EMOJIS.map(e => `<button data-act="emojiSet" data-e="${e}" class="${e === p.emoji ? 'on' : ''}">${e}</button>`).join('')}</div>` : ''}
    ${titles.length ? `<div class="badges">${titles.map(t => `<span class="badge gold" title="${t.desc}">${t.icon} ${t.name}</span>`).join('')}</div>` : ''}
    ${s.form.length ? `<div class="form">Form: ${s.form.slice(-8).map(pl => `<span class="f${Math.min(pl, 4)}">${pl}</span>`).join('')}</div>` : ''}
  </section>
  ${s.rounds ? `
  <div class="tiles">
    ${tile('Spiele', s.games, s.games ? `${s.wins} ${s.wins === 1 ? 'Sieg' : 'Siege'} · ${pctOf(s.wins, s.games)}` : '')}
    ${tile('Ø Punkte', s.games ? Math.round(s.sumPts / s.games) : '–', s.games ? `Ø Platz ${avg1(s.placeSum, s.games)}` : '')}
    ${tile('All-Time High', s.games ? s.best.v : '–', 'bestes Spiel')}
    ${tile('All-Time Low', s.games ? s.worst.v : '–', 'schwächstes Spiel')}
    ${tile('Trefferquote', pctOf(s.hits, s.rounds), `${s.hits} von ${s.rounds} Ansagen`)}
    ${tile('Längste Serie', s.maxStreak, `aktuell ${s.curStreak} · im Spiel max. ${s.maxStreakGame}`)}
    ${tile('Stiche gesamt', s.tricks, `Ø ${avg1(s.tricks, s.rounds)} pro Runde`)}
    ${tile('Ansage-Tendenz', Math.abs(tend) < 0.03 ? 'neutral' : tend > 0 ? 'Optimist' : 'Tiefstapler', `${pctOf(s.over, s.rounds)} zu viel · ${pctOf(s.under, s.rounds)} zu wenig`)}
    ${tile('Null-Ansagen', pctOf(s.zeroHits, s.zeroBids), `${s.zeroHits} von ${s.zeroBids} richtig`)}
    ${tile('Beste Runde', signed(s.bestRound), `schlechteste ${s.worstRound}`)}
    ${tile('Pechsträhne', s.maxMiss, 'falsche Ansagen in Folge')}
    ${tile('Siegesserie', s.winStreakMax, `${s.perfect} perfekte${s.perfect === 1 ? 's Spiel' : ' Spiele'}`)}
  </div>
  <section class="card"><h3>Auszeichnungen</h3><div class="achs">
    ${ACHIEVEMENTS.map(a => `<div class="ach ${a.ok(s) ? 'ok' : ''}"><span>${a.icon}</span><b>${a.name}</b><small>${a.desc}</small></div>`).join('')}
  </div></section>
  ${h2h.length ? `<section class="card"><h3>Direkter Vergleich</h3>
    <p class="hint">Wie oft ${esc(p.name)} vor bzw. hinter den Mitspielern gelandet ist.</p>
    ${h2h.map(([id, h]) => `<div class="h2h" data-act="profile" data-id="${id}"><span>${who(id)}</span>
      <span class="bar"><i style="width:${h.games ? 100 * h.ahead / h.games : 0}%"></i></span>
      <span class="h2v"><b>${h.ahead}</b> : ${h.behind}</span></div>`).join('')}
  </section>` : ''}` : '<p class="hint center">Noch keine gespielten Runden – die Statistik füllt sich mit dem ersten Spiel.</p>'}
  <div class="btnrow wrap">
    <button class="btn" data-act="rename">✏️ Umbenennen</button>
    ${playerHasGames(p.id)
      ? `<button class="btn" data-act="archive">${p.archived ? '♻️ Reaktivieren' : '📦 Archivieren'}</button>`
      : '<button class="btn danger" data-act="deletePlayer">🗑️ Löschen</button>'}
  </div>`;
}

ACT.profileBack = () => { ui.profile = null; render(); window.scrollTo(0, 0); };
ACT.emojiToggle = () => { ui.emojiPick = !ui.emojiPick; render(); };
ACT.emojiSet = d => { playerById(ui.profile).emoji = d.e; ui.emojiPick = false; saveDb(); render(); };
ACT.rename = () => {
  const p = playerById(ui.profile);
  const name = (prompt('Neuer Name:', p.name) || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!name || name === p.name) return;
  if (db.players.some(o => o !== p && o.name.toLowerCase() === name.toLowerCase())) { alert('Diesen Namen gibt es schon.'); return; }
  p.name = name; saveDb(); render();
};
ACT.archive = () => { const p = playerById(ui.profile); p.archived = !p.archived; saveDb(); render(); };
ACT.deletePlayer = () => {
  const p = playerById(ui.profile);
  if (playerHasGames(p.id) || !confirm(`${p.name} wirklich löschen?`)) return;
  db.players = db.players.filter(o => o !== p);
  ui.profile = null; saveDb(); render();
};

/* ================= Historie ================= */

VIEWS.history = () => {
  if (ui.scan) return scanHtml();
  const g = ui.histGid && db.games.find(x => x.id === ui.histGid);
  if (g) return gameDetailHtml(g);
  const list = db.games.filter(x => x.status !== 'active').sort((a, b) => b.started - a.started);
  return `
  <h2 class="sec">📚 Gespielte Partien <small>${list.length}</small></h2>
  <button class="btn gold big" data-act="scanOpen">📷 Alten Block einscannen</button>
  <div class="hlist">${list.map(x => {
    const c = calcGame(x), order = [...Array(c.n).keys()].sort((a, b) => c.total[b] - c.total[a]);
    return `<button class="hcard" data-act="openGame" data-gid="${x.id}">
      <span class="hd">${fmtDate(x.started)} · ${c.n} Spieler · ${c.rows.length} Runden
        ${x.status === 'aborted' ? '<span class="tag">abgebrochen</span>' : ''}${x.demo ? '<span class="tag blue">Demo</span>' : ''}${x.imported ? '<span class="tag blue">eingescannt</span>' : ''}</span>
      <span class="hp">${order.map(i => `<span class="${c.place[i] === 1 && x.status === 'finished' ? 'win' : ''}">${c.place[i] === 1 && x.status === 'finished' ? '👑 ' : ''}${esc(pName(x.playerIds[i]))} <b>${c.total[i]}</b></span>`).join('')}</span>
    </button>`;
  }).join('') || '<p class="hint center">Noch keine abgeschlossenen Partien.</p>'}</div>
  ${settingsHtml()}`;
};

function gameDetailHtml(g) {
  return `
  <button class="link back" data-act="histBack">← Alle Partien</button>
  ${g.status === 'aborted' ? '<p class="hint center">Diese Partie wurde vorzeitig beendet.</p>' : ''}
  ${standingsHtml(g)}
  ${blockHtml(g, false)}
  ${chartHtml(g)}
  <div class="btnrow wrap">
    ${g.status === 'active' ? '<button class="btn gold" data-act="nav" data-view="game">Zum laufenden Spiel</button>'
      : `<button class="btn danger" data-act="deleteGame" data-gid="${g.id}">🗑️ Partie löschen</button>`}
  </div>`;
}

ACT.histBack = () => { ui.histGid = null; render(); window.scrollTo(0, 0); };
ACT.deleteGame = d => {
  if (!confirm('Diese Partie endgültig löschen? Alle Statistiken werden neu berechnet.')) return;
  db.games = db.games.filter(g => g.id !== d.gid);
  if (ui.resultGid === d.gid) ui.resultGid = null;
  ui.histGid = null; saveDb(); render();
};

/* ================= Daten & Einstellungen ================= */

function settingsHtml() {
  return `${syncCardHtml()}<section class="card">
    <h3>⚙️ Daten</h3>
    <p class="hint">${sync.code ? 'Der Stand liegt in eurer Gruppe und zusätzlich auf diesem Gerät. Eine Sicherung als Datei schadet trotzdem nie.'
      : 'Alles wird lokal in diesem Browser gespeichert. Mit der Sicherung kannst du die Daten auf ein anderes Gerät mitnehmen.'}</p>
    <div class="btnrow wrap">
      <button class="btn" data-act="exportDb">⬇️ Sicherung speichern</button>
      <button class="btn" data-act="importDb">⬆️ Sicherung laden</button>
      ${hasDemoData() ? '<button class="btn" data-act="demoRemove">🧹 Demo-Daten entfernen</button>' : '<button class="btn" data-act="demoLoad">🧪 Demo-Daten laden</button>'}
      <button class="btn danger" data-act="resetDb">💣 Alles löschen</button>
    </div>
    <input type="file" id="importFile" accept="application/json,.json" hidden>
  </section>`;
}

ACT.exportDb = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }));
  a.download = `wizard-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
ACT.importDb = () => {
  const inp = $('#importFile');
  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    f.text().then(txt => {
      let d;
      try { d = JSON.parse(txt); } catch (e) { d = null; }
      if (!d || !Array.isArray(d.players) || !Array.isArray(d.games)) { alert('Das ist keine gültige Wizard-Sicherung.'); return; }
      if (!confirm(`Sicherung mit ${d.players.length} Spielern und ${d.games.length} Partien laden? Die aktuellen Daten ${sync.code ? 'der ganzen Gruppe' : 'in diesem Browser'} werden ersetzt.`)) return;
      db = d; ui.resultGid = null; ui.setup.sel = [];
      saveDb(); render();
    });
  };
  inp.click();
};
ACT.demoLoad = () => { loadDemoData(); go('fame'); };
ACT.demoRemove = () => {
  if (!confirm('Alle Demo-Spieler und Demo-Partien entfernen? Eigene Daten bleiben erhalten.')) return;
  removeDemoData(); render();
};
ACT.resetDb = () => {
  if (!confirm(sync.code ? 'Wirklich ALLE Spieler, Partien und Statistiken löschen – für ALLE Geräte der Gruppe?'
    : 'Wirklich ALLE Spieler, Partien und Statistiken löschen?')) return;
  if (!confirm('Sicher? Das lässt sich nicht rückgängig machen.')) return;
  db = emptyDb(); ui.resultGid = null; ui.setup.sel = [];
  saveDb(); go('game');
};
