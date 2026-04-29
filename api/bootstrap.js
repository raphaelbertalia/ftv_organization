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
            SELECT *
            FROM sessions
            ORDER BY created_at DESC
        `);

        const pairsResult = await pool.query(`
            SELECT id, session_id, p1, p2, position
            FROM pairs
            ORDER BY session_id ASC, position ASC, id ASC
        `);

        const matchesResult = await pool.query(`
            SELECT *
            FROM matches
            ORDER BY created_at ASC
        `);

        return res.status(200).json({
            players: playersResult.rows || [],
            sessions: sessionsResult.rows || [],
            pairs: pairsResult.rows || [],
            matches: matchesResult.rows || []
        });
    } catch (err) {
        console.error("Erro no bootstrap:", err);
        return res.status(500).json({
            error: "Erro ao carregar dados iniciais",
            detail: err.message
        });
    }
}