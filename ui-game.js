/* Wizard Super Power App – Grundgerüst der Oberfläche + Spielansicht */
'use strict';

const ui = {
  view: 'game',
  setup: { sel: [], noEven: false },
  resultGid: null, showChart: false, edit: null, force: false,
  fameN: 0, sort: 'elo', profile: null, histGid: null, emojiPick: false
};

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = ts => new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const signed = v => (v > 0 ? '+' : '') + v;
const who = id => `<span class="who-e">${pEmoji(id)}</span> ${esc(pName(id))}`;

const VIEWS = {};      // name → () => html
const ACT = {};        // data-act → handler(dataset, element)

function render() {
  const keep = window.scrollY;
  $('#app').innerHTML = VIEWS[ui.view]();
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.view === ui.view));
  mountCharts();
  document.querySelectorAll('.chips').forEach(c => {
    const s = c.querySelector('.on');
    if (s) c.scrollLeft = s.offsetLeft - c.clientWidth / 2 + s.offsetWidth / 2;
  });
  window.scrollTo(0, keep);
}

function go(view) { ui.view = view; ui.profile = null; ui.histGid = null; ui.edit = null; render(); window.scrollTo(0, 0); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !ACT[el.dataset.act]) return;
  ACT[el.dataset.act](el.dataset, el);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.enter) ACT[e.target.dataset.enter](e.target.dataset, e.target);
});
window.addEventListener('resize', () => mountCharts());

ACT.nav = d => go(d.view);

/* ================= Spielansicht ================= */

VIEWS.game = () => {
  if (ui.resultGid) {
    const g = db.games.find(x => x.id === ui.resultGid);
    if (g) return resultHtml(g);
    ui.resultGid = null;
  }
  const g = activeGame();
  return g ? playHtml(g) : setupHtml();
};

/* ---------- Neues Spiel ---------- */

function setupHtml() {
  const s = ui.setup;
  s.sel = s.sel.filter(id => playerById(id));
  const list = db.players.filter(p => !p.archived).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const n = s.sel.length, ok = n >= 3 && n <= 6;
  const empty = !db.players.length && !db.games.length;
  return `
  <section class="card">
    <h2>Neues Spiel</h2>
    <p class="hint">Spieler in <b>Sitzreihenfolge</b> (im Uhrzeigersinn) antippen. Wer die <b>1</b> hat, gibt in der ersten Runde.</p>
    <div class="pchips">
      ${list.map(p => {
        const i = s.sel.indexOf(p.id);
        return `<button class="pchip ${i >= 0 ? 'on' : ''}" data-act="togglePlayer" data-id="${p.id}">
          ${i >= 0 ? `<span class="seat">${i + 1}</span>` : ''}<span class="who-e">${p.emoji}</span> ${esc(p.name)}</button>`;
      }).join('') || '<p class="hint">Noch keine Spieler angelegt – trag unten den ersten Namen ein.</p>'}
    </div>
    <div class="addrow">
      <input id="newName" type="text" maxlength="20" placeholder="Neuer Spieler …" data-enter="addPlayerSetup" autocomplete="off">
      <button class="btn" data-act="addPlayerSetup">＋ Hinzufügen</button>
    </div>
    <label class="check"><input type="checkbox" id="noEven" ${s.noEven ? 'checked' : ''} data-act="toggleNoEven">
      Variante: Ansagen dürfen nicht aufgehen <small>(Summe der Ansagen ≠ Anzahl Karten)</small></label>
    <p class="setup-info">${ok ? `<b>${n} Spieler</b> · ${roundsFor(n)} Runden` : n > 6 ? 'Maximal 6 Spieler' : `Noch ${3 - n} Spieler wählen (3 bis 6)`}</p>
    <button class="btn gold big" data-act="startGame" ${ok ? '' : 'disabled'}>✨ Spiel starten</button>
  </section>
  ${empty ? `<section class="card center">
    <h3>Erst mal umschauen?</h3>
    <p class="hint">Lade Demo-Daten mit 7 Zauberern und 16 Spielen, um Ruhmeshalle und Statistiken auszuprobieren. Du kannst sie jederzeit wieder entfernen.</p>
    <button class="btn" data-act="demoLoad">🧪 Demo-Daten laden</button></section>` : ''}`;
}

ACT.togglePlayer = d => {
  const s = ui.setup, i = s.sel.indexOf(d.id);
  if (i >= 0) s.sel.splice(i, 1); else if (s.sel.length < 6) s.sel.push(d.id);
  render();
};
ACT.addPlayerSetup = () => {
  const p = addPlayer($('#newName').value);
  if (!p) return;
  if (!ui.setup.sel.includes(p.id) && ui.setup.sel.length < 6) ui.setup.sel.push(p.id);
  render();
  $('#newName').focus();
};
ACT.toggleNoEven = (d, el) => { ui.setup.noEven = el.checked; };
ACT.startGame = () => {
  if (ui.setup.sel.length < 3 || ui.setup.sel.length > 6) return;
  newGame(ui.setup.sel, { noEven: ui.setup.noEven });
  ui.showChart = false;
  render(); window.scrollTo(0, 0);
};

