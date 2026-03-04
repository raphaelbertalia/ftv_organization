// matches.js

function getCurrentSession() {
  return state.sessions.find(s => s.id === state.currentSessionId) || null;
}

function assertScore(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 && Number.isInteger(v);
}

function addMatch(pairAId, pairBId, scoreA, scoreB) {
  const session = getCurrentSession();
  if (!session) return alert("Inicie uma sessão antes.");

  if (!pairAId || !pairBId || pairAId === pairBId) return alert("Selecione duas duplas diferentes.");
  if (!assertScore(scoreA) || !assertScore(scoreB)) return alert("Placar inválido.");

  state.matches = state.matches || [];

  const match = {
    id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now()),
    createdAt: Date.now(),
    dateISO: session.dateISO,
    sessionId: session.id,
    scheduleIndex: null, // agora quem manda é o app.js (sequência dinâmica)
    pairAId,
    pairBId,
    scoreA: Number(scoreA),
    scoreB: Number(scoreB)
  };

  state.matches.push(match);

  saveState();
}

function undoLastMatchOfCurrentSession() {
  const session = getCurrentSession();
  if (!session) return alert("Sem sessão ativa.");
  state.matches = state.matches || [];

  for (let i = state.matches.length - 1; i >= 0; i--) {
    const m = state.matches[i];
    if (m.sessionId === session.id) {
      state.matches.splice(i, 1);
      saveState();
      return;
    }
  }

  alert("Não tem jogo dessa sessão pra desfazer.");
}

// ✅ expõe pro app.js
window.addMatch = addMatch;
window.undoLastMatchOfCurrentSession = undoLastMatchOfCurrentSession;