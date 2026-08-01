(function () {
  class ApiError extends Error {
    constructor(status, code, message, details = null) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  function createApiClient(baseUrl) {
    const base = String(baseUrl || "").replace(/\/$/, "");
    if (!/^https?:\/\//.test(base)) {
      throw new Error("Discord 운영 모드에는 올바른 Bridge URL이 필요합니다.");
    }

    async function request(path, options = {}) {
      const response = await fetch(`${base}${path}`, {
        method: options.method || "GET",
        credentials: "include",
        headers: options.body ? { "Content-Type": "application/json" } : {},
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      if (response.status === 204) return null;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = payload.error || {};
        throw new ApiError(
          response.status,
          error.code || "request_failed",
          error.message || "서버 요청에 실패했습니다.",
          error.issues || null,
        );
      }
      return payload;
    }

    return {
      baseUrl: base,
      request,
      login(returnTo = `${location.pathname}${location.search}`) {
        location.href = `${base}/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`;
      },
    };
  }

  WR.ApiError = ApiError;
  WR.createApiClient = createApiClient;
})();