/* ---------- Der Block ---------- */

function blockHtml(g, editable) {
  const c = calcGame(g), n = c.n, pend = g.pending;
  let body = '';
  for (let r = 0; r < g.total; r++) {
    const row = c.rows[r], cur = !row && pend && r === c.rows.length;
    let tds = '';
    for (let i = 0; i < n; i++) {
      if (row) {
        tds += `<td class="sc ${row.c[i] < 0 ? 'neg' : ''}">${row.c[i]}</td>
          <td class="bd ${row.hit[i] ? 'hit' : 'miss'}"><span class="bid">${row.b[i]}</span><span class="tr">${row.t[i]}</span></td>`;
      } else if (cur) {
        const b = pend.b[i];
        tds += `<td class="sc"></td><td class="bd"><span class="bid pencil">${b === null ? '' : b}</span><span class="tr"></span></td>`;
      } else tds += '<td class="sc"></td><td class="bd"></td>';
    }
    body += `<tr class="${row ? 'done' : cur ? 'cur' : ''}" ${row && editable ? `data-act="editRound" data-ri="${r}"` : ''}><td class="rn">${r + 1}</td>${tds}</tr>`;
  }
  return `
  <div class="block n${n}">
    <div class="block-head"><span class="block-logo">WIZARD</span><span class="block-sub">Block der Wahrheit</span>
      <span class="block-date">${fmtDate(g.started)}</span></div>
    <div class="block-scroll"><table class="bt">
      <colgroup><col class="c-rn">${'<col><col class="c-bd">'.repeat(n)}</colgroup>
      <thead><tr><th class="rn"></th>${g.playerIds.map(id => `<th colspan="2" class="pn"><span>${esc(pName(id))}</span></th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <div class="block-legend"><span>Punkte</span> │ <span>Ansage</span> · <small>Stiche</small>${editable ? ' — Zeile antippen zum Korrigieren' : ''}</div>
  </div>`;
}

function standingsHtml(g) {
  const c = calcGame(g), n = c.n;
  const streak = i => { let k = 0; for (let r = c.rows.length - 1; r >= 0 && c.rows[r].hit[i]; r--) k++; return k; };
  const order = [...Array(n).keys()].sort((a, b) => c.total[b] - c.total[a]);
  return `<div class="standings">${order.map(i => `
    <div class="st ${c.place[i] === 1 && c.rows.length ? 'lead' : ''}">
      <span class="st-pl">${c.place[i]}.</span>
      <span class="st-n">${who(g.playerIds[i])}</span>
      <span class="st-v">${c.total[i]}</span>
      ${streak(i) >= 3 ? `<span class="st-f" title="Treffer-Serie">🔥${streak(i)}</span>` : ''}
    </div>`).join('')}</div>`;
}

/* ---------- Laufendes Spiel ---------- */

function playHtml(g) {
  const p = g.pending, rn = g.rounds.length + 1, cards = rn, n = g.playerIds.length;
  const order = bidOrder(g, rn), dealer = dealerOf(g, rn);
  const isB = p.phase === 'b', vals = isB ? p.b : p.t;
  const sum = vals.reduce((a, v) => a + (v || 0), 0), allSet = vals.every(v => v !== null);

  let forbidden = -1;                       // ±1-Regel: verbotene Ansage des Gebers
  if (isB && g.opt.noEven) {
    const others = p.b.filter((v, i) => i !== dealer);
    if (others.every(v => v !== null)) forbidden = cards - others.reduce((a, v) => a + v, 0);
  }

  const rows = order.map(i => `
    <div class="erow">
      <div class="ewho">${who(g.playerIds[i])}
        ${i === dealer ? '<span class="tag">Geber</span>' : ''}${!isB ? `<span class="tag blue">sagt ${p.b[i]}</span>` : ''}</div>
      <div class="chips">${Array.from({ length: cards + 1 }, (_, v) =>
        `<button class="chip ${vals[i] === v ? 'on' : ''} ${isB && i === dealer && v === forbidden ? 'no' : ''}" data-act="pick" data-i="${i}" data-v="${v}">${v}</button>`).join('')}</div>
    </div>`).join('');

  let status, btn;
  if (isB) {
    const diff = sum - cards, bad = g.opt.noEven && allSet && diff === 0;
    status = !allSet ? `Angesagt: <b>${sum}</b> bei ${cards} ${cards === 1 ? 'Karte' : 'Karten'}`
      : bad ? '⚠️ Ansagen gehen auf – der Geber muss anders ansagen'
      : diff === 0 ? `Angesagt: <b>${sum}</b> – geht genau auf`
      : `Angesagt: <b>${sum}</b> bei ${cards} – ${Math.abs(diff)} ${diff > 0 ? 'zu viel, es wird gekämpft ⚔️' : 'zu wenig, keiner will stechen 🙅'}`;
    btn = `<button class="btn gold big" data-act="lockBids" ${allSet && !bad ? '' : 'disabled'}>Ansagen fixieren →</button>`;
  } else {
    const okSum = sum === cards;
    status = okSum ? `Stiche verteilt: <b>${sum}</b> von ${cards} ✓` : `Stiche verteilt: <b>${sum}</b> von ${cards} – ${sum > cards ? 'zu viele!' : 'da fehlt noch was'}`;
    btn = `<div class="btnrow"><button class="btn" data-act="backToBids">← Ansagen</button>
      <button class="btn gold big" data-act="scoreRound" ${okSum || (ui.force && sum < cards) ? '' : 'disabled'}>Runde werten ✓</button></div>
      ${!okSum && sum < cards && !ui.force ? '<button class="link" data-act="forceSum">Stich fehlt absichtlich (z. B. Bombe)? Trotzdem werten</button>' : ''}`;
  }

  return `
  ${standingsHtml(g)}
  <section class="card entry">
    <div class="entry-head">
      <h2>Runde ${rn} <small>von ${g.total}</small></h2>
      <div class="steps"><span class="${isB ? 'on' : 'ok'}">① Ansagen</span><span class="${isB ? '' : 'on'}">② Stiche</span></div>
    </div>
    <p class="hint">${cards} ${cards === 1 ? 'Karte' : 'Karten'} pro Spieler · ${esc(pName(g.playerIds[dealer]))} gibt · ${esc(pName(g.playerIds[order[0]]))} ${isB ? 'sagt zuerst an' : 'spielt aus'}</p>
    ${rows}
    <p class="estatus">${status}</p>
    ${btn}
  </section>
  ${blockHtml(g, true)}
  ${ui.showChart && g.rounds.length ? chartHtml(g) : ''}
  <div class="btnrow wrap">
    ${g.rounds.length ? `<button class="btn" data-act="toggleChart">📈 Verlauf ${ui.showChart ? 'ausblenden' : 'anzeigen'}</button>
    <button class="btn" data-act="undoRound">↩︎ Letzte Runde korrigieren</button>` : ''}
    <button class="btn danger" data-act="abortGame">✖︎ Spiel ${g.rounds.length ? 'vorzeitig beenden' : 'verwerfen'}</button>
  </div>
  ${ui.edit ? editHtml(g) : ''}`;
}

ACT.pick = (d, el) => {
  if (el.classList.contains('no')) return;
  const g = activeGame(), p = g.pending;
  (p.phase === 'b' ? p.b : p.t)[+d.i] = +d.v;
  ui.force = false;
  saveDb(); render();
};
ACT.lockBids = () => {
  const p = activeGame().pending;
  p.phase = 't';
  p.t = p.t.map((v, i) => v === null ? p.b[i] : v);   // Vorbelegung: Ansage getroffen
  saveDb(); render();
};
ACT.backToBids = () => { activeGame().pending.phase = 'b'; ui.force = false; saveDb(); render(); };
ACT.forceSum = () => { ui.force = true; render(); };
ACT.scoreRound = () => {
  const g = activeGame();
  ui.force = false;
  commitRound(g);
  if (g.status === 'finished') { ui.resultGid = g.id; render(); window.scrollTo(0, 0); confetti(); }
  else { render(); window.scrollTo(0, 0); }
};
ACT.toggleChart = () => { ui.showChart = !ui.showChart; render(); };
ACT.undoRound = () => { reopenLastRound(activeGame()); render(); window.scrollTo(0, 0); };
ACT.abortGame = () => {
  const g = activeGame();
  const msg = g.rounds.length
    ? 'Spiel jetzt vorzeitig beenden? Die gespielten Runden zählen für Runden-Statistiken (Serien, Trefferquote), aber nicht für Siege und Punkte-Rekorde.'
    : 'Dieses Spiel verwerfen?';
  if (!confirm(msg)) return;
  abortGame(g);
  render(); window.scrollTo(0, 0);
};

/* ---------- Runde nachträglich korrigieren ---------- */

function editHtml(g) {
  const e = ui.edit, cards = e.ri + 1, sum = e.t.reduce((a, v) => a + v, 0);
  const step = (f, i) => `<div class="stepper"><button data-act="editStep" data-f="${f}" data-i="${i}" data-d="-1">−</button>
    <b>${e[f][i]}</b><button data-act="editStep" data-f="${f}" data-i="${i}" data-d="1">＋</button></div>`;
  return `<div class="modal" data-act="editClose"><div class="modal-box" data-act="noop">
    <h2>Runde ${cards} korrigieren</h2>
    <div class="edit-grid"><span></span><span class="eh">Ansage</span><span class="eh">Stiche</span>
      ${g.playerIds.map((id, i) => `<span class="ewho">${who(id)}</span>${step('b', i)}${step('t', i)}`).join('')}</div>
    <p class="estatus">${sum === cards ? `Stiche: ${sum} von ${cards} ✓` : `⚠️ Stiche: ${sum} von ${cards}`}</p>
    <div class="btnrow"><button class="btn" data-act="editClose">Abbrechen</button>
      <button class="btn gold" data-act="editSave">Speichern</button></div>
  </div></div>`;
}

ACT.noop = () => {};
ACT.editRound = d => {
  const g = activeGame(), r = g.rounds[+d.ri];
  ui.edit = { ri: +d.ri, b: r.b.slice(), t: r.t.slice() };
  render();
};
ACT.editStep = d => {
  const e = ui.edit, a = e[d.f], i = +d.i;
  a[i] = Math.max(0, Math.min(e.ri + 1, a[i] + +d.d));
  render();
};
ACT.editClose = (d, el) => { ui.edit = null; render(); };
ACT.editSave = () => {
  const g = activeGame(), e = ui.edit;
  g.rounds[e.ri] = { b: e.b, t: e.t };
  ui.edit = null;
  saveDb(); render();
};

/* ---------- Endstand ---------- */

function resultHtml(g) {
  const c = calcGame(g), n = c.n, st = computeStats(0);
  const order = [...Array(n).keys()].sort((a, b) => c.total[b] - c.total[a]);
  const medal = ['🥇', '🥈', '🥉'];
  const recs = recordsSetBy(g.id);
  const delta = st.eloDelta[g.id] || {};
  const winners = order.filter(i => c.place[i] === 1).map(i => pName(g.playerIds[i]));
  return `
  <section class="card result">
    <div class="crown">🏆</div>
    <h2>${esc(winners.join(' & '))} ${winners.length > 1 ? 'gewinnen' : 'gewinnt'}!</h2>
    <div class="podium">${order.map(i => {
      const id = g.playerIds[i], hits = c.rows.filter(r => r.hit[i]).length, dl = delta[id] || 0;
      return `<div class="prow p${c.place[i]}">
        <span class="pm">${medal[c.place[i] - 1] || c.place[i] + '.'}</span>
        <span class="pn2">${who(id)}<small>${hits} von ${c.rows.length} Ansagen richtig · Zauberkraft ${signed(Math.round(dl))}</small></span>
        <span class="pv">${c.total[i]}</span></div>`;
    }).join('')}</div>
  </section>
  ${recs.length ? `<section class="card">
    <h3>✨ Neue Bestmarken in diesem Spiel</h3>
    ${recs.map(x => `<div class="newrec"><span class="ri">${x.r.icon}</span><span><b>${x.r.title}</b><small>${who(x.e.pid)} · ${x.r.fmt(x.e.v)}</small></span></div>`).join('')}
  </section>` : ''}
  ${chartHtml(g)}
  ${blockHtml(g, false)}
  <div class="btnrow wrap">
    <button class="btn gold" data-act="rematch" data-gid="${g.id}">🔁 Revanche (gleiche Runde)</button>
    <button class="btn" data-act="closeResult">Neues Spiel</button>
    <button class="btn" data-act="nav" data-view="fame">🏛️ Ruhmeshalle</button>
  </div>`;
}

ACT.closeResult = () => { ui.resultGid = null; ui.setup.sel = []; render(); window.scrollTo(0, 0); };
ACT.rematch = d => {
  const g = db.games.find(x => x.id === d.gid);
  const ids = g.playerIds.filter(id => playerById(id));
  ui.setup.sel = ids.slice(1).concat(ids.slice(0, 1));     // Geber wandert weiter
  ui.setup.noEven = !!g.opt.noEven;
  ui.resultGid = null;
  render(); window.scrollTo(0, 0);
};

function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const bits = ['✨', '⭐️', '🃏', '🎉', '🔮', '💫'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.textContent = bits[i % bits.length];
    s.style.left = Math.random() * 100 + '%';
    s.style.animationDelay = Math.random() * 1.2 + 's';
    s.style.fontSize = 14 + Math.random() * 18 + 'px';
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4500);
}
