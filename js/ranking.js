// ranking.js — Ranking INDIVIDUAL

(function () {

  function emptyStats(player) {
    return {
      playerId: player.id,
      name: player.name,
      played: 0,
      wins: 0,
      losses: 0,
      points: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      diff: 0
    };
  }

  function computeRanking(session, allMatches = []) {
    if (!session) return [];

    const byId = new Map();

    // cria stats pra todos jogadores da sessão
    (session.roster || []).forEach(pid => {
      const player = state.players.find(p => p.id === pid);
      if (player) byId.set(pid, emptyStats(player));
    });

    const matches = (allMatches || []).filter(m => m.sessionId === session.id);

    for (const m of matches) {

      const pairA = session.pairs.find(p => p.id === m.pairAId);
      const pairB = session.pairs.find(p => p.id === m.pairBId);
      if (!pairA || !pairB) continue;

      const scoreA = Number(m.scoreA);
      const scoreB = Number(m.scoreB);

      const playersA = [pairA.p1, pairA.p2];
      const playersB = [pairB.p1, pairB.p2];

      playersA.forEach(pid => {
        const s = byId.get(pid);
        if (!s) return;
        s.played++;
        s.pointsFor += scoreA;
        s.pointsAgainst += scoreB;
      });

      playersB.forEach(pid => {
        const s = byId.get(pid);
        if (!s) return;
        s.played++;
        s.pointsFor += scoreB;
        s.pointsAgainst += scoreA;
      });

      if (scoreA > scoreB) {
        playersA.forEach(pid => {
          const s = byId.get(pid);
          if (!s) return;
          s.wins++;
          s.points += 3;
        });
        playersB.forEach(pid => {
          const s = byId.get(pid);
          if (!s) return;
          s.losses++;
        });
      } else {
        playersB.forEach(pid => {
          const s = byId.get(pid);
          if (!s) return;
          s.wins++;
          s.points += 3;
        });
        playersA.forEach(pid => {
          const s = byId.get(pid);
          if (!s) return;
          s.losses++;
        });
      }
    }

    const table = [...byId.values()].map(s => ({
      ...s,
      diff: s.pointsFor - s.pointsAgainst
    }));

    table.sort((a, b) =>
      (b.points - a.points) ||
      (b.diff - a.diff) ||
      (b.pointsFor - a.pointsFor)
    );

    return table;
  }

  function renderRanking() {
    const sess = window.getCurrentSession();
    const data = computeRanking(sess, state.matches || []);

    const el = document.getElementById("rankingTable");
    if (!el) return;

    el.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Jogador</th>
            <th>J</th>
            <th>V</th>
            <th>D</th>
            <th>Pontos</th>
            <th>Saldo</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${r.name}</td>
              <td>${r.played}</td>
              <td>${r.wins}</td>
              <td>${r.losses}</td>
              <td>${r.points}</td>
              <td>${r.diff}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  window.computeRanking = computeRanking;
  window.renderRanking = renderRanking;

})();