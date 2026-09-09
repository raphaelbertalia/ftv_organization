// sessions.js (SEM import/export)

function getCurrentSession() {
  const sess = state.sessions.find(s => s.id === state.currentSessionId);

  if (!sess || sess.status !== "em_andamento") {
    return null;
  }

  return sess;
}

function generateSchedule(pairs) {
  if (!pairs || pairs.length !== 4) return [];

  const [p1, p2, p3, p4] = pairs;

  return [
    { a: { type: "pair", id: p1.id }, b: { type: "pair", id: p2.id }, label: "Jogo 1" },
    { a: { type: "pair", id: p3.id }, b: { type: "pair", id: p4.id }, label: "Jogo 2" },
    { a: { type: "winner", match: 1 }, b: { type: "winner", match: 2 }, label: "Jogo 3 (W1 x W2)" },
    { a: { type: "loser", match: 1 }, b: { type: "loser", match: 2 }, label: "Jogo 4 (L1 x L2)" },
    { a: { type: "winner", match: 3 }, b: { type: "winner", match: 4 }, label: "Jogo 5 (W3 x W4)" },
    { a: { type: "loser", match: 3 }, b: { type: "loser", match: 4 }, label: "Jogo 6 (L3 x L4)" },
    { a: { type: "winner", match: 5 }, b: { type: "winner", match: 6 }, label: "Jogo 7 (W5 x W6)" },
    { a: { type: "loser", match: 5 }, b: { type: "loser", match: 6 }, label: "Jogo 8 (L5 x L6)" },
  ];
}

async function syncSessionToDb(session) {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: session.id,
      date_iso: session.dateISO,
      name: session.name,
      play_mode: session.playMode || "fixed",
      participant_ids: session.participantIds || [],
      group_id: state.auth?.currentGroupId || null
    })
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  return data;
}

function syncPairsToDb(session) {
  (session.pairs || []).forEach((pair, index) => {
    fetch("/api/pairs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: pair.id,
        session_id: session.id,
        p1: pair.p1,
        p2: pair.p2,
        position: index + 1
      })
    }).catch(err => console.error("Erro ao salvar dupla no banco:", err));
  });
}

async function createSession(
  name,
  pairs = [],
  options = {}
) {
  const id = (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : (
      Math.random()
        .toString(36)
        .slice(2) +
      Date.now()
    );

  const dateISO =
    new Date()
      .toISOString()
      .slice(0, 10);

  const pairParticipantIds = [
    ...new Set(
      (pairs || [])
        .flatMap(
          pair => [
            pair.p1,
            pair.p2
          ]
        )
        .filter(Boolean)
        .map(String)
    )
  ];

  const participantIds =
    Array.isArray(options.participantIds) &&
      options.participantIds.length
      ? [
        ...new Set(
          options.participantIds
            .filter(Boolean)
            .map(String)
        )
      ]
      : pairParticipantIds;

  if (participantIds.length < 4) {
    throw new Error(
      "A sessão precisa ter pelo menos 4 participantes."
    );
  }

  const playMode =
    options.playMode ||
    (
      participantIds.length % 2 === 0
        ? "fixed"
        : "rotation"
    );

  if (
    !["fixed", "rotation"]
      .includes(playMode)
  ) {
    throw new Error(
      "Modo de sessão inválido."
    );
  }

  if (
    playMode === "fixed" &&
    participantIds.length % 2 !== 0
  ) {
    throw new Error(
      "Duplas fixas exigem uma quantidade par de jogadores."
    );
  }

  if (
    playMode === "rotation" &&
    participantIds.length % 2 === 0
  ) {
    throw new Error(
      "O rodízio deve ser utilizado com quantidade ímpar de jogadores."
    );
  }

  const session = {
    id,
    name,
    dateISO,

    pairs:
      Array.isArray(pairs)
        ? pairs
        : [],

    /*
     * O ranking continua usando roster.
     * Aqui preservamos todos os participantes
     * definidos no início da sessão.
     */
    roster: [
      ...participantIds
    ],

    /*
     * Par   = duplas fixas
     * Ímpar = rodízio
     */
    playMode,

    participantIds,

    /*
     * Sessões novas são abertas.
     * Não possuem mais uma agenda fechada
     * obrigatória de 8 jogos.
     */
    schedule: null,

    nextIndex: 0,

    pendingPairAId: null,
    pendingPairBId: null
  };

  state.sessions.push(session);

  state.currentSessionId = id;

  saveState();

  await syncSessionToDb(session);

  /*
   * No modo fixo já existem as duplas
   * definitivas da sessão.
   *
   * No rodízio as duplas serão criadas
   * conforme os confrontos forem surgindo.
   */
  if (
    playMode === "fixed" &&
    session.pairs.length
  ) {
    syncPairsToDb(session);
  }

  return session;
}

window.getCurrentSession = getCurrentSession;
window.createSession = createSession;