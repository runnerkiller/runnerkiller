import { parseEnv } from "./env.js";

const SNOWFLAKE_RE = /^\d{17,20}$/;
const ORIGIN_RE = /^https?:\/\/[^/\s]+$/;

/**
 * 계획서 5절의 환경변수 목록.
 *
 * `stage`는 그 값이 실제로 필요해지는 구현 단계다. 1단계(연결 확인 + 설정 읽기)에
 * 필요한 값만 필수로 검사하고, 나머지는 아직 없어도 서버가 뜨도록 한다.
 * 그래야 Discord 채널을 하나씩 만들어가며 단계적으로 붙일 수 있다.
 */
export const ENV_SPEC = [
  { key: "PORT", stage: 1, kind: "port", required: false, fallback: "8787" },
  { key: "PUBLIC_SITE_ORIGIN", stage: 1, kind: "origin", required: false },
  { key: "BRIDGE_PUBLIC_URL", stage: 3, kind: "origin", required: false },
  { key: "DISCORD_BOT_TOKEN", stage: 1, kind: "secret", required: true },
  { key: "DISCORD_APPLICATION_ID", stage: 3, kind: "snowflake", required: false },
  { key: "DISCORD_CLIENT_ID", stage: 3, kind: "snowflake", required: false },
  { key: "DISCORD_CLIENT_SECRET", stage: 3, kind: "secret", required: false },
  { key: "DISCORD_GUILD_ID", stage: 1, kind: "snowflake", required: true },
  { key: "DISCORD_ADMIN_ROLE_ID", stage: 3, kind: "snowflake", required: false },
  { key: "DISCORD_CONFIG_CHANNEL_ID", stage: 1, kind: "snowflake", required: true },
  { key: "DISCORD_CONFIG_MESSAGE_ID", stage: 1, kind: "snowflake", required: true },
  { key: "DISCORD_USERS_CHANNEL_ID", stage: 4, kind: "snowflake", required: false },
  { key: "DISCORD_VERIFICATIONS_CHANNEL_ID", stage: 4, kind: "snowflake", required: false },
  { key: "DISCORD_REPORTS_PENDING_CHANNEL_ID", stage: 2, kind: "snowflake", required: false },
  { key: "DISCORD_REPORTS_APPROVED_CHANNEL_ID", stage: 2, kind: "snowflake", required: false },
  { key: "DEV_REPORTER_DISCORD_ID", stage: 2, kind: "snowflake", required: false },
  { key: "DISCORD_REPORTS_REJECTED_CHANNEL_ID", stage: 3, kind: "snowflake", required: false },
  { key: "DISCORD_VOTES_CHANNEL_ID", stage: 5, kind: "snowflake", required: false },
  { key: "DISCORD_AUDIT_LOG_CHANNEL_ID", stage: 3, kind: "snowflake", required: false },
  { key: "DISCORD_ERRORS_CHANNEL_ID", stage: 6, kind: "snowflake", required: false },
  { key: "SESSION_SIGNING_SECRET", stage: 3, kind: "secret", required: false },
];

function checkValue(spec, value) {
  switch (spec.kind) {
    case "snowflake":
      return SNOWFLAKE_RE.test(value)
        ? null
        : "Discord ID 형식이 아닙니다 (숫자 17~20자리).";
    case "origin":
      return ORIGIN_RE.test(value)
        ? null
        : "http(s)://호스트 형식이어야 하며 끝에 / 를 붙이지 않습니다.";
    case "port": {
      const port = Number(value);
      return Number.isInteger(port) && port > 0 && port < 65536
        ? null
        : "1~65535 사이의 정수여야 합니다.";
    }
    case "secret":
      return value.length >= 8 ? null : "값이 너무 짧습니다.";
    default:
      return null;
  }
}

/**
 * 환경변수를 검사해 설정 객체를 만든다.
 *
 * 첫 오류에서 바로 던지지 않고 전부 모아서 돌려준다. 채널을 9개나 만들어야 하는
 * 초기 설정에서 오류를 하나씩 고치게 만들면 시간이 너무 오래 걸린다.
 */
export function buildConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const values = {};
  const missingByStage = {};

  for (const spec of ENV_SPEC) {
    const raw = env[spec.key];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (!value) {
      if (spec.required) {
        errors.push({ key: spec.key, message: "필수 값이 비어 있습니다." });
      } else {
        if (spec.fallback !== undefined) values[spec.key] = spec.fallback;
        if (spec.stage > 1) {
          missingByStage[spec.stage] = missingByStage[spec.stage] || [];
          missingByStage[spec.stage].push(spec.key);
        }
      }
      continue;
    }

    const problem = checkValue(spec, value);
    if (problem) {
      errors.push({ key: spec.key, message: problem });
      continue;
    }
    values[spec.key] = value;
  }

  if (!values.PUBLIC_SITE_ORIGIN) {
    warnings.push(
      "PUBLIC_SITE_ORIGIN이 없어 브라우저에서의 교차 출처 요청이 모두 거부됩니다.",
    );
  }
  if (
    values.SESSION_SIGNING_SECRET &&
    values.SESSION_SIGNING_SECRET.length < 32
  ) {
    warnings.push(
      "SESSION_SIGNING_SECRET이 32자 미만입니다. 더 긴 임의 문자열을 사용하세요.",
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    missingByStage,
    port: Number(values.PORT ?? 8787),
    publicSiteOrigin: values.PUBLIC_SITE_ORIGIN ?? null,
    bridgePublicUrl: values.BRIDGE_PUBLIC_URL ?? null,
    discord: {
      botToken: values.DISCORD_BOT_TOKEN ?? null,
      applicationId: values.DISCORD_APPLICATION_ID ?? null,
      clientId: values.DISCORD_CLIENT_ID ?? null,
      clientSecret: values.DISCORD_CLIENT_SECRET ?? null,
      guildId: values.DISCORD_GUILD_ID ?? null,
      adminRoleId: values.DISCORD_ADMIN_ROLE_ID ?? null,
      channels: {
        config: values.DISCORD_CONFIG_CHANNEL_ID ?? null,
        users: values.DISCORD_USERS_CHANNEL_ID ?? null,
        verifications: values.DISCORD_VERIFICATIONS_CHANNEL_ID ?? null,
        reportsPending: values.DISCORD_REPORTS_PENDING_CHANNEL_ID ?? null,
        reportsApproved: values.DISCORD_REPORTS_APPROVED_CHANNEL_ID ?? null,
        reportsRejected: values.DISCORD_REPORTS_REJECTED_CHANNEL_ID ?? null,
        votes: values.DISCORD_VOTES_CHANNEL_ID ?? null,
        auditLog: values.DISCORD_AUDIT_LOG_CHANNEL_ID ?? null,
        errors: values.DISCORD_ERRORS_CHANNEL_ID ?? null,
      },
      configMessageId: values.DISCORD_CONFIG_MESSAGE_ID ?? null,
    },
    devReporterDiscordId: values.DEV_REPORTER_DISCORD_ID ?? null,
    sessionSigningSecret: values.SESSION_SIGNING_SECRET ?? null,
  };
}

/** `.env.example`에 선언된 키와 ENV_SPEC이 어긋났는지 검사한다. */
export function diffEnvExample(exampleText) {
  const declared = Object.keys(parseEnv(exampleText));
  const known = ENV_SPEC.map((spec) => spec.key);
  return {
    missingFromExample: known.filter((key) => !declared.includes(key)),
    unknownInExample: declared.filter((key) => !known.includes(key)),
  };
}
