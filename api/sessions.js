import { pool } from "./_db";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const result = await pool.query(`
        SELECT id, date_iso
        FROM sessions
        ORDER BY created_at DESC
      `);

      return res.status(200).json(result.rows);
    }

    if (req.method === "POST") {
      const { id, date_iso } = req.body || {};

      if (!id || !date_iso) {
        return res.status(400).json({ error: "id e date_iso são obrigatórios" });
      }

      await pool.query(
        `
        INSERT INTO sessions (id, date_iso, created_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          date_iso = EXCLUDED.date_iso
        `,
        [id, date_iso]
      );

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}