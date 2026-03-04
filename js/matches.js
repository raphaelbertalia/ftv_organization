// matches.js

function getCurrentSession() {
  return state.sessions.find(s => s.id === state.currentSessionId) || null;
}

function assertScore(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 && Number.isInteger(v);
}

function makePairKey(aId, bId) {
  return [aId, bId].sort().join("::");
}

function addMatch(pairAId, pairBId, scoreA, scoreB) {
  const session = getCurrentSession();
  if (!session) return alert("Inicie uma sessão antes.");

  if (!pairAId || !pairBId || pairAId === pairBId) return alert("Selecione duas duplas diferentes.");
  if (!assertScore(scoreA) || !assertScore(scoreB)) return alert("Placar inválido.");

  state.matches = state.matches || [];

  // valida contra o schedule (se existir)
  const idx = Number(session.nextIndex || 0);
  const planned = (session.schedule || [])[idx];
  if (planned) {
    const plannedKey = makePairKey(planned.pairAId, planned.pairBId);
    const actualKey = makePairKey(pairAId, pairBId);

    if (plannedKey !== actualKey) {
      return alert("Esse não é o próximo jogo do rodízio 😉\nUse o 'Próximo jogo' ou selecione as duplas corretas.");
    }
  }

  const match = {
    id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now()),
    createdAt: Date.now(),
    dateISO: session.dateISO,
    sessionId: session.id,
    scheduleIndex: idx,
    pairAId,
    pairBId,
    scoreA: Number(scoreA),
    scoreB: Number(scoreB)
  };

  state.matches.push(match);

  // avança rodízio
  session.nextIndex = idx + 1;

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

      if (typeof m.scheduleIndex === "number") {
        session.nextIndex = Math.max(0, m.scheduleIndex);
      } else {
        session.nextIndex = Math.max(0, Number(session.nextIndex || 0) - 1);
      }

      saveState();
      return;
    }
  }

  alert("Não tem jogo dessa sessão pra desfazer.");
}

// ✅ expõe pro app.js (e pra outros scripts)
window.addMatch = addMatch;
window.undoLastMatchOfCurrentSession = undoLastMatchOfCurrentSession;