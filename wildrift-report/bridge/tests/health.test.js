import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createHealthService } from "../src/health.js";
import { DiscordApiError } from "../src/discordClient.js";

const okUser = { id: "999999999999999999", username: "wr-bridge-bot" };

function makeService({ user, configResult, configError, ...overrides } = {}) {
  let discordCalls = 0;
  let configCalls = 0;

  const discordClient = {
    async getCurrentUser() {
      discordCalls += 1;
      if (user instanceof Error) throw user;
      return user ?? okUser;
    },
  };

  const configRepository = {
    async get() {
      configCalls += 1;
      if (configError) throw configError;
      return (
        configResult ?? {
          config: { schemaVersion: 1, updatedAt: "2026-08-01T00:00:00.000Z" },
          warnings: [],
          stale: false,
          cached: false,
        }
      );
    },
  };

  const service = createHealthService({
    discordClient,
    configRepository,
    ...overrides,
  });

  return {
    service,
    counts: () => ({ discordCalls, configCalls }),
  };
}

describe("createHealthService", () => {
  test("연결과 설정이 모두 정상이면 ok", async () => {
    const { service } = makeService();
    const result = await service.check();

    assert.equal(result.status, "ok");
    assert.equal(result.discord.connected, true);
    assert.equal(result.discord.botUsername, "wr-bridge-bot");
    assert.equal(result.config.loaded, true);
    assert.equal(result.config.schemaVersion, 1);
  });

  test("Discord에 못 붙으면 error이고 설정은 시도조차 하지 않는다", async () => {
    const { service, counts } = makeService({
      user: new DiscordApiError("토큰이 거부되었습니다.", { status: 401 }),
    });

    const result = await service.check();

    assert.equal(result.status, "error");
    assert.equal(result.discord.connected, false);
    assert.equal(result.discord.error.status, 401);
    assert.equal(result.config.loaded, false);
    assert.equal(result.config.skipped, true);
    assert.equal(counts().configCalls, 0);
  });

  test("설정을 못 읽으면 error", async () => {
    const { service } = makeService({
      configError: new Error("설정 메시지의 JSON 형식이 잘못되었습니다."),
    });

    const result = await service.check();

    assert.equal(result.status, "error");
    assert.equal(result.discord.connected, true);
    assert.equal(result.config.loaded, false);
    assert.match(result.config.error.message, /JSON/);
  });

  test("설정이 stale이면 degraded", async () => {
    const { service } = makeService({
      configResult: {
        config: { schemaVersion: 1, updatedAt: null },
        warnings: [],
        stale: true,
        cached: true,
      },
    });

    const result = await service.check();
    assert.equal(result.status, "degraded");
    assert.equal(result.config.stale, true);
  });

  test("설정에 경고가 있으면 degraded", async () => {
    const { service } = makeService({
      configResult: {
        config: { schemaVersion: 1, updatedAt: null },
        warnings: ["voting이 true/false가 아니라 기본값을 씁니다."],
        stale: false,
        cached: false,
      },
    });

    const result = await service.check();
    assert.equal(result.status, "degraded");
    assert.equal(result.config.warnings.length, 1);
  });

  test("짧은 시간 안의 반복 요청은 캐시로 답한다", async () => {
    let clock = 1000;
    const { service, counts } = makeService({
      cacheTtlMs: 5_000,
      now: () => clock,
    });

    await service.check();
    clock += 1_000;
    const second = await service.check();

    assert.equal(second.cached, true);
    assert.equal(counts().discordCalls, 1);
  });

  test("캐시가 만료되면 다시 확인한다", async () => {
    let clock = 1000;
    const { service, counts } = makeService({
      cacheTtlMs: 5_000,
      now: () => clock,
    });

    await service.check();
    clock += 6_000;
    await service.check();

    assert.equal(counts().discordCalls, 2);
  });

  test("설정이 덜 된 항목을 단계별로 알려준다", async () => {
    const { service } = makeService({
      setup: { missingByStage: { 5: ["DISCORD_VOTES_CHANNEL_ID"] }, warnings: [] },
    });

    const result = await service.check();
    assert.deepEqual(result.setup.missingByStage[5], ["DISCORD_VOTES_CHANNEL_ID"]);
  });

  test("가동 시간을 초 단위로 보고한다", async () => {
    let clock = 100_000;
    const { service } = makeService({
      now: () => clock,
      startedAt: 40_000,
    });

    const result = await service.check();
    assert.equal(result.uptimeSeconds, 60);
  });
});
