import { test } from "node:test";
import assert from "node:assert/strict";

import { createAuditRepository } from "../src/repositories/auditRepository.js";

test("감사 이벤트를 Discord 메시지로 저장한다", async () => {
  const calls = [];
  const repository = createAuditRepository({
    discordClient: {
      async createMessage(channelId, payload) {
        calls.push({ channelId, payload });
        return { id: "999999999999999999" };
      },
    },
    channelId: "111111111111111111",
    now: () => Date.parse("2026-08-01T12:00:00.000Z"),
  });
  const audit = await repository.create({
    action: "report.approved",
    targetId: "222222222222222222",
    actorDiscordId: "333333333333333333",
    before: { status: "pending" },
    after: { status: "approved" },
  });
  assert.equal(audit.auditMessageId, "999999999999999999");
  assert.match(calls[0].payload.content, /report\.approved/);
  assert.match(calls[0].payload.content, /```json/);
});
