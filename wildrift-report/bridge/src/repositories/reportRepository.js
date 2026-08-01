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
  rejectedChannelId = null,
  auditRepository = null,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  onInvalidRecord = () => {},
}) {
  if (!discordClient) throw new Error("discordClient가 필요합니다.");
  if (!pendingChannelId)
    throw new Error("DISCORD_REPORTS_PENDING_CHANNEL_ID가 필요합니다.");
  if (!approvedChannelId)
    throw new Error("DISCORD_REPORTS_APPROVED_CHANNEL_ID가 필요합니다.");

  async function downloadAttachments(attachments = []) {
    const files = [];
    for (const attachment of attachments) {
      let response;
      try {
        response = await fetchImpl(attachment.url);
      } catch (cause) {
        const error = new Error("Discord 증거 사진을 복제하지 못했습니다.");
        error.cause = cause;
        throw error;
      }
      if (!response.ok) {
        throw new Error(`Discord 증거 사진 다운로드 실패 (${response.status})`);
      }
      const data = Buffer.from(await response.arrayBuffer());
      files.push({
        data,
        filename: attachment.filename,
        contentType: attachment.content_type ?? "application/octet-stream",
        description: attachment.description ?? "증거 사진",
      });
    }
    return files;
  }

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
        const report = parseReportMessage(message, {
          expectedStatus: "approved",
        });
        if (options.category && report.category !== options.category) continue;
        if (
          options.query &&
          !report.nicknameNormalized.includes(
            String(options.query).trim().toLowerCase(),
          )
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
        messages.length === limit
          ? (messages[messages.length - 1]?.id ?? null)
          : null,
    };
  }

  async function listPending(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
    const messages = await discordClient.getChannelMessages(pendingChannelId, {
      limit,
      before: options.before ?? undefined,
    });
    const reports = [];
    for (const message of messages) {
      try {
        reports.push(
          parseReportMessage(message, { expectedStatus: "pending" }),
        );
      } catch (error) {
        onInvalidRecord(error, message);
      }
    }
    return {
      reports,
      nextCursor:
        messages.length === limit
          ? (messages[messages.length - 1]?.id ?? null)
          : null,
    };
  }

  async function getApprovedById(reportId) {
    try {
      const message = await discordClient.getMessage(
        approvedChannelId,
        reportId,
      );
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

  async function decide(reportId, status, adminDiscordId) {
    if (!["approved", "rejected"].includes(status)) {
      throw new Error("승인 또는 반려 상태만 처리할 수 있습니다.");
    }
    const targetChannelId =
      status === "approved" ? approvedChannelId : rejectedChannelId;
    if (!targetChannelId) {
      throw new Error(
        status === "approved"
          ? "승인 제보 채널이 설정되지 않았습니다."
          : "반려 제보 채널이 설정되지 않았습니다.",
      );
    }
    if (!auditRepository) {
      throw new Error("감사 로그 저장소가 설정되지 않았습니다.");
    }

    const recentDestinationMessages = await discordClient.getChannelMessages(
      targetChannelId,
      { limit: 100 },
    );
    let existingDecision = null;
    for (const message of recentDestinationMessages) {
      try {
        const candidate = parseReportMessage(message, {
          expectedStatus: status,
        });
        if (candidate.originReportId === reportId) {
          existingDecision = { message, report: candidate };
          break;
        }
      } catch (error) {
        onInvalidRecord(error, message);
      }
    }

    if (existingDecision) {
      await auditRepository.create({
        action: `report.${status}.recovered`,
        targetId: reportId,
        actorDiscordId: adminDiscordId,
        before: { status: "pending" },
        after: { status, reportId: existingDecision.message.id },
        metadata: { reason: "existing_destination_record" },
      });
      let cleanupPending = false;
      try {
        await discordClient.deleteMessage(pendingChannelId, reportId);
      } catch (error) {
        if (!(error instanceof DiscordApiError && error.status === 404)) {
          cleanupPending = true;
          onInvalidRecord(error, existingDecision.message);
        }
      }
      return {
        report:
          status === "approved"
            ? toPublicReport(existingDecision.report)
            : existingDecision.report,
        cleanupPending,
        recovered: true,
      };
    }

    let sourceMessage;
    try {
      sourceMessage = await discordClient.getMessage(
        pendingChannelId,
        reportId,
      );
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) {
        throw new ReportNotFoundError(reportId);
      }
      throw error;
    }
    const source = parseReportMessage(sourceMessage, {
      expectedStatus: "pending",
    });
    const files = await downloadAttachments(sourceMessage.attachments ?? []);
    const timestamp = new Date(now()).toISOString();
    const destinationRecord = {
      ...source,
      reportId: undefined,
      evidence: undefined,
      status,
      originReportId: reportId,
      updatedAt: timestamp,
      reviewedByDiscordId: adminDiscordId,
      reviewedAt: timestamp,
    };
    const storedRecord = Object.fromEntries(
      Object.entries(destinationRecord).filter(
        ([, value]) => value !== undefined,
      ),
    );
    const destinationMessage = await discordClient.createMessage(
      targetChannelId,
      { content: buildReportMessageContent(storedRecord) },
      files,
    );

    await auditRepository.create({
      action: `report.${status}`,
      targetId: reportId,
      actorDiscordId: adminDiscordId,
      before: { status: "pending" },
      after: { status, reportId: destinationMessage.id },
      metadata: { destinationChannelId: targetChannelId },
    });

    let cleanupPending = false;
    try {
      await discordClient.deleteMessage(pendingChannelId, reportId);
    } catch (error) {
      cleanupPending = true;
      onInvalidRecord(error, sourceMessage);
    }

    const decided = parseReportMessage(destinationMessage, {
      expectedStatus: status,
    });
    return {
      report: status === "approved" ? toPublicReport(decided) : decided,
      cleanupPending,
    };
  }

  return { create, listApproved, listPending, getApprovedById, decide };
}
