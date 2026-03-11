import { pool } from "./_db";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { session_id } = req.query;

      if (!session_id) {
        return res.status(400).json({ error: "session_id é obrigatório" });
      }

      const result = await pool.query(
        `
        SELECT id, session_id, p1, p2
        FROM pairs
        WHERE session_id = $1
        ORDER BY id ASC
        `,
        [session_id]
      );

      return res.status(200).json(result.rows);
    }

    if (req.method === "POST") {
      const { id, session_id, p1, p2 } = req.body || {};

      if (!id || !session_id || !p1 || !p2) {
        return res.status(400).json({ error: "id, session_id, p1 e p2 são obrigatórios" });
      }

      await pool.query(
        `
        INSERT INTO pairs (id, session_id, p1, p2)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id)
        DO UPDATE SET
          session_id = EXCLUDED.session_id,
          p1 = EXCLUDED.p1,
          p2 = EXCLUDED.p2
        `,
        [id, session_id, p1, p2]
      );

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}