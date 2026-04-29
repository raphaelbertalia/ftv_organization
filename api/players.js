import { pool } from "./_db";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const result = await pool.query(`
        SELECT id, name, active, side
        FROM players
        ORDER BY name ASC
      `);

      return res.status(200).json(result.rows);
    }

    if (req.method === "POST") {
      const { id, name, active = true, side = null } = req.body || {};

      if (!id || !name) {
        return res.status(400).json({ error: "id e name são obrigatórios" });
      }

      await pool.query(
        `
        INSERT INTO players (id, name, active, side)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          active = EXCLUDED.active,
          side = EXCLUDED.side
        `,
        [id, name, active, side]
      );

      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: "id é obrigatório" });
      }

      await pool.query(`DELETE FROM players WHERE id = $1`, [id]);

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}