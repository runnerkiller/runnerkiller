import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseConfigMessage,
  extractJsonBlock,
  toPublicConfig,
  createConfigRepository,
  ConfigParseError,
  FEATURE_FLAG_DEFAULTS,
  CONFIG_SCHEMA_VERSION,
} from "../src/repositories/configRepository.js";
import { createDiscordClient } from "../src/discordClient.js";
import { mockFetch, configMessageContent } from "./helpers/mockDiscord.js";

describe("extractJsonBlock", () => {
  test("```json 블록에서 뽑아낸다", () => {
    const raw = extractJsonBlock('설명\n```json\n{"a":1}\n```');
    assert.equal(raw, '{"a":1}');
  });

  test("언어 표시가 없는 블록도 처리한다", () => {
    assert.equal(extractJsonBlock('```\n{"a":1}\n```'), '{"a":1}');
  });

  test("코드 블록 없이 JSON만 있어도 처리한다", () => {
    assert.equal(extractJsonBlock('{"a":1}'), '{"a":1}');
  });

  test("설명 뒤에 붙은 JSON도 찾아낸다", () => {
    assert.equal(extractJsonBlock('설정입니다 {"a":1} 끝'), '{"a":1}');
  });

  test("JSON이 없으면 null", () => {
    assert.equal(extractJsonBlock("그냥 잡담"), null);
    assert.equal(extractJsonBlock(""), null);
    assert.equal(extractJsonBlock(undefined), null);
  });
});

describe("parseConfigMessage", () => {
  test("정상 설정을 그대로 읽는다", () => {
    const { config, warnings } = parseConfigMessage(configMessageContent());
    assert.deepEqual(warnings, []);
    assert.equal(config.schemaVersion, 1);
    assert.equal(config.type, "config");
    assert.equal(config.publicList, true);
    assert.equal(config.updatedAt, "2026-08-01T00:00:00.000Z");
  });

  test("false로 꺼둔 스위치를 true로 되돌리지 않는다", () => {
    const content = configMessageContent({
      reportSubmission: false,
      voting: false,
    });
    const { config } = parseConfigMessage(content);
    assert.equal(config.reportSubmission, false);
    assert.equal(config.voting, false);
  });

  test("빠진 항목은 기본값으로 채우고 경고하지 않는다", () => {
    const { config, warnings } = parseConfigMessage(
      JSON.stringify({ schemaVersion: 1, type: "config", publicList: false }),
    );
    assert.equal(config.publicList, false);
    assert.equal(config.voting, FEATURE_FLAG_DEFAULTS.voting);
    assert.deepEqual(warnings, []);
  });

  test("true/false가 아닌 값은 기본값으로 되돌리고 경고한다", () => {
    const content = configMessageContent({ voting: "yes" });
    const { config, warnings } = parseConfigMessage(content);
    assert.equal(config.voting, FEATURE_FLAG_DEFAULTS.voting);
    assert.ok(warnings.some((w) => w.includes("voting")));
  });

  test("증거 업로드를 끄면 증거 필수도 함께 꺼진다", () => {
    const content = configMessageContent({
      evidenceUpload: false,
      evidenceRequired: true,
    });
    const { config, warnings } = parseConfigMessage(content);
    assert.equal(config.evidenceRequired, false);
    assert.ok(warnings.some((w) => w.includes("evidenceRequired")));
  });

  test("schemaVersion이 없으면 경고한다", () => {
    const content = JSON.stringify({ type: "config" });
    const { config, warnings } = parseConfigMessage(content);
    assert.equal(config.schemaVersion, CONFIG_SCHEMA_VERSION);
    assert.ok(warnings.some((w) => w.includes("schemaVersion")));
  });

  test("Bridge가 모르는 상위 schemaVersion은 경고한다", () => {
    const content = configMessageContent({ schemaVersion: 99 });
    const { warnings } = parseConfigMessage(content);
    assert.ok(warnings.some((w) => w.includes("99")));
  });

  test("type이 다르면 경고한다", () => {
    const content = configMessageContent({ type: "report" });
    const { warnings } = parseConfigMessage(content);
    assert.ok(warnings.some((w) => w.includes("type")));
  });

  test("모르는 키는 조용히 무시한다", () => {
    const content = configMessageContent({ 미래기능: true });
    const { config } = parseConfigMessage(content);
    assert.equal(config.미래기능, undefined);
  });

  test("깨진 JSON은 기본값으로 넘어가지 않고 예외를 던진다", () => {
    assert.throws(
      () => parseConfigMessage('```json\n{"publicList": tru\n```'),
      ConfigParseError,
    );
  });

  test("JSON이 아예 없으면 예외를 던진다", () => {
    assert.throws(() => parseConfigMessage("설정 메시지를 지웠습니다"), ConfigParseError);
  });

  test("배열은 설정으로 인정하지 않는다", () => {
    assert.throws(() => parseConfigMessage("[1,2,3]"), ConfigParseError);
  });
});

