import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ReportValidationError,
  validateReportSubmission,
} from "../src/validation/reportValidation.js";

const NOW = () => Date.parse("2026-08-01T12:00:00.000Z");
const tinyJpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]).toString("base64")}`;

function valid(overrides = {}) {
  return {
    nickname: "협곡의파괴자",
    category: "troll",
    tags: ["고의 피딩"],
    mode: "랭크",
    occurredAt: "2026-08-01",
    description: "한타 직전에 반복적으로 적진으로 들어가 사망했습니다.",
    evidence: [],
    ...overrides,
  };
}

function issuesFor(body, options = {}) {
  try {
    validateReportSubmission(body, { now: NOW, ...options });
    return [];
  } catch (error) {
    assert.ok(error instanceof ReportValidationError);
    return error.issues;
  }
}

describe("validateReportSubmission", () => {
  test("정상 입력을 정규화한다", () => {
    const result = validateReportSubmission(
      valid({ nickname: "  협곡의파괴자  ", tags: ["고의 피딩", "고의 피딩"] }),
      { now: NOW },
    );
    assert.equal(result.report.nickname, "협곡의파괴자");
    assert.equal(result.report.nicknameNormalized, "협곡의파괴자");
    assert.deepEqual(result.report.tags, ["고의 피딩"]);
  });

  test("분류에 없는 태그를 거부한다", () => {
    const issues = issuesFor(valid({ category: "hack", tags: ["고의 피딩"] }));
    assert.ok(issues.some((issue) => issue.field === "tags"));
  });

  test("미래 날짜와 실제로 없는 날짜를 거부한다", () => {
    assert.ok(issuesFor(valid({ occurredAt: "2026-08-02" })).length > 0);
    assert.ok(issuesFor(valid({ occurredAt: "2026-02-30" })).length > 0);
  });

  test("설명이 너무 짧거나 길면 거부한다", () => {
    assert.ok(issuesFor(valid({ description: "짧음" })).length > 0);
    assert.ok(issuesFor(valid({ description: "가".repeat(801) })).length > 0);
  });

  test("개인정보 의심 내용을 거부한다", () => {
    const issues = issuesFor(
      valid({ description: "상황 설명입니다. 연락은 test@example.com 으로 주세요." }),
    );
    assert.match(issues.find((issue) => issue.field === "description").message, /이메일/);
  });

  test("증거 필수 설정을 적용한다", () => {
    const issues = issuesFor(valid(), {
      flags: { evidenceUpload: true, evidenceRequired: true },
    });
    assert.ok(issues.some((issue) => issue.field === "evidence"));
  });

  test("첨부 기능이 꺼졌는데 사진이 있으면 거부한다", () => {
    const issues = issuesFor(valid({ evidence: [tinyJpeg] }), {
      flags: { evidenceUpload: false, evidenceRequired: false },
    });
    assert.ok(issues.some((issue) => issue.field === "evidence"));
  });

  test("최대 3장까지만 받는다", () => {
    const issues = issuesFor(valid({ evidence: [tinyJpeg, tinyJpeg, tinyJpeg, tinyJpeg] }));
    assert.ok(issues.some((issue) => /최대 3장/.test(issue.message)));
  });

  test("이미지 data URL을 Discord 첨부파일로 변환한다", () => {
    const result = validateReportSubmission(valid({ evidence: [tinyJpeg] }), { now: NOW });
    assert.equal(result.evidenceFiles.length, 1);
    assert.equal(result.evidenceFiles[0].contentType, "image/jpeg");
    assert.equal(result.evidenceFiles[0].filename, "evidence-1.jpg");
    assert.ok(Buffer.isBuffer(result.evidenceFiles[0].data));
  });

  test("이미지가 아닌 data URL을 거부한다", () => {
    const text = `data:text/plain;base64,${Buffer.from("hello").toString("base64")}`;
    const issues = issuesFor(valid({ evidence: [text] }));
    assert.ok(issues.some((issue) => /JPEG/.test(issue.message)));
  });

  test("MIME만 이미지로 속이고 실제 내용이 다르면 거부한다", () => {
    const fake = `data:image/jpeg;base64,${Buffer.from("not-a-jpeg").toString("base64")}`;
    const issues = issuesFor(valid({ evidence: [fake] }));
    assert.ok(issues.some((issue) => /실제 파일 형식/.test(issue.message)));
  });
});
