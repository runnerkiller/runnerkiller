export const NICK_RE = /^[가-힣ㄱ-ㅎa-zA-Z0-9 _.\-]{2,20}$/;

export const REPORT_CATEGORIES = Object.freeze({
  hack: [],
  abuse: ["대리", "부계정", "승부조작", "랭크 판매"],
  troll: ["고의 피딩", "잠수 / AFK", "아군 방해", "채팅 도배"],
});

export const REPORT_MODES = Object.freeze(["랭크", "전설 랭크"]);
export const MAX_DESCRIPTION_LENGTH = 800;
export const MAX_EVIDENCE_FILES = 3;
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

const PII_RULES = [
  { label: "전화번호", re: /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/ },
  { label: "주민등록번호", re: /\d{6}[-\s]?[1-4]\d{6}/ },
  { label: "이메일", re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  {
    label: "카카오톡 정보",
    re: /(open\.kakao|오픈\s?채팅|카톡\s?(아이디|id))/i,
  },
  { label: "SNS 계정", re: /(instagram\.com|facebook\.com|tiktok\.com)/i },
  { label: "실명 언급", re: /(본명|실명|진짜\s?이름)/ },
  {
    label: "신상 정보",
    re: /(사는\s?곳|거주지|다니는\s?(학교|회사)|재학\s?중|고등학교|중학교|직장)/,
  },
];

const DATA_URL_RE =
  /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/;
const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function hasExpectedSignature(data, contentType) {
  if (contentType === "image/jpeg") {
    return (
      data.length >= 3 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[2] === 0xff
    );
  }
  if (contentType === "image/png") {
    return (
      data.length >= 8 &&
      data
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  if (contentType === "image/webp") {
    return (
      data.length >= 12 &&
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

export class ReportValidationError extends Error {
  constructor(issues) {
    super("제보 입력값을 확인해 주세요.");
    this.name = "ReportValidationError";
    this.issues = issues;
  }
}

export function normalizeNickname(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function scanPii(text) {
  return PII_RULES.filter((rule) => rule.re.test(text ?? "")).map(
    (rule) => rule.label,
  );
}

function isValidDateOnly(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  if (parsed.toISOString().slice(0, 10) !== value) return false;
  return value <= today;
}

export function decodeEvidenceDataUrl(value, index) {
  if (typeof value !== "string") {
    throw new Error(`${index + 1}번째 증거 사진 형식이 올바르지 않습니다.`);
  }

  const match = value.match(DATA_URL_RE);
  if (!match) {
    throw new Error(
      `${index + 1}번째 증거는 JPEG, PNG, WebP 이미지여야 합니다.`,
    );
  }

  const contentType = match[1];
  const data = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (data.length === 0) {
    throw new Error(`${index + 1}번째 증거 사진이 비어 있습니다.`);
  }
  if (data.length > MAX_EVIDENCE_BYTES) {
    throw new Error(`${index + 1}번째 증거 사진은 5MB 이하여야 합니다.`);
  }
  if (!hasExpectedSignature(data, contentType)) {
    throw new Error(
      `${index + 1}번째 증거 사진의 실제 파일 형식이 일치하지 않습니다.`,
    );
  }

  return {
    data,
    contentType,
    filename: `evidence-${index + 1}.${EXTENSIONS[contentType]}`,
    description: `증거 사진 ${index + 1}`,
  };
}

export function validateReportSubmission(body, options = {}) {
  const issues = [];
  const input =
    body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const nickname = String(input.nickname ?? "").trim();
  const category = String(input.category ?? "");
  const mode = String(input.mode ?? "");
  const occurredAt = String(input.occurredAt ?? "");
  const description = String(input.description ?? "").trim();
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const allowedTags = REPORT_CATEGORIES[category] ?? [];
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.map((tag) => String(tag)).filter(Boolean))]
    : [];
  const today = new Date(options.now?.() ?? Date.now())
    .toISOString()
    .slice(0, 10);
  const flags = {
    evidenceUpload: true,
    evidenceRequired: false,
    ...(options.flags ?? {}),
  };

  if (!NICK_RE.test(nickname)) {
    issues.push({
      field: "nickname",
      message: "닉네임은 2~20자로 입력해 주세요.",
    });
  }
  if (!Object.hasOwn(REPORT_CATEGORIES, category)) {
    issues.push({
      field: "category",
      message: "지원하지 않는 제보 분류입니다.",
    });
  }
  const invalidTags = tags.filter((tag) => !allowedTags.includes(tag));
  if (invalidTags.length > 0) {
    issues.push({
      field: "tags",
      message: `허용되지 않은 태그: ${invalidTags.join(", ")}`,
    });
  }
  if (!REPORT_MODES.includes(mode)) {
    issues.push({ field: "mode", message: "지원하지 않는 게임 모드입니다." });
  }
  if (!isValidDateOnly(occurredAt, today)) {
    issues.push({
      field: "occurredAt",
      message: "발생 날짜가 올바르지 않거나 미래입니다.",
    });
  }
  if (description.length < 15 || description.length > MAX_DESCRIPTION_LENGTH) {
    issues.push({
      field: "description",
      message: `상황 설명은 15~${MAX_DESCRIPTION_LENGTH}자로 입력해 주세요.`,
    });
  }
  if (description.includes("```")) {
    issues.push({
      field: "description",
      message: "상황 설명에 연속된 백틱 3개를 사용할 수 없습니다.",
    });
  }
  const pii = scanPii(description);
  if (pii.length > 0) {
    issues.push({
      field: "description",
      message: `개인정보 의심 항목: ${pii.join(", ")}`,
    });
  }
  if (!flags.evidenceUpload && evidence.length > 0) {
    issues.push({
      field: "evidence",
      message: "현재 증거 사진 첨부 기능이 꺼져 있습니다.",
    });
  }
  if (flags.evidenceRequired && evidence.length === 0) {
    issues.push({
      field: "evidence",
      message: "증거 사진을 한 장 이상 첨부해 주세요.",
    });
  }
  if (evidence.length > MAX_EVIDENCE_FILES) {
    issues.push({
      field: "evidence",
      message: "증거 사진은 최대 3장까지 첨부할 수 있습니다.",
    });
  }

  const evidenceFiles = [];
  if (flags.evidenceUpload && evidence.length <= MAX_EVIDENCE_FILES) {
    for (let index = 0; index < evidence.length; index += 1) {
      try {
        evidenceFiles.push(decodeEvidenceDataUrl(evidence[index], index));
      } catch (error) {
        issues.push({ field: "evidence", message: error.message });
      }
    }
  }

  if (issues.length > 0) throw new ReportValidationError(issues);

  return {
    report: {
      nickname,
      nicknameNormalized: normalizeNickname(nickname),
      category,
      tags,
      mode,
      occurredAt,
      description,
      revealReporter: Boolean(input.revealReporter),
    },
    evidenceFiles,
  };
}
