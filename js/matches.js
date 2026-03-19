// matches.js

function getCurrentSession() {
  return state.sessions.find(s => s.id === state.currentSessionId) || null;
}

function assertScore(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 && Number.isInteger(v);
}

function isValidFinalScore(scoreA, scoreB) {
  const a = Number(scoreA);
  const b = Number(scoreB);

  if (!assertScore(a) || !assertScore(b)) return false;
  if (a === b) return false;

  const max = Math.max(a, b);
  const min = Math.min(a, b);

  if (max < 18) return false;

  // terminou no limite normal
  if (min < 17) {
    return max === 18;
  }

  // a partir de 17x17, precisa abrir 2
  return (max - min) === 2;
}

function getMatchesOfSession(sessionId) {
  state.matches = state.matches || [];
  return state.matches.filter(m => m.sessionId === sessionId);
}

function getMatchByScheduleIndex(sessionId, idx) {
  return getMatchesOfSession(sessionId).find(m => m.scheduleIndex === idx) || null;
}

function getWinnerLoserPairId(match, want) {
  if (!match) return null;
  if (match.scoreA === match.scoreB) return null;

  const winnerId = match.scoreA > match.scoreB ? match.pairAId : match.pairBId;
  const loserId = match.scoreA > match.scoreB ? match.pairBId : match.pairAId;

  return want === "winner" ? winnerId : loserId;
}

function resolvePairId(session, ref) {
  if (!ref) return null;
  if (ref.type === "pair") return ref.id;

  const prevIdx = Number(ref.match) - 1;
  const prev = getMatchByScheduleIndex(session.id, prevIdx);
  if (!prev) return null;

  return getWinnerLoserPairId(prev, ref.type);
}

function getExpectedPairsForScheduleIndex(session, idx) {
  const sch = session.schedule?.[idx];
  if (!sch) return null;

  const aId = resolvePairId(session, sch.a);
  const bId = resolvePairId(session, sch.b);

  if (!aId || !bId || aId === bId) return null;
  return { aId, bId };
}

function computeExpectedPairsForScheduleIndex(session, idx) {
  const sch = session.schedule?.[idx];
  if (!sch) return null;

  const aId = resolvePairId(session, sch.a);
  const bId = resolvePairId(session, sch.b);

  if (!aId || !bId || aId === bId) return null;
  return { aId, bId };
}

function isSameFixture(p1a, p1b, p2a, p2b) {
  const x = [p1a, p1b].sort().join("::");
  const y = [p2a, p2b].sort().join("::");
  return x === y;
}

function syncMatchToDb(match) {
  return fetch("/api/matches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: match.id,
      session_id: match.sessionId,
      pair_a: match.pairAId,
      pair_b: match.pairBId,
      score_a: match.scoreA,
      score_b: match.scoreB,
      schedule_index: match.scheduleIndex,
      created_at: match.createdAt
    })
  }).catch(err => console.error("Erro ao salvar jogo no banco:", err));
}

function deleteMatchFromDb(matchId) {
  return fetch("/api/matches", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: matchId })
  }).catch(err => console.error("Erro ao apagar jogo no banco:", err));
}

function addMatch(pairAId, pairBId, scoreA, scoreB, scheduleIndexArg) {
  const session = getCurrentSession();
  if (!session) return alert("Inicie uma sessão antes.");

  if (!pairAId || !pairBId || pairAId === pairBId) return alert("Selecione duas duplas diferentes.");
  if (!isValidFinalScore(scoreA, scoreB)) {
    return alert("Placar inválido. Vai até 18, mas em 17x17 vence quem abrir 2.");
  }

  state.matches = state.matches || [];

  const scheduleIndex =
    Number.isInteger(scheduleIndexArg)
      ? scheduleIndexArg
      : getMatchesOfSession(session.id).length;

  if (session.schedule?.length) {
    if (scheduleIndex < 0 || scheduleIndex >= session.schedule.length) {
      return alert("Esse jogo está fora da sequência da sessão.");
    }

    if (getMatchByScheduleIndex(session.id, scheduleIndex)) {
      return alert("Esse jogo da sequência já foi registrado.");
    }

    const expected = computeExpectedPairsForScheduleIndex(session, scheduleIndex);
    if (!expected) {
      return alert("Ainda não dá pra montar esse jogo. Termine os jogos anteriores primeiro (sem empates).");
    }

    if (!isSameFixture(pairAId, pairBId, expected.aId, expected.bId)) {
      return alert("As duplas selecionadas não batem com o próximo jogo da sequência.");
    }
  }

  const match = {
    id: (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Math.random().toString(36).slice(2) + Date.now()),
    createdAt: Date.now(),
    dateISO: session.dateISO,
    sessionId: session.id,
    scheduleIndex,
    pairAId,
    pairBId,
    scoreA: Number(scoreA),
    scoreB: Number(scoreB)
  };

  state.matches.push(match);
  saveState();
  syncMatchToDb(match);
}

function undoLastMatchOfCurrentSession() {
  const session = getCurrentSession();
  if (!session) return alert("Sem sessão ativa.");
  state.matches = state.matches || [];

  let lastIdx = -1;
  let lastTime = -Infinity;

  for (let i = 0; i < state.matches.length; i++) {
    const m = state.matches[i];
    if (m.sessionId === session.id && m.createdAt > lastTime) {
      lastTime = m.createdAt;
      lastIdx = i;
    }
  }

  if (lastIdx >= 0) {
    const removed = state.matches[lastIdx];
    state.matches.splice(lastIdx, 1);
    saveState();
    deleteMatchFromDb(removed.id);
    return;
  }

  alert("Não tem jogo dessa sessão pra desfazer.");
}

window.addMatch = addMatch;
window.undoLastMatchOfCurrentSession = undoLastMatchOfCurrentSession;
window.syncMatchToDb = syncMatchToDb;
window.deleteMatchFromDb = deleteMatchFromDb;

window.getExpectedPairsForScheduleIndex = function (idx) {
  const session = getCurrentSession();
  if (!session) return null;
  return computeExpectedPairsForScheduleIndex(session, idx);
};