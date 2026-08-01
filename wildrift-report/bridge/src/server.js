import { createServer as createHttpServer } from "node:http";

import { DiscordApiError } from "./discordClient.js";
import { ReportNotFoundError } from "./repositories/reportRepository.js";
import {
  REPORT_CATEGORIES,
  ReportValidationError,
  validateReportSubmission,
} from "./validation/reportValidation.js";

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
      throw new RequestError(413, "payload_too_large", "요청 본문이 너무 큽니다.");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    throw new RequestError(400, "invalid_json", "JSON 요청 본문이 필요합니다.");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "invalid_json", "JSON 형식이 올바르지 않습니다.");
  }
}

function reportIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/reports\/(\d{17,20})$/);
  return match?.[1] ?? null;
}

function sendRouteError(res, error, cors) {
  if (error instanceof RequestError) {
    sendError(res, error.status, error.code, error.message, cors);
    return;
  }
  if (error instanceof ReportValidationError) {
    sendJson(
      res,
      422,
      { error: { code: "validation_failed", message: error.message, issues: error.issues } },
      cors,
    );
    return;
  }
  if (error instanceof ReportNotFoundError) {
    sendError(res, 404, "report_not_found", error.message, cors);
    return;
  }
  if (error instanceof DiscordApiError) {
    sendError(res, 502, "discord_unavailable", "Discord 저장소 요청에 실패했습니다.", cors);
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
      sendError(res, 400, "bad_request", "요청 경로를 해석할 수 없습니다.", cors);
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
          throw new RequestError(503, "maintenance_mode", "현재 점검 중입니다.");
        }

        if (req.method === "GET" || req.method === "HEAD") {
          if (!flags.publicList) {
            throw new RequestError(403, "feature_disabled", "공개 명단 기능이 꺼져 있습니다.");
          }
          const category = url.searchParams.get("category") || null;
          if (category && !Object.hasOwn(REPORT_CATEGORIES, category)) {
            throw new RequestError(400, "invalid_category", "지원하지 않는 분류입니다.");
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
            throw new RequestError(403, "feature_disabled", "제보 제출 기능이 꺼져 있습니다.");
          }
          if (!devReporterDiscordId) {
            throw new RequestError(
              503,
              "reporter_not_configured",
              "로그인 구현 전 개발용 제출자 ID를 설정해야 합니다.",
            );
          }
          const body = await readJsonBody(req);
          const validated = validateReportSubmission(body, { flags });
          const report = await reportRepository.create(
            { ...validated.report, reporterDiscordId: devReporterDiscordId },
            validated.evidenceFiles,
          );
          sendJson(res, 201, { report }, cors);
          return;
        }

        throw new RequestError(405, "method_not_allowed", "GET과 POST만 지원합니다.");
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
        sendError(res, 503, "reports_not_configured", "제보 채널 설정이 아직 완료되지 않았습니다.", cors);
        return;
      }
      try {
        const flags = configRepository
          ? (await configRepository.get()).config
          : { publicList: true, maintenanceMode: false };
        if (flags.maintenanceMode) {
          throw new RequestError(503, "maintenance_mode", "현재 점검 중입니다.");
        }
        if (!flags.publicList) {
          throw new RequestError(403, "feature_disabled", "공개 명단 기능이 꺼져 있습니다.");
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
