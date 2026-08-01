import { UserNotFoundError } from "./userRepository.js";

export const VERIFICATION_SCHEMA_VERSION = 1;

export class VerificationNotFoundError extends Error {
  constructor(verificationId) {
    super("게임 계정 인증 요청을 찾을 수 없습니다.");
    this.name = "VerificationNotFoundError";
    this.verificationId = verificationId;
  }
}

export class VerificationConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationConflictError";
  }
}

export class VerificationRecordError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "VerificationRecordError";
    this.messageId = details.messageId ?? null;
    this.cause = details.cause ?? null;
  }
}

function extractJsonBlock(content) {
  if (typeof content !== "string") return null;
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

export function buildVerificationMessageContent(record) {
  const content = `게임 계정 인증 | ${record.gameNickname} | ${record.status}\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\``;
  if (content.length > 2_000) {
    throw new VerificationRecordError(
      "Discord 게임 계정 인증 메시지 길이 제한을 초과했습니다.",
    );
  }
  return content;
}

export function parseVerificationMessage(message, options = {}) {
  const raw = extractJsonBlock(message?.content);
  if (!raw) {
    throw new VerificationRecordError(
      "게임 계정 인증 메시지에서 JSON을 찾지 못했습니다.",
      { messageId: message?.id },
    );
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch (cause) {
    throw new VerificationRecordError(
      "게임 계정 인증 메시지의 JSON 형식이 잘못되었습니다.",
      { messageId: message?.id, cause },
    );
  }

  if (
    !record ||
    record.schemaVersion !== VERIFICATION_SCHEMA_VERSION ||
    record.type !== "verification" ||
    !/^\d{17,20}$/.test(record.discordUserId ?? "")
  ) {
    throw new VerificationRecordError(
      "지원하지 않는 게임 계정 인증 레코드입니다.",
      { messageId: message?.id },
    );
  }
  if (options.expectedStatus && record.status !== options.expectedStatus) {
    throw new VerificationRecordError(
      "게임 계정 인증 상태가 요청한 상태와 일치하지 않습니다.",
      { messageId: message?.id },
    );
  }

  return {
    ...record,
    verificationId: message.id,
    evidence: (message.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.content_type ?? null,
      size: attachment.size ?? null,
      url: attachment.url,
      proxyUrl: attachment.proxy_url ?? null,
    })),
  };
}

export function toOwnVerification(verification) {
  return {
    verificationId: verification.verificationId,
    gameNickname: verification.gameNickname,
    status: verification.status,
    evidenceCount: verification.evidence?.length ?? 0,
    createdAt: verification.createdAt,
    updatedAt: verification.updatedAt,
    reviewedAt: verification.reviewedAt ?? null,
  };
}

export function createVerificationRepository({
  discordClient,
  channelId,
  userRepository,
  auditRepository,
  now = () => Date.now(),
  onInvalidRecord = () => {},
  maxScanPages = 10,
}) {
  if (!discordClient) throw new Error("discordClient가 필요합니다.");
  if (!channelId)
    throw new Error("DISCORD_VERIFICATIONS_CHANNEL_ID가 필요합니다.");
  if (!userRepository) throw new Error("userRepository가 필요합니다.");
  if (!auditRepository) throw new Error("auditRepository가 필요합니다.");

  async function list(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
    const messages = await discordClient.getChannelMessages(channelId, {
      limit,
      before: options.before ?? undefined,
    });
    const verifications = [];
    for (const message of messages) {
      try {
        const verification = parseVerificationMessage(message);
        if (options.status && verification.status !== options.status) continue;
        verifications.push(verification);
      } catch (error) {
        onInvalidRecord(error, message);
      }
    }
    return {
      verifications,
      nextCursor:
        messages.length === limit
          ? (messages[messages.length - 1]?.id ?? null)
          : null,
    };
  }

  async function getById(verificationId) {
    try {
      const message = await discordClient.getMessage(channelId, verificationId);
      return parseVerificationMessage(message);
    } catch (error) {
      if (error?.status === 404 || error instanceof VerificationRecordError) {
        throw new VerificationNotFoundError(verificationId);
      }
      throw error;
    }
  }

  async function findPendingByDiscordUserId(discordUserId) {
    let before = null;
    for (let page = 0; page < maxScanPages; page += 1) {
      const result = await list({ status: "pending", limit: 100, before });
      const existing = result.verifications.find(
        (item) => item.discordUserId === discordUserId,
      );
      if (existing) return existing;
      if (!result.nextCursor) return null;
      before = result.nextCursor;
    }
    return null;
  }

  async function create(
    { discordUserId, discordUsernameSnapshot, gameNickname },
    evidenceFile,
  ) {
    const existing = await findPendingByDiscordUserId(discordUserId);
    if (existing) {
      await userRepository.setVerificationPending({
        discordUserId,
        discordUsernameSnapshot,
        gameNickname: existing.gameNickname,
      });
      return { verification: existing, recovered: true };
    }

    const timestamp = new Date(now()).toISOString();
    const record = {
      schemaVersion: VERIFICATION_SCHEMA_VERSION,
      type: "verification",
      discordUserId,
      gameNickname,
      status: "pending",
      reviewedByDiscordId: null,
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const message = await discordClient.createMessage(
      channelId,
      { content: buildVerificationMessageContent(record) },
      [evidenceFile],
    );
    const verification = parseVerificationMessage(message, {
      expectedStatus: "pending",
    });
    await userRepository.setVerificationPending({
      discordUserId,
      discordUsernameSnapshot,
      gameNickname,
    });
    return { verification, recovered: false };
  }

  async function decide(verificationId, status, adminDiscordId) {
    if (!["approved", "rejected"].includes(status)) {
      throw new Error("인증 상태는 approved 또는 rejected여야 합니다.");
    }
    const current = await getById(verificationId);
    if (current.status !== "pending" && current.status !== status) {
      throw new VerificationConflictError(
        `이미 ${current.status} 상태로 처리된 인증 요청입니다.`,
      );
    }

    let decided = current;
    let recovered = current.status === status;
    if (!recovered) {
      const timestamp = new Date(now()).toISOString();
      const record = {
        ...current,
        verificationId: undefined,
        evidence: undefined,
        status,
        reviewedByDiscordId: adminDiscordId,
        reviewedAt: timestamp,
        updatedAt: timestamp,
      };
      const message = await discordClient.editMessage(
        channelId,
        verificationId,
        { content: buildVerificationMessageContent(record) },
      );
      decided = parseVerificationMessage(message, { expectedStatus: status });
    }

    try {
      await userRepository.setVerificationStatus(
        decided.discordUserId,
        status,
        decided.gameNickname,
      );
    } catch (error) {
      if (!(error instanceof UserNotFoundError)) throw error;
      throw new VerificationConflictError(
        "인증 요청의 사용자 레코드가 없어 판정을 완료하지 못했습니다.",
      );
    }

    await auditRepository.create({
      action: recovered
        ? `verification.${status}.recovered`
        : `verification.${status}`,
      targetId: verificationId,
      actorDiscordId: adminDiscordId,
      before: { status: "pending" },
      after: { status, discordUserId: decided.discordUserId },
      metadata: recovered ? { reason: "existing_decision_record" } : null,
    });

    return { verification: decided, recovered };
  }

  return { list, getById, create, decide };
}
