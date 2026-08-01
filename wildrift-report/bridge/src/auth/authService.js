import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { DiscordApiError } from "../discordClient.js";

export const SESSION_COOKIE = "wr_session";
export const OAUTH_STATE_COOKIE = "wr_oauth_state";

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signature(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function signToken(payload, secret) {
  const body = encode(payload);
  return `${body}.${signature(body, secret)}`;
}

export function verifyToken(
  token,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (typeof token !== "string") return null;
  const [body, supplied, extra] = token.split(".");
  if (!body || !supplied || extra) return null;
  const expected = signature(body, secret);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!Number.isInteger(payload.exp) || payload.exp <= nowSeconds)
      return null;
    return payload;
  } catch {
    return null;
  }
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${value}`, `Path=${options.path ?? "/"}`, "HttpOnly"];
  if (options.secure !== false) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function safeReturnPath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n]/.test(value)
  ) {
    return "/";
  }
  return value;
}

export function createAuthService({
  clientId,
  clientSecret,
  bridgePublicUrl,
  publicSiteOrigin,
  sessionSecret,
  guildId,
  adminRoleId,
  discordClient,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  randomBytesImpl = randomBytes,
  sessionTtlSeconds = 8 * 60 * 60,
  secureCookies = true,
}) {
  if (!clientId || !clientSecret || !bridgePublicUrl || !publicSiteOrigin) {
    throw new Error("Discord OAuth 환경변수가 필요합니다.");
  }
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SIGNING_SECRET은 32자 이상이어야 합니다.");
  }
  if (!discordClient || !guildId || !adminRoleId) {
    throw new Error("Discord 관리자 역할 확인 설정이 필요합니다.");
  }

  const redirectUri = `${bridgePublicUrl}/api/auth/discord/callback`;
  const nowSeconds = () => Math.floor(now() / 1000);

  function startLogin(returnPath = "/") {
    const state = signToken(
      {
        nonce: randomBytesImpl(24).toString("base64url"),
        returnPath: safeReturnPath(returnPath),
        exp: nowSeconds() + 10 * 60,
      },
      sessionSecret,
    );
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", state);

    return {
      url: url.toString(),
      state,
      stateCookie: cookie(OAUTH_STATE_COOKIE, state, {
        path: "/api/auth/discord",
        sameSite: "Lax",
        secure: secureCookies,
        maxAge: 10 * 60,
      }),
    };
  }

  async function discordOAuthRequest(url, options) {
    let response;
    try {
      response = await fetchImpl(url, options);
    } catch (cause) {
      const error = new AuthError(
        502,
        "discord_oauth_unavailable",
        "Discord 로그인 서버에 연결하지 못했습니다.",
      );
      error.cause = cause;
      throw error;
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AuthError(
        502,
        "discord_oauth_rejected",
        body?.error_description ??
          body?.message ??
          "Discord 로그인이 거부되었습니다.",
      );
    }
    return body;
  }

  async function finishLogin({ code, state, stateCookie }) {
    if (!code || !state || !stateCookie || state !== stateCookie) {
      throw new AuthError(
        400,
        "invalid_oauth_state",
        "로그인 요청 상태가 일치하지 않습니다.",
      );
    }
    const statePayload = verifyToken(state, sessionSecret, nowSeconds());
    if (!statePayload) {
      throw new AuthError(
        400,
        "invalid_oauth_state",
        "로그인 요청이 만료되었거나 변조되었습니다.",
      );
    }

    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    const token = await discordOAuthRequest(
      "https://discord.com/api/v10/oauth2/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      },
    );
    const user = await discordOAuthRequest(
      "https://discord.com/api/v10/users/@me",
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
      },
    );
    if (!/^\d{17,20}$/.test(user?.id ?? "")) {
      throw new AuthError(
        502,
        "invalid_discord_user",
        "Discord 사용자 정보를 확인하지 못했습니다.",
      );
    }

    const issuedAt = nowSeconds();
    const session = signToken(
      {
        sub: user.id,
        username: user.username ?? "Discord user",
        avatar: user.avatar ?? null,
        iat: issuedAt,
        exp: issuedAt + sessionTtlSeconds,
      },
      sessionSecret,
    );

    return {
      user: {
        id: user.id,
        username: user.username ?? "Discord user",
        avatar: user.avatar ?? null,
      },
      redirectUrl: `${publicSiteOrigin}${safeReturnPath(statePayload.returnPath)}`,
      sessionCookie: cookie(SESSION_COOKIE, session, {
        sameSite: "None",
        secure: secureCookies,
        maxAge: sessionTtlSeconds,
      }),
      clearStateCookie: cookie(OAUTH_STATE_COOKIE, "", {
        path: "/api/auth/discord",
        sameSite: "Lax",
        secure: secureCookies,
        maxAge: 0,
      }),
    };
  }

  function authenticate(cookieHeader) {
    const token = parseCookies(cookieHeader)[SESSION_COOKIE];
    const payload = verifyToken(token, sessionSecret, nowSeconds());
    if (!payload?.sub) {
      throw new AuthError(
        401,
        "authentication_required",
        "Discord 로그인이 필요합니다.",
      );
    }
    return {
      id: payload.sub,
      username: payload.username,
      avatar: payload.avatar ?? null,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }

  async function isAdmin(userId) {
    try {
      const member = await discordClient.getGuildMember(guildId, userId);
      return Array.isArray(member?.roles) && member.roles.includes(adminRoleId);
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404)
        return false;
      throw error;
    }
  }

  async function requireAdmin(cookieHeader) {
    const user = authenticate(cookieHeader);
    if (!(await isAdmin(user.id))) {
      throw new AuthError(403, "admin_required", "관리자 권한이 필요합니다.");
    }
    return user;
  }

  return {
    startLogin,
    finishLogin,
    authenticate,
    isAdmin,
    requireAdmin,
    logoutCookie: () =>
      cookie(SESSION_COOKIE, "", {
        sameSite: "None",
        secure: secureCookies,
        maxAge: 0,
      }),
  };
}
