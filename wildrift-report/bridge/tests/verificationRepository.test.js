import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  VerificationConflictError,
  VerificationNotFoundError,
  buildVerificationMessageContent,
  createVerificationRepository,
  parseVerificationMessage,
  toOwnVerification,
} from "../src/repositories/verificationRepository.js";

const IDS = {
  channel: "111111111111111111",
  user: "222222222222222222",
  verification: "333333333333333333",
  admin: "444444444444444444",
};

function record(overrides = {}) {
  return {
    schemaVersion: 1,
    type: "verification",
    discordUserId: IDS.user,
    gameNickname: "협곡의파괴자",
    status: "pending",
    reviewedByDiscordId: null,
    reviewedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function message(overrides = {}) {
  const verificationRecord = overrides.record ?? record();
  return {
    id: IDS.verification,
    content: buildVerificationMessageContent(verificationRecord),
    attachments: [
      {
        id: "555555555555555555",
        filename: "verification.jpg",
        content_type: "image/jpeg",
        size: 12,
        url: "https://cdn.discordapp.com/verification.jpg",
      },
    ],
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "record"),
    ),
  };
}

function fixtures(initial = []) {
  const messages = [...initial];
  const discordCalls = [];
  const userCalls = [];
  const auditCalls = [];
  const discordClient = {
    async getChannelMessages(channelId, query) {
      discordCalls.push({ method: "list", channelId, query });
      return messages.slice(0, Number(query.limit));
    },
    async getMessage(channelId, verificationId) {
      discordCalls.push({ method: "get", channelId, verificationId });
      const found = messages.find((item) => item.id === verificationId);
      if (!found) throw Object.assign(new Error("missing"), { status: 404 });
      return found;
    },
    async createMessage(channelId, payload, files) {
      discordCalls.push({ method: "create", channelId, payload, files });
      const created = message({ content: payload.content });
      messages.unshift(created);
      return created;
    },
    async editMessage(channelId, verificationId, payload) {
      discordCalls.push({ method: "edit", channelId, verificationId, payload });
      const index = messages.findIndex((item) => item.id === verificationId);
      messages[index] = { ...messages[index], content: payload.content };
      return messages[index];
    },
  };
  const userRepository = {
    async setVerificationPending(input) {
      userCalls.push({ method: "pending", input });
      return input;
    },
    async setVerificationStatus(discordUserId, status, gameNickname) {
      userCalls.push({
        method: "status",
        discordUserId,
        status,
        gameNickname,
      });
      return { discordUserId, verificationStatus: status, gameNickname };
    },
  };
  const auditRepository = {
    async create(event) {
      auditCalls.push(event);
      return event;
    },
  };
  const repository = createVerificationRepository({
    discordClient,
    channelId: IDS.channel,
    userRepository,
    auditRepository,
    now: () => Date.parse("2026-08-01T01:00:00.000Z"),
  });
  return { repository, messages, discordCalls, userCalls, auditCalls };
}

describe("verification record", () => {
  test("Discord 메시지와 첨부파일을 인증 레코드로 복원한다", () => {
    const verification = parseVerificationMessage(message());
    assert.equal(verification.verificationId, IDS.verification);
    assert.equal(verification.evidence.length, 1);
  });

  test("본인용 응답에서 Discord 사용자 ID와 사진 URL을 숨긴다", () => {
    const own = toOwnVerification(parseVerificationMessage(message()));
    assert.equal(own.evidenceCount, 1);
    assert.equal(own.discordUserId, undefined);
    assert.equal(own.evidence, undefined);
  });
});

describe("createVerificationRepository", () => {
  test("새 인증 요청과 사진을 저장하고 사용자 상태를 pending으로 만든다", async () => {
    const state = fixtures();
    const result = await state.repository.create(
      {
        discordUserId: IDS.user,
        discordUsernameSnapshot: "tester",
        gameNickname: "협곡의파괴자",
      },
      { data: Buffer.from("image"), filename: "verification.jpg" },
    );
    assert.equal(result.recovered, false);
    assert.equal(state.discordCalls.at(-1).method, "create");
    assert.equal(state.userCalls.at(-1).method, "pending");
  });

  test("같은 사용자의 기존 대기 요청은 재사용해 중복 생성을 막는다", async () => {
    const state = fixtures([message()]);
    const result = await state.repository.create(
      {
        discordUserId: IDS.user,
        discordUsernameSnapshot: "tester",
        gameNickname: "다른닉네임",
      },
      { data: Buffer.from("image"), filename: "verification.jpg" },
    );
    assert.equal(result.recovered, true);
    assert.equal(
      state.discordCalls.some((call) => call.method === "create"),
      false,
    );
    assert.equal(state.userCalls.at(-1).input.gameNickname, "협곡의파괴자");
  });

  test("첫 100건보다 오래된 대기 요청도 다음 페이지에서 찾아 재사용한다", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      message({
        id: String(600000000000000000n + BigInt(index)),
        record: record({
          discordUserId: String(700000000000000000n + BigInt(index)),
          status: "rejected",
        }),
      }),
    );
    const existing = message();
    const calls = [];
    const userCalls = [];
    const repository = createVerificationRepository({
      discordClient: {
        async getChannelMessages(_channelId, query) {
          calls.push(query);
          return query.before ? [existing] : firstPage;
        },
        async createMessage() {
          throw new Error("중복 메시지를 만들면 안 됩니다.");
        },
      },
      channelId: IDS.channel,
      userRepository: {
        async setVerificationPending(input) {
          userCalls.push(input);
        },
      },
      auditRepository: { async create() {} },
      maxScanPages: 2,
    });
    const result = await repository.create(
      {
        discordUserId: IDS.user,
        discordUsernameSnapshot: "tester",
        gameNickname: "협곡의파괴자",
      },
      { data: Buffer.from("image"), filename: "verification.jpg" },
    );
    assert.equal(result.recovered, true);
    assert.equal(calls.length, 2);
    assert.equal(userCalls.length, 1);
  });

  test("승인 판정은 인증 메시지·사용자 상태·감사 로그를 갱신한다", async () => {
    const state = fixtures([message()]);
    const result = await state.repository.decide(
      IDS.verification,
      "approved",
      IDS.admin,
    );
    assert.equal(result.verification.status, "approved");
    assert.equal(result.recovered, false);
    assert.equal(state.userCalls.at(-1).status, "approved");
    assert.equal(state.auditCalls.at(-1).action, "verification.approved");
  });

  test("판정 후 재시도는 사용자 상태와 감사 로그를 복구한다", async () => {
    const state = fixtures([
      message({
        record: record({
          status: "approved",
          reviewedByDiscordId: IDS.admin,
          reviewedAt: "2026-08-01T01:00:00.000Z",
        }),
      }),
    ]);
    const result = await state.repository.decide(
      IDS.verification,
      "approved",
      IDS.admin,
    );
    assert.equal(result.recovered, true);
    assert.equal(
      state.discordCalls.some((call) => call.method === "edit"),
      false,
    );
    assert.equal(
      state.auditCalls.at(-1).action,
      "verification.approved.recovered",
    );
  });

  test("이미 반려된 요청을 승인으로 뒤집지 않는다", async () => {
    const state = fixtures([
      message({ record: record({ status: "rejected" }) }),
    ]);
    await assert.rejects(
      () => state.repository.decide(IDS.verification, "approved", IDS.admin),
      VerificationConflictError,
    );
  });

  test("없는 인증 요청은 공개용 not found 오류로 바꾼다", async () => {
    const state = fixtures();
    await assert.rejects(
      () => state.repository.getById(IDS.verification),
      VerificationNotFoundError,
    );
  });
});
