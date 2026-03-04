// sessions.js (SEM import/export)

function getCurrentSession() {
  return state.sessions.find(s => s.id === state.currentSessionId) || null;
}

// gerador simples aqui mesmo pra não depender de import
// gerador do Quarta CH (8 jogos, todo mundo joga 4x)
// schedule guarda referências (pair/winner/loser)
function generateSchedule(pairs) {
  if (!pairs || pairs.length !== 4) return [];

  const [p1, p2, p3, p4] = pairs;

  return [
    { a: { type: "pair", id: p1.id }, b: { type: "pair", id: p2.id }, label: "Jogo 1" },
    { a: { type: "pair", id: p3.id }, b: { type: "pair", id: p4.id }, label: "Jogo 2" },
    { a: { type: "winner", match: 1 }, b: { type: "winner", match: 2 }, label: "Jogo 3 (W1 x W2)" },
    { a: { type: "loser",  match: 1 }, b: { type: "loser",  match: 2 }, label: "Jogo 4 (L1 x L2)" },
    { a: { type: "winner", match: 3 }, b: { type: "winner", match: 4 }, label: "Jogo 5 (W3 x W4)" },
    { a: { type: "loser",  match: 3 }, b: { type: "loser",  match: 4 }, label: "Jogo 6 (L3 x L4)" },
    { a: { type: "winner", match: 5 }, b: { type: "winner", match: 6 }, label: "Jogo 7 (W5 x W6)" },
    { a: { type: "loser",  match: 5 }, b: { type: "loser",  match: 6 }, label: "Jogo 8 (L5 x L6)" },
  ];
}F

function createSession(name, pairs) {
  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now());
  const dateISO = new Date().toISOString().slice(0, 10);

  state.sessions.push({
    id,
    name,
    dateISO,
    pairs,
    roster: pairs.flatMap(p => [p.p1, p.p2]),
    schedule: generateSchedule(pairs),
    nextIndex: 0
  });

  state.currentSessionId = id;
  saveState();
}

// ✅ expõe pro app.js
window.getCurrentSession = getCurrentSession;
window.createSession = createSession;