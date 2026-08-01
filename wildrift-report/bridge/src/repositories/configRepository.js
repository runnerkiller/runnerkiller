import { DiscordApiError } from "../discordClient.js";

export const CONFIG_SCHEMA_VERSION = 1;

/**
 * 기본값은 프런트엔드의 WR.DEFAULT_FEATURE_FLAGS와 일부러 똑같이 맞췄다.
 * 데모 모드와 Discord 모드가 다르게 동작하면 검수 결과를 믿을 수 없게 된다.
 * maintenanceMode는 계획서 4.1에만 있는 값이라 여기서 기본값을 정한다.
 */
export const FEATURE_FLAG_DEFAULTS = Object.freeze({
  publicList: true,
  reportSubmission: true,
  evidenceUpload: true,
  evidenceRequired: false,
  authentication: true,
  signup: true,
  voting: true,
  reporterIdentity: true,
  maintenanceMode: false,
});

export class ConfigParseError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ConfigParseError";
    this.messageId = details.messageId ?? null;
    this.cause = details.cause ?? null;
  }
}

/** 메시지 본문에서 JSON 부분만 뽑아낸다. 운영자가 설명을 함께 적어둘 수 있다. */
export function extractJsonBlock(content) {
  if (typeof content !== "string") return null;

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);

  return null;
}

/**
 * 설정 메시지를 파싱한다. 값이 없거나 형식이 틀린 항목은 기본값으로 채우고
 * 무엇을 기본값으로 되돌렸는지 warnings에 남긴다.
 *
 * JSON 자체가 깨진 경우에만 예외를 던진다. 이때 전부 기본값으로 되돌리면
 * 관리자가 꺼둔 기능이 조용히 다시 켜지기 때문에, 조용히 넘어가지 않는다.
 */
export function parseConfigMessage(content, options = {}) {
  const raw = extractJsonBlock(content);
  if (!raw) {
    throw new ConfigParseError("설정 메시지에서 JSON을 찾지 못했습니다.", {
      messageId: options.messageId,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigParseError("설정 메시지의 JSON 형식이 잘못되었습니다.", {
      messageId: options.messageId,
      cause,
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigParseError("설정 메시지가 JSON 객체가 아닙니다.", {
      messageId: options.messageId,
    });
  }

  const warnings = [];

  if (parsed.type !== undefined && parsed.type !== "config") {
    warnings.push(`type이 "config"가 아닙니다: ${String(parsed.type)}`);
  }

  let schemaVersion = CONFIG_SCHEMA_VERSION;
  if (parsed.schemaVersion !== undefined) {
    if (
      typeof parsed.schemaVersion === "number" &&
      Number.isInteger(parsed.schemaVersion)
    ) {
      schemaVersion = parsed.schemaVersion;
      if (schemaVersion > CONFIG_SCHEMA_VERSION) {
        warnings.push(
          `설정 메시지의 schemaVersion(${schemaVersion})이 Bridge가 아는 버전(${CONFIG_SCHEMA_VERSION})보다 높습니다. Bridge를 업데이트하세요.`,
        );
      }
    } else {
      warnings.push("schemaVersion이 정수가 아니라 기본값을 사용합니다.");
    }
  } else {
    warnings.push("schemaVersion이 없어 기본값을 사용합니다.");
  }

  const flags = {};
  for (const [key, fallback] of Object.entries(FEATURE_FLAG_DEFAULTS)) {
    const value = parsed[key];
    if (typeof value === "boolean") {
      flags[key] = value;
    } else {
      flags[key] = fallback;
      if (value !== undefined) {
        warnings.push(`${key}가 true/false가 아니라 기본값(${fallback})을 씁니다.`);
      }
    }
  }

  // 프런트엔드와 같은 규칙: 증거 업로드를 끄면 증거 필수도 함께 꺼진다.
  if (!flags.evidenceUpload && flags.evidenceRequired) {
    flags.evidenceRequired = false;
    warnings.push(
      "evidenceUpload가 꺼져 있어 evidenceRequired를 함께 껐습니다.",
    );
  }

  const updatedAt =
    typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
  const updatedByDiscordId =
    typeof parsed.updatedByDiscordId === "string"
      ? parsed.updatedByDiscordId
      : null;

  return {
    config: {
      schemaVersion,
      type: "config",
      ...flags,
      updatedAt,
      updatedByDiscordId,
    },
    warnings,
  };
}

/** 공개 API로 내보낼 때 내부 Discord ID를 제거한다 (계획서 10절). */
export function toPublicConfig(config) {
  const { updatedByDiscordId, type, ...rest } = config;
  return rest;
}

/**
 * wr-config 채널의 고정 메시지 하나를 설정 원본으로 읽는다.
 *
 * 메모리 캐시는 성능용일 뿐이고, 캐시가 비어도 Discord만으로 복원된다.
 */
export function createConfigRepository({
  discordClient,
  channelId,
  messageId,
  cacheTtlMs = 30_000,
  now = () => Date.now(),
}) {
  if (!discordClient) throw new Error("discordClient가 필요합니다.");
  if (!channelId) throw new Error("DISCORD_CONFIG_CHANNEL_ID가 필요합니다.");
  if (!messageId) throw new Error("DISCORD_CONFIG_MESSAGE_ID가 필요합니다.");

  let cache = null;

  async function get(options = {}) {
    if (
      !options.forceRefresh &&
      cache &&
      now() - cache.fetchedAt < cacheTtlMs
    ) {
      return { ...cache.result, cached: true };
    }

    let message;
    try {
      message = await discordClient.getMessage(channelId, messageId);
    } catch (error) {
      // Discord를 못 읽는데 예전 값이 있으면 stale 표시를 달아 제한적으로 쓴다 (계획서 12절).
      if (cache) {
        return { ...cache.result, cached: true, stale: true, error };
      }
      throw error;
    }

    let parsed;
    try {
      parsed = parseConfigMessage(message?.content, { messageId });
    } catch (error) {
      if (cache) {
        return { ...cache.result, cached: true, stale: true, error };
      }
      throw error;
    }

    const result = {
      config: parsed.config,
      warnings: parsed.warnings,
      fetchedAt: new Date(now()).toISOString(),
      stale: false,
    };
    cache = { fetchedAt: now(), result };
    return { ...result, cached: false };
  }

  return {
    get,
    /** 캐시를 비운다. 재시작 없이 Discord에서 다시 읽게 할 때 쓴다. */
    invalidate() {
      cache = null;
    },
    /** 마지막으로 성공한 값. 없으면 null. */
    peek() {
      return cache ? cache.result : null;
    },
  };
}

export { DiscordApiError };
