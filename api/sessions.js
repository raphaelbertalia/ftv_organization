import { pool } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const result = await pool.query(`
        SELECT
          id,
          date_iso,
          name,
          created_at,
          status,
          play_mode,
          participant_ids
        FROM sessions
        ORDER BY created_at DESC
      `);

      return res.status(200).json(result.rows);
    }

    if (req.method === "POST") {
      const {
        id,
        dateISO,
        date_iso,
        name,
        playMode,
        play_mode,
        participantIds,
        participant_ids
      } = req.body || {};

      const finalDateIso = date_iso || dateISO || null;
      const finalName = name || null;
      const finalPlayMode = play_mode || playMode || "fixed";

      const finalParticipantIds = Array.isArray(participant_ids)
        ? participant_ids
        : Array.isArray(participantIds)
          ? participantIds
          : [];

      if (!id || !finalDateIso) {
        return res.status(400).json({
          error: "id e date_iso são obrigatórios"
        });
      }

      if (!["fixed", "rotation"].includes(finalPlayMode)) {
        return res.status(400).json({
          error: "play_mode inválido"
        });
      }

      await pool.query(
        `
        INSERT INTO sessions (
          id,
          date_iso,
          name,
          created_at,
          status,
          play_mode,
          participant_ids
        )
        VALUES (
          $1,
          $2,
          $3,
          NOW(),
          'em_andamento',
          $4,
          $5::jsonb
        )
        ON CONFLICT (id)
        DO UPDATE SET
          date_iso = EXCLUDED.date_iso,
          name = EXCLUDED.name,
          play_mode = EXCLUDED.play_mode,
          participant_ids = EXCLUDED.participant_ids
        `,
        [
          id,
          finalDateIso,
          finalName,
          finalPlayMode,
          JSON.stringify(finalParticipantIds)
        ]
      );

      return res.status(200).json({ ok: true });
    }

    if (req.method === "PATCH") {
      const {
        id,
        status,
        playMode,
        play_mode,
        participantIds,
        participant_ids
      } = req.body || {};

      if (!id) {
        return res.status(400).json({
          error: "id é obrigatório"
        });
      }

      const finalPlayMode = play_mode || playMode;
      const hasParticipantIds =
        Array.isArray(participant_ids) ||
        Array.isArray(participantIds);

      const finalParticipantIds = Array.isArray(participant_ids)
        ? participant_ids
        : Array.isArray(participantIds)
          ? participantIds
          : null;

      if (
        finalPlayMode &&
        !["fixed", "rotation"].includes(finalPlayMode)
      ) {
        return res.status(400).json({
          error: "play_mode inválido"
        });
      }

      if (
        typeof status === "undefined" &&
        typeof finalPlayMode === "undefined" &&
        !hasParticipantIds
      ) {
        return res.status(400).json({
          error: "Nenhuma alteração informada"
        });
      }

      await pool.query(
        `
        UPDATE sessions
        SET
          status = COALESCE($2, status),
          play_mode = COALESCE($3, play_mode),
          participant_ids = CASE
            WHEN $4::boolean = true THEN $5::jsonb
            ELSE participant_ids
          END
        WHERE id = $1
        `,
        [
          id,
          status || null,
          finalPlayMode || null,
          hasParticipantIds,
          hasParticipantIds
            ? JSON.stringify(finalParticipantIds)
            : null
        ]
      );

      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};

      if (!id) {
        return res.status(400).json({
          error: "id é obrigatório"
        });
      }

      await pool.query(
        `DELETE FROM matches WHERE session_id = $1`,
        [id]
      );

      await pool.query(
        `DELETE FROM pairs WHERE session_id = $1`,
        [id]
      );

      await pool.query(
        `DELETE FROM sessions WHERE id = $1`,
        [id]
      );

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({
      error: "Método não permitido"
    });
  } catch (err) {
    console.error("Erro na API de sessões:", err);

    return res.status(500).json({
      error: err.message
    });
  }
}