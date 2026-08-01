import { createServer as createHttpServer } from "node:http";

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

export function createRequestHandler({ healthService, publicSiteOrigin = null }) {
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
