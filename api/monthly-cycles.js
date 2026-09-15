import { pool } from "../lib/db.js";
import {
    requireAuth,
    requireGroupAdmin
} from "../lib/auth.js";

async function requireGroupAccess(
    req,
    res,
    groupId
) {
    const user =
        await requireAuth(
            req,
            res
        );

    if (!user) {
        return null;
    }

    if (!groupId) {
        res.status(400).json({
            error: "Grupo não informado"
        });

        return null;
    }

    /*
     * Admin Global pode consultar
     * qualquer grupo.
     */
    if (user.role === "admin") {
        return {
            user,
            groupRole: "admin",
            isGlobalAdmin: true
        };
    }

    const result =
        await pool.query(
            `
                SELECT
                    ug.role
                FROM user_groups ug

                INNER JOIN groups g
                    ON g.id = ug.group_id

                WHERE ug.user_id = $1
                  AND ug.group_id = $2
                  AND ug.active = true
                  AND g.active = true

                LIMIT 1
            `,
            [
                user.id,
                groupId
            ]
        );

    const membership =
        result.rows[0];

    if (!membership) {
        res.status(403).json({
            error:
                "Você não possui acesso a este grupo"
        });

        return null;
    }

    return {
        user,
        groupRole:
            membership.role,
        isGlobalAdmin: false
    };
}

export default async function handler(req, res) {
    try {
        if (req.method === "GET") {
            const {
                group_id
            } = req.query || {};

            if (!group_id) {
                return res.status(400).json({
                    error:
                        "group_id é obrigatório"
                });
            }

            const access =
                await requireGroupAccess(
                    req,
                    res,
                    group_id
                );

            if (!access) {
                return;
            }

            const cycles =
                await pool.query(
                    `
                        SELECT *
                        FROM monthly_cycles
                        WHERE group_id = $1
                        ORDER BY created_at DESC
                    `,
                    [
                        group_id
                    ]
                );

            return res
                .status(200)
                .json(
                    cycles.rows || []
                );
        }

        if (req.method === "POST") {
            const {
                id,
                name,
                start_date,
                end_date,
                pairs,
                group_id
            } = req.body || {};

            if (!id || !name || !start_date || !end_date || !group_id) {
                return res.status(400).json({
                    error: "id, name, start_date, end_date e group_id são obrigatórios"
                });
            }

            const access =
                await requireGroupAdmin(
                    req,
                    res,
                    group_id
                );

            if (!access) {
                return;
            }


            /*
             * Impede utilizar o ID de um ciclo
             * pertencente a outro grupo.
             */
            const existingCycle =
                await pool.query(
                    `
            SELECT
                id,
                group_id
            FROM monthly_cycles
            WHERE id = $1
            LIMIT 1
        `,
                    [
                        id
                    ]
                );

            if (
                existingCycle.rows.length &&
                String(
                    existingCycle.rows[0]
                        .group_id
                ) !== String(group_id)
            ) {
                return res.status(403).json({
                    error:
                        "Este ciclo pertence a outro grupo"
                });
            }

            await pool.query("BEGIN");

            await pool.query(
                `
                    INSERT INTO monthly_cycles (
                        id,
                        name,
                        start_date,
                        end_date,
                        status,
                        group_id
                    )
                    VALUES ($1, $2, $3, $4, 'em_andamento', $5)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        name = EXCLUDED.name,
                        start_date = EXCLUDED.start_date,
                        end_date = EXCLUDED.end_date
                `,
                [id, name, start_date, end_date, group_id]
            );

            await pool.query(`DELETE FROM pairs WHERE cycle_id = $1`, [id]);

            for (const [index, pair] of (pairs || []).entries()) {
                await pool.query(
                    `
                    INSERT INTO pairs (id, cycle_id, session_id, p1, p2, position)
                    VALUES ($1, $2, NULL, $3, $4, $5)
                    `,
                    [pair.id, id, pair.p1, pair.p2, index + 1]
                );
            }

            await pool.query("COMMIT");

            return res.status(200).json({ ok: true });
        }

        if (req.method === "DELETE") {
            const { id, group_id } = req.body || {};

            if (!id || !group_id) {
                return res.status(400).json({
                    error: "id e group_id são obrigatórios"
                });
            }

            const access =
                await requireGroupAdmin(
                    req,
                    res,
                    group_id
                );

            if (!access) {
                return;
            }

            const cycleResult = await pool.query(
                `
            SELECT id
            FROM monthly_cycles
            WHERE id = $1
              AND group_id = $2
            LIMIT 1
        `,
                [id, group_id]
            );

            if (!cycleResult.rows.length) {
                return res.status(404).json({
                    error: "Ciclo não encontrado para este grupo"
                });
            }

            await pool.query("BEGIN");

            await pool.query(
                `DELETE FROM pairs WHERE cycle_id = $1`,
                [id]
            );

            await pool.query(
                `
                    DELETE FROM monthly_cycles
                    WHERE id = $1
                    AND group_id = $2
                `,
                [id, group_id]
            );

            await pool.query("COMMIT");

            return res.status(200).json({ ok: true });
        }

        if (req.method === "PATCH") {
            const { id, status, group_id } = req.body || {};

            if (!id || !status || !group_id) {
                return res.status(400).json({
                    error: "id, status e group_id são obrigatórios"
                });
            }

            const access =
                await requireGroupAdmin(
                    req,
                    res,
                    group_id
                );

            if (!access) {
                return;
            }

            const allowedStatuses =
                new Set([
                    "em_andamento",
                    "encerrada"
                ]);

            if (
                !allowedStatuses.has(
                    status
                )
            ) {
                return res.status(400).json({
                    error:
                        "Status de ciclo inválido"
                });
            }

            await pool.query(
                `
                    UPDATE monthly_cycles
                    SET status = $2
                    WHERE id = $1
                    AND group_id = $3
                    `,
                [id, status, group_id]
            );

            return res.status(200).json({ ok: true });
        }

        return res.status(405).json({ error: "Método não permitido" });
    } catch (err) {
        try {
            await pool.query("ROLLBACK");
        } catch (_) { }

        return res.status(500).json({ error: err.message });
    }
}