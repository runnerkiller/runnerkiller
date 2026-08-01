import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  VerificationValidationError,
  validateVerificationSubmission,
} from "../src/validation/verificationValidation.js";

const tinyJpeg = `data:image/jpeg;base64,${Buffer.from([
  0xff, 0xd8, 0xff, 0xdb, 0x00,
]).toString("base64")}`;

describe("validateVerificationSubmission", () => {
  test("닉네임과 인증 사진을 Discord 첨부 형식으로 바꾼다", () => {
    const result = validateVerificationSubmission({
      gameNickname: " 협곡의파괴자 ",
      evidence: tinyJpeg,
    });
    assert.equal(result.gameNickname, "협곡의파괴자");
    assert.equal(result.evidenceFile.filename, "verification.jpg");
    assert.equal(result.evidenceFile.contentType, "image/jpeg");
  });

  test("닉네임과 사진이 없으면 필드별 오류를 반환한다", () => {
    assert.throws(
      () => validateVerificationSubmission({}),
      (error) =>
        error instanceof VerificationValidationError &&
        error.issues.some((issue) => issue.field === "gameNickname") &&
        error.issues.some((issue) => issue.field === "evidence"),
    );
  });

  test("이미지 MIME과 실제 형식이 다르면 거부한다", () => {
    const fake = `data:image/png;base64,${Buffer.from("not-png").toString("base64")}`;
    assert.throws(
      () =>
        validateVerificationSubmission({
          gameNickname: "협곡의파괴자",
          evidence: fake,
        }),
      VerificationValidationError,
    );
  });
});
