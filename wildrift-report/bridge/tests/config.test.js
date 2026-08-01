import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildConfig, diffEnvExample, ENV_SPEC } from "../src/config.js";
import { parseEnv } from "../src/env.js";

const here = dirname(fileURLToPath(import.meta.url));

const VALID = {
  DISCORD_BOT_TOKEN: "test-bot-token-value",
  DISCORD_GUILD_ID: "111111111111111111",
  DISCORD_CONFIG_CHANNEL_ID: "222222222222222222",
  DISCORD_CONFIG_MESSAGE_ID: "333333333333333333",
};

describe("buildConfig", () => {
  test("1단계 필수 값이 모두 있으면 통과한다", () => {
    const config = buildConfig({ ...VALID });
    assert.equal(config.ok, true);
    assert.deepEqual(config.errors, []);
    assert.equal(config.discord.guildId, VALID.DISCORD_GUILD_ID);
    assert.equal(config.discord.channels.config, VALID.DISCORD_CONFIG_CHANNEL_ID);
  });

  test("PORT 기본값은 8787이다", () => {
    assert.equal(buildConfig({ ...VALID }).port, 8787);
    assert.equal(buildConfig({ ...VALID, PORT: "9000" }).port, 9000);
  });

  test("필수 값이 없으면 한 번에 모두 보고한다", () => {
    const config = buildConfig({});
    assert.equal(config.ok, false);
    const keys = config.errors.map((e) => e.key);
    assert.deepEqual(keys.sort(), [
      "DISCORD_BOT_TOKEN",
      "DISCORD_CONFIG_CHANNEL_ID",
      "DISCORD_CONFIG_MESSAGE_ID",
      "DISCORD_GUILD_ID",
    ]);
  });

  test("Discord ID 형식이 아니면 거부한다", () => {
    const config = buildConfig({ ...VALID, DISCORD_GUILD_ID: "not-a-snowflake" });
    assert.equal(config.ok, false);
    assert.ok(config.errors.some((e) => e.key === "DISCORD_GUILD_ID"));
  });

  test("끝에 슬래시가 붙은 출처는 거부한다", () => {
    const config = buildConfig({
      ...VALID,
      PUBLIC_SITE_ORIGIN: "https://runnerkiller.github.io/",
    });
    assert.equal(config.ok, false);
    assert.ok(config.errors.some((e) => e.key === "PUBLIC_SITE_ORIGIN"));
  });

  test("올바른 출처는 통과한다", () => {
    const config = buildConfig({
      ...VALID,
      PUBLIC_SITE_ORIGIN: "https://runnerkiller.github.io",
    });
    assert.equal(config.ok, true);
    assert.equal(config.publicSiteOrigin, "https://runnerkiller.github.io");
  });

  test("PUBLIC_SITE_ORIGIN이 없으면 경고한다", () => {
    const config = buildConfig({ ...VALID });
    assert.ok(config.warnings.some((w) => w.includes("PUBLIC_SITE_ORIGIN")));
  });

  test("짧은 세션 키는 경고한다", () => {
    const config = buildConfig({ ...VALID, SESSION_SIGNING_SECRET: "short123" });
    assert.equal(config.ok, true);
    assert.ok(config.warnings.some((w) => w.includes("SESSION_SIGNING_SECRET")));
  });

  test("나중 단계에 필요한 값은 없어도 시작할 수 있고 단계별로 안내한다", () => {
    const config = buildConfig({ ...VALID });
    assert.equal(config.ok, true);
    assert.ok(config.missingByStage[5].includes("DISCORD_VOTES_CHANNEL_ID"));
    assert.ok(config.missingByStage[3].includes("SESSION_SIGNING_SECRET"));
  });
});

describe(".env.example", () => {
  test("코드가 아는 키와 예시 파일의 키가 일치한다", () => {
    const text = readFileSync(join(here, "..", ".env.example"), "utf8");
    const diff = diffEnvExample(text);
    assert.deepEqual(diff.missingFromExample, []);
    assert.deepEqual(diff.unknownInExample, []);
  });

  test("예시 파일에 실제 값이 들어 있지 않다", () => {
    const text = readFileSync(join(here, "..", ".env.example"), "utf8");
    for (const [key, value] of Object.entries(parseEnv(text))) {
      assert.equal(value, "", `${key}에 값이 채워져 있습니다.`);
    }
  });

  test("계획서 5절이 요구한 키를 모두 선언한다", () => {
    const required = [
      "PORT",
      "PUBLIC_SITE_ORIGIN",
      "BRIDGE_PUBLIC_URL",
      "DISCORD_BOT_TOKEN",
      "DISCORD_APPLICATION_ID",
      "DISCORD_CLIENT_ID",
      "DISCORD_CLIENT_SECRET",
      "DISCORD_GUILD_ID",
      "DISCORD_ADMIN_ROLE_ID",
      "DISCORD_CONFIG_CHANNEL_ID",
      "DISCORD_CONFIG_MESSAGE_ID",
      "DISCORD_USERS_CHANNEL_ID",
      "DISCORD_VERIFICATIONS_CHANNEL_ID",
      "DISCORD_REPORTS_PENDING_CHANNEL_ID",
      "DISCORD_REPORTS_APPROVED_CHANNEL_ID",
      "DISCORD_REPORTS_REJECTED_CHANNEL_ID",
      "DISCORD_VOTES_CHANNEL_ID",
      "DISCORD_AUDIT_LOG_CHANNEL_ID",
      "DISCORD_ERRORS_CHANNEL_ID",
      "SESSION_SIGNING_SECRET",
    ];
    const known = ENV_SPEC.map((spec) => spec.key);
    for (const key of required) {
      assert.ok(known.includes(key), `${key}가 ENV_SPEC에 없습니다.`);
    }
  });
});

describe("parseEnv", () => {
  test("주석과 빈 줄을 건너뛴다", () => {
    const parsed = parseEnv("# 주석\n\nA=1\n  # 들여쓴 주석\nB=2\n");
    assert.deepEqual(parsed, { A: "1", B: "2" });
  });

  test("따옴표를 벗겨낸다", () => {
    const parsed = parseEnv(`A="값"\nB='값2'\n`);
    assert.deepEqual(parsed, { A: "값", B: "값2" });
  });

  test("값 안의 #을 주석으로 자르지 않는다", () => {
    const parsed = parseEnv("TOKEN=abc#def\n");
    assert.equal(parsed.TOKEN, "abc#def");
  });

  test("값에 =가 들어가도 첫 =만 구분자로 쓴다", () => {
    const parsed = parseEnv("SECRET=a=b=c\n");
    assert.equal(parsed.SECRET, "a=b=c");
  });

  test("export 접두사를 허용한다", () => {
    assert.deepEqual(parseEnv("export A=1\n"), { A: "1" });
  });
});
