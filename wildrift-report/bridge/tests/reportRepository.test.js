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
    assert.throws(() => parseReportMessage({ id: IDS.report, content: "not json" }), /JSON/);
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
      discordMessage(approvedRecord({ nickname: "다른유저", nicknameNormalized: "다른유저", category: "hack", tags: [] }), { id: "666666666666666666" }),
    ];
    const repository = createReportRepository({
      discordClient: { async getChannelMessages() { return messages; } },
      pendingChannelId: IDS.pending,
      approvedChannelId: IDS.approved,
    });
    const result = await repository.listApproved({ query: "협곡", category: "troll" });
    assert.equal(result.reports.length, 1);
    assert.equal(result.reports[0].nickname, "협곡의파괴자");
  });

  test("손상된 메시지는 전체 목록을 망가뜨리지 않는다", async () => {
    const invalid = [];
    const repository = createReportRepository({
      discordClient: {
        async getChannelMessages() {
          return [{ id: "777777777777777777", content: "broken" }, discordMessage(approvedRecord())];
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
});
