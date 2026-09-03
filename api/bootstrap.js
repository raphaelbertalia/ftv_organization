import { pool } from "../lib/db.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {

        const { group_id } = req.query;

        if (!group_id) {
            return res.status(400).json({
                error: "group_id é obrigatório"
            });
        }

        const playersResult = await pool.query(`
            SELECT *
            FROM players
            WHERE group_id = $1
            ORDER BY name ASC
        `, [group_id]);

        const sessionsResult = await pool.query(`
            SELECT *
            FROM sessions
            WHERE group_id = $1
            ORDER BY created_at DESC
        `, [group_id]);

        const pairsResult = await pool.query(`
            SELECT DISTINCT
                p.id,
                p.session_id,
                p.cycle_id,
                p.p1,
                p.p2,
                p.position
            FROM pairs p
            LEFT JOIN sessions s
                ON s.id = p.session_id
            LEFT JOIN monthly_cycles mc
                ON mc.id = p.cycle_id
            WHERE
                s.group_id = $1
                OR mc.group_id = $1
            ORDER BY
                p.session_id ASC,
                p.cycle_id ASC,
                p.position ASC,
                p.id ASC
        `, [group_id]);

        const matchesResult = await pool.query(`
            SELECT m.*
            FROM matches m
            INNER JOIN sessions s
                ON s.id = m.session_id
            WHERE s.group_id = $1
            ORDER BY m.created_at ASC
        `, [group_id]);

        const cyclesResult = await pool.query(`
            SELECT *
            FROM monthly_cycles
            WHERE group_id = $1
            ORDER BY created_at DESC
        `, [group_id]);

        return res.status(200).json({
            players: playersResult.rows || [],
            sessions: sessionsResult.rows || [],
            cycles: cyclesResult.rows || [],
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