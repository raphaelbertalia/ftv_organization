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
      diff: 0,
      bonus: 0
    };
  }

  function getPeriodValue() {
    return document.getElementById("period")?.value || "session";
  }

  function getSortValue() {
    return document.getElementById("sortBy")?.value || "points";
  }

  function getShowOnlyValue() {
    return document.getElementById("showOnly")?.value || "all";
  }

  function todayISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(Date.now() - tz).toISOString().slice(0, 10);
  }

  function getSessionsForRanking() {
    const period = String(getPeriodValue() || "").toLowerCase();
    const sessions = (state.sessions || []).slice();

    if (period === "all" || period === "tudo" || period === "todas") {
      return sessions;
    }

    if (period === "today" || period === "hoje") {
      const today = todayISO();
      return sessions.filter(s => String(s.dateISO) === String(today));
    }

    if (
      period === "session" ||
      period === "current" ||
      period === "sessao_atual" ||
      period === "sessão atual"
    ) {
      const current = window.getCurrentSession?.() || null;
      return current ? [current] : [];
    }

    const current = window.getCurrentSession?.() || null;
    return current ? [current] : [];
  }

  function computeRankingForSessions(sessions, allMatches = []) {
    if (!sessions || !sessions.length) return [];

    const statsByPlayer = new Map();
    const sessionsById = new Map();
    const allPairsById = new Map();

    sessions.forEach(session => {
      sessionsById.set(String(session.id), session);

      (session.pairs || []).forEach(pair => {
        allPairsById.set(String(pair.id), pair);
      });

      const roster = Array.isArray(session.roster) ? session.roster : [];
      roster.forEach(pid => {
        const player = (state.players || []).find(p => String(p.id) === String(pid));
        if (!player) return;

        if (!statsByPlayer.has(String(pid))) {
          statsByPlayer.set(String(pid), emptyStats(player));
        }
      });
    });

    const matches = (allMatches || []).filter(m =>
      sessionsById.has(String(m.sessionId))
    );

    for (const m of matches) {
      const session = sessionsById.get(String(m.sessionId));
      if (!session) continue;

      const pairA =
        (session.pairs || []).find(p => String(p.id) === String(m.pairAId)) ||
        allPairsById.get(String(m.pairAId));

      const pairB =
        (session.pairs || []).find(p => String(p.id) === String(m.pairBId)) ||
        allPairsById.get(String(m.pairBId));

      if (!pairA || !pairB) {
        console.warn("Par não encontrado no ranking:", {
          matchId: m.id,
          sessionId: m.sessionId,
          pairAId: m.pairAId,
          pairBId: m.pairBId,
          sessionPairs: session.pairs || []
        });
        continue;
      }

      const scoreA = Number(m.scoreA);
      const scoreB = Number(m.scoreB);

      if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
        continue;
      }

      const playersA = [pairA.p1, pairA.p2];
      const playersB = [pairB.p1, pairB.p2];

      playersA.forEach(pid => {
        const key = String(pid);
        const player = (state.players || []).find(p => String(p.id) === key);

        if (!statsByPlayer.has(key) && player) {
          statsByPlayer.set(key, emptyStats(player));
        }

        const s = statsByPlayer.get(key);
        if (!s) return;

        s.played++;
        s.pointsFor += scoreA;
        s.pointsAgainst += scoreB;
      });

      playersB.forEach(pid => {
        const key = String(pid);
        const player = (state.players || []).find(p => String(p.id) === key);

        if (!statsByPlayer.has(key) && player) {
          statsByPlayer.set(key, emptyStats(player));
        }

        const s = statsByPlayer.get(key);
        if (!s) return;

        s.played++;
        s.pointsFor += scoreB;
        s.pointsAgainst += scoreA;
      });

      const pointsWinA = (scoreA === 18 && scoreB === 0) ? 4 : 3;
      const pointsWinB = (scoreB === 18 && scoreA === 0) ? 4 : 3;

      if (scoreA > scoreB) {
        playersA.forEach(pid => {
          const s = statsByPlayer.get(String(pid));
          if (!s) return;
          s.wins++;
          s.points += pointsWinA;
        });

        playersB.forEach(pid => {
          const s = statsByPlayer.get(String(pid));
          if (!s) return;
          s.losses++;
        });
      } else if (scoreB > scoreA) {
        playersB.forEach(pid => {
          const s = statsByPlayer.get(String(pid));
          if (!s) return;
          s.wins++;
          s.points += pointsWinB;
        });

        playersA.forEach(pid => {
          const s = statsByPlayer.get(String(pid));
          if (!s) return;
          s.losses++;
        });
      }
    }

    const table = [...statsByPlayer.values()].map(s => ({
      ...s,
      diff: s.pointsFor - s.pointsAgainst,
      bonus: s.points - (s.wins * 3)
    }));

    const sortBy = getSortValue();

    table.sort((a, b) => {
      if (sortBy === "wins") {
        return (
          (b.wins - a.wins) ||
          (b.points - a.points) ||
          (b.diff - a.diff) ||
          (b.pointsFor - a.pointsFor) ||
          a.name.localeCompare(b.name)
        );
      }

      if (sortBy === "diff") {
        return (
          (b.diff - a.diff) ||
          (b.points - a.points) ||
          (b.wins - a.wins) ||
          (b.pointsFor - a.pointsFor) ||
          a.name.localeCompare(b.name)
        );
      }

      if (sortBy === "for") {
        return (
          (b.pointsFor - a.pointsFor) ||
          (b.points - a.points) ||
          (b.diff - a.diff) ||
          (b.wins - a.wins) ||
          a.name.localeCompare(b.name)
        );
      }

      return (
        (b.points - a.points) ||
        (b.diff - a.diff) ||
        (b.wins - a.wins) ||
        (b.pointsFor - a.pointsFor) ||
        a.name.localeCompare(b.name)
      );
    });

    const showOnly = getShowOnlyValue();

    if (showOnly === "played") {
      return table.filter(r => r.played > 0);
    }

    return table;
  }

  function renderRanking() {
    const sessions = getSessionsForRanking();
    const data = computeRankingForSessions(sessions, state.matches || []);
    const el = document.getElementById("rankingTable");
    if (!el) return;

    if (!sessions.length) {
      el.innerHTML = `<div class="muted">Nenhuma sessão disponível para o filtro selecionado.</div>`;
      return;
    }

    if (!data.length) {
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
              <th>Bônus</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="8" style="text-align:center;">Sem dados para exibir.</td>
            </tr>
          </tbody>
        </table>
      `;
      return;
    }

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
            <th>Bônus</th>
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
              <td>${r.bonus}</td>
              <td>${r.diff}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  window.renderRanking = renderRanking;
})();