import { pool } from "./_db";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const result = await pool.query(`
        SELECT id, date_iso, name, created_at
        FROM sessions
        ORDER BY created_at DESC
      `);

      return res.status(200).json(result.rows);
    }

    if (req.method === "POST") {
      const { id, dateISO, date_iso, name } = req.body || {};

      const finalDateIso = date_iso || dateISO || null;
      const finalName = name || null;

      if (!id || !finalDateIso) {
        return res.status(400).json({ error: "id e date_iso são obrigatórios" });
      }

      await pool.query(
        `
        INSERT INTO sessions (id, date_iso, name, created_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          date_iso = EXCLUDED.date_iso,
          name = EXCLUDED.name
        `,
        [id, finalDateIso, finalName]
      );

      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: "id é obrigatório" });
      }

      try {
        // 1. apagar matches da sessão
        await pool.query(`DELETE FROM matches WHERE session_id = $1`, [id]);

        // 2. apagar pairs da sessão
        await pool.query(`DELETE FROM pairs WHERE session_id = $1`, [id]);

        // 3. apagar sessão
        await pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);

        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}