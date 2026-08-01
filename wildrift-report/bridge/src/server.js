import { createServer as createHttpServer } from "node:http";

import {
  AuthError,
  OAUTH_STATE_COOKIE,
  parseCookies,
} from "./auth/authService.js";
import { DiscordApiError } from "./discordClient.js";
import { ReportNotFoundError } from "./repositories/reportRepository.js";
import { UserNotFoundError, toOwnUser } from "./repositories/userRepository.js";
import {
  VerificationConflictError,
  VerificationNotFoundError,
  toOwnVerification,
} from "./repositories/verificationRepository.js";
import {
  REPORT_CATEGORIES,
  ReportValidationError,
  validateReportSubmission,
} from "./validation/reportValidation.js";
import {
  VerificationValidationError,
  validateVerificationSubmission,
} from "./validation/verificationValidation.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
  res.end(body);
}

function sendError(res, status, code, message, extraHeaders = {}) {
  sendJson(res, status, { error: { code, message } }, extraHeaders);
}

function sendRedirect(res, location, cookies = [], extraHeaders = {}) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    ...(cookies.length > 0 ? { "Set-Cookie": cookies } : {}),
    ...extraHeaders,
  });
  res.end();
}

class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
  }
}

async function readJsonBody(req, maxBytes = 22 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new RequestError(
        413,
        "payload_too_large",
        "요청 본문이 너무 큽니다.",
      );
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    throw new RequestError(400, "invalid_json", "JSON 요청 본문이 필요합니다.");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(
      400,
      "invalid_json",
      "JSON 형식이 올바르지 않습니다.",
    );
  }
}

function reportIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/reports\/(\d{17,20})$/);
  return match?.[1] ?? null;
}

function adminDecisionIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/admin\/reports\/(\d{17,20})\/status$/);
  return match?.[1] ?? null;
}

function adminVerificationIdFromPath(pathname) {
  const match = pathname.match(
    /^\/api\/admin\/verifications\/(\d{17,20})\/status$/,
  );
  return match?.[1] ?? null;
}

function adminUserIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/admin\/users\/(\d{17,20})\/ban$/);
  return match?.[1] ?? null;
}

function sendRouteError(res, error, cors) {
  if (error instanceof RequestError) {
    sendError(res, error.status, error.code, error.message, cors);
    return;
  }
  if (error instanceof AuthError) {
    sendError(res, error.status, error.code, error.message, cors);
    return;
  }
  if (error instanceof ReportValidationError) {
    sendJson(
      res,
      422,
      {
        error: {
          code: "validation_failed",
          message: error.message,
          issues: error.issues,
        },
      },
      cors,
    );
    return;
  }
  if (error instanceof VerificationValidationError) {
    sendJson(
      res,
      422,
      {
        error: {
          code: "validation_failed",
          message: error.message,
          issues: error.issues,
        },
      },
      cors,
    );
    return;
  }
  if (error instanceof ReportNotFoundError) {
    sendError(res, 404, "report_not_found", error.message, cors);
    return;
  }
  if (error instanceof VerificationNotFoundError) {
    sendError(res, 404, "verification_not_found", error.message, cors);
    return;
  }
  if (error instanceof UserNotFoundError) {
    sendError(res, 404, "user_not_found", error.message, cors);
    return;
  }
  if (error instanceof VerificationConflictError) {
    sendError(res, 409, "verification_conflict", error.message, cors);
    return;
  }
  if (error instanceof DiscordApiError) {
    sendError(
      res,
      502,
      "discord_unavailable",
      "Discord 저장소 요청에 실패했습니다.",
      cors,
    );
    return;
  }
  throw error;
}

/**
 * 허용된 출처 하나만 CORS를 열어준다 (계획서 7절).
 * 요청 출처가 다르면 CORS 헤더를 아예 붙이지 않아 브라우저가 막게 한다.
 */
