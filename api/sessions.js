import { pool } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { group_id } = req.query || {};

      if (!group_id) {
        return res.status(400).json({
          error: "group_id é obrigatório"
        });
      }

      const result = await pool.query(
        `
          SELECT
            id,
            date_iso,
            name,
            created_at,
            status,
            play_mode,
            match_flow_mode,
            participant_ids,
            pending_pair_a_id,
            pending_pair_b_id,
            group_id
          FROM sessions
          WHERE group_id = $1
          ORDER BY created_at DESC
        `,
        [group_id]
      );

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
        matchFlowMode,
        match_flow_mode,
        participantIds,
        participant_ids,
        group_id
      } = req.body || {};

      const finalPlayMode = play_mode || playMode || "fixed";
      const finalDateIso = date_iso || dateISO || null;
      const finalName = name || null;
      const finalMatchFlowMode =
        match_flow_mode ||
        matchFlowMode ||
        "smart";

      const finalParticipantIds = Array.isArray(participant_ids)
        ? participant_ids
        : Array.isArray(participantIds)
          ? participantIds
          : [];

      if (!id || !finalDateIso || !group_id) {
        return res.status(400).json({
          error: "id, date_iso e group_id são obrigatórios"
        });
      }

      if (!["fixed", "rotation"].includes(finalPlayMode)) {
        return res.status(400).json({
          error: "play_mode inválido"
        });
      }

      if (
        !["smart", "classic"]
          .includes(finalMatchFlowMode)
      ) {
        return res.status(400).json({
          error: "match_flow_mode inválido"
        });
      }

      /*
       * A dinâmica clássica só faz sentido
       * com duplas fixas.
       */
      if (
        finalPlayMode !== "fixed" &&
        finalMatchFlowMode === "classic"
      ) {
        return res.status(400).json({
          error:
            "A dinâmica previsível só pode ser usada com duplas fixas"
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
            match_flow_mode,
            participant_ids,
            group_id
          )
          VALUES (
            $1,
            $2,
            $3,
            NOW(),
            'em_andamento',
            $4,
            $5,
            $6::jsonb,
            $7
          )
            ON CONFLICT (id)
            DO UPDATE SET
              date_iso = EXCLUDED.date_iso,
              name = EXCLUDED.name,
              play_mode = EXCLUDED.play_mode,
              match_flow_mode = EXCLUDED.match_flow_mode,
              participant_ids = EXCLUDED.participant_ids,
              group_id = EXCLUDED.group_id
        `,
        [
          id,
          finalDateIso,
          finalName,
          finalPlayMode,
          finalMatchFlowMode,
          JSON.stringify(finalParticipantIds),
          group_id
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
        matchFlowMode,
        match_flow_mode,
        participantIds,
        participant_ids,
        pendingPairAId,
        pending_pair_a_id,
        pendingPairBId,
        pending_pair_b_id,
        group_id
      } = body;

      if (!id || !group_id) {
        return res.status(400).json({
          error: "id e group_id são obrigatórios"
        });
      }

      const finalPlayMode =
        play_mode ??
        playMode;

      const finalMatchFlowMode =
        match_flow_mode ??
        matchFlowMode;

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

      if (
        finalMatchFlowMode &&
        !["smart", "classic"].includes(finalMatchFlowMode)
      ) {
        return res.status(400).json({
          error: "match_flow_mode inválido"
        });
      }

      const hasAnyChange =
        typeof status !== "undefined" ||
        typeof finalPlayMode !== "undefined" ||
        typeof finalMatchFlowMode !== "undefined" ||
        hasParticipantIds ||
        hasPendingPairA ||
        hasPendingPairB;

      if (!hasAnyChange) {
        return res.status(400).json({
          error: "Nenhuma alteração informada"
        });
      }

      const updateResult = await pool.query(
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

            match_flow_mode = CASE
              WHEN $6::boolean THEN $7
              ELSE match_flow_mode
            END,

            participant_ids = CASE
              WHEN $8::boolean THEN $9::jsonb
              ELSE participant_ids
            END,

            pending_pair_a_id = CASE
              WHEN $10::boolean THEN $11
              ELSE pending_pair_a_id
            END,

            pending_pair_b_id = CASE
              WHEN $12::boolean THEN $13
              ELSE pending_pair_b_id
            END

          WHERE id = $1
            AND group_id = $14
        `,
        [
          id,

          typeof status !== "undefined",
          status ?? null,

          typeof finalPlayMode !== "undefined",
          finalPlayMode ?? null,

          typeof finalMatchFlowMode !== "undefined",
          finalMatchFlowMode ?? null,

          hasParticipantIds,
          hasParticipantIds
            ? JSON.stringify(finalParticipantIds || [])
            : null,

          hasPendingPairA,
          finalPendingPairA,

          hasPendingPairB,
          finalPendingPairB,

          group_id
        ]
      );

      if (!updateResult.rowCount) {
        return res.status(404).json({
          error: "Sessão não encontrada para este grupo"
        });
      }

      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const { id, group_id } = req.body || {};

      if (!id || !group_id) {
        return res.status(400).json({
          error: "id e group_id são obrigatórios"
        });
      }

      const sessionResult = await pool.query(
        `
      SELECT id
      FROM sessions
      WHERE id = $1
        AND group_id = $2
      LIMIT 1
    `,
        [id, group_id]
      );

      if (!sessionResult.rows.length) {
        return res.status(404).json({
          error: "Sessão não encontrada para este grupo"
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
        `
      DELETE FROM sessions
      WHERE id = $1
        AND group_id = $2
    `,
        [id, group_id]
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