// lib/auth.js
import crypto from "crypto";
import { pool } from "./db.js";

const SESSION_COOKIE_NAME = "quarta_ch_session";
const SESSION_DURATION_DAYS = 30;

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function parseCookies(req) {
  const header = req.headers?.cookie || "";

  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const separatorIndex = item.indexOf("=");

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = item.slice(0, separatorIndex);
      const value = item.slice(separatorIndex + 1);

      cookies[key] = decodeURIComponent(value);

      return cookies;
    }, {});
}

function buildSessionCookie(token) {
  const maxAgeSeconds =
    SESSION_DURATION_DAYS * 24 * 60 * 60;

  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    process.env.NODE_ENV === "production" ? "Secure" : null
  ]
    .filter(Boolean)
    .join("; ");
}

function buildExpiredSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
    process.env.NODE_ENV === "production" ? "Secure" : null
  ]
    .filter(Boolean)
    .join("; ");
}

export async function createSession(res, userId) {
  const sessionId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  const expiresAt = new Date(
    Date.now() +
      SESSION_DURATION_DAYS *
        24 *
        60 *
        60 *
        1000
  );

  await pool.query(
    `
      INSERT INTO user_sessions (
        id,
        user_id,
        token_hash,
        expires_at
      )
      VALUES ($1, $2, $3, $4)
    `,
    [
      sessionId,
      String(userId),
      tokenHash,
      expiresAt
    ]
  );

  res.setHeader(
    "Set-Cookie",
    buildSessionCookie(token)
  );

  return {
    id: sessionId,
    expiresAt
  };
}

export async function getAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);

  const result = await pool.query(
    `
      SELECT
        us.id AS session_id,
        us.user_id,
        us.expires_at,
        u.username,
        u.role,
        u.active
      FROM user_sessions us
      INNER JOIN users u
        ON u.id = us.user_id
      WHERE us.token_hash = $1
        AND us.expires_at > NOW()
        AND u.active = true
      LIMIT 1
    `,
    [tokenHash]
  );

  const session = result.rows[0];

  if (!session) {
    return null;
  }

  await pool.query(
    `
      UPDATE user_sessions
      SET last_used_at = NOW()
      WHERE id = $1
    `,
    [session.session_id]
  );

  return {
    id: session.user_id,
    username: session.username,
    role: session.role
  };
}

export async function requireAuth(req, res) {
  const user = await getAuthenticatedUser(req);

  if (!user) {
    res.status(401).json({
      error: "Sessão inválida ou expirada"
    });

    return null;
  }

  return user;
}

export async function destroySession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];

  if (token) {
    const tokenHash = hashToken(token);

    await pool.query(
      `
        DELETE FROM user_sessions
        WHERE token_hash = $1
      `,
      [tokenHash]
    );
  }

  res.setHeader(
    "Set-Cookie",
    buildExpiredSessionCookie()
  );
}

export async function requireGlobalAdmin(req, res) {
  const user = await requireAuth(req, res);

  if (!user) {
    return null;
  }

  if (user.role !== "admin") {
    res.status(403).json({
      error: "Acesso permitido apenas para administrador global"
    });

    return null;
  }

  return user;
}

export async function requireGroupAdmin(req, res, groupId) {
  const user = await requireAuth(req, res);

  if (!user) {
    return null;
  }

  if (!groupId) {
    res.status(400).json({
      error: "Grupo não informado"
    });

    return null;
  }

  // Admin Global pode administrar qualquer grupo
  if (user.role === "admin") {
    return {
      user,
      groupRole: "admin",
      isGlobalAdmin: true
    };
  }

  const result = await pool.query(
    `
      SELECT role
      FROM user_groups
      WHERE user_id = $1
        AND group_id = $2
        AND active = true
      LIMIT 1
    `,
    [
      user.id,
      groupId
    ]
  );

  const membership = result.rows[0];

  if (!membership || membership.role !== "admin") {
    res.status(403).json({
      error: "Você não possui permissão administrativa neste grupo"
    });

    return null;
  }

  return {
    user,
    groupRole: membership.role,
    isGlobalAdmin: false
  };
}