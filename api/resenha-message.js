import { pool } from "./_db";

export default async function handler(req, res) {
    try {
        if (req.method !== "GET") {
            return res.status(405).json({ error: "Método não permitido" });
        }

        const { kind } = req.query;

        if (!kind || !["best", "worst"].includes(kind)) {
            return res.status(400).json({ error: "kind inválido" });
        }

        const result = await pool.query(`
      SELECT message
      FROM resenha_messages
      WHERE kind = $1
        AND active = true
      ORDER BY RANDOM()
      LIMIT 1
    `, [kind]);

        const msg = result.rows[0]?.message || "";

        return res.status(200).json({ message: msg });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}