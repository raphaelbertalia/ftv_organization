import { pool } from "../lib/db.js";

export default async function handler(req, res) {
    try {
        if (req.method === "GET") {
            const cycles = await pool.query(`
        SELECT *
        FROM monthly_cycles
        ORDER BY created_at DESC
      `);

            return res.status(200).json(cycles.rows || []);
        }

        if (req.method === "POST") {
            const { id, name, start_date, end_date, pairs } = req.body || {};

            if (!id || !name || !start_date || !end_date) {
                return res.status(400).json({ error: "Dados do ciclo incompletos" });
            }

            await pool.query("BEGIN");

            await pool.query(
                `
                INSERT INTO monthly_cycles (id, name, start_date, end_date, status)
                VALUES ($1, $2, $3, $4, 'em_andamento')
                ON CONFLICT (id)
                DO UPDATE SET
                    name = EXCLUDED.name,
                    start_date = EXCLUDED.start_date,
                    end_date = EXCLUDED.end_date
                `,
                [id, name, start_date, end_date]
            );

            await pool.query(`DELETE FROM pairs WHERE cycle_id = $1`, [id]);

            for (const [index, pair] of (pairs || []).entries()) {
                await pool.query(
                    `
                    INSERT INTO pairs (id, cycle_id, session_id, p1, p2, position)
                    VALUES ($1, $2, NULL, $3, $4, $5)
                    `,
                    [pair.id, id, pair.p1, pair.p2, index + 1]
                );
            }

            await pool.query("COMMIT");

            return res.status(200).json({ ok: true });
        }

        if (req.method === "DELETE") {
            const { id } = req.body || {};

            if (!id) {
                return res.status(400).json({ error: "id é obrigatório" });
            }

            await pool.query("BEGIN");

            await pool.query(`DELETE FROM pairs WHERE cycle_id = $1`, [id]);
            await pool.query(`DELETE FROM monthly_cycles WHERE id = $1`, [id]);

            await pool.query("COMMIT");

            return res.status(200).json({ ok: true });
        }

        if (req.method === "PATCH") {
            const { id, status } = req.body || {};

            if (!id || !status) {
                return res.status(400).json({ error: "id e status são obrigatórios" });
            }

            await pool.query(
                `
        UPDATE monthly_cycles
        SET status = $2
        WHERE id = $1
        `,
                [id, status]
            );

            return res.status(200).json({ ok: true });
        }

        return res.status(405).json({ error: "Método não permitido" });
    } catch (err) {
        try {
            await pool.query("ROLLBACK");
        } catch (_) { }

        return res.status(500).json({ error: err.message });
    }
}