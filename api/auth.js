import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "../lib/db.js";
import {
  createSession,
  getAuthenticatedUser,
  destroySession,
  requireAuth,
  requireGroupAdmin,
  requireGlobalAdmin
} from "../lib/auth.js";

function normalizeGroupSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeWhatsapp(value) {
  const digits = String(value || "")
    .replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  // DDD + celular
  if (digits.length === 11) {
    return `55${digits}`;
  }

  // 55 + DDD + celular
  if (
    digits.length === 13 &&
    digits.startsWith("55")
  ) {
    return digits;
  }

  return digits;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método não permitido" });
    }

    const { action } = req.query || {};

    if (action === "me") {
      const authenticatedUser = await getAuthenticatedUser(req);

      if (!authenticatedUser) {
        return res.status(401).json({
          error: "Sessão inválida ou expirada"
        });
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
        [authenticatedUser.id]
      );

      return res.status(200).json({
        ok: true,
        user: authenticatedUser,
        groups: groupsResult.rows || []
      });

    } else if (action === "logout") {
      await destroySession(req, res);

      return res.status(200).json({
        ok: true
      });

    } else if (action === "login") {
      // mantém exatamente o fluxo atual de login
      // todo o código do cadastro que você já colocou
    } else if (action === "register") {
      const {
        name,
        username,
        email,
        whatsapp,
        password
      } = req.body || {};

      const cleanName = String(name || "").trim();
      const cleanUsername = String(username || "").trim();
      const cleanEmail = String(email || "").trim().toLowerCase();
      const cleanWhatsapp = normalizeWhatsapp(whatsapp);
      const cleanPassword = String(password || "");

      if (
        !cleanName ||
        !cleanUsername ||
        !cleanEmail ||
        !cleanWhatsapp ||
        !cleanPassword
      ) {
        return res.status(400).json({
          error:
            "Nome, usuário, e-mail, WhatsApp e senha são obrigatórios"
        });
      }

      if (!/^55[1-9][0-9]9[0-9]{8}$/.test(cleanWhatsapp)) {
        return res.status(400).json({
          error: "Informe um WhatsApp celular brasileiro válido"
        });
      }

      if (cleanPassword.length < 8) {
        return res.status(400).json({
          error: "A senha deve ter pelo menos 8 caracteres"
        });
      }

      const existingUser = await pool.query(
        `
    SELECT
      id,
      username,
      email,
      whatsapp
    FROM users
    WHERE LOWER(username) = LOWER($1)
       OR LOWER(email) = LOWER($2)
       OR whatsapp = $3
    LIMIT 1
  `,
        [
          cleanUsername,
          cleanEmail,
          cleanWhatsapp
        ]
      );

      if (existingUser.rows.length) {
        const existing = existingUser.rows[0];

        if (
          String(existing.username || "").toLowerCase() ===
          cleanUsername.toLowerCase()
        ) {
          return res.status(409).json({
            error: "Este nome de usuário já está em uso"
          });
        }

        if (
          String(existing.email || "").toLowerCase() ===
          cleanEmail
        ) {
          return res.status(409).json({
            error: "Este e-mail já possui uma conta"
          });
        }

        if (
          String(existing.whatsapp || "") ===
          cleanWhatsapp
        ) {
          return res.status(409).json({
            error:
              "Este WhatsApp já está vinculado a outro usuário"
          });
        }

        return res.status(409).json({
          error: "Já existe uma conta com estes dados"
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
      whatsapp,
      password,
      role,
      active
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      'user',
      true
    )
    RETURNING
      id,
      name,
      username,
      email,
      whatsapp,
      role,
      active
  `,
        [
          userId,
          cleanName,
          cleanUsername,
          cleanEmail,
          cleanWhatsapp,
          hashedPassword
        ]
      );

      return res.status(201).json({
        ok: true,
        user: result.rows[0]
      });
    } else if (action === "access-options") {
      const user = await requireAuth(req, res);

      if (!user) {
        return;
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
        [user.id]
      );

      return res.status(200).json({
        ok: true,
        groups: result.rows || []
      });

    } else if (action === "request-group-access") {
      const user = await requireAuth(req, res);

      if (!user) {
        return;
      }

      const { group_id } = req.body || {};

      if (!group_id) {
        return res.status(400).json({
          error: "Grupo é obrigatório"
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
        [user.id, group_id]
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
        [user.id, group_id]
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
      VALUES ($1, $2, 'viewer', 'pending')
      RETURNING
        id,
        user_id,
        group_id,
        requested_role,
        status,
        created_at
    `,
        [user.id, group_id]
      );

      return res.status(201).json({
        ok: true,
        message: `Solicitação enviada para o grupo ${group.name}.`,
        request: requestResult.rows[0]
      });

    } else if (action === "pending-group-requests") {
      const { group_id } = req.body || {};

      const auth = await requireGroupAdmin(
        req,
        res,
        group_id
      );

      if (!auth) {
        return;
      }

      const result = await pool.query(
        `
      SELECT
        gar.id,
        gar.user_id,
        gar.group_id,
        gar.requested_role,
        gar.status,
        gar.created_at,

        u.name,
        u.username,
        u.email,

        g.name AS group_name

      FROM group_access_requests gar

      INNER JOIN users u
        ON u.id = gar.user_id

      INNER JOIN groups g
        ON g.id = gar.group_id

      WHERE gar.group_id = $1
        AND gar.status = 'pending'

      ORDER BY gar.created_at ASC
    `,
        [group_id]
      );

      return res.status(200).json({
        ok: true,
        requests: result.rows || []
      });

    } else if (action === "approve-group-request") {
      const { request_id } = req.body || {};

      if (!request_id) {
        return res.status(400).json({
          error: "Solicitação não informada"
        });
      }

      const requestResult = await pool.query(
        `
      SELECT
        id,
        user_id,
        group_id,
        requested_role,
        status
      FROM group_access_requests
      WHERE id = $1
      LIMIT 1
    `,
        [request_id]
      );

      const accessRequest = requestResult.rows[0];

      if (!accessRequest) {
        return res.status(404).json({
          error: "Solicitação não encontrada"
        });
      }

      if (accessRequest.status !== "pending") {
        return res.status(409).json({
          error: "Esta solicitação já foi analisada"
        });
      }

      const auth = await requireGroupAdmin(
        req,
        res,
        accessRequest.group_id
      );

      if (!auth) {
        return;
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await client.query(
          `
        INSERT INTO user_groups (
          user_id,
          group_id,
          role,
          active
        )
        VALUES ($1, $2, $3, true)

        ON CONFLICT (user_id, group_id)
        DO UPDATE SET
          role = EXCLUDED.role,
          active = true
      `,
          [
            accessRequest.user_id,
            accessRequest.group_id,
            accessRequest.requested_role || "viewer"
          ]
        );

        await client.query(
          `
        UPDATE group_access_requests
        SET
          status = 'approved',
          reviewed_at = NOW(),
          reviewed_by = $2
        WHERE id = $1
      `,
          [
            request_id,
            auth.user.id
          ]
        );

        await client.query("COMMIT");

        return res.status(200).json({
          ok: true,
          message: "Solicitação aprovada com sucesso"
        });

      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

    } else if (action === "reject-group-request") {
      const { request_id } = req.body || {};

      if (!request_id) {
        return res.status(400).json({
          error: "Solicitação não informada"
        });
      }

      const requestResult = await pool.query(
        `
      SELECT
        id,
        group_id,
        status
      FROM group_access_requests
      WHERE id = $1
      LIMIT 1
    `,
        [request_id]
      );

      const accessRequest = requestResult.rows[0];

      if (!accessRequest) {
        return res.status(404).json({
          error: "Solicitação não encontrada"
        });
      }

      if (accessRequest.status !== "pending") {
        return res.status(409).json({
          error: "Esta solicitação já foi analisada"
        });
      }

      const auth = await requireGroupAdmin(
        req,
        res,
        accessRequest.group_id
      );

      if (!auth) {
        return;
      }

      await pool.query(
        `
      UPDATE group_access_requests
      SET
        status = 'rejected',
        reviewed_at = NOW(),
        reviewed_by = $2
      WHERE id = $1
    `,
        [
          request_id,
          auth.user.id
        ]
      );

      return res.status(200).json({
        ok: true,
        message: "Solicitação rejeitada"
      });

    } else if (action === "group-members") {
      const { group_id } = req.body || {};

      const auth = await requireGroupAdmin(
        req,
        res,
        group_id
      );

      if (!auth) {
        return;
      }

      const result = await pool.query(
        `
      SELECT
        ug.id,
        ug.user_id,
        ug.group_id,
        ug.role,
        ug.active,
        ug.created_at,

        u.name,
        u.username,
        u.email,
        u.role AS global_role

      FROM user_groups ug

      INNER JOIN users u
        ON u.id = ug.user_id

      WHERE ug.group_id = $1

      ORDER BY
        ug.active DESC,
        u.name ASC,
        u.username ASC
    `,
        [group_id]
      );

      return res.status(200).json({
        ok: true,
        members: result.rows || []
      });

    } else if (action === "update-group-member-role") {
      const { group_id, user_id, role } = req.body || {};

      if (!group_id || !user_id || !role) {
        return res.status(400).json({
          error: "Grupo, usuário e papel são obrigatórios"
        });
      }

      const allowedRoles = ["viewer", "user", "admin"];

      if (!allowedRoles.includes(role)) {
        return res.status(400).json({
          error: "Papel inválido"
        });
      }

      const auth = await requireGroupAdmin(
        req,
        res,
        group_id
      );

      if (!auth) {
        return;
      }

      const membershipResult = await pool.query(
        `
      SELECT id, role, active
      FROM user_groups
      WHERE user_id = $1
        AND group_id = $2
      LIMIT 1
    `,
        [user_id, group_id]
      );

      const membership = membershipResult.rows[0];

      if (!membership) {
        return res.status(404).json({
          error: "Membro não encontrado neste grupo"
        });
      }

      if (
        membership.active &&
        membership.role === "admin" &&
        role !== "admin"
      ) {
        const adminsResult = await pool.query(
          `
      SELECT COUNT(*) AS total
      FROM user_groups
      WHERE group_id = $1
        AND role = 'admin'
        AND active = true
    `,
          [group_id]
        );

        const activeAdmins = Number(
          adminsResult.rows[0]?.total || 0
        );

        if (activeAdmins <= 1) {
          return res.status(409).json({
            error:
              "Não é possível alterar o papel do último administrador ativo do grupo"
          });
        }
      }

      await pool.query(
        `
      UPDATE user_groups
      SET role = $3
      WHERE user_id = $1
        AND group_id = $2
    `,
        [user_id, group_id, role]
      );

      return res.status(200).json({
        ok: true,
        message: "Papel do membro atualizado com sucesso"
      });

    } else if (action === "deactivate-group-member") {
      const { group_id, user_id } = req.body || {};

      if (!group_id || !user_id) {
        return res.status(400).json({
          error: "Grupo e usuário são obrigatórios"
        });
      }

      const auth = await requireGroupAdmin(
        req,
        res,
        group_id
      );

      if (!auth) {
        return;
      }

      if (String(auth.user.id) === String(user_id)) {
        return res.status(400).json({
          error: "Você não pode desativar seu próprio acesso ao grupo"
        });
      }

      const targetResult = await pool.query(
        `
    SELECT role, active
    FROM user_groups
    WHERE user_id = $1
      AND group_id = $2
    LIMIT 1
  `,
        [user_id, group_id]
      );

      const targetMembership = targetResult.rows[0];

      if (!targetMembership) {
        return res.status(404).json({
          error: "Membro não encontrado neste grupo"
        });
      }

      if (
        targetMembership.active &&
        targetMembership.role === "admin"
      ) {
        const adminsResult = await pool.query(
          `
      SELECT COUNT(*) AS total
      FROM user_groups
      WHERE group_id = $1
        AND role = 'admin'
        AND active = true
    `,
          [group_id]
        );

        const activeAdmins = Number(
          adminsResult.rows[0]?.total || 0
        );

        if (activeAdmins <= 1) {
          return res.status(409).json({
            error:
              "Não é possível desativar o último administrador ativo do grupo"
          });
        }
      }

      const result = await pool.query(
        `
      UPDATE user_groups
      SET active = false
      WHERE user_id = $1
        AND group_id = $2
      RETURNING id
    `,
        [user_id, group_id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Membro não encontrado neste grupo"
        });
      }

      return res.status(200).json({
        ok: true,
        message: "Acesso do membro desativado"
      });

    } else if (action === "reactivate-group-member") {
      const { group_id, user_id } = req.body || {};

      if (!group_id || !user_id) {
        return res.status(400).json({
          error: "Grupo e usuário são obrigatórios"
        });
      }

      const auth = await requireGroupAdmin(
        req,
        res,
        group_id
      );

      if (!auth) {
        return;
      }

      const result = await pool.query(
        `
      UPDATE user_groups
      SET active = true
      WHERE user_id = $1
        AND group_id = $2
      RETURNING id
    `,
        [user_id, group_id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Membro não encontrado neste grupo"
        });
      }

      return res.status(200).json({
        ok: true,
        message: "Acesso do membro reativado"
      });

    } else if (action === "list-groups-admin") {
      const user = await requireGlobalAdmin(req, res);

      if (!user) {
        return;
      }

      const result = await pool.query(
        `
      SELECT
        g.id,
        g.name,
        g.slug,
        g.active,

        (
          SELECT COUNT(*)
          FROM user_groups ug
          WHERE ug.group_id = g.id
            AND ug.active = true
        ) AS active_members,

        (
          SELECT COUNT(*)
          FROM group_access_requests gar
          WHERE gar.group_id = g.id
            AND gar.status = 'pending'
        ) AS pending_requests

      FROM groups g

      ORDER BY
        g.active DESC,
        g.name ASC
    `
      );

      return res.status(200).json({
        ok: true,
        groups: result.rows || []
      });

    } else if (action === "create-group") {
      const user = await requireGlobalAdmin(req, res);

      if (!user) {
        return;
      }

      const { name, slug } = req.body || {};

      const cleanName = String(name || "").trim();

      const cleanSlug = normalizeGroupSlug(
        slug || cleanName
      );

      if (!cleanName) {
        return res.status(400).json({
          error: "Nome do grupo é obrigatório"
        });
      }

      if (!cleanSlug) {
        return res.status(400).json({
          error: "Não foi possível gerar um identificador para o grupo"
        });
      }

      const existingGroup = await pool.query(
        `
      SELECT id
      FROM groups
      WHERE LOWER(slug) = LOWER($1)
      LIMIT 1
    `,
        [cleanSlug]
      );

      if (existingGroup.rows.length) {
        return res.status(409).json({
          error: "Já existe um grupo com este identificador"
        });
      }

      const groupId = crypto.randomUUID();

      const result = await pool.query(
        `
      INSERT INTO groups (
        id,
        name,
        slug,
        active
      )
      VALUES ($1, $2, $3, true)

      RETURNING
        id,
        name,
        slug,
        active
    `,
        [
          groupId,
          cleanName,
          cleanSlug
        ]
      );

      return res.status(201).json({
        ok: true,
        message: "Grupo criado com sucesso",
        group: result.rows[0]
      });

    } else if (action === "update-group") {
      const user = await requireGlobalAdmin(req, res);

      if (!user) {
        return;
      }

      const {
        group_id,
        name,
        slug
      } = req.body || {};

      if (!group_id) {
        return res.status(400).json({
          error: "Grupo não informado"
        });
      }

      const cleanName = String(name || "").trim();

      const cleanSlug = normalizeGroupSlug(
        slug || cleanName
      );

      if (!cleanName) {
        return res.status(400).json({
          error: "Nome do grupo é obrigatório"
        });
      }

      if (!cleanSlug) {
        return res.status(400).json({
          error: "Identificador do grupo inválido"
        });
      }

      const existingSlug = await pool.query(
        `
      SELECT id
      FROM groups
      WHERE LOWER(slug) = LOWER($1)
        AND id <> $2
      LIMIT 1
    `,
        [
          cleanSlug,
          group_id
        ]
      );

      if (existingSlug.rows.length) {
        return res.status(409).json({
          error: "Já existe outro grupo com este identificador"
        });
      }

      const result = await pool.query(
        `
      UPDATE groups
      SET
        name = $2,
        slug = $3
      WHERE id = $1

      RETURNING
        id,
        name,
        slug,
        active
    `,
        [
          group_id,
          cleanName,
          cleanSlug
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Grupo não encontrado"
        });
      }

      return res.status(200).json({
        ok: true,
        message: "Grupo atualizado com sucesso",
        group: result.rows[0]
      });

    } else if (action === "set-group-active") {
      const user = await requireGlobalAdmin(req, res);

      if (!user) {
        return;
      }

      const {
        group_id,
        active
      } = req.body || {};

      if (!group_id) {
        return res.status(400).json({
          error: "Grupo não informado"
        });
      }

      if (typeof active !== "boolean") {
        return res.status(400).json({
          error: "Status do grupo inválido"
        });
      }

      const result = await pool.query(
        `
      UPDATE groups
      SET active = $2
      WHERE id = $1

      RETURNING
        id,
        name,
        slug,
        active
    `,
        [
          group_id,
          active
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Grupo não encontrado"
        });
      }

      return res.status(200).json({
        ok: true,
        message: active
          ? "Grupo ativado com sucesso"
          : "Grupo desativado com sucesso",
        group: result.rows[0]
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

    await createSession(res, user.id);

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