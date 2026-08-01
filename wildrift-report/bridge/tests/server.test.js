import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { AuthError } from "../src/auth/authService.js";
import { createServer } from "../src/server.js";
import { ReportNotFoundError } from "../src/repositories/reportRepository.js";

const SITE_ORIGIN = "https://runnerkiller.github.io";

let healthResult = { status: "ok", version: "0.1.0" };
let healthError = null;
let featureFlags = {
  publicList: true,
  reportSubmission: true,
  evidenceUpload: true,
  evidenceRequired: false,
  authentication: false,
  maintenanceMode: false,
};
let approvedReports = [];
let pendingReports = [];
let createdInput = null;
let decisionInput = null;

const healthService = {
  async check() {
    if (healthError) throw healthError;
    return healthResult;
  },
};

const configRepository = {
  async get() {
    return { config: featureFlags };
  },
};

const reportRepository = {
  async listApproved(options) {
    return { reports: approvedReports, nextCursor: null, options };
  },
  async getApprovedById(reportId) {
    const report = approvedReports.find((item) => item.reportId === reportId);
    if (!report) {
      throw new ReportNotFoundError(reportId);
    }
    return report;
  },
  async create(report, evidenceFiles) {
    createdInput = { report, evidenceFiles };
    return { reportId: "333333333333333333", status: "pending", ...report };
  },
  async listPending(options) {
    return { reports: pendingReports, nextCursor: null, options };
  },
  async decide(reportId, status, adminId) {
    decisionInput = { reportId, status, adminId };
    return {
      report: { reportId: "999999999999999999", status },
      cleanupPending: false,
    };
  },
};

const authService = {
  startLogin(returnTo) {
    return {
      url: `https://discord.com/oauth2/authorize?returnTo=${encodeURIComponent(returnTo)}`,
      stateCookie: "wr_oauth_state=state; HttpOnly",
    };
  },
  async finishLogin() {
    return {
      redirectUrl: `${SITE_ORIGIN}/wildrift-report/`,
      sessionCookie: "wr_session=valid; HttpOnly",
      clearStateCookie: "wr_oauth_state=; Max-Age=0",
    };
  },
  authenticate(cookie) {
    if (!String(cookie).includes("wr_session=valid")) {
      throw new AuthError(
        401,
        "authentication_required",
        "Discord 로그인이 필요합니다.",
      );
    }
    return { id: "777777777777777777", username: "tester" };
  },
  async isAdmin(userId) {
    return userId === "777777777777777777";
  },
  async requireAdmin(cookie) {
    return this.authenticate(cookie);
  },
  logoutCookie() {
    return "wr_session=; Max-Age=0";
  },
};

let server;
let baseUrl;

before(async () => {
  server = createServer({
    healthService,
    configRepository,
    reportRepository,
    authService,
    devReporterDiscordId: "444444444444444444",
    publicSiteOrigin: SITE_ORIGIN,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("GET /health", () => {
  test("정상이면 200과 상태를 돌려준다", async () => {
    healthResult = { status: "ok", version: "0.1.0" };
    healthError = null;

    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });

  test("degraded도 200으로 답한다", async () => {
    healthResult = { status: "degraded" };
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
  });

  test("error면 503으로 답해 감시 도구가 알아채게 한다", async () => {
    healthResult = { status: "error" };
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.status, "error");
  });

  test("상태 확인 자체가 터지면 500과 오류 형식을 지킨다", async () => {
    healthError = new Error("예상치 못한 오류");
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    healthError = null;

    assert.equal(response.status, 500);
    assert.equal(body.error.code, "health_check_failed");
    assert.equal(typeof body.error.message, "string");
  });

  test("GET이 아니면 405", async () => {
    healthResult = { status: "ok" };
    const response = await fetch(`${baseUrl}/health`, { method: "POST" });
    const body = await response.json();

    assert.equal(response.status, 405);
    assert.equal(body.error.code, "method_not_allowed");
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  });
});

describe("없는 경로", () => {
  test("계획서가 정한 오류 형식으로 404를 준다", async () => {
    const response = await fetch(`${baseUrl}/api/unknown`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error.code, "not_found");
    assert.equal(typeof body.error.message, "string");
  });
});

describe("reports API", () => {
  test("GET /api/reports가 승인 목록을 반환한다", async () => {
    approvedReports = [
      {
        reportId: "333333333333333333",
        nickname: "협곡의파괴자",
        status: "approved",
      },
    ];
    const response = await fetch(
      `${baseUrl}/api/reports?category=troll&query=협곡`,
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.reports.length, 1);
    assert.equal(body.options.category, "troll");
  });

  test("지원하지 않는 분류는 400", async () => {
    const response = await fetch(`${baseUrl}/api/reports?category=unknown`);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "invalid_category");
  });

  test("GET /api/reports/:id가 승인 제보 상세를 반환한다", async () => {
    approvedReports = [
      {
        reportId: "333333333333333333",
        nickname: "협곡의파괴자",
        status: "approved",
      },
    ];
    const response = await fetch(`${baseUrl}/api/reports/333333333333333333`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.report.nickname, "협곡의파괴자");
  });

  test("없는 승인 제보 상세는 404", async () => {
    approvedReports = [];
    const response = await fetch(`${baseUrl}/api/reports/333333333333333333`);
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, "report_not_found");
  });

  test("POST /api/reports가 검증 후 저장한다", async () => {
    createdInput = null;
    const response = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "협곡의파괴자",
        category: "troll",
        tags: ["고의 피딩"],
        mode: "랭크",
        occurredAt: "2026-08-01",
        description: "한타 직전에 반복적으로 적진으로 들어가 사망했습니다.",
        evidence: [],
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.report.status, "pending");
    assert.equal(createdInput.report.reporterDiscordId, "444444444444444444");
  });

  test("인증 기능이 켜지면 로그인한 Discord ID를 제출자로 사용한다", async () => {
    featureFlags = { ...featureFlags, authentication: true };
    const response = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "wr_session=valid",
      },
      body: JSON.stringify({
        nickname: "협곡의파괴자",
        category: "troll",
        tags: ["고의 피딩"],
        mode: "랭크",
        occurredAt: "2026-08-01",
        description: "한타 직전에 반복적으로 적진으로 들어가 사망했습니다.",
        evidence: [],
      }),
    });
    featureFlags = { ...featureFlags, authentication: false };
    assert.equal(response.status, 201);
    assert.equal(createdInput.report.reporterDiscordId, "777777777777777777");
  });

  test("입력 오류는 필드별 422를 반환한다", async () => {
    const response = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "x" }),
    });
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.error.code, "validation_failed");
    assert.ok(body.error.issues.length > 0);
  });

  test("기능 설정이 제출을 막으면 403", async () => {
    featureFlags = { ...featureFlags, reportSubmission: false };
    const response = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await response.json();
    featureFlags = { ...featureFlags, reportSubmission: true };
    assert.equal(response.status, 403);
    assert.equal(body.error.code, "feature_disabled");
  });

  test("제보 채널이 설정되지 않으면 503", async () => {
    const bare = createServer({ healthService, reportRepository: null });
    await new Promise((resolve) => bare.listen(0, "127.0.0.1", resolve));
    const bareUrl = `http://127.0.0.1:${bare.address().port}`;
    const response = await fetch(`${bareUrl}/api/reports`);
    const body = await response.json();
    await new Promise((resolve) => bare.close(resolve));
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "reports_not_configured");
  });
});

