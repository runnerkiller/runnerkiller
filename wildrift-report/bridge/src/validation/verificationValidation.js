import { NICK_RE, decodeEvidenceDataUrl } from "./reportValidation.js";

export class VerificationValidationError extends Error {
  constructor(issues) {
    super("게임 계정 인증 입력값을 확인해 주세요.");
    this.name = "VerificationValidationError";
    this.issues = issues;
  }
}

export function validateVerificationSubmission(body) {
  const input =
    body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const gameNickname = String(input.gameNickname ?? "").trim();
  const issues = [];
  let evidenceFile = null;

  if (!NICK_RE.test(gameNickname)) {
    issues.push({
      field: "gameNickname",
      message: "게임 닉네임은 2~20자로 입력해 주세요.",
    });
  }
  if (!input.evidence) {
    issues.push({
      field: "evidence",
      message: "닉네임이 보이는 게임 프로필 사진을 첨부해 주세요.",
    });
  } else {
    try {
      const decoded = decodeEvidenceDataUrl(input.evidence, 0);
      evidenceFile = {
        ...decoded,
        filename: decoded.filename.replace("evidence-1", "verification"),
        description: "게임 계정 인증 사진",
      };
    } catch (error) {
      issues.push({ field: "evidence", message: error.message });
    }
  }

  if (issues.length > 0) throw new VerificationValidationError(issues);
  return { gameNickname, evidenceFile };
}