function corsHeaders(requestOrigin, allowedOrigin) {
  if (!allowedOrigin || requestOrigin !== allowedOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function createRequestHandler({
  healthService,
  configRepository = null,
  reportRepository = null,
  userRepository = null,
  verificationRepository = null,
  auditRepository = null,
  authService = null,
  devReporterDiscordId = null,
  publicSiteOrigin = null,
}) {
  return async function handle(req, res) {
    const origin = req.headers.origin ?? null;
    const cors = corsHeaders(origin, publicSiteOrigin);

    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      sendError(
        res,
        400,
        "bad_request",
        "요청 경로를 해석할 수 없습니다.",
        cors,
      );
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (url.pathname === "/health") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendError(res, 405, "method_not_allowed", "GET만 지원합니다.", {
          ...cors,
          Allow: "GET, HEAD",
        });
        return;
      }
      try {
        const result = await healthService.check();
        // 감시 도구가 HTTP 상태 코드만 보고도 판단할 수 있게 맞춰준다.
        const status = result.status === "error" ? 503 : 200;
        sendJson(res, status, result, cors);
      } catch (error) {
        sendError(
          res,
          500,
          "health_check_failed",
          error?.message ?? "상태 확인에 실패했습니다.",
          cors,
        );
      }
      return;
    }

    if (url.pathname === "/api/auth/discord") {
      if (req.method !== "GET") {
        sendError(res, 405, "method_not_allowed", "GET만 지원합니다.", {
          ...cors,
          Allow: "GET",
        });
        return;
      }
      if (!authService) {
        sendError(
          res,
          503,
          "auth_not_configured",
          "Discord 로그인 설정이 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      const login = authService.startLogin(
        url.searchParams.get("returnTo") || "/",
      );
      sendRedirect(res, login.url, [login.stateCookie]);
      return;
    }

    if (url.pathname === "/api/auth/discord/callback") {
      if (req.method !== "GET") {
        sendError(res, 405, "method_not_allowed", "GET만 지원합니다.", cors);
        return;
      }
      if (!authService) {
        sendError(
          res,
          503,
          "auth_not_configured",
          "Discord 로그인 설정이 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      try {
        const cookies = parseCookies(req.headers.cookie);
        const result = await authService.finishLogin({
          code: url.searchParams.get("code"),
          state: url.searchParams.get("state"),
          stateCookie: cookies[OAUTH_STATE_COOKIE],
        });
        sendRedirect(res, result.redirectUrl, [
          result.sessionCookie,
          result.clearStateCookie,
        ]);
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    if (url.pathname === "/api/auth/logout") {
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "POST만 지원합니다.", cors);
        return;
      }
      if (!authService) {
        sendError(
          res,
          503,
          "auth_not_configured",
          "Discord 로그인 설정이 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      res.writeHead(204, { ...cors, "Set-Cookie": authService.logoutCookie() });
      res.end();
      return;
    }

    if (url.pathname === "/api/me") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendError(res, 405, "method_not_allowed", "GET만 지원합니다.", cors);
        return;
      }
      if (!authService) {
        sendError(
          res,
          503,
          "auth_not_configured",
          "Discord 로그인 설정이 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      try {
        const identity = authService.authenticate(req.headers.cookie);
        const [admin, account] = await Promise.all([
          authService.isAdmin(identity.id),
          userRepository
            ? userRepository.getByDiscordId(identity.id)
            : Promise.resolve(null),
        ]);
        sendJson(
          res,
          200,
          {
            user: {
              ...identity,
              admin,
              gameAccount: toOwnUser(account),
            },
          },
          cors,
        );
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    if (url.pathname === "/api/verifications") {
      if (req.method !== "POST") {
        sendError(res, 405, "method_not_allowed", "POST만 지원합니다.", {
          ...cors,
          Allow: "POST",
        });
        return;
      }
      if (!authService) {
        sendError(
          res,
          503,
          "auth_not_configured",
          "Discord 로그인 설정이 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      if (!userRepository || !verificationRepository) {
        sendError(
          res,
          503,
          "verifications_not_configured",
          "게임 계정 인증 채널 설정이 아직 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      try {
        const flags = configRepository
          ? (await configRepository.get()).config
          : { signup: true, maintenanceMode: false };
        if (flags.maintenanceMode) {
          throw new RequestError(
            503,
            "maintenance_mode",
            "현재 점검 중입니다.",
          );
        }
        if (flags.authentication === false || !flags.signup) {
          throw new RequestError(
            403,
            "feature_disabled",
            "현재 게임 계정 인증 요청을 받지 않습니다.",
          );
        }
        const identity = authService.authenticate(req.headers.cookie);
        const account = await userRepository.getByDiscordId(identity.id);
        if (account?.banned) {
          throw new RequestError(
            403,
            "user_banned",
            "정지된 사용자는 게임 계정 인증을 요청할 수 없습니다.",
          );
        }
        if (account?.verificationStatus === "approved") {
          throw new RequestError(
            409,
            "already_verified",
            "이미 승인된 게임 계정이 있습니다.",
          );
        }
        const body = await readJsonBody(req);
        const validated = validateVerificationSubmission(body);
        const result = await verificationRepository.create(
          {
            discordUserId: identity.id,
            discordUsernameSnapshot: identity.username,
            gameNickname: validated.gameNickname,
          },
          validated.evidenceFile,
        );
        sendJson(
          res,
          result.recovered ? 200 : 201,
          {
            verification: toOwnVerification(result.verification),
            recovered: result.recovered,
          },
          cors,
        );
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    if (url.pathname === "/api/admin/verifications") {
      if (!authService) {
        sendError(
          res,
          503,
          "auth_not_configured",
          "Discord 로그인 설정이 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      if (!verificationRepository) {
        sendError(
          res,
          503,
          "verifications_not_configured",
          "게임 계정 인증 채널 설정이 아직 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      try {
        await authService.requireAdmin(req.headers.cookie);
        if (req.method !== "GET" && req.method !== "HEAD") {
          throw new RequestError(
            405,
            "method_not_allowed",
            "GET만 지원합니다.",
          );
        }
        const status = url.searchParams.get("status") || "pending";
        if (status !== "pending") {
          throw new RequestError(
            400,
            "unsupported_status",
            "현재는 인증 대기 목록만 지원합니다.",
          );
        }
        const result = await verificationRepository.list({
          status,
          before: url.searchParams.get("cursor") || null,
          limit: url.searchParams.get("limit") || 30,
        });
        sendJson(res, 200, result, cors);
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    const adminVerificationId = adminVerificationIdFromPath(url.pathname);
    if (adminVerificationId) {
      if (!authService || !verificationRepository) {
        sendError(
          res,
          503,
          "verifications_not_configured",
          "게임 계정 인증 관리자 기능이 설정되지 않았습니다.",
          cors,
        );
        return;
      }
      try {
        const admin = await authService.requireAdmin(req.headers.cookie);
        if (req.method !== "PATCH") {
          throw new RequestError(
            405,
            "method_not_allowed",
            "PATCH만 지원합니다.",
          );
        }
        const body = await readJsonBody(req, 8 * 1024);
        if (!["approved", "rejected"].includes(body.status)) {
          throw new RequestError(
            422,
            "invalid_status",
            "approved 또는 rejected만 허용합니다.",
          );
        }
        const result = await verificationRepository.decide(
          adminVerificationId,
          body.status,
          admin.id,
        );
        sendJson(
          res,
          200,
          {
            verification: toOwnVerification(result.verification),
            recovered: result.recovered,
          },
          cors,
        );
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    if (url.pathname === "/api/admin/users") {
      if (!authService || !userRepository) {
        sendError(
          res,
          503,
          "users_not_configured",
          "사용자 관리자 기능이 설정되지 않았습니다.",
          cors,
        );
        return;
      }
      try {
        await authService.requireAdmin(req.headers.cookie);
        if (req.method !== "GET" && req.method !== "HEAD") {
          throw new RequestError(
            405,
            "method_not_allowed",
            "GET만 지원합니다.",
          );
        }
        const result = await userRepository.list({
          before: url.searchParams.get("cursor") || null,
          limit: url.searchParams.get("limit") || 30,
        });
        sendJson(res, 200, result, cors);
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    const adminUserId = adminUserIdFromPath(url.pathname);
    if (adminUserId) {
      if (!authService || !userRepository || !auditRepository) {
        sendError(
          res,
          503,
          "users_not_configured",
          "사용자 정지 관리자 기능이 설정되지 않았습니다.",
          cors,
        );
        return;
      }
      try {
        const admin = await authService.requireAdmin(req.headers.cookie);
        if (req.method !== "PATCH") {
          throw new RequestError(
            405,
            "method_not_allowed",
            "PATCH만 지원합니다.",
          );
        }
        const body = await readJsonBody(req, 8 * 1024);
        if (typeof body.banned !== "boolean") {
          throw new RequestError(
            422,
            "invalid_ban_status",
            "banned에는 true 또는 false만 허용합니다.",
          );
        }
        const before = await userRepository.getByDiscordId(adminUserId);
        if (!before) throw new UserNotFoundError(adminUserId);
        const user = await userRepository.setBanned(adminUserId, body.banned);
        const recovered = before.banned === body.banned;
        await auditRepository.create({
          action: body.banned ? "user.banned" : "user.unbanned",
          targetId: adminUserId,
          actorDiscordId: admin.id,
          before: { banned: Boolean(before.banned) },
          after: { banned: body.banned },
          metadata: recovered ? { reason: "existing_user_state" } : null,
        });
        sendJson(res, 200, { user, recovered }, cors);
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    if (url.pathname === "/api/admin/reports") {
      if (!reportRepository) {
        sendError(
          res,
          503,
          "reports_not_configured",
          "제보 채널 설정이 아직 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      if (!authService) {
        sendError(
          res,
          503,
          "auth_not_configured",
          "Discord 로그인 설정이 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      try {
        await authService.requireAdmin(req.headers.cookie);
        if (req.method !== "GET" && req.method !== "HEAD") {
          throw new RequestError(
            405,
            "method_not_allowed",
            "GET만 지원합니다.",
          );
        }
        const status = url.searchParams.get("status") || "pending";
        if (status !== "pending") {
          throw new RequestError(
            400,
            "unsupported_status",
            "현재는 검수 대기 목록만 지원합니다.",
          );
        }
        const result = await reportRepository.listPending({
          before: url.searchParams.get("cursor") || null,
          limit: url.searchParams.get("limit") || 30,
        });
        sendJson(res, 200, result, cors);
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    const adminDecisionId = adminDecisionIdFromPath(url.pathname);
    if (adminDecisionId) {
      if (!reportRepository) {
        sendError(
          res,
          503,
          "reports_not_configured",
          "제보 채널 설정이 아직 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      if (!authService) {
        sendError(
          res,
          503,
          "auth_not_configured",
          "Discord 로그인 설정이 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      try {
        const admin = await authService.requireAdmin(req.headers.cookie);
        if (req.method !== "PATCH") {
          throw new RequestError(
            405,
            "method_not_allowed",
            "PATCH만 지원합니다.",
          );
        }
        const body = await readJsonBody(req, 8 * 1024);
        if (!["approved", "rejected"].includes(body.status)) {
          throw new RequestError(
            422,
            "invalid_status",
            "approved 또는 rejected만 허용합니다.",
          );
        }
        const result = await reportRepository.decide(
          adminDecisionId,
          body.status,
          admin.id,
        );
        sendJson(res, 200, result, cors);
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    if (url.pathname === "/api/reports") {
      if (!reportRepository) {
        sendError(
          res,
          503,
          "reports_not_configured",
          "제보 채널 설정이 아직 완료되지 않았습니다.",
          cors,
        );
        return;
      }

      try {
        const flags = configRepository
          ? (await configRepository.get()).config
          : {
              publicList: true,
              reportSubmission: true,
              evidenceUpload: true,
              evidenceRequired: false,
              maintenanceMode: false,
            };

        if (flags.maintenanceMode) {
          throw new RequestError(
            503,
            "maintenance_mode",
            "현재 점검 중입니다.",
          );
        }

        if (req.method === "GET" || req.method === "HEAD") {
          if (!flags.publicList) {
            throw new RequestError(
              403,
              "feature_disabled",
              "공개 명단 기능이 꺼져 있습니다.",
            );
          }
          const category = url.searchParams.get("category") || null;
          if (category && !Object.hasOwn(REPORT_CATEGORIES, category)) {
            throw new RequestError(
              400,
              "invalid_category",
              "지원하지 않는 분류입니다.",
            );
          }
          const result = await reportRepository.listApproved({
            query: url.searchParams.get("query") || null,
            category,
            before: url.searchParams.get("cursor") || null,
            limit: url.searchParams.get("limit") || 30,
          });
          sendJson(res, 200, result, cors);
          return;
        }

        if (req.method === "POST") {
          if (!flags.reportSubmission) {
            throw new RequestError(
              403,
              "feature_disabled",
              "제보 제출 기능이 꺼져 있습니다.",
            );
          }
          let reporterDiscordId = devReporterDiscordId;
          if (flags.authentication !== false) {
            if (!authService) {
              throw new RequestError(
                503,
                "auth_not_configured",
                "Discord 로그인 설정이 완료되지 않았습니다.",
              );
            }
            reporterDiscordId = authService.authenticate(req.headers.cookie).id;
            if (userRepository) {
              const account =
                await userRepository.getByDiscordId(reporterDiscordId);
              if (account?.banned) {
                throw new RequestError(
                  403,
                  "user_banned",
                  "정지된 사용자는 제보를 제출할 수 없습니다.",
                );
              }
            }
          }
          if (!reporterDiscordId) {
            throw new RequestError(
              503,
              "reporter_not_configured",
              "제보 제출자 설정이 필요합니다.",
            );
          }
          const body = await readJsonBody(req);
          const validated = validateReportSubmission(body, { flags });
          const report = await reportRepository.create(
            { ...validated.report, reporterDiscordId },
            validated.evidenceFiles,
          );
          sendJson(res, 201, { report }, cors);
          return;
        }

        throw new RequestError(
          405,
          "method_not_allowed",
          "GET과 POST만 지원합니다.",
        );
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    const reportId = reportIdFromPath(url.pathname);
    if (reportId) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendError(res, 405, "method_not_allowed", "GET만 지원합니다.", {
          ...cors,
          Allow: "GET, HEAD",
        });
        return;
      }
      if (!reportRepository) {
        sendError(
          res,
          503,
          "reports_not_configured",
          "제보 채널 설정이 아직 완료되지 않았습니다.",
          cors,
        );
        return;
      }
      try {
        const flags = configRepository
          ? (await configRepository.get()).config
          : { publicList: true, maintenanceMode: false };
        if (flags.maintenanceMode) {
          throw new RequestError(
            503,
            "maintenance_mode",
            "현재 점검 중입니다.",
          );
        }
        if (!flags.publicList) {
          throw new RequestError(
            403,
            "feature_disabled",
            "공개 명단 기능이 꺼져 있습니다.",
          );
        }
        const report = await reportRepository.getApprovedById(reportId);
        sendJson(res, 200, { report }, cors);
      } catch (error) {
        sendRouteError(res, error, cors);
      }
      return;
    }

    sendError(res, 404, "not_found", "존재하지 않는 경로입니다.", cors);
  };
}

export function createServer(options) {
  const handle = createRequestHandler(options);
  return createHttpServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) {
        sendError(res, 500, "internal_error", "서버 내부 오류입니다.");
      } else {
        res.end();
      }
      options.onError?.(error);
    });
  });
}
