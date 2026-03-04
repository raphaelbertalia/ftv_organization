// matches.js

function getCurrentSession() {
  return state.sessions.find(s => s.id === state.currentSessionId) || null;
}

function assertScore(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 && Number.isInteger(v);
}

function getMatchesOfSession(sessionId) {
  state.matches = state.matches || [];
  return state.matches.filter(m => m.sessionId === sessionId);
}

function getMatchByScheduleIndex(sessionId, idx) {
  return getMatchesOfSession(sessionId).find(m => m.scheduleIndex === idx) || null;
}

function getWinnerLoserPairId(match, want /* "winner" | "loser" */) {
  if (!match) return null;
  if (match.scoreA === match.scoreB) return null; // empate -> não resolve

  const winnerId = match.scoreA > match.scoreB ? match.pairAId : match.pairBId;
  const loserId  = match.scoreA > match.scoreB ? match.pairBId : match.pairAId;

  return want === "winner" ? winnerId : loserId;
}

function resolvePairId(session, ref) {
  // ref: { type:"pair", id } | { type:"winner"/"loser", match: <1..8> }
  if (!ref) return null;

  if (ref.type === "pair") return ref.id;

  const prevIdx = Number(ref.match) - 1; // match 1..8 -> idx 0..7
  const prev = getMatchByScheduleIndex(session.id, prevIdx);
  if (!prev) return null;

  return getWinnerLoserPairId(prev, ref.type); // "winner" ou "loser"
}

function getExpectedPairsForScheduleIndex(session, idx) {
  const sch = session.schedule?.[idx];
  if (!sch) return null; // sessão sem schedule

  const aId = resolvePairId(session, sch.a);
  const bId = resolvePairId(session, sch.b);

  if (!aId || !bId || aId === bId) return null;
  return { aId, bId };
}

function isSameFixture(p1a, p1b, p2a, p2b) {
  // compara ignorando ordem
  const x = [p1a, p1b].sort().join("::");
  const y = [p2a, p2b].sort().join("::");
  return x === y;
}

function addMatch(pairAId, pairBId, scoreA, scoreB, scheduleIndexArg) {
  const session = getCurrentSession();
  if (!session) return alert("Inicie uma sessão antes.");

  if (!pairAId || !pairBId || pairAId === pairBId) return alert("Selecione duas duplas diferentes.");
  if (!assertScore(scoreA) || !assertScore(scoreB)) return alert("Placar inválido.");

  state.matches = state.matches || [];

  // decide o scheduleIndex (prioriza o que veio do app.js)
  const scheduleIndex =
    Number.isInteger(scheduleIndexArg)
      ? scheduleIndexArg
      : getMatchesOfSession(session.id).length; // 0..7 (ordem de cadastro)

  // valida contra o schedule (se existir)
  if (session.schedule?.length) {
    if (scheduleIndex < 0 || scheduleIndex >= session.schedule.length) {
      return alert("Esse jogo está fora da sequência da sessão.");
    }

    // impede duplicar o mesmo índice
    if (getMatchByScheduleIndex(session.id, scheduleIndex)) {
      return alert("Esse jogo da sequência já foi registrado.");
    }

    const expected = getExpectedPairsForScheduleIndex(session, scheduleIndex);
    if (!expected) {
      return alert("Ainda não dá pra montar esse jogo. Termine os jogos anteriores primeiro (sem empates).");
    }

    if (!isSameFixture(pairAId, pairBId, expected.aId, expected.bId)) {
      return alert("As duplas selecionadas não batem com o próximo jogo da sequência.");
    }
  }

  const match = {
    id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now()),
    createdAt: Date.now(),
    dateISO: session.dateISO,
    sessionId: session.id,
    scheduleIndex, // ✅ agora fica salvo
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

  // remove o último match da sessão (pela createdAt)
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
    state.matches.splice(lastIdx, 1);
    saveState();
    return;
  }

  alert("Não tem jogo dessa sessão pra desfazer.");
}

// ✅ expõe pro app.js
window.addMatch = addMatch;
window.undoLastMatchOfCurrentSession = undoLastMatchOfCurrentSession;

// (opcional) helper pro app.js montar “próximo jogo”
window.getExpectedPairsForScheduleIndex = function(idx) {
  const session = getCurrentSession();
  if (!session) return null;
  return getExpectedPairsForScheduleIndex(session, idx);
};