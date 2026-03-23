import { pool } from "./_db";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const playersResult = await pool.query(`
      SELECT *
      FROM players
      ORDER BY name ASC
    `);

        const sessionsResult = await pool.query(`
  SELECT 
        id,
        name,
        date_iso AS "dateISO",
        created_at AS "createdAt"
  FROM sessions
  ORDER BY created_at DESC
`);

        const matchesResult = await pool.query(`
  SELECT 
        id,
        session_id AS "sessionId",
        pair_a_id AS "pairAId",
        pair_b_id AS "pairBId",
        score_a AS "scoreA",
        score_b AS "scoreB",
        schedule_index AS "scheduleIndex",
        created_at AS "createdAt"
  FROM matches
  ORDER BY created_at ASC
`);

        return res.status(200).json({
            players: playersResult.rows || [],
            sessions: sessionsResult.rows || [],
            matches: matchesResult.rows || []
        });
    } catch (err) {
        console.error("Erro no bootstrap:", err);
        return res.status(500).json({
            error: "Erro ao carregar dados iniciais"
        });
    }
}