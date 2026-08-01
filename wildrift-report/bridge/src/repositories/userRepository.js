export const USER_SCHEMA_VERSION = 1;

export class UserNotFoundError extends Error {
  constructor(discordUserId) {
    super("사용자 정보를 찾을 수 없습니다.");
    this.name = "UserNotFoundError";
    this.discordUserId = discordUserId;
  }
}

export class UserRecordError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "UserRecordError";
    this.messageId = details.messageId ?? null;
    this.cause = details.cause ?? null;
  }
}

function extractJsonBlock(content) {
  if (typeof content !== "string") return null;
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

export function buildUserMessageContent(record) {
  const nickname = record.gameNickname || "미인증";
  const content = `사용자 | ${record.discordUserId} | ${nickname}\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\``;
  if (content.length > 2_000) {
    throw new UserRecordError(
      "Discord 사용자 메시지 길이 제한을 초과했습니다.",
    );
  }
  return content;
}

export function parseUserMessage(message) {
  const raw = extractJsonBlock(message?.content);
  if (!raw) {
    throw new UserRecordError("사용자 메시지에서 JSON을 찾지 못했습니다.", {
      messageId: message?.id,
    });
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch (cause) {
    throw new UserRecordError("사용자 메시지의 JSON 형식이 잘못되었습니다.", {
      messageId: message?.id,
      cause,
    });
  }

  if (
    !record ||
    record.schemaVersion !== USER_SCHEMA_VERSION ||
    record.type !== "user" ||
    !/^\d{17,20}$/.test(record.discordUserId ?? "")
  ) {
    throw new UserRecordError("지원하지 않는 사용자 레코드입니다.", {
      messageId: message?.id,
    });
  }

  return { ...record, userMessageId: message.id };
}

export function toOwnUser(user) {
  if (!user) {
    return {
      gameNickname: null,
      verificationStatus: "unverified",
      banned: false,
    };
  }
  return {
    gameNickname: user.gameNickname ?? null,
    verificationStatus: user.verificationStatus ?? "unverified",
    banned: Boolean(user.banned),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function createUserRepository({
  discordClient,
  channelId,
  now = () => Date.now(),
  onInvalidRecord = () => {},
  maxScanPages = 10,
}) {
  if (!discordClient) throw new Error("discordClient가 필요합니다.");
  if (!channelId) throw new Error("DISCORD_USERS_CHANNEL_ID가 필요합니다.");

  async function list(options = {}) {
    const requestedLimit = Math.min(
      Math.max(Number(options.limit) || 100, 1),
      100,
    );
    const messages = await discordClient.getChannelMessages(channelId, {
      limit: requestedLimit,
      before: options.before ?? undefined,
    });
    const users = [];
    for (const message of messages) {
      try {
        users.push(parseUserMessage(message));
      } catch (error) {
        onInvalidRecord(error, message);
      }
    }
    return {
      users,
      nextCursor:
        messages.length === requestedLimit
          ? (messages[messages.length - 1]?.id ?? null)
          : null,
    };
  }

  async function getByDiscordId(discordUserId) {
    let before = null;
    for (let page = 0; page < maxScanPages; page += 1) {
      const result = await list({ limit: 100, before });
      const user = result.users.find(
        (candidate) => candidate.discordUserId === discordUserId,
      );
      if (user) return user;
      if (!result.nextCursor) return null;
      before = result.nextCursor;
    }
    return null;
  }

  async function write(record, existing = null) {
    const content = buildUserMessageContent(record);
    const message = existing
      ? await discordClient.editMessage(channelId, existing.userMessageId, {
          content,
        })
      : await discordClient.createMessage(channelId, { content });
    return parseUserMessage(message);
  }

  async function setVerificationPending({
    discordUserId,
    discordUsernameSnapshot,
    gameNickname,
  }) {
    const existing = await getByDiscordId(discordUserId);
    const timestamp = new Date(now()).toISOString();
    const record = {
      schemaVersion: USER_SCHEMA_VERSION,
      type: "user",
      discordUserId,
      discordUsernameSnapshot,
      gameNickname,
      verificationStatus: "pending",
      banned: Boolean(existing?.banned),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    return write(record, existing);
  }

  async function setVerificationStatus(
    discordUserId,
    verificationStatus,
    gameNickname,
  ) {
    if (!["approved", "rejected"].includes(verificationStatus)) {
      throw new Error("인증 상태는 approved 또는 rejected여야 합니다.");
    }
    const existing = await getByDiscordId(discordUserId);
    if (!existing) throw new UserNotFoundError(discordUserId);
    return write(
      {
        ...existing,
        userMessageId: undefined,
        gameNickname: gameNickname ?? existing.gameNickname,
        verificationStatus,
        updatedAt: new Date(now()).toISOString(),
      },
      existing,
    );
  }

  async function setBanned(discordUserId, banned) {
    const existing = await getByDiscordId(discordUserId);
    if (!existing) throw new UserNotFoundError(discordUserId);
    if (existing.banned === banned) return existing;
    return write(
      {
        ...existing,
        userMessageId: undefined,
        banned,
        updatedAt: new Date(now()).toISOString(),
      },
      existing,
    );
  }

  return {
    list,
    getByDiscordId,
    setVerificationPending,
    setVerificationStatus,
    setBanned,
  };
}
