import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { DiscordApiError } from "../src/discordClient.js";
import {
  ReportNotFoundError,
  buildReportMessageContent,
  createReportRepository,
  parseReportMessage,
} from "../src/repositories/reportRepository.js";

const IDS = {
  pending: "111111111111111111",
  approved: "222222222222222222",
  report: "333333333333333333",
  reporter: "444444444444444444",
};

function input(overrides = {}) {
  return {
    nickname: "협곡의파괴자",
    nicknameNormalized: "협곡의파괴자",
    category: "troll",
    tags: ["고의 피딩"],
    mode: "랭크",
    occurredAt: "2026-08-01",
    description: "한타 직전에 반복적으로 적진으로 들어가 사망했습니다.",
    reporterDiscordId: IDS.reporter,
    revealReporter: false,
    ...overrides,
  };
}

function discordMessage(record, overrides = {}) {
  return {
    id: IDS.report,
    content: buildReportMessageContent(record),
    attachments: [],
    ...overrides,
  };
}

function approvedRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    type: "report",
    ...input(),
    status: "approved",
    evidenceCount: 0,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    reviewedByDiscordId: "555555555555555555",
    reviewedAt: "2026-08-01T13:00:00.000Z",
    ...overrides,
  };
}

describe("report message record", () => {
  test("Discord 메시지에서 제보를 복원하고 메시지 ID를 reportId로 쓴다", () => {
    const report = parseReportMessage(discordMessage(approvedRecord()));
    assert.equal(report.reportId, IDS.report);
    assert.equal(report.status, "approved");
  });

  test("첨부파일 메타데이터를 최신 메시지에서 읽는다", () => {
    const report = parseReportMessage(
      discordMessage(approvedRecord(), {
        attachments: [
          {
            id: "9",
            filename: "evidence.jpg",
            content_type: "image/jpeg",
            size: 12,
            url: "https://cdn.discordapp.com/example",
            proxy_url: "https://media.discordapp.net/example",
          },
        ],
      }),
    );
    assert.equal(report.evidenceCount, 1);
    assert.equal(report.evidence[0].contentType, "image/jpeg");
  });

  test("깨진 메시지는 파싱 오류가 난다", () => {
    assert.throws(
      () => parseReportMessage({ id: IDS.report, content: "not json" }),
      /JSON/,
    );
  });
});

