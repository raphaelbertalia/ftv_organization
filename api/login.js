import { pool } from "./_db";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido" });
    }

    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: "username e password são obrigatórios" });
    }

    const result = await pool.query(
      `
      SELECT id, username, password, role, active
      FROM users
      WHERE username = $1
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

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}