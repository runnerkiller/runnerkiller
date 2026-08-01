import { DiscordApiError } from "../discordClient.js";

export const REPORT_SCHEMA_VERSION = 1;

export class ReportNotFoundError extends Error {
  constructor(reportId) {
    super("제보를 찾을 수 없습니다.");
    this.name = "ReportNotFoundError";
    this.reportId = reportId;
  }
}

export class ReportRecordError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ReportRecordError";
    this.messageId = details.messageId ?? null;
    this.cause = details.cause ?? null;
  }
}

function extractJsonBlock(content) {
  if (typeof content !== "string") return null;
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

export function buildReportMessageContent(record) {
  const summary = `제보 | ${record.nickname} | ${record.category} | ${record.occurredAt}`;
  const content = `${summary}\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\``;
  if (content.length > 2_000) {
    throw new ReportRecordError("Discord 메시지 길이 제한을 초과했습니다.");
  }
  return content;
}

export function parseReportMessage(message, options = {}) {
  const raw = extractJsonBlock(message?.content);
  if (!raw) {
    throw new ReportRecordError("제보 메시지에서 JSON을 찾지 못했습니다.", {
      messageId: message?.id,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ReportRecordError("제보 메시지의 JSON 형식이 잘못되었습니다.", {
      messageId: message?.id,
      cause,
    });
  }

  if (!parsed || parsed.type !== "report" || parsed.schemaVersion !== 1) {
    throw new ReportRecordError("지원하지 않는 제보 레코드입니다.", {
      messageId: message?.id,
    });
  }
  if (options.expectedStatus && parsed.status !== options.expectedStatus) {
    throw new ReportRecordError("제보 상태와 저장 채널이 일치하지 않습니다.", {
      messageId: message?.id,
    });
  }

  return {
    ...parsed,
    reportId: message.id,
    evidenceCount: Array.isArray(message.attachments)
      ? message.attachments.length
      : Number(parsed.evidenceCount ?? 0),
    evidence: (message.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.content_type ?? null,
      size: attachment.size ?? null,
      url: attachment.url,
      proxyUrl: attachment.proxy_url ?? null,
    })),
  };
}

export function toPublicReport(report) {
  const {
    reporterDiscordId,
    reviewedByDiscordId,
    originReportId,
    ...publicReport
  } = report;
  return publicReport;
}

export function createReportRepository({
  discordClient,
  pendingChannelId,
  approvedChannelId,
  now = () => Date.now(),
  onInvalidRecord = () => {},
}) {
  if (!discordClient) throw new Error("discordClient가 필요합니다.");
  if (!pendingChannelId) throw new Error("DISCORD_REPORTS_PENDING_CHANNEL_ID가 필요합니다.");
  if (!approvedChannelId) throw new Error("DISCORD_REPORTS_APPROVED_CHANNEL_ID가 필요합니다.");

  async function create(input, evidenceFiles = []) {
    const timestamp = new Date(now()).toISOString();
    const record = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      type: "report",
      nickname: input.nickname,
      nicknameNormalized: input.nicknameNormalized,
      category: input.category,
      tags: input.tags,
      mode: input.mode,
      occurredAt: input.occurredAt,
      description: input.description,
      status: "pending",
      reporterDiscordId: input.reporterDiscordId,
      revealReporter: Boolean(input.revealReporter),
      evidenceCount: evidenceFiles.length,
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewedByDiscordId: null,
      reviewedAt: null,
    };

    const message = await discordClient.createMessage(
      pendingChannelId,
      { content: buildReportMessageContent(record) },
      evidenceFiles,
    );
    return toPublicReport(parseReportMessage(message));
  }

  async function listApproved(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
    const messages = await discordClient.getChannelMessages(approvedChannelId, {
      limit,
      before: options.before ?? undefined,
    });
    const reports = [];

    for (const message of messages) {
      try {
        const report = parseReportMessage(message, { expectedStatus: "approved" });
        if (options.category && report.category !== options.category) continue;
        if (
          options.query &&
          !report.nicknameNormalized.includes(String(options.query).trim().toLowerCase())
        ) {
          continue;
        }
        reports.push(toPublicReport(report));
      } catch (error) {
        onInvalidRecord(error, message);
      }
    }

    return {
      reports,
      nextCursor:
        messages.length === limit ? messages[messages.length - 1]?.id ?? null : null,
    };
  }

  async function getApprovedById(reportId) {
    try {
      const message = await discordClient.getMessage(approvedChannelId, reportId);
      return toPublicReport(
        parseReportMessage(message, { expectedStatus: "approved" }),
      );
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) {
        throw new ReportNotFoundError(reportId);
      }
      if (error instanceof ReportRecordError) {
        throw new ReportNotFoundError(reportId);
      }
      throw error;
    }
  }

  return { create, listApproved, getApprovedById };
}