describe("Discord auth API", () => {
  test("로그인 시작은 Discord로 리디렉션하고 state 쿠키를 설정한다", async () => {
    const response = await fetch(
      `${baseUrl}/api/auth/discord?returnTo=/wildrift-report/`,
      {
        redirect: "manual",
      },
    );
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location"), /discord\.com/);
    assert.match(response.headers.get("set-cookie"), /wr_oauth_state/);
  });

  test("세션이 없으면 /api/me가 401", async () => {
    const response = await fetch(`${baseUrl}/api/me`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.error.code, "authentication_required");
  });

  test("로그인 세션의 사용자와 관리자 여부를 반환한다", async () => {
    const response = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: "wr_session=valid" },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.user.id, "777777777777777777");
    assert.equal(body.user.admin, true);
  });

  test("로그아웃은 세션 쿠키를 만료시킨다", async () => {
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  });
});

describe("admin reports API", () => {
  test("관리자 세션이 없으면 대기 목록을 볼 수 없다", async () => {
    const response = await fetch(`${baseUrl}/api/admin/reports`);
    assert.equal(response.status, 401);
  });

  test("관리자는 대기 제보 목록을 조회한다", async () => {
    pendingReports = [{ reportId: "333333333333333333", status: "pending" }];
    const response = await fetch(`${baseUrl}/api/admin/reports`, {
      headers: { Cookie: "wr_session=valid" },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.reports.length, 1);
  });

  test("관리자는 제보를 승인한다", async () => {
    decisionInput = null;
    const response = await fetch(
      `${baseUrl}/api/admin/reports/333333333333333333/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "wr_session=valid",
        },
        body: JSON.stringify({ status: "approved" }),
      },
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.report.status, "approved");
    assert.deepEqual(decisionInput, {
      reportId: "333333333333333333",
      status: "approved",
      adminId: "777777777777777777",
    });
  });

  test("잘못된 판정 상태는 422", async () => {
    const response = await fetch(
      `${baseUrl}/api/admin/reports/333333333333333333/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "wr_session=valid",
        },
        body: JSON.stringify({ status: "hidden" }),
      },
    );
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.error.code, "invalid_status");
  });
});

describe("CORS", () => {
  test("허용된 출처에만 CORS 헤더를 붙인다", async () => {
    healthResult = { status: "ok" };
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: SITE_ORIGIN },
    });

    assert.equal(
      response.headers.get("access-control-allow-origin"),
      SITE_ORIGIN,
    );
    assert.equal(
      response.headers.get("access-control-allow-credentials"),
      "true",
    );
    assert.equal(response.headers.get("vary"), "Origin");
  });

  test("다른 출처에는 CORS 헤더를 붙이지 않는다", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://evil.example.com" },
    });

    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });

  test("Origin이 없는 요청(curl 등)도 막지 않는다", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });

  test("preflight에 204로 답한다", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      method: "OPTIONS",
      headers: { Origin: SITE_ORIGIN },
    });

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      SITE_ORIGIN,
    );
    assert.match(response.headers.get("access-control-allow-methods"), /GET/);
  });

  test("PUBLIC_SITE_ORIGIN이 없으면 아무 출처에도 열지 않는다", async () => {
    const bare = createServer({ healthService, publicSiteOrigin: null });
    await new Promise((resolve) => bare.listen(0, "127.0.0.1", resolve));
    const bareUrl = `http://127.0.0.1:${bare.address().port}`;

    const response = await fetch(`${bareUrl}/health`, {
      headers: { Origin: SITE_ORIGIN },
    });

    assert.equal(response.headers.get("access-control-allow-origin"), null);
    await new Promise((resolve) => bare.close(resolve));
  });
});
