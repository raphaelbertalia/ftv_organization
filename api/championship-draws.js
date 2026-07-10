import { pool } from "../lib/db.js";

const PLAYER_CATEGORIES = {
    beginner: {
        label: "Estreante",
        role: "nao_carrega",
        points: 1
    },
    novice: {
        label: "Iniciante",
        role: "nao_carrega",
        points: 2
    },
    advanced_b: {
        label: "Avançado B",
        role: "carrega",
        points: 3
    },
    advanced_a: {
        label: "Avançado A",
        role: "carrega",
        points: 4
    }
};

const VALID_SIDES = ["left", "right", "any"];

async function getOwnedDraw(drawId, createdBy) {
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
        WHERE id = $1
          AND created_by = $2
        LIMIT 1
        `,
        [drawId, createdBy]
    );

    return result.rows[0] || null;
}

async function handlePlayers(req, res) {
    // LISTAR JOGADORES DO CAMPEONATO
    if (req.method === "GET") {
        const { draw_id, created_by } = req.query;

        if (!draw_id || !created_by) {
            return res.status(400).json({
                error: "draw_id e created_by são obrigatórios"
            });
        }

        const draw = await getOwnedDraw(draw_id, created_by);

        if (!draw) {
            return res.status(404).json({
                error: "Campeonato não encontrado"
            });
        }

        const result = await pool.query(
            `
            SELECT
                id,
                draw_id,
                name,
                preferred_side,
                category,
                points,
                created_at
            FROM championship_players
            WHERE draw_id = $1
            ORDER BY name ASC
            `,
            [draw_id]
        );

        return res.status(200).json({
            draw,
            players: result.rows || []
        });
    }

    // CADASTRAR JOGADOR
    if (req.method === "POST") {
        const {
            draw_id,
            created_by,
            name,
            preferred_side = "any",
            category = null
        } = req.body || {};

        if (!draw_id || !created_by || !name?.trim()) {
            return res.status(400).json({
                error: "draw_id, created_by e name são obrigatórios"
            });
        }

        if (!VALID_SIDES.includes(preferred_side)) {
            return res.status(400).json({
                error: "Lado preferencial inválido"
            });
        }

        const draw = await getOwnedDraw(draw_id, created_by);

        if (!draw) {
            return res.status(404).json({
                error: "Campeonato não encontrado"
            });
        }

        let finalCategory = null;
        let finalPoints = null;

        if (draw.draw_type === "custom") {
            if (!category || !PLAYER_CATEGORIES[category]) {
                return res.status(400).json({
                    error: "Categoria obrigatória para sorteio personalizado"
                });
            }

            finalCategory = category;
            finalPoints = PLAYER_CATEGORIES[category].points;
        }

        const duplicated = await pool.query(
            `
            SELECT id
            FROM championship_players
            WHERE draw_id = $1
              AND LOWER(name) = LOWER($2)
            LIMIT 1
            `,
            [draw_id, name.trim()]
        );

        if (duplicated.rows.length) {
            return res.status(409).json({
                error: "Já existe um jogador com esse nome"
            });
        }

        const result = await pool.query(
            `
            INSERT INTO championship_players (
                draw_id,
                name,
                preferred_side,
                category,
                points
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING
                id,
                draw_id,
                name,
                preferred_side,
                category,
                points,
                created_at
            `,
            [
                draw_id,
                name.trim(),
                preferred_side,
                finalCategory,
                finalPoints
            ]
        );

        return res.status(201).json({
            ok: true,
            player: result.rows[0]
        });
    }

    // EDITAR JOGADOR
    if (req.method === "PATCH") {
        const {
            id,
            draw_id,
            created_by,
            name,
            preferred_side,
            category
        } = req.body || {};

        if (!id || !draw_id || !created_by) {
            return res.status(400).json({
                error: "id, draw_id e created_by são obrigatórios"
            });
        }

        const draw = await getOwnedDraw(draw_id, created_by);

        if (!draw) {
            return res.status(404).json({
                error: "Campeonato não encontrado"
            });
        }

        if (
            preferred_side &&
            !VALID_SIDES.includes(preferred_side)
        ) {
            return res.status(400).json({
                error: "Lado preferencial inválido"
            });
        }

        let finalCategory = null;
        let finalPoints = null;

        if (draw.draw_type === "custom") {
            if (category && !PLAYER_CATEGORIES[category]) {
                return res.status(400).json({
                    error: "Categoria inválida"
                });
            }

            if (category) {
                finalCategory = category;
                finalPoints = PLAYER_CATEGORIES[category].points;
            }
        }

        const result = await pool.query(
            `
            UPDATE championship_players
            SET
                name = COALESCE($4, name),
                preferred_side = COALESCE($5, preferred_side),
                category = CASE
                    WHEN $6::varchar IS NOT NULL THEN $6
                    ELSE category
                END,
                points = CASE
                    WHEN $7::integer IS NOT NULL THEN $7
                    ELSE points
                END
            WHERE id = $1
              AND draw_id = $2
              AND EXISTS (
                  SELECT 1
                  FROM championship_draws
                  WHERE id = $2
                    AND created_by = $3
              )
            RETURNING
                id,
                draw_id,
                name,
                preferred_side,
                category,
                points,
                created_at
            `,
            [
                id,
                draw_id,
                created_by,
                name?.trim() || null,
                preferred_side || null,
                finalCategory,
                finalPoints
            ]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                error: "Jogador não encontrado"
            });
        }

        return res.status(200).json({
            ok: true,
            player: result.rows[0]
        });
    }

    // EXCLUIR JOGADOR
    if (req.method === "DELETE") {
        const {
            id,
            draw_id,
            created_by
        } = req.body || {};

        if (!id || !draw_id || !created_by) {
            return res.status(400).json({
                error: "id, draw_id e created_by são obrigatórios"
            });
        }

        const result = await pool.query(
            `
            DELETE FROM championship_players
            WHERE id = $1
              AND draw_id = $2
              AND EXISTS (
                  SELECT 1
                  FROM championship_draws
                  WHERE id = $2
                    AND created_by = $3
              )
            RETURNING id
            `,
            [id, draw_id, created_by]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                error: "Jogador não encontrado"
            });
        }

        return res.status(200).json({
            ok: true
        });
    }

    return res.status(405).json({
        error: "Método não permitido"
    });
}

export default async function handler(req, res) {
    try {
        const action = String(
            req.query.action || req.body?.action || ""
        ).toLowerCase();

        if (action === "players") {
            return await handlePlayers(req, res);
        }

        // LISTAR CAMPEONATOS DO USUÁRIO
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

        // CRIAR CAMPEONATO
        if (req.method === "POST") {
            const {
                name,
                draw_type,
                created_by
            } = req.body || {};

            if (!name?.trim() || !draw_type || !created_by) {
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

        // EDITAR CAMPEONATO
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
                    error: "Campeonato não encontrado"
                });
            }

            return res.status(200).json({
                ok: true,
                draw: result.rows[0]
            });
        }

        // EXCLUIR CAMPEONATO
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
                    error: "Campeonato não encontrado"
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