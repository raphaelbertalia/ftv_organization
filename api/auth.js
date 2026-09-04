import { pool } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido" });
    }

    const { action } = req.query || {};

    if (action !== "login") {
      return res.status(400).json({ error: "Ação inválida" });
    }

    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: "username e password são obrigatórios" });
    }

    const result = await pool.query(
      `
      SELECT id, username, password, role, active
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
      `,
      [username]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }

    if (!user.active) {
      return res.status(403).json({ error: "Usuário inativo" });
    }

    if (user.password !== password) {
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }

    const groupsResult = await pool.query(
      `
        SELECT
          g.id,
          g.name,
          g.slug,
          ug.role
        FROM user_groups ug
        INNER JOIN groups g
          ON g.id = ug.group_id
        WHERE ug.user_id = $1
          AND ug.active = true
          AND g.active = true
        ORDER BY g.name ASC
      `,
      [user.id]
    );

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      },
      groups: groupsResult.rows || []
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}