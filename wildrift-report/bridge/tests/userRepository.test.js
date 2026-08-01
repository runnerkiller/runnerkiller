import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  UserNotFoundError,
  buildUserMessageContent,
  createUserRepository,
  parseUserMessage,
  toOwnUser,
} from "../src/repositories/userRepository.js";

const IDS = {
  channel: "111111111111111111",
  user: "222222222222222222",
  message: "333333333333333333",
};

function userRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    type: "user",
    discordUserId: IDS.user,
    discordUsernameSnapshot: "tester",
    gameNickname: "협곡의파괴자",
    verificationStatus: "pending",
    banned: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function memoryDiscord(initial = []) {
  const messages = [...initial];
  const calls = [];
  return {
    messages,
    calls,
    async getChannelMessages(channelId, query) {
      calls.push({ method: "list", channelId, query });
      const start = query.before
        ? messages.findIndex((item) => item.id === query.before) + 1
        : 0;
      return messages.slice(start, start + Number(query.limit));
    },
    async createMessage(channelId, payload) {
      calls.push({ method: "create", channelId, payload });
      const message = {
        id: IDS.message,
        content: payload.content,
        attachments: [],
      };
      messages.unshift(message);
      return message;
    },
    async editMessage(channelId, messageId, payload) {
      calls.push({ method: "edit", channelId, messageId, payload });
      const index = messages.findIndex((item) => item.id === messageId);
      messages[index] = { ...messages[index], content: payload.content };
      return messages[index];
    },
  };
}

describe("user record", () => {
  test("Discord 메시지에서 사용자 레코드를 복원한다", () => {
    const parsed = parseUserMessage({
      id: IDS.message,
      content: buildUserMessageContent(userRecord()),
    });
    assert.equal(parsed.discordUserId, IDS.user);
    assert.equal(parsed.userMessageId, IDS.message);
  });

  test("본인 응답은 내부 Discord ID와 메시지 ID를 숨긴다", () => {
    const own = toOwnUser({ ...userRecord(), userMessageId: IDS.message });
    assert.equal(own.gameNickname, "협곡의파괴자");
    assert.equal(own.discordUserId, undefined);
    assert.equal(own.userMessageId, undefined);
  });
});

describe("createUserRepository", () => {
  test("첫 인증 요청은 새 사용자 메시지를 만든다", async () => {
    const client = memoryDiscord();
    const repository = createUserRepository({
      discordClient: client,
      channelId: IDS.channel,
      now: () => Date.parse("2026-08-01T01:00:00.000Z"),
    });
    const user = await repository.setVerificationPending({
      discordUserId: IDS.user,
      discordUsernameSnapshot: "tester",
      gameNickname: "협곡의파괴자",
    });
    assert.equal(user.verificationStatus, "pending");
    assert.equal(client.calls.at(-1).method, "create");
  });

  test("기존 사용자의 재신청은 같은 메시지를 수정하고 정지 상태를 보존한다", async () => {
    const client = memoryDiscord([
      {
        id: IDS.message,
        content: buildUserMessageContent(
          userRecord({ verificationStatus: "rejected", banned: true }),
        ),
      },
    ]);
    const repository = createUserRepository({
      discordClient: client,
      channelId: IDS.channel,
    });
    const user = await repository.setVerificationPending({
      discordUserId: IDS.user,
      discordUsernameSnapshot: "renamed",
      gameNickname: "새닉네임",
    });
    assert.equal(user.userMessageId, IDS.message);
    assert.equal(user.discordUsernameSnapshot, "renamed");
    assert.equal(user.gameNickname, "새닉네임");
    assert.equal(user.banned, true);
    assert.equal(client.calls.at(-1).method, "edit");
  });

  test("인증 판정과 사용자 정지를 같은 메시지에 반영한다", async () => {
    const client = memoryDiscord([
      {
        id: IDS.message,
        content: buildUserMessageContent(userRecord()),
      },
    ]);
    const repository = createUserRepository({
      discordClient: client,
      channelId: IDS.channel,
    });
    await repository.setVerificationStatus(
      IDS.user,
      "approved",
      "협곡의파괴자",
    );
    const banned = await repository.setBanned(IDS.user, true);
    assert.equal(banned.verificationStatus, "approved");
    assert.equal(banned.banned, true);
  });

  test("없는 사용자의 정지 변경은 명시적인 not found 오류다", async () => {
    const repository = createUserRepository({
      discordClient: memoryDiscord(),
      channelId: IDS.channel,
    });
    await assert.rejects(
      () => repository.setBanned(IDS.user, true),
      (error) => error instanceof UserNotFoundError,
    );
  });

  test("손상된 메시지는 건너뛰고 뒤의 사용자 레코드를 찾는다", async () => {
    const invalid = [];
    const client = memoryDiscord([
      { id: "444444444444444444", content: "broken" },
      {
        id: IDS.message,
        content: buildUserMessageContent(userRecord()),
      },
    ]);
    const repository = createUserRepository({
      discordClient: client,
      channelId: IDS.channel,
      onInvalidRecord: (error) => invalid.push(error),
    });
    const user = await repository.getByDiscordId(IDS.user);
    assert.equal(user.gameNickname, "협곡의파괴자");
    assert.equal(invalid.length, 1);
  });
});
