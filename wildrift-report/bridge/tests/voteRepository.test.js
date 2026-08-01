import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DuplicateVoteError,
  buildVoteMessageContent,
  createVoteRepository,
  parseVoteMessage,
  toPublicVote,
} from "../src/repositories/voteRepository.js";

const IDS = {
  channel: "111111111111111111",
  report: "222222222222222222",
  user: "333333333333333333",
  otherUser: "444444444444444444",
  vote: "555555555555555555",
};

function record(overrides = {}) {
  return {
    schemaVersion: 1,
    type: "vote",
    reportId: IDS.report,
    discordUserId: IDS.user,
    direction: "up",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function message(overrides = {}) {
  const voteRecord = overrides.record ?? record();
  return {
    id: IDS.vote,
    content: buildVoteMessageContent(voteRecord),
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "record"),
    ),
  };
}

function memoryDiscord(initial = []) {
  const messages = [...initial];
  const calls = [];
  let nextId = 600000000000000000n;
  return {
    calls,
    messages,
    async getChannelMessages(channelId, query) {
      calls.push({ method: "list", channelId, query });
      const start = query.before
        ? messages.findIndex((item) => item.id === query.before) + 1
        : 0;
      return messages.slice(start, start + Number(query.limit));
    },
    async createMessage(channelId, payload) {
      calls.push({ method: "create", channelId, payload });
      const created = {
        id: String(nextId++),
        content: payload.content,
      };
      messages.unshift(created);
      return created;
    },
  };
}

describe("vote record", () => {
  test("Discord 메시지에서 투표를 복원한다", () => {
    const vote = parseVoteMessage(message());
    assert.equal(vote.voteId, IDS.vote);
    assert.equal(vote.direction, "up");
  });

  test("공개 응답에서 투표자의 Discord ID를 제거한다", () => {
    const vote = toPublicVote(parseVoteMessage(message()));
    assert.equal(vote.reportId, IDS.report);
    assert.equal(vote.discordUserId, undefined);
  });
});

describe("createVoteRepository", () => {
  test("Discord 기록만으로 투표 인덱스와 점수를 복구한다", async () => {
    const invalid = [];
    const client = memoryDiscord([
      message(),
      message({ id: "666666666666666666" }),
      message({
        id: "777777777777777777",
        record: record({
          discordUserId: IDS.otherUser,
          direction: "down",
        }),
      }),
      { id: "888888888888888888", content: "broken" },
    ]);
    const repository = createVoteRepository({
      discordClient: client,
      channelId: IDS.channel,
      onInvalidRecord: (error) => invalid.push(error),
    });
    assert.deepEqual(await repository.summary(IDS.report), {
      up: 1,
      down: 1,
      score: 0,
    });
    assert.equal(invalid.length, 2);
  });

  test("한 사용자는 한 제보에 한 번만 투표한다", async () => {
    const repository = createVoteRepository({
      discordClient: memoryDiscord(),
      channelId: IDS.channel,
    });
    await repository.create(IDS.report, IDS.user, "up");
    await assert.rejects(
      () => repository.create(IDS.report, IDS.user, "down"),
      DuplicateVoteError,
    );
  });

  test("동시에 들어온 같은 논리 키 요청도 하나만 저장한다", async () => {
    const client = memoryDiscord();
    const repository = createVoteRepository({
      discordClient: client,
      channelId: IDS.channel,
    });
    const results = await Promise.allSettled([
      repository.create(IDS.report, IDS.user, "up"),
      repository.create(IDS.report, IDS.user, "down"),
    ]);
    assert.equal(
      results.filter((item) => item.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((item) => item.status === "rejected").length,
      1,
    );
    assert.equal(
      client.calls.filter((call) => call.method === "create").length,
      1,
    );
  });

  test("사용자별 투표 목록과 여러 제보 점수를 반환한다", async () => {
    const otherReport = "999999999999999999";
    const repository = createVoteRepository({
      discordClient: memoryDiscord([
        message(),
        message({
          id: "666666666666666666",
          record: record({ reportId: otherReport, direction: "down" }),
        }),
      ]),
      channelId: IDS.channel,
    });
    const summaries = await repository.summaries([IDS.report, otherReport]);
    assert.equal(summaries[IDS.report].score, 1);
    assert.equal(summaries[otherReport].score, -1);
    assert.equal((await repository.listByUser(IDS.user)).length, 2);
  });
});
