export const AUDIT_SCHEMA_VERSION = 1;

function buildAuditContent(record) {
  const content = `운영 기록 | ${record.action} | ${record.targetId}\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\``;
  if (content.length > 2_000)
    throw new Error("감사 로그 메시지가 너무 깁니다.");
  return content;
}

export function createAuditRepository({
  discordClient,
  channelId,
  now = () => Date.now(),
}) {
  if (!discordClient) throw new Error("discordClient가 필요합니다.");
  if (!channelId) throw new Error("DISCORD_AUDIT_LOG_CHANNEL_ID가 필요합니다.");

  async function create({
    action,
    targetId,
    actorDiscordId,
    before,
    after,
    metadata = null,
  }) {
    const record = {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      type: "audit",
      action,
      targetId,
      actorDiscordId,
      before,
      after,
      metadata,
      createdAt: new Date(now()).toISOString(),
    };
    const message = await discordClient.createMessage(channelId, {
      content: buildAuditContent(record),
    });
    return { ...record, auditMessageId: message.id };
  }

  return { create };
}
