export const DISCORD_API_BASE = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DiscordApiError";
    this.status = details.status ?? null;
    this.discordCode = details.discordCode ?? null;
    this.method = details.method ?? null;
    this.path = details.path ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.body = details.body ?? null;
  }
}

const defaultSleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * 429 응답이 알려주는 대기 시간(초)을 밀리초로 바꾼다.
 * 본문의 retry_after를 우선 보고, 없으면 Retry-After 헤더를 본다.
 */
function readRetryAfterMs(body, headers) {
  const fromBody =
    body && typeof body === "object" ? Number(body.retry_after) : NaN;
  if (Number.isFinite(fromBody)) return Math.ceil(fromBody * 1000);

  const fromHeader = Number(headers?.get?.("retry-after"));
  if (Number.isFinite(fromHeader)) return Math.ceil(fromHeader * 1000);

  return null;
}

/**
 * Discord REST API 클라이언트.
 *
 * discord.js를 쓰지 않고 공식 HTTP API를 직접 호출한다. 의존성이 없어야
 * Termux 같은 제한된 환경에서 설치가 쉽고, 이 단계에서 필요한 요청이
 * 몇 개 되지 않는다.
 *
 * fetchImpl과 sleep을 주입받는 이유는 테스트에서 실제 네트워크를 타지 않기 위해서다.
 */
export function createDiscordClient({
  token,
  baseUrl = DISCORD_API_BASE,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  maxRetries = 3,
  timeoutMs = 10_000,
  userAgent = "WildriftReportBridge (https://github.com/runnerkiller/rift-archive, 0.4.0)",
} = {}) {
  if (!token) throw new Error("Discord 봇 토큰이 필요합니다.");
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "fetch를 사용할 수 없습니다. Node.js 20 이상이 필요합니다.",
    );
  }

  async function request(method, path, options = {}) {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      Authorization: `Bot ${token}`,
      "User-Agent": userAgent,
      Accept: "application/json",
    };
    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";
    if (options.body !== undefined && options.formData !== undefined) {
      throw new Error(
        "JSON body와 multipart formData를 동시에 보낼 수 없습니다.",
      );
    }

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const attemptStartedAt = Date.now();
      const timeout = AbortSignal.timeout(timeoutMs);
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method,
          headers,
          body:
            options.formData !== undefined
              ? options.formData
              : options.body === undefined
                ? undefined
                : JSON.stringify(options.body),
          signal: timeout,
        });
      } catch (cause) {
        // 네트워크 오류나 타임아웃. 남은 시도가 있으면 잠시 뒤 다시 시도한다.
        // /health가 원인 불명으로 오래 걸리는 문제를 진단하려고 시도마다
        // 걸린 시간을 남긴다. AbortSignal이 제때 작동하는지도 이 로그로 보인다.
        console.error(
          `Discord ${method} ${path} 시도 ${attempt + 1}/${maxRetries + 1} 실패 ` +
            `(${Date.now() - attemptStartedAt}ms 후, timeoutMs=${timeoutMs}): ` +
            `${cause?.name ?? "Error"}: ${cause?.message ?? cause}`,
        );
        lastError = new DiscordApiError("Discord에 연결하지 못했습니다.", {
          method,
          path,
        });
        lastError.cause = cause;
        if (attempt === maxRetries) throw lastError;
        await sleep(2 ** attempt * 500);
        continue;
      }

      console.log(
        `Discord ${method} ${path} 시도 ${attempt + 1}/${maxRetries + 1} ` +
          `-> ${response.status} (${Date.now() - attemptStartedAt}ms)`,
      );

      const text = await response.text();
      const body = parseBody(text);

      if (response.ok) return body;

      if (response.status === 429) {
        const retryAfterMs = readRetryAfterMs(body, response.headers) ?? 1000;
        lastError = new DiscordApiError("Discord 요청 한도에 걸렸습니다.", {
          status: 429,
          method,
          path,
          retryAfterMs,
          body,
        });
        if (attempt === maxRetries) throw lastError;
        await sleep(retryAfterMs);
        continue;
      }

      if (response.status >= 500) {
        lastError = new DiscordApiError("Discord 서버 오류입니다.", {
          status: response.status,
          method,
          path,
          body,
        });
        if (attempt === maxRetries) throw lastError;
        await sleep(2 ** attempt * 500);
        continue;
      }

      // 4xx는 다시 시도해도 결과가 같다. 설정이 틀렸을 가능성이 높으므로 즉시 알린다.
      throw new DiscordApiError(
        body && typeof body === "object" && body.message
          ? `Discord 요청이 거부되었습니다: ${body.message}`
          : "Discord 요청이 거부되었습니다.",
        {
          status: response.status,
          discordCode:
            body && typeof body === "object" ? (body.code ?? null) : null,
          method,
          path,
          body,
        },
      );
    }

    throw (
      lastError ??
      new DiscordApiError("Discord 요청에 실패했습니다.", {
        method,
        path,
      })
    );
  }

  return {
    request,
    /** 봇 토큰이 유효한지 확인하는 가장 가벼운 요청 */
    getCurrentUser: () => request("GET", "/users/@me"),
    getGuild: (guildId) => request("GET", `/guilds/${guildId}`),
    getGuildMember: (guildId, userId) =>
      request("GET", `/guilds/${guildId}/members/${userId}`),
    getChannel: (channelId) => request("GET", `/channels/${channelId}`),
    getMessage: (channelId, messageId) =>
      request("GET", `/channels/${channelId}/messages/${messageId}`),
    getChannelMessages: (channelId, query = {}) =>
      request("GET", `/channels/${channelId}/messages`, { query }),
    createMessage(channelId, payload, files = []) {
      if (!files.length) {
        return request("POST", `/channels/${channelId}/messages`, {
          body: payload,
        });
      }

      const form = new FormData();
      const attachments = files.map((file, index) => ({
        id: index,
        filename: file.filename,
        description: file.description,
      }));
      form.append("payload_json", JSON.stringify({ ...payload, attachments }));
      files.forEach((file, index) => {
        form.append(
          `files[${index}]`,
          new Blob([file.data], { type: file.contentType }),
          file.filename,
        );
      });
      return request("POST", `/channels/${channelId}/messages`, {
        formData: form,
      });
    },
    editMessage: (channelId, messageId, payload) =>
      request("PATCH", `/channels/${channelId}/messages/${messageId}`, {
        body: payload,
      }),
    deleteMessage: (channelId, messageId) =>
      request("DELETE", `/channels/${channelId}/messages/${messageId}`),
  };
}