describe("createReportRepository", () => {
  test("새 제보를 pending 채널에 저장하고 내부 Discord ID는 숨긴다", async () => {
    const calls = [];
    const client = {
      async createMessage(channelId, payload, files) {
        calls.push({ channelId, payload, files });
        return { id: IDS.report, content: payload.content, attachments: [] };
      },
    };
    const repository = createReportRepository({
      discordClient: client,
      pendingChannelId: IDS.pending,
      approvedChannelId: IDS.approved,
      now: () => Date.parse("2026-08-01T12:00:00.000Z"),
    });

    const report = await repository.create(input(), []);
    assert.equal(calls[0].channelId, IDS.pending);
    assert.equal(report.status, "pending");
    assert.equal(report.reportId, IDS.report);
    assert.equal(report.reporterDiscordId, undefined);
  });

  test("승인 채널 목록에서 검색과 분류를 적용한다", async () => {
    const messages = [
      discordMessage(approvedRecord()),
      discordMessage(
        approvedRecord({
          nickname: "다른유저",
          nicknameNormalized: "다른유저",
          category: "hack",
          tags: [],
        }),
        { id: "666666666666666666" },
      ),
    ];
    const repository = createReportRepository({
      discordClient: {
        async getChannelMessages() {
          return messages;
        },
      },
      pendingChannelId: IDS.pending,
      approvedChannelId: IDS.approved,
    });
    const result = await repository.listApproved({
      query: "협곡",
      category: "troll",
    });
    assert.equal(result.reports.length, 1);
    assert.equal(result.reports[0].nickname, "협곡의파괴자");
  });

  test("손상된 메시지는 전체 목록을 망가뜨리지 않는다", async () => {
    const invalid = [];
    const repository = createReportRepository({
      discordClient: {
        async getChannelMessages() {
          return [
            { id: "777777777777777777", content: "broken" },
            discordMessage(approvedRecord()),
          ];
        },
      },
      pendingChannelId: IDS.pending,
      approvedChannelId: IDS.approved,
      onInvalidRecord: (error) => invalid.push(error),
    });
    const result = await repository.listApproved();
    assert.equal(result.reports.length, 1);
    assert.equal(invalid.length, 1);
  });

  test("Discord 404를 공개용 not found로 바꾼다", async () => {
    const repository = createReportRepository({
      discordClient: {
        async getMessage() {
          throw new DiscordApiError("missing", { status: 404 });
        },
      },
      pendingChannelId: IDS.pending,
      approvedChannelId: IDS.approved,
    });
    await assert.rejects(
      () => repository.getApprovedById(IDS.report),
      (error) => error instanceof ReportNotFoundError,
    );
  });

  test("대기 제보 목록은 관리자용 내부 제출자 ID를 유지한다", async () => {
    const pending = approvedRecord({
      status: "pending",
      reviewedByDiscordId: null,
      reviewedAt: null,
    });
    const repository = createReportRepository({
      discordClient: {
        async getChannelMessages() {
          return [discordMessage(pending)];
        },
      },
      pendingChannelId: IDS.pending,
      approvedChannelId: IDS.approved,
    });
    const result = await repository.listPending();
    assert.equal(result.reports[0].reporterDiscordId, IDS.reporter);
  });

  test("승인 시 사진과 레코드를 승인 채널로 복제하고 감사 로그를 남긴다", async () => {
    const sourceRecord = approvedRecord({
      status: "pending",
      reviewedByDiscordId: null,
      reviewedAt: null,
      evidenceCount: 1,
    });
    const sourceMessage = discordMessage(sourceRecord, {
      attachments: [
        {
          id: "8",
          filename: "evidence.jpg",
          content_type: "image/jpeg",
          description: "증거",
          url: "https://cdn.discordapp.com/evidence",
        },
      ],
    });
    const calls = [];
    const audits = [];
    const client = {
      async getChannelMessages() {
        return [];
      },
      async getMessage() {
        return sourceMessage;
      },
      async createMessage(channelId, payload, files) {
        calls.push({ channelId, payload, files });
        return {
          id: "888888888888888888",
          content: payload.content,
          attachments: [
            {
              id: "10",
              filename: "evidence.jpg",
              content_type: "image/jpeg",
              url: "https://cdn.discordapp.com/copied",
            },
          ],
        };
      },
      async deleteMessage(channelId, messageId) {
        calls.push({ delete: true, channelId, messageId });
      },
    };
    const repository = createReportRepository({
      discordClient: client,
      pendingChannelId: IDS.pending,
      approvedChannelId: IDS.approved,
      rejectedChannelId: "777777777777777777",
      auditRepository: {
        async create(event) {
          audits.push(event);
        },
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from([0xff, 0xd8, 0xff]);
        },
      }),
      now: () => Date.parse("2026-08-01T14:00:00.000Z"),
    });
    const result = await repository.decide(
      IDS.report,
      "approved",
      "555555555555555555",
    );
    assert.equal(calls[0].channelId, IDS.approved);
    assert.equal(calls[0].files.length, 1);
    assert.equal(calls[1].delete, true);
    assert.equal(audits[0].action, "report.approved");
    assert.equal(result.report.status, "approved");
    assert.equal(result.report.reporterDiscordId, undefined);
    assert.equal(result.cleanupPending, false);
  });

  test("반려 시 반려 채널을 사용하고 대기 메시지 삭제 실패를 표시한다", async () => {
    const source = discordMessage(
      approvedRecord({
        status: "pending",
        reviewedByDiscordId: null,
        reviewedAt: null,
      }),
    );
    const invalid = [];
    const repository = createReportRepository({
      discordClient: {
        async getChannelMessages() {
          return [];
        },
        async getMessage() {
          return source;
        },
        async createMessage(channelId, payload) {
          return {
            id: "888888888888888888",
            content: payload.content,
            attachments: [],
          };
        },
        async deleteMessage() {
          throw new Error("delete failed");
        },
      },
      pendingChannelId: IDS.pending,
      approvedChannelId: IDS.approved,
      rejectedChannelId: "777777777777777777",
      auditRepository: { async create() {} },
      onInvalidRecord: (error) => invalid.push(error),
    });
    const result = await repository.decide(
      IDS.report,
      "rejected",
      "555555555555555555",
    );
    assert.equal(result.report.status, "rejected");
    assert.equal(result.cleanupPending, true);
    assert.equal(invalid.length, 1);
  });

  test("재시도 시 이미 복제된 판정을 재사용해 중복 생성을 막는다", async () => {
    const existing = discordMessage(
      approvedRecord({ originReportId: IDS.report }),
      { id: "888888888888888888" },
    );
    let createCalls = 0;
    let deleteCalls = 0;
    const audits = [];
    const repository = createReportRepository({
      discordClient: {
        async getChannelMessages() {
          return [existing];
        },
        async createMessage() {
          createCalls += 1;
        },
        async deleteMessage() {
          deleteCalls += 1;
        },
      },
      pendingChannelId: IDS.pending,
      approvedChannelId: IDS.approved,
      rejectedChannelId: "777777777777777777",
      auditRepository: {
        async create(event) {
          audits.push(event);
        },
      },
    });
    const result = await repository.decide(
      IDS.report,
      "approved",
      "555555555555555555",
    );
    assert.equal(result.recovered, true);
    assert.equal(createCalls, 0);
    assert.equal(deleteCalls, 1);
    assert.equal(audits[0].action, "report.approved.recovered");
  });
});
