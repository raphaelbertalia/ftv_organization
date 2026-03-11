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
        SELECT id, session_id, pair_a, pair_b, score_a, score_b, schedule_index, created_at
        FROM matches
        WHERE session_id = $1
        ORDER BY schedule_index ASC, created_at ASC
        `,
        [session_id]
      );

      return res.status(200).json(result.rows);
    }

    if (req.method === "POST") {
      const {
        id,
        session_id,
        pair_a,
        pair_b,
        score_a,
        score_b,
        schedule_index,
        created_at
      } = req.body || {};

      if (
        !id ||
        !session_id ||
        !pair_a ||
        !pair_b ||
        typeof score_a === "undefined" ||
        typeof score_b === "undefined" ||
        typeof schedule_index === "undefined" ||
        typeof created_at === "undefined"
      ) {
        return res.status(400).json({ error: "dados obrigatórios faltando" });
      }

      await pool.query(
        `
        INSERT INTO matches (
          id, session_id, pair_a, pair_b, score_a, score_b, schedule_index, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id)
        DO UPDATE SET
          session_id = EXCLUDED.session_id,
          pair_a = EXCLUDED.pair_a,
          pair_b = EXCLUDED.pair_b,
          score_a = EXCLUDED.score_a,
          score_b = EXCLUDED.score_b,
          schedule_index = EXCLUDED.schedule_index,
          created_at = EXCLUDED.created_at
        `,
        [id, session_id, pair_a, pair_b, score_a, score_b, schedule_index, created_at]
      );

      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: "id é obrigatório" });
      }

      await pool.query(`DELETE FROM matches WHERE id = $1`, [id]);

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}