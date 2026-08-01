/**
 * /health 응답을 만든다.
 *
 * Discord 왕복 한 번(GET /users/@me)과 설정 메시지 읽기로 상태를 판단한다.
 * 짧은 캐시를 두는 이유는 감시 도구가 이 주소를 주기적으로 찌를 때
 * Discord 요청 한도를 낭비하지 않기 위해서다.
 */
export function createHealthService({
  discordClient,
  configRepository,
  setup = {},
  version = "0.2.0",
  cacheTtlMs = 5_000,
  now = () => Date.now(),
  startedAt = Date.now(),
}) {
  let cache = null;

  async function probeDiscord() {
    const startedProbeAt = now();
    try {
      const user = await discordClient.getCurrentUser();
      return {
        connected: true,
        botUserId: user?.id ?? null,
        botUsername: user?.username ?? null,
        latencyMs: now() - startedProbeAt,
      };
    } catch (error) {
      return {
        connected: false,
        error: {
          message: error?.message ?? "알 수 없는 오류",
          status: error?.status ?? null,
        },
        latencyMs: now() - startedProbeAt,
      };
    }
  }

  async function probeConfig() {
    try {
      const result = await configRepository.get();
      return {
        loaded: true,
        schemaVersion: result.config.schemaVersion,
        updatedAt: result.config.updatedAt,
        stale: Boolean(result.stale),
        cached: Boolean(result.cached),
        warnings: result.warnings ?? [],
      };
    } catch (error) {
      return {
        loaded: false,
        error: {
          message: error?.message ?? "알 수 없는 오류",
          status: error?.status ?? null,
        },
      };
    }
  }

  async function check(options = {}) {
    if (!options.forceRefresh && cache && now() - cache.at < cacheTtlMs) {
      return { ...cache.value, cached: true };
    }

    const discord = await probeDiscord();
    // Discord에 붙지 못하면 설정도 읽을 수 없다. 실패가 뻔한 요청은 보내지 않는다.
    const config = discord.connected
      ? await probeConfig()
      : { loaded: false, skipped: true };

    let status = "ok";
    if (!discord.connected || !config.loaded) {
      status = "error";
    } else if (config.stale || (config.warnings?.length ?? 0) > 0) {
      status = "degraded";
    }

    const value = {
      status,
      version,
      checkedAt: new Date(now()).toISOString(),
      uptimeSeconds: Math.floor((now() - startedAt) / 1000),
      discord,
      config,
      setup,
    };

    cache = { at: now(), value };
    return { ...value, cached: false };
  }

  return { check };
}
