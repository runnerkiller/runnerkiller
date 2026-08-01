export const VOTE_SCHEMA_VERSION = 1;

export class DuplicateVoteError extends Error {
  constructor(reportId, discordUserId) {
    super("이미 이 제보를 평가했습니다.");
    this.name = "DuplicateVoteError";
    this.reportId = reportId;
    this.discordUserId = discordUserId;
  }
}

export class VoteRecordError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "VoteRecordError";
    this.messageId = details.messageId ?? null;
    this.cause = details.cause ?? null;
  }
}

const logicalKey = (reportId, discordUserId) => `${reportId}:${discordUserId}`;

function extractJsonBlock(content) {
  if (typeof content !== "string") return null;
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

export function buildVoteMessageContent(record) {
  const content = `제보 평가 | ${record.reportId} | ${record.direction}\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\``;
  if (content.length > 2_000) {
    throw new VoteRecordError("Discord 투표 메시지 길이 제한을 초과했습니다.");
  }
  return content;
}

export function parseVoteMessage(message) {
  const raw = extractJsonBlock(message?.content);
  if (!raw) {
    throw new VoteRecordError("투표 메시지에서 JSON을 찾지 못했습니다.", {
      messageId: message?.id,
    });
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch (cause) {
    throw new VoteRecordError("투표 메시지의 JSON 형식이 잘못되었습니다.", {
      messageId: message?.id,
      cause,
    });
  }

  if (
    !record ||
    record.schemaVersion !== VOTE_SCHEMA_VERSION ||
    record.type !== "vote" ||
    !/^\d{17,20}$/.test(record.reportId ?? "") ||
    !/^\d{17,20}$/.test(record.discordUserId ?? "") ||
    !["up", "down"].includes(record.direction)
  ) {
    throw new VoteRecordError("지원하지 않는 투표 레코드입니다.", {
      messageId: message?.id,
    });
  }

  return { ...record, voteId: message.id };
}

export function toPublicVote(vote) {
  return {
    voteId: vote.voteId,
    reportId: vote.reportId,
    direction: vote.direction,
    createdAt: vote.createdAt,
  };
}

export function createVoteRepository({
  discordClient,
  channelId,
  now = () => Date.now(),
  onInvalidRecord = () => {},
  maxScanPages = 100,
}) {
  if (!discordClient) throw new Error("discordClient가 필요합니다.");
  if (!channelId) throw new Error("DISCORD_VOTES_CHANNEL_ID가 필요합니다.");

  const index = new Map();
  const locks = new Map();
  let hydrated = false;

  async function hydrate(options = {}) {
    if (hydrated && !options.force) return;
    const nextIndex = new Map();
    let before = null;
    for (let page = 0; page < maxScanPages; page += 1) {
      const messages = await discordClient.getChannelMessages(channelId, {
        limit: 100,
        before: before ?? undefined,
      });
      for (const message of messages) {
        try {
          const vote = parseVoteMessage(message);
          const key = logicalKey(vote.reportId, vote.discordUserId);
          if (nextIndex.has(key)) {
            onInvalidRecord(
              new VoteRecordError(
                "같은 사용자와 제보의 중복 투표 레코드를 건너뜁니다.",
                { messageId: message.id },
              ),
              message,
            );
            continue;
          }
          nextIndex.set(key, vote);
        } catch (error) {
          onInvalidRecord(error, message);
        }
      }
      if (messages.length < 100) break;
      before = messages[messages.length - 1]?.id ?? null;
      if (!before) break;
    }
    index.clear();
    for (const [key, vote] of nextIndex) index.set(key, vote);
    hydrated = true;
  }

  async function withLock(key, task) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    locks.set(key, current);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (locks.get(key) === current) locks.delete(key);
    }
  }

  async function create(reportId, discordUserId, direction) {
    if (!/^\d{17,20}$/.test(reportId ?? "")) {
      throw new Error("올바른 reportId가 필요합니다.");
    }
    if (!/^\d{17,20}$/.test(discordUserId ?? "")) {
      throw new Error("올바른 Discord 사용자 ID가 필요합니다.");
    }
    if (!["up", "down"].includes(direction)) {
      throw new Error("투표 방향은 up 또는 down이어야 합니다.");
    }

    const key = logicalKey(reportId, discordUserId);
    return withLock(key, async () => {
      await hydrate();
      if (index.has(key)) throw new DuplicateVoteError(reportId, discordUserId);
      const timestamp = new Date(now()).toISOString();
      const record = {
        schemaVersion: VOTE_SCHEMA_VERSION,
        type: "vote",
        reportId,
        discordUserId,
        direction,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const message = await discordClient.createMessage(channelId, {
        content: buildVoteMessageContent(record),
      });
      const vote = parseVoteMessage(message);
      index.set(key, vote);
      return vote;
    });
  }

  async function summary(reportId) {
    await hydrate();
    let up = 0;
    let down = 0;
    for (const vote of index.values()) {
      if (vote.reportId !== reportId) continue;
      if (vote.direction === "up") up += 1;
      else down += 1;
    }
    return { up, down, score: up - down };
  }

  async function summaries(reportIds) {
    await hydrate();
    const output = Object.fromEntries(
      reportIds.map((reportId) => [reportId, { up: 0, down: 0, score: 0 }]),
    );
    for (const vote of index.values()) {
      const counts = output[vote.reportId];
      if (!counts) continue;
      counts[vote.direction] += 1;
      counts.score = counts.up - counts.down;
    }
    return output;
  }

  async function listByUser(discordUserId) {
    await hydrate();
    return [...index.values()]
      .filter((vote) => vote.discordUserId === discordUserId)
      .map(toPublicVote);
  }

  return { hydrate, create, summary, summaries, listByUser };
}