describe("toPublicConfig", () => {
  test("내부 Discord ID를 공개 응답에서 제거한다", () => {
    const { config } = parseConfigMessage(configMessageContent());
    const publicConfig = toPublicConfig(config);
    assert.equal(publicConfig.updatedByDiscordId, undefined);
    assert.equal(publicConfig.publicList, true);
    assert.equal(publicConfig.updatedAt, "2026-08-01T00:00:00.000Z");
  });
});

function makeRepository(responses, overrides = {}) {
  const fetchImpl = mockFetch(responses);
  const discordClient = createDiscordClient({
    token: "test-token",
    fetchImpl,
    sleep: async () => {},
  });
  const repository = createConfigRepository({
    discordClient,
    channelId: "222222222222222222",
    messageId: "333333333333333333",
    ...overrides,
  });
  return { repository, fetchImpl };
}

describe("createConfigRepository", () => {
  test("필수 인자가 없으면 만들 수 없다", () => {
    assert.throws(() => createConfigRepository({}), /discordClient/);
    assert.throws(
      () => createConfigRepository({ discordClient: {}, messageId: "1" }),
      /CHANNEL_ID/,
    );
  });

  test("고정 메시지를 읽어 설정을 돌려준다", async () => {
    const { repository, fetchImpl } = makeRepository({
      status: 200,
      body: { id: "333", content: configMessageContent({ voting: false }) },
    });

    const result = await repository.get();

    assert.equal(result.config.voting, false);
    assert.equal(result.stale, false);
    assert.equal(result.cached, false);
    assert.match(
      fetchImpl.calls[0].url,
      /\/channels\/222222222222222222\/messages\/333333333333333333$/,
    );
  });

  test("캐시가 살아 있으면 Discord를 다시 부르지 않는다", async () => {
    let clock = 1000;
    const { repository, fetchImpl } = makeRepository(
      { status: 200, body: { content: configMessageContent() } },
      { cacheTtlMs: 30_000, now: () => clock },
    );

    await repository.get();
    clock += 5_000;
    const second = await repository.get();

    assert.equal(second.cached, true);
    assert.equal(fetchImpl.calls.length, 1);
  });

  test("캐시가 만료되면 다시 읽는다", async () => {
    let clock = 1000;
    const { repository, fetchImpl } = makeRepository(
      { status: 200, body: { content: configMessageContent() } },
      { cacheTtlMs: 30_000, now: () => clock },
    );

    await repository.get();
    clock += 31_000;
    await repository.get();

    assert.equal(fetchImpl.calls.length, 2);
  });

  test("forceRefresh는 캐시를 무시한다", async () => {
    const { repository, fetchImpl } = makeRepository({
      status: 200,
      body: { content: configMessageContent() },
    });

    await repository.get();
    await repository.get({ forceRefresh: true });

    assert.equal(fetchImpl.calls.length, 2);
  });

  test("첫 요청부터 Discord가 죽어 있으면 예외를 던진다", async () => {
    const { repository } = makeRepository({ status: 401, body: { message: "bad token" } });
    await assert.rejects(() => repository.get(), /거부/);
  });

  test("Discord 장애 시 예전 값을 stale로 표시해 돌려준다", async () => {
    let clock = 1000;
    const { repository } = makeRepository(
      [
        { status: 200, body: { content: configMessageContent({ voting: false }) } },
        { status: 500, body: {} },
      ],
      { cacheTtlMs: 1, now: () => clock },
    );

    const first = await repository.get();
    assert.equal(first.stale, false);

    clock += 10_000;
    const second = await repository.get();

    assert.equal(second.stale, true);
    assert.equal(second.config.voting, false, "예전 설정을 유지해야 한다");
    assert.ok(second.error);
  });

  test("설정 메시지가 깨져도 예전 값을 stale로 유지한다", async () => {
    let clock = 1000;
    const { repository } = makeRepository(
      [
        { status: 200, body: { content: configMessageContent({ signup: false }) } },
        { status: 200, body: { content: "누가 실수로 지웠습니다" } },
      ],
      { cacheTtlMs: 1, now: () => clock },
    );

    await repository.get();
    clock += 10_000;
    const second = await repository.get();

    assert.equal(second.stale, true);
    assert.equal(second.config.signup, false);
  });

  test("invalidate 후에는 Discord에서 다시 읽는다", async () => {
    const { repository, fetchImpl } = makeRepository({
      status: 200,
      body: { content: configMessageContent() },
    });

    await repository.get();
    repository.invalidate();
    await repository.get();

    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(repository.peek() !== null, true);
  });

  test("캐시를 비운 뒤에도 Discord만으로 상태가 복원된다", async () => {
    const { repository } = makeRepository({
      status: 200,
      body: { content: configMessageContent({ maintenanceMode: true }) },
    });

    await repository.get();
    repository.invalidate();
    assert.equal(repository.peek(), null);

    const restored = await repository.get();
    assert.equal(restored.config.maintenanceMode, true);
  });
});
