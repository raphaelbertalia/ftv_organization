import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "../lib/db.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido" });
    }

    const { action } = req.query || {};

    if (action === "login") {
      // todo o código do cadastro que você já colocou
    } else if (action === "register") {
      const { name, username, email, password } = req.body || {};

      const cleanName = String(name || "").trim();
      const cleanUsername = String(username || "").trim();
      const cleanEmail = String(email || "").trim().toLowerCase();
      const cleanPassword = String(password || "");

      if (!cleanName || !cleanUsername || !cleanEmail || !cleanPassword) {
        return res.status(400).json({
          error: "Nome, usuário, e-mail e senha são obrigatórios"
        });
      }

      if (cleanPassword.length < 8) {
        return res.status(400).json({
          error: "A senha deve ter pelo menos 8 caracteres"
        });
      }

      const existingUser = await pool.query(
        `
          SELECT id
          FROM users
          WHERE LOWER(username) = LOWER($1)
            OR LOWER(email) = LOWER($2)
          LIMIT 1
          `,
        [cleanUsername, cleanEmail]
      );

      if (existingUser.rows.length) {
        return res.status(409).json({
          error: "Usuário ou e-mail já cadastrado"
        });
      }

      const hashedPassword = await bcrypt.hash(cleanPassword, 12);

      const userId = crypto.randomUUID();

      const result = await pool.query(
        `
          INSERT INTO users (
              id,
              name,
              username,
              email,
              password,
              role,
              active
          )
          VALUES ($1, $2, $3, $4, $5, 'user', true)
          RETURNING id, name, username, email, role, active
          `,
        [
          userId,
          cleanName,
          cleanUsername,
          cleanEmail,
          hashedPassword
        ]
      );

      return res.status(201).json({
        ok: true,
        user: result.rows[0]
      });
    } else if (action === "access-options") {
      const { user_id } = req.body || {};

      if (!user_id) {
        return res.status(400).json({
          error: "Usuário não informado"
        });
      }

      const userResult = await pool.query(
        `
          SELECT id, active
          FROM users
          WHERE id = $1
          LIMIT 1
        `,
        [user_id]
      );

      const user = userResult.rows[0];

      if (!user || !user.active) {
        return res.status(403).json({
          error: "Usuário inválido ou inativo"
        });
      }

      const result = await pool.query(
        `
          SELECT
            g.id,
            g.name,
            g.slug,
            CASE
              WHEN ug.id IS NOT NULL THEN true
              ELSE false
            END AS already_member,
            gar.status AS request_status
          FROM groups g

          LEFT JOIN user_groups ug
            ON ug.group_id = g.id
           AND ug.user_id = $1
           AND ug.active = true

          LEFT JOIN group_access_requests gar
            ON gar.group_id = g.id
           AND gar.user_id = $1
           AND gar.status = 'pending'

          WHERE g.active = true

          ORDER BY g.name ASC
        `,
        [user_id]
      );

      return res.status(200).json({
        ok: true,
        groups: result.rows || []
      });

    } else if (action === "request-group-access") {
      const { user_id, group_id } = req.body || {};

      if (!user_id || !group_id) {
        return res.status(400).json({
          error: "Usuário e grupo são obrigatórios"
        });
      }

      const groupResult = await pool.query(
        `
          SELECT id, name
          FROM groups
          WHERE id = $1
            AND active = true
          LIMIT 1
        `,
        [group_id]
      );

      const group = groupResult.rows[0];

      if (!group) {
        return res.status(404).json({
          error: "Grupo não encontrado"
        });
      }

      const membershipResult = await pool.query(
        `
          SELECT id
          FROM user_groups
          WHERE user_id = $1
            AND group_id = $2
            AND active = true
          LIMIT 1
        `,
        [user_id, group_id]
      );

      if (membershipResult.rows.length) {
        return res.status(409).json({
          error: `Você já participa do grupo ${group.name}.`
        });
      }

      const pendingResult = await pool.query(
        `
          SELECT id
          FROM group_access_requests
          WHERE user_id = $1
            AND group_id = $2
            AND status = 'pending'
          LIMIT 1
        `,
        [user_id, group_id]
      );

      if (pendingResult.rows.length) {
        return res.status(409).json({
          error:
            `Sua solicitação de acesso ao grupo ${group.name} ainda está pendente. ` +
            `Entre em contato com o responsável pelo grupo.`
        });
      }

      const requestResult = await pool.query(
        `
          INSERT INTO group_access_requests (
            user_id,
            group_id,
            requested_role,
            status
          )
          VALUES ($1, $2, 'user', 'pending')
          RETURNING
            id,
            user_id,
            group_id,
            requested_role,
            status,
            created_at
        `,
        [user_id, group_id]
      );

      return res.status(201).json({
        ok: true,
        message: `Solicitação enviada para o grupo ${group.name}.`,
        request: requestResult.rows[0]
      });

    } else {
      return res.status(400).json({ error: "Ação inválida" });
    }

    // daqui para baixo segue o fluxo de login

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

    const storedPassword = user.password || "";
    const isHashedPassword = /^\$2[aby]\$\d{2}\$/.test(storedPassword);

    let passwordValid = false;

    if (isHashedPassword) {
      passwordValid = await bcrypt.compare(password, storedPassword);
    } else {
      passwordValid = storedPassword === password;

      if (passwordValid) {
        const hashedPassword = await bcrypt.hash(password, 12);

        await pool.query(
          `
            UPDATE users
            SET password = $1
            WHERE id = $2
            `,
          [hashedPassword, user.id]
        );
      }
    }

    if (!passwordValid) {
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