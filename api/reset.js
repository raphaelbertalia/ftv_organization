import { pool } from "../lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { keepPlayers = false, group_id } = req.body || {};

  if (!group_id) {
    return res.status(400).json({
      error: "group_id é obrigatório"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Jogos pertencentes às sessões do grupo
    await client.query(
      `
        DELETE FROM matches
        WHERE session_id IN (
          SELECT id
          FROM sessions
          WHERE group_id = $1
        )
      `,
      [group_id]
    );

    // Duplas pertencentes às sessões do grupo
    await client.query(
      `
        DELETE FROM pairs
        WHERE session_id IN (
          SELECT id
          FROM sessions
          WHERE group_id = $1
        )
      `,
      [group_id]
    );

    // Duplas pertencentes aos ciclos do grupo
    await client.query(
      `
        DELETE FROM pairs
        WHERE cycle_id IN (
          SELECT id
          FROM monthly_cycles
          WHERE group_id = $1
        )
      `,
      [group_id]
    );

    // Sessões somente do grupo atual
    await client.query(
      `
        DELETE FROM sessions
        WHERE group_id = $1
      `,
      [group_id]
    );

    // Só remove jogadores se for reset total
    if (!keepPlayers) {
      await client.query(
        `
          DELETE FROM players
          WHERE group_id = $1
        `,
        [group_id]
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");

    return res.status(500).json({
      error: err.message
    });
  } finally {
    client.release();
  }
}