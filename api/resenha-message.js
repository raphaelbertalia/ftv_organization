import { pool } from "../lib/db.js";

export default async function handler(req, res) {
    try {
        if (req.method !== "GET") {
            return res.status(405).json({ error: "Método não permitido" });
        }

        const kindNormalized = String(req.query.kind || "")
            .toLowerCase()
            .trim();

        const groupId = String(req.query.group_id || "").trim();

        if (!["best", "worst"].includes(kindNormalized)) {
            return res.status(400).json({ error: "kind inválido" });
        }

        if (!groupId) {
            return res.status(400).json({
                error: "group_id é obrigatório"
            });
        }

        const result = await pool.query(
            `
                SELECT message
                FROM resenha_messages
                WHERE kind = $1
                  AND group_id = $2
                  AND active = true
                ORDER BY RANDOM()
                LIMIT 1
            `,
            [kindNormalized, groupId]
        );

        const msg = result.rows[0]?.message;

        if (!msg) {
            return res.status(404).json({
                error: "Nenhuma mensagem encontrada"
            });
        }

        return res.status(200).json({ message: msg });
    } catch (err) {
        return res.status(500).json({
            error: "Erro interno ao buscar mensagem",
            details: err.message
        });
    }
}