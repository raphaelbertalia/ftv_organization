import { pool } from "./_db";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido" });
    }

    const { keepPlayers = false } = req.body || {};

    await pool.query("BEGIN");

    try {
      await pool.query(`DELETE FROM matches`);
      await pool.query(`DELETE FROM pairs`);
      await pool.query(`DELETE FROM sessions`);

      if (!keepPlayers) {
        await pool.query(`DELETE FROM players`);
      }

      await pool.query("COMMIT");
      return res.status(200).json({ ok: true });
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}