/**
 * 테스트용 가짜 fetch. 실제 Discord로 나가는 요청은 하나도 없다.
 *
 * 사용법:
 *   const fetchImpl = mockFetch([
 *     { status: 429, body: { retry_after: 0.2 } },
 *     { status: 200, body: { id: "1" } },
 *   ]);
 */
export function mockFetch(responses) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls = [];

  async function fetchImpl(url, init) {
    calls.push({ url, init });

    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (!next) throw new Error("준비된 가짜 응답이 없습니다.");

    if (next.throw) throw next.throw;

    const bodyText =
      typeof next.body === "string" ? next.body : JSON.stringify(next.body ?? {});

    const headers = new Map(
      Object.entries(next.headers ?? {}).map(([k, v]) => [
        k.toLowerCase(),
        String(v),
      ]),
    );

    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
      text: async () => bodyText,
    };
  }

  fetchImpl.calls = calls;
  return fetchImpl;
}

/** 대기 시간을 실제로 기다리지 않고 기록만 하는 sleep */
export function recordingSleep() {
  const waited = [];
  const sleep = async (ms) => {
    waited.push(ms);
  };
  sleep.waited = waited;
  return sleep;
}

/** wr-config 채널에 올라갈 법한 설정 메시지 본문을 만든다. */
export function configMessageContent(overrides = {}, { fenced = true } = {}) {
  const payload = {
    schemaVersion: 1,
    type: "config",
    publicList: true,
    reportSubmission: true,
    evidenceUpload: true,
    evidenceRequired: false,
    authentication: true,
    signup: true,
    voting: true,
    reporterIdentity: true,
    maintenanceMode: false,
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedByDiscordId: "111111111111111111",
    ...overrides,
  };
  const json = JSON.stringify(payload, null, 2);
  return fenced ? "협곡 기록소 설정입니다.\n```json\n" + json + "\n```" : json;
}
