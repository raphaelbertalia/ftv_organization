import { pool } from "../lib/db.js";

export default async function handler(req, res) {
    try {
        // LISTAR SORTEIOS DO USUÁRIO
        if (req.method === "GET") {
            const { created_by } = req.query;

            if (!created_by) {
                return res.status(400).json({
                    error: "created_by é obrigatório"
                });
            }

            const result = await pool.query(
                `
                SELECT
                    id,
                    name,
                    draw_type,
                    created_by,
                    status,
                    created_at,
                    updated_at
                FROM championship_draws
                WHERE created_by = $1
                ORDER BY created_at DESC
                `,
                [created_by]
            );

            return res.status(200).json(result.rows || []);
        }

        // CRIAR SORTEIO
        if (req.method === "POST") {
            const {
                name,
                draw_type,
                created_by
            } = req.body || {};

            if (!name || !draw_type || !created_by) {
                return res.status(400).json({
                    error: "name, draw_type e created_by são obrigatórios"
                });
            }

            if (!["simple", "custom"].includes(draw_type)) {
                return res.status(400).json({
                    error: "Tipo de sorteio inválido"
                });
            }

            const result = await pool.query(
                `
                INSERT INTO championship_draws (
                    name,
                    draw_type,
                    created_by,
                    status
                )
                VALUES ($1, $2, $3, 'draft')
                RETURNING
                    id,
                    name,
                    draw_type,
                    created_by,
                    status,
                    created_at,
                    updated_at
                `,
                [
                    name.trim(),
                    draw_type,
                    created_by
                ]
            );

            return res.status(201).json({
                ok: true,
                draw: result.rows[0]
            });
        }

        // EDITAR SORTEIO
        if (req.method === "PATCH") {
            const {
                id,
                name,
                status,
                created_by
            } = req.body || {};

            if (!id || !created_by) {
                return res.status(400).json({
                    error: "id e created_by são obrigatórios"
                });
            }

            if (!name && !status) {
                return res.status(400).json({
                    error: "Informe name ou status para atualizar"
                });
            }

            const result = await pool.query(
                `
                UPDATE championship_draws
                SET
                    name = COALESCE($3, name),
                    status = COALESCE($4, status),
                    updated_at = NOW()
                WHERE id = $1
                  AND created_by = $2
                RETURNING
                    id,
                    name,
                    draw_type,
                    created_by,
                    status,
                    created_at,
                    updated_at
                `,
                [
                    id,
                    created_by,
                    name?.trim() || null,
                    status || null
                ]
            );

            if (!result.rows.length) {
                return res.status(404).json({
                    error: "Sorteio não encontrado"
                });
            }

            return res.status(200).json({
                ok: true,
                draw: result.rows[0]
            });
        }

        // EXCLUIR SORTEIO
        if (req.method === "DELETE") {
            const {
                id,
                created_by
            } = req.body || {};

            if (!id || !created_by) {
                return res.status(400).json({
                    error: "id e created_by são obrigatórios"
                });
            }

            const result = await pool.query(
                `
                DELETE FROM championship_draws
                WHERE id = $1
                  AND created_by = $2
                RETURNING id
                `,
                [id, created_by]
            );

            if (!result.rows.length) {
                return res.status(404).json({
                    error: "Sorteio não encontrado"
                });
            }

            return res.status(200).json({
                ok: true
            });
        }

        return res.status(405).json({
            error: "Método não permitido"
        });
    } catch (err) {
        console.error("Erro em championship-draws:", err);

        return res.status(500).json({
            error: "Erro interno ao gerenciar sorteios",
            detail: err.message
        });
    }
}