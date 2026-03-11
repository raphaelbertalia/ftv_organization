import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function emptyStats(player) {
  return {
    playerId: player.id,
    name: player.name,
    played: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    balance: 0
  };
}

export default async function handler(req, res) {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ error: "session_id é obrigatório" });
    }

    const [playersRes, pairsRes, matchesRes] = await Promise.all([
      pool.query(`SELECT id, name FROM players WHERE active = true`),
      pool.query(`SELECT id, p1, p2 FROM pairs WHERE session_id = $1`, [session_id]),
      pool.query(`
        SELECT id, pair_a, pair_b, score_a, score_b
        FROM matches
        WHERE session_id = $1
        ORDER BY schedule_index ASC, created_at ASC
      `, [session_id])
    ]);

    const players = playersRes.rows;
    const pairs = pairsRes.rows;
    const matches = matchesRes.rows;

    const pairMap = new Map();
    for (const pair of pairs) {
      pairMap.set(pair.id, pair);
    }

    const stats = new Map();
    for (const player of players) {
      stats.set(player.id, emptyStats(player));
    }

    for (const match of matches) {
      const pairA = pairMap.get(match.pair_a);
      const pairB = pairMap.get(match.pair_b);

      if (!pairA || !pairB) continue;

      const playersA = [pairA.p1, pairA.p2];
      const playersB = [pairB.p1, pairB.p2];

      const scoreA = Number(match.score_a || 0);
      const scoreB = Number(match.score_b || 0);

      for (const pid of playersA) {
        const s = stats.get(pid);
        if (!s) continue;

        s.played += 1;
        s.pointsFor += scoreA;
        s.pointsAgainst += scoreB;

        if (scoreA > scoreB) s.wins += 1;
        else if (scoreA < scoreB) s.losses += 1;
      }

      for (const pid of playersB) {
        const s = stats.get(pid);
        if (!s) continue;

        s.played += 1;
        s.pointsFor += scoreB;
        s.pointsAgainst += scoreA;

        if (scoreB > scoreA) s.wins += 1;
        else if (scoreB < scoreA) s.losses += 1;
      }
    }

    const ranking = Array.from(stats.values())
      .map((s) => ({
        ...s,
        balance: s.pointsFor - s.pointsAgainst
      }))
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.balance !== a.balance) return b.balance - a.balance;
        if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
        return a.name.localeCompare(b.name);
      });

    return res.status(200).json(ranking);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}