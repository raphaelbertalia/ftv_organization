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
          participant_ids,
          pending_pair_a_id,
          pending_pair_b_id
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
      const body = req.body || {};

      const {
        id,
        status,
        playMode,
        play_mode,
        participantIds,
        participant_ids,
        pendingPairAId,
        pending_pair_a_id,
        pendingPairBId,
        pending_pair_b_id
      } = body;

      if (!id) {
        return res.status(400).json({
          error: "id é obrigatório"
        });
      }

      const finalPlayMode =
        play_mode ??
        playMode;

      const hasParticipantIds =
        Object.prototype.hasOwnProperty.call(body, "participant_ids") ||
        Object.prototype.hasOwnProperty.call(body, "participantIds");

      const finalParticipantIds =
        Array.isArray(participant_ids)
          ? participant_ids
          : Array.isArray(participantIds)
            ? participantIds
            : null;

      const hasPendingPairA =
        Object.prototype.hasOwnProperty.call(body, "pending_pair_a_id") ||
        Object.prototype.hasOwnProperty.call(body, "pendingPairAId");

      const hasPendingPairB =
        Object.prototype.hasOwnProperty.call(body, "pending_pair_b_id") ||
        Object.prototype.hasOwnProperty.call(body, "pendingPairBId");

      const finalPendingPairA =
        pending_pair_a_id ??
        pendingPairAId ??
        null;

      const finalPendingPairB =
        pending_pair_b_id ??
        pendingPairBId ??
        null;

      if (
        finalPlayMode &&
        !["fixed", "rotation"].includes(finalPlayMode)
      ) {
        return res.status(400).json({
          error: "play_mode inválido"
        });
      }

      const hasAnyChange =
        typeof status !== "undefined" ||
        typeof finalPlayMode !== "undefined" ||
        hasParticipantIds ||
        hasPendingPairA ||
        hasPendingPairB;

      if (!hasAnyChange) {
        return res.status(400).json({
          error: "Nenhuma alteração informada"
        });
      }

      await pool.query(
        `
          UPDATE sessions
          SET
            status = CASE
              WHEN $2::boolean THEN $3
              ELSE status
            END,

            play_mode = CASE
              WHEN $4::boolean THEN $5
              ELSE play_mode
            END,

            participant_ids = CASE
              WHEN $6::boolean THEN $7::jsonb
              ELSE participant_ids
            END,

            pending_pair_a_id = CASE
              WHEN $8::boolean THEN $9
              ELSE pending_pair_a_id
            END,

            pending_pair_b_id = CASE
              WHEN $10::boolean THEN $11
              ELSE pending_pair_b_id
            END
          WHERE id = $1
    `,
        [
          id,

          typeof status !== "undefined",
          status ?? null,

          typeof finalPlayMode !== "undefined",
          finalPlayMode ?? null,

          hasParticipantIds,
          hasParticipantIds
            ? JSON.stringify(finalParticipantIds || [])
            : null,

          hasPendingPairA,
          finalPendingPairA,

          hasPendingPairB,
          finalPendingPairB
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