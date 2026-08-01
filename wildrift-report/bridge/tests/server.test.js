import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { createServer } from "../src/server.js";

const SITE_ORIGIN = "https://runnerkiller.github.io";

let healthResult = { status: "ok", version: "0.1.0" };
let healthError = null;

const healthService = {
  async check() {
    if (healthError) throw healthError;
    return healthResult;
  },
};

let server;
let baseUrl;

before(async () => {
  server = createServer({ healthService, publicSiteOrigin: SITE_ORIGIN });
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
    const response = await fetch(`${baseUrl}/api/reports`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error.code, "not_found");
    assert.equal(typeof body.error.message, "string");
  });
});

describe("CORS", () => {
  test("허용된 출처에만 CORS 헤더를 붙인다", async () => {
    healthResult = { status: "ok" };
    const response = await fetch(`${baseUrl}/health`, {
      headers: { Origin: SITE_ORIGIN },
    });

    assert.equal(response.headers.get("access-control-allow-origin"), SITE_ORIGIN);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
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
    assert.equal(response.headers.get("access-control-allow-origin"), SITE_ORIGIN);
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
