import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { DiscordApiError } from "../src/discordClient.js";
import {
  AuthError,
  SESSION_COOKIE,
  createAuthService,
  signToken,
  verifyToken,
} from "../src/auth/authService.js";

const SECRET = "s".repeat(32);
const NOW_MS = Date.parse("2026-08-01T12:00:00.000Z");
const USER_ID = "111111111111111111";
const ADMIN_ROLE_ID = "222222222222222222";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function makeService(overrides = {}) {
  const responses = [
    jsonResponse(200, { access_token: "oauth-access-token" }),
    jsonResponse(200, { id: USER_ID, username: "tester", avatar: "avatar" }),
  ];
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return responses.shift();
  };
  const discordClient = {
    async getGuildMember() {
      return { roles: [ADMIN_ROLE_ID] };
    },
  };
  const service = createAuthService({
    clientId: "333333333333333333",
    clientSecret: "client-secret-value",
    bridgePublicUrl: "https://bridge.example.com",
    publicSiteOrigin: "https://runnerkiller.github.io",
    sessionSecret: SECRET,
    guildId: "444444444444444444",
    adminRoleId: ADMIN_ROLE_ID,
    discordClient,
    fetchImpl,
    now: () => NOW_MS,
    randomBytesImpl: () => Buffer.alloc(24, 7),
    ...overrides,
  });
  return { service, calls, discordClient };
}

describe("signed session token", () => {
  test("서명된 값을 검증한다", () => {
    const token = signToken(
      { sub: USER_ID, exp: Math.floor(NOW_MS / 1000) + 60 },
      SECRET,
    );
    assert.equal(
      verifyToken(token, SECRET, Math.floor(NOW_MS / 1000)).sub,
      USER_ID,
    );
  });

  test("변조되거나 만료된 값은 거부한다", () => {
    const token = signToken({ sub: USER_ID, exp: 10 }, SECRET);
    assert.equal(verifyToken(`${token}x`, SECRET, 1), null);
    assert.equal(verifyToken(token, SECRET, 10), null);
  });
});

describe("Discord OAuth", () => {
  test("로그인 URL과 state 쿠키를 만든다", () => {
    const { service } = makeService();
    const login = service.startLogin("/admin");
    const url = new URL(login.url);
    assert.equal(url.hostname, "discord.com");
    assert.equal(url.searchParams.get("scope"), "identify");
    assert.equal(url.searchParams.get("state"), login.state);
    assert.match(login.stateCookie, /wr_oauth_state=/);
    assert.match(login.stateCookie, /HttpOnly/);
  });

  test("외부 returnTo 주소를 허용하지 않는다", async () => {
    const { service } = makeService();
    const login = service.startLogin("//evil.example.com");
    const result = await service.finishLogin({
      code: "code",
      state: login.state,
      stateCookie: login.state,
    });
    assert.equal(result.redirectUrl, "https://runnerkiller.github.io/");
  });

  test("백슬래시를 이용한 returnTo 우회도 허용하지 않는다", async () => {
    const { service } = makeService();
    const login = service.startLogin("/\\evil.example.com");
    const result = await service.finishLogin({
      code: "code",
      state: login.state,
      stateCookie: login.state,
    });
    assert.equal(result.redirectUrl, "https://runnerkiller.github.io/");
  });

  test("코드를 토큰과 사용자 정보로 교환하고 세션을 발급한다", async () => {
    const { service, calls } = makeService();
    const login = service.startLogin("/wildrift-report/");
    const result = await service.finishLogin({
      code: "oauth-code",
      state: login.state,
      stateCookie: login.state,
    });
    assert.equal(calls.length, 2);
    assert.match(String(calls[0].init.body), /oauth-code/);
    assert.equal(
      calls[1].init.headers.Authorization,
      "Bearer oauth-access-token",
    );
    assert.match(result.sessionCookie, /SameSite=None/);
    assert.match(result.sessionCookie, /Secure/);
    const cookiePair = result.sessionCookie.split(";")[0];
    const user = service.authenticate(cookiePair);
    assert.equal(user.id, USER_ID);
    assert.equal(user.username, "tester");
  });

  test("state가 다르면 Discord를 호출하기 전에 거부한다", async () => {
    const { service, calls } = makeService();
    const login = service.startLogin("/");
    await assert.rejects(
      () =>
        service.finishLogin({
          code: "code",
          state: login.state,
          stateCookie: "different",
        }),
      (error) =>
        error instanceof AuthError && error.code === "invalid_oauth_state",
    );
    assert.equal(calls.length, 0);
  });

  test("세션 쿠키가 없으면 로그인을 요구한다", () => {
    const { service } = makeService();
    assert.throws(
      () => service.authenticate(""),
      (error) => error instanceof AuthError && error.status === 401,
    );
  });
});

describe("Discord admin role", () => {
  test("관리자 역할이 있으면 true", async () => {
    const { service } = makeService();
    assert.equal(await service.isAdmin(USER_ID), true);
  });

  test("서버 멤버가 아니면 false", async () => {
    const { service } = makeService({
      discordClient: {
        async getGuildMember() {
          throw new DiscordApiError("missing", { status: 404 });
        },
      },
    });
    assert.equal(await service.isAdmin(USER_ID), false);
  });

  test("역할이 없는 사용자는 관리자 API를 쓸 수 없다", async () => {
    const { service } = makeService({
      discordClient: {
        async getGuildMember() {
          return { roles: [] };
        },
      },
    });
    const session = signToken(
      {
        sub: USER_ID,
        username: "tester",
        iat: 1,
        exp: Math.floor(NOW_MS / 1000) + 60,
      },
      SECRET,
    );
    await assert.rejects(
      () => service.requireAdmin(`${SESSION_COOKIE}=${session}`),
      (error) => error instanceof AuthError && error.status === 403,
    );
  });
});
