import { pool } from "../lib/db.js";
import {
  requireGroupAdmin
} from "../lib/auth.js";

export default async function handler(req, res) {
  try {

    if (req.method === "POST") {
      const {
        id,
        name,
        active = true,
        side = null,
        group_id,
        user_id = null
      } = req.body || {};

      if (!id || !name || !group_id) {
        return res.status(400).json({
          error:
            "id, name e group_id são obrigatórios"
        });
      }

      const auth =
        await requireGroupAdmin(
          req,
          res,
          group_id
        );

      if (!auth) {
        return;
      }

      const cleanName =
        String(name || "")
          .trim()
          .slice(0, 120);

      const allowedSides = [
        "left",
        "right",
        "both"
      ];

      if (
        side &&
        !allowedSides.includes(side)
      ) {
        return res.status(400).json({
          error: "Lado inválido"
        });
      }

      if (user_id) {
        const userResult =
          await pool.query(
            `
              SELECT
                id,
                active
              FROM users
              WHERE id = $1
              LIMIT 1
            `,
            [user_id]
          );

        const linkedUser =
          userResult.rows[0];

        if (!linkedUser) {
          return res.status(404).json({
            error:
              "Usuário vinculado não encontrado"
          });
        }

        if (!linkedUser.active) {
          return res.status(409).json({
            error:
              "Não é possível vincular um usuário inativo"
          });
        }

        const duplicatePlayer =
          await pool.query(
            `
              SELECT id
              FROM players
              WHERE group_id = $1
                AND user_id = $2
                AND id <> $3
              LIMIT 1
            `,
            [
              group_id,
              user_id,
              id
            ]
          );

        if (
          duplicatePlayer.rows.length
        ) {
          return res.status(409).json({
            error:
              "Este usuário já está vinculado a um jogador deste grupo"
          });
        }
      }

      await pool.query(
        `
          INSERT INTO players (
            id,
            name,
            active,
            side,
            group_id,
            user_id
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6
          )

          ON CONFLICT (id)
          DO UPDATE SET
            name = EXCLUDED.name,
            active = EXCLUDED.active,
            side = COALESCE(
              EXCLUDED.side,
              players.side
            ),
            user_id = COALESCE(
              EXCLUDED.user_id,
              players.user_id
            )
        `,
        [
          id,
          cleanName,
          !!active,
          side,
          group_id,
          user_id || null
        ]
      );

      return res.status(200).json({
        ok: true
      });
    }


    if (req.method === "DELETE") {
      const {
        id,
        group_id
      } = req.body || {};

      if (!id || !group_id) {
        return res.status(400).json({
          error:
            "id e group_id são obrigatórios"
        });
      }

      const auth =
        await requireGroupAdmin(
          req,
          res,
          group_id
        );

      if (!auth) {
        return;
      }

      const result =
        await pool.query(
          `
            DELETE FROM players
            WHERE id = $1
              AND group_id = $2
          `,
          [
            id,
            group_id
          ]
        );

      if (!result.rowCount) {
        return res.status(404).json({
          error:
            "Jogador não encontrado"
        });
      }

      return res.status(200).json({
        ok: true
      });
    }


    return res.status(405).json({
      error:
        "Método não permitido"
    });

  } catch (err) {

    if (
      err?.code === "23505"
    ) {
      return res.status(409).json({
        error:
          "Este usuário já está vinculado a um jogador deste grupo"
      });
    }

    return res.status(500).json({
      error:
        err?.message ||
        "Erro interno"
    });
  }
}