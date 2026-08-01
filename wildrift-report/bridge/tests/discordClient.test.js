import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createDiscordClient,
  DiscordApiError,
  DISCORD_API_BASE,
} from "../src/discordClient.js";
import { mockFetch, recordingSleep } from "./helpers/mockDiscord.js";

function makeClient(responses, overrides = {}) {
  const fetchImpl = mockFetch(responses);
  const sleep = recordingSleep();
  const client = createDiscordClient({
    token: "test-token",
    fetchImpl,
    sleep,
    ...overrides,
  });
  return { client, fetchImpl, sleep };
}

describe("createDiscordClient", () => {
  test("토큰이 없으면 만들 수 없다", () => {
    assert.throws(() => createDiscordClient({ fetchImpl: () => {} }), /토큰/);
  });

  test("봇 인증 헤더를 붙인다", async () => {
    const { client, fetchImpl } = makeClient({
      status: 200,
      body: { id: "1" },
    });
    await client.getCurrentUser();

    const { url, init } = fetchImpl.calls[0];
    assert.equal(url, `${DISCORD_API_BASE}/users/@me`);
    assert.equal(init.headers.Authorization, "Bot test-token");
    assert.equal(init.method, "GET");
  });

  test("메시지 조회 경로가 올바르다", async () => {
    const { client, fetchImpl } = makeClient({
      status: 200,
      body: { id: "9", content: "hi" },
    });
    const message = await client.getMessage("123", "456");

    assert.equal(
      fetchImpl.calls[0].url,
      `${DISCORD_API_BASE}/channels/123/messages/456`,
    );
    assert.equal(message.content, "hi");
  });

  test("서버 멤버 역할 조회 경로가 올바르다", async () => {
    const { client, fetchImpl } = makeClient({
      status: 200,
      body: { roles: [] },
    });
    await client.getGuildMember("123", "456");
    assert.equal(
      fetchImpl.calls[0].url,
      `${DISCORD_API_BASE}/guilds/123/members/456`,
    );
  });

  test("메시지 삭제 요청을 보낸다", async () => {
    const { client, fetchImpl } = makeClient({ status: 204, body: "" });
    await client.deleteMessage("123", "456");
    assert.equal(
      fetchImpl.calls[0].url,
      `${DISCORD_API_BASE}/channels/123/messages/456`,
    );
    assert.equal(fetchImpl.calls[0].init.method, "DELETE");
  });

  test("채널 메시지 목록 쿼리를 보낸다", async () => {
    const { client, fetchImpl } = makeClient({ status: 200, body: [] });
    await client.getChannelMessages("123", { limit: 30, before: "456" });
    assert.equal(
      fetchImpl.calls[0].url,
      `${DISCORD_API_BASE}/channels/123/messages?limit=30&before=456`,
    );
  });

  test("사진이 없는 메시지는 JSON으로 생성한다", async () => {
    const { client, fetchImpl } = makeClient({
      status: 200,
      body: { id: "9" },
    });
    await client.createMessage("123", { content: "hello" });
    const call = fetchImpl.calls[0];
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(call.init.body), { content: "hello" });
  });

  test("사진이 있으면 Discord multipart 형식으로 생성한다", async () => {
    const { client, fetchImpl } = makeClient({
      status: 200,
      body: { id: "9" },
    });
    await client.createMessage("123", { content: "hello" }, [
      {
        data: Buffer.from("image"),
        contentType: "image/jpeg",
        filename: "evidence.jpg",
        description: "증거",
      },
    ]);
    const call = fetchImpl.calls[0];
    assert.ok(call.init.body instanceof FormData);
    assert.equal(call.init.headers["Content-Type"], undefined);
    const payload = JSON.parse(call.init.body.get("payload_json"));
    assert.equal(payload.attachments[0].filename, "evidence.jpg");
    assert.ok(call.init.body.get("files[0]") instanceof Blob);
  });

  test("429를 만나면 retry_after만큼 기다렸다가 다시 시도한다", async () => {
    const { client, sleep, fetchImpl } = makeClient([
      { status: 429, body: { retry_after: 0.25 } },
      { status: 200, body: { id: "ok" } },
    ]);

    const result = await client.getCurrentUser();

    assert.equal(result.id, "ok");
    assert.equal(fetchImpl.calls.length, 2);
    assert.deepEqual(sleep.waited, [250]);
  });

  test("본문에 retry_after가 없으면 Retry-After 헤더를 쓴다", async () => {
    const { client, sleep } = makeClient([
      { status: 429, body: {}, headers: { "Retry-After": "2" } },
      { status: 200, body: { id: "ok" } },
    ]);

    await client.getCurrentUser();
    assert.deepEqual(sleep.waited, [2000]);
  });

  test("429가 계속되면 마지막에 429 오류를 던진다", async () => {
    const { client, fetchImpl } = makeClient(
      { status: 429, body: { retry_after: 0.01 } },
      { maxRetries: 2 },
    );

    await assert.rejects(
      () => client.getCurrentUser(),
      (error) => {
        assert.ok(error instanceof DiscordApiError);
        assert.equal(error.status, 429);
        assert.equal(error.retryAfterMs, 10);
        return true;
      },
    );
    assert.equal(fetchImpl.calls.length, 3);
  });

  test("5xx는 지수 백오프로 다시 시도한다", async () => {
    const { client, sleep } = makeClient([
      { status: 500, body: {} },
      { status: 502, body: {} },
      { status: 200, body: { id: "ok" } },
    ]);

    const result = await client.getCurrentUser();

    assert.equal(result.id, "ok");
    assert.deepEqual(sleep.waited, [500, 1000]);
  });

  test("401 같은 4xx는 다시 시도하지 않고 바로 알린다", async () => {
    const { client, fetchImpl } = makeClient({
      status: 401,
      body: { message: "401: Unauthorized", code: 0 },
    });

    await assert.rejects(
      () => client.getCurrentUser(),
      (error) => {
        assert.equal(error.status, 401);
        assert.match(error.message, /401: Unauthorized/);
        return true;
      },
    );
    assert.equal(fetchImpl.calls.length, 1, "4xx는 재시도하면 안 된다");
  });

  test("네트워크 오류는 재시도 후 연결 실패로 보고한다", async () => {
    const { client, fetchImpl } = makeClient(
      { throw: new Error("getaddrinfo ENOTFOUND") },
      { maxRetries: 1 },
    );

    await assert.rejects(
      () => client.getCurrentUser(),
      (error) => {
        assert.ok(error instanceof DiscordApiError);
        assert.match(error.message, /연결하지 못했습니다/);
        return true;
      },
    );
    assert.equal(fetchImpl.calls.length, 2);
  });

  test("JSON이 아닌 본문도 오류로 감싼다", async () => {
    const { client } = makeClient({ status: 400, body: "<html>nope</html>" });

    await assert.rejects(
      () => client.getCurrentUser(),
      (error) => {
        assert.equal(error.status, 400);
        assert.equal(error.body, "<html>nope</html>");
        return true;
      },
    );
  });
});
