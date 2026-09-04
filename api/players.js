import { pool } from "../lib/db.js";

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
      const {
        id,
        name,
        active = true,
        side = null,
        group_id
      } = req.body || {};

      if (!id || !name || !group_id) {
        return res.status(400).json({
          error: "id, name e group_id são obrigatórios"
        });
      }

      await pool.query(
        `
      INSERT INTO players (
          id,
          name,
          active,
          side,
          group_id
      )
      VALUES ($1, $2, $3, $4, $5)

      ON CONFLICT (id)
      DO UPDATE SET
          name = EXCLUDED.name,
          active = EXCLUDED.active,
          side = EXCLUDED.side,
          group_id = EXCLUDED.group_id
      `,
        [id, name, active, side, group_id]
      );

      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { id, group_id } = req.body || {};

      if (!id || !group_id) {
        return res.status(400).json({
          error: "id e group_id são obrigatórios"
        });
      }

      await pool.query(
        `
        DELETE FROM players
        WHERE id = $1
          AND group_id = $2
        `,
        [id, group_id]
      );

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}