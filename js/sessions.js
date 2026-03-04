// sessions.js (SEM import/export)

function getCurrentSession() {
  return state.sessions.find(s => s.id === state.currentSessionId) || null;
}

// gerador simples aqui mesmo pra não depender de import
function generateSchedule(pairs, totalMatches = 8) {
  const base = [];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      base.push({ pairAId: pairs[i].id, pairBId: pairs[j].id });
    }
  }

  // embaralha
  base.sort(() => Math.random() - 0.5);

  // round robin dá 6 jogos (4 duplas). completa até 8 repetindo os menos repetidos
  if (base.length >= totalMatches) return base.slice(0, totalMatches);

  const schedule = [...base];
  const count = new Map();
  const key = (a, b) => [a, b].sort().join("::");

  for (const m of schedule) count.set(key(m.pairAId, m.pairBId), (count.get(key(m.pairAId, m.pairBId)) || 0) + 1);

  let guard = 0;
  while (schedule.length < totalMatches && guard++ < 200) {
    const pick = base[Math.floor(Math.random() * base.length)];
    const k = key(pick.pairAId, pick.pairBId);
    const c = count.get(k) || 0;
    if (c >= 2) continue;
    schedule.push({ ...pick });
    count.set(k, c + 1);
  }

  return schedule;
}

function createSession(name, pairs) {
  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now());
  const dateISO = new Date().toISOString().slice(0, 10);

  state.sessions.push({
    id,
    name,
    dateISO,
    pairs,
    roster: pairs.flatMap(p => [p.p1, p.p2]),
    schedule: generateSchedule(pairs, 8),
    nextIndex: 0
  });

  state.currentSessionId = id;
  saveState();
}

// ✅ expõe pro app.js
window.getCurrentSession = getCurrentSession;
window.createSession = createSession;