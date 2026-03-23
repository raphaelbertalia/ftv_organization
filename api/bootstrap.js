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

        const matchesResult = await pool.query(`
            SELECT *
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
            error: "Erro ao carregar dados iniciais",
            detail: err.message
        });
    }
}